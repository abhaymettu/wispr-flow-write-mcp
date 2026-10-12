import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const session = join(mkdtempSync(join(tmpdir(), 'wispr-prefs-')), 'session.json');
writeFileSync(session, JSON.stringify({ 'sb-test-auth-token': JSON.stringify({ access_token: 'fake', expires_at: Date.now()/1000+3600 }) }));
let prefs, writes, reads, conflict, context, malformed, http, client;
beforeEach(() => {
  prefs = { privacy_mode: false, share_data: true, cloud_sync: true, personalization_styles: { email: 'casual', work: 'formal' }, unknown_future_field: { keep: true } };
  writes=[]; reads=0; conflict=false; malformed=false;
  context={ writing_samples: { email: ['synthetic sample'] }, polish_prompts: { polish_prompt_1: { prompt_name: 'Shorten', prompt: 'Shorten it', shortcut: ['ctrl','1'] } }, unrelated: 'preserve' };
});
before(async () => {
  http=createServer((req,res) => {
    let raw=''; req.on('data', c=>raw+=c); req.on('end',()=>{
      res.setHeader('Content-Type','application/json');
      if (req.method==='GET') reads++;
      if (req.url.endsWith('/user/preferences')) {
        if(req.method==='POST') { writes.push(JSON.parse(raw)); if(conflict) {res.writeHead(409); return res.end('{"detail":"conflict"}');} prefs=JSON.parse(raw).preferences; return res.end('{"modified_at":"v2"}'); }
        return res.end(JSON.stringify({preferences:prefs,modified_at:'v1'}));
      }
      if (req.url.endsWith('/user_context')) {
        if(req.method==='PUT') { writes.push(JSON.parse(raw)); Object.assign(context,JSON.parse(raw)); }
        return res.end(JSON.stringify(context));
      }
      if(req.url.endsWith('/notes/sync')) { const b=JSON.parse(raw); return res.end(JSON.stringify({pull: malformed ? {} : [], next_cursor: 'stuck'})); }
      res.writeHead(404);res.end('{}');
    });
  });
  await new Promise(r=>http.listen(0,'127.0.0.1',r));
  client=new Client({name:'protocol-test',version:'0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[new URL('../index.js',import.meta.url).pathname],env:{...process.env,WISPR_FLOW_API:`http://127.0.0.1:${http.address().port}/api/v1`,WISPR_FLOW_SESSION:session}}));
});
after(async()=>{await client.close();http.close();});
const call=async(name,args={})=>{ const r=await client.callTool({name,arguments:args}); const out=r.content[0].text;return {error:!!r.isError,out,json:r.isError?null:JSON.parse(out)};};
test('privacy mode normalizes both fields and preserves unrelated preferences',async()=>{
  const r=await call('update_preferences',{privacy_mode:true});assert.equal(r.error,false);
  assert.equal(writes[0].preferences.share_data,false);assert.equal(writes[0].preferences.privacy_mode,true);
  assert.deepEqual(writes[0].preferences.unknown_future_field,{keep:true});assert.equal(writes[0].modified_at,'v1');
});
test('share_data normalizes privacy_mode',async()=>{ await call('update_preferences',{share_data:false}); assert.equal(writes[0].preferences.privacy_mode,true); });
test('contradictory privacy settings reject before reads or writes',async()=>{
  assert.match((await call('update_preferences',{privacy_mode:true,share_data:true})).out,/opposites/);assert.equal(reads,0);assert.equal(writes.length,0);
});
test('dry run merges nested styles but never sends dry_run to API',async()=>{
  const r=await call('update_preferences',{dry_run:true,personalization_styles:{email:'formal'},personalizationOnboardingCompleted:true});
  assert.equal(r.json.dry_run,true);assert.equal(r.json.would_write.preferences.personalizationOnboardingCompleted,true);
  assert.equal(r.json.would_write.preferences.personalization_styles.work,'formal');assert.equal(writes.length,0);
  assert.equal('dry_run' in r.json.would_write.preferences,false);
});
test('empty preferences patch fails without network',async()=>{ assert.equal((await call('update_preferences',{dry_run:true})).error,true);assert.equal(reads,0); });
test('409 conflict never retries or claims success',async()=>{conflict=true;assert.equal((await call('update_preferences',{cloud_sync:false})).error,true);assert.equal(writes.length,1);});
test('read user context exposes only supported fields without writing',async()=>{assert.deepEqual((await call('get_user_context')).json,{writing_samples:context.writing_samples,polish_prompts:context.polish_prompts});assert.equal(writes.length,0);});
test('updating a transform preserves writing samples and its shortcut',async()=>{await call('set_transform',{name:'Shorten',prompt:'Make it short'});assert.equal(writes[0].writing_samples,undefined);assert.deepEqual(context.writing_samples,{email:['synthetic sample']});assert.deepEqual(writes[0].polish_prompts.polish_prompt_1.shortcut,['ctrl','1']);});
test('repeating sync cursor terminates instead of looping forever',async()=>{const r=await call('list_notes');assert.equal(r.error,true);assert.match(r.out,/pagination did not finish/);assert.equal(writes.length,0);});
test('malformed sync list fails clearly',async()=>{malformed=true;const r=await call('list_notes');assert.equal(r.error,true);assert.match(r.out,/not an array/);});
