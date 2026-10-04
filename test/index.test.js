// Runs the real server over stdio against a fake dictionary API. Offline; no Wispr account needed.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PERSONAL = '00000000-0000-0000-0000-000000000000';
const sessionFile = join(mkdtempSync(join(tmpdir(), 'wispr-test-')), 'session.json');
const writeSession = (access_token, expires_at = Date.now() / 1000 + 3600) =>
  writeFileSync(sessionFile, JSON.stringify({ 'sb-test-auth-token': JSON.stringify({ access_token, expires_at }) }));

let dict, posts, failures, validToken, http, client;
const item = (word, extra) => ({ id: word, word, team_dictionary_id: PERSONAL, is_deleted: false, is_snippet: false, replacement: null, ...extra });

beforeEach(() => {
  dict = [item('Wispr'), item('GitHub'), item('brb', { is_snippet: true, replacement: 'be right back' }), item('gone', { is_deleted: true })];
  posts = [];
  failures = [];
  validToken = 'tok-1';
  writeSession('tok-1');
});

before(async () => {
  http = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const fail = failures.shift();
      if (fail) {
        fail.onHit?.();
        res.writeHead(fail.status, { 'Content-Type': fail.type ?? 'application/json' });
        return res.end(fail.body ?? '');
      }
      if (req.headers.authorization !== validToken) { res.writeHead(401); return res.end('{"detail":"Invalid token"}'); }
      if (req.method === 'POST') {
        const changes = JSON.parse(body);
        posts.push(changes);
        for (const c of changes) dict = [...dict.filter((i) => i.id !== c.id), c];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.method === 'GET' ? dict : { ok: true }));
    });
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../index.js', import.meta.url).pathname],
    env: { ...process.env, WISPR_FLOW_API: `http://127.0.0.1:${http.address().port}/api/v1`, WISPR_FLOW_SESSION: sessionFile },
  }));
});

after(async () => {
  await client.close();
  http.close();
});

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const out = res.content[0].text;
  return { error: !!res.isError, out, json: res.isError ? null : JSON.parse(out) };
};

test('existing tool names are all still registered', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ['list_words', 'add_word', 'bulk_add', 'remove_word', 'list_snippets', 'add_snippet', 'get_preferences',
    'update_preferences', 'list_transforms', 'set_transform', 'remove_transform', 'list_notes', 'add_note', 'update_note',
    'delete_note', 'list_todos', 'add_todo', 'update_todo', 'delete_todo', 'update_meeting', 'update_profile', 'find_word']) {
    assert.ok(names.includes(n), n);
  }
});

test('add_word skips a word present in another casing and names it', async () => {
  const { json } = await call('add_word', { word: 'wispr' });
  assert.deepEqual(json, { added: [], skipped: ['wispr (already a word as "Wispr")'] });
  assert.equal(posts.length, 0);
});

test('add_word trims input and revives a deleted word in place', async () => {
  const { json } = await call('add_word', { word: '  gone ' });
  assert.deepEqual(json.added, ['gone']);
  assert.equal(posts[0][0].id, 'gone');
  assert.equal(posts[0][0].is_deleted, false);
});

test('add_word rejects a multi-line word', async () => {
  const { error, out } = await call('add_word', { word: 'two\nlines' });
  assert.ok(error);
  assert.match(out, /one line/);
});

test('bulk_add dedupes input, skips existing and invalid, and writes once', async () => {
  const { json } = await call('bulk_add', { words: ['Ponytail', 'ponytail', '', '  ', 'github', 'BRB', 'bad\tword', 'Instinct'] });
  assert.deepEqual(json.added, ['Ponytail', 'Instinct']);
  assert.deepEqual(json.skipped, [
    'bad\tword (must be one line with no control characters)',
    'ponytail (repeated in input)',
    'github (already a word as "GitHub")',
    'BRB (already a snippet as "brb")',
  ]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].map((i) => i.word), ['Ponytail', 'Instinct']);
});

test('bulk_add dry_run writes nothing', async () => {
  const { json } = await call('bulk_add', { words: ['Ponytail', 'Wispr'], dry_run: true });
  assert.deepEqual(json, { would_add: ['Ponytail'], skipped: ['Wispr (already a word)'] });
  assert.equal(posts.length, 0);
});

test('find_word matches ignoring case and suggests near misses', async () => {
  assert.deepEqual((await call('find_word', { word: 'BRB' })).json, { found: true, matches: [{ word: 'brb', type: 'snippet', replacement: 'be right back' }] });
  assert.deepEqual((await call('find_word', { word: 'git' })).json, { found: false, similar: ['GitHub'] });
  assert.deepEqual((await call('find_word', { word: 'gone' })).json, { found: false, similar: [] });
});

test('remove_word removes exact duplicates together, refuses ambiguity, suggests near misses', async () => {
  dict.push(item('Wispr', { id: 'dup' }), item('WISPR'));
  assert.deepEqual((await call('remove_word', { word: 'Wispr' })).json, { removed: 'Wispr', duplicates_removed: 1 });
  dict.push(item('flow'), item('Flow'));
  assert.match((await call('remove_word', { word: 'FLOW' })).out, /matches flow, Flow\. Pass the exact word/);
  assert.match((await call('remove_word', { word: 'Git' })).out, /not in the dictionary\. Similar: GitHub/);
});

test('a 401 retries once when the app has rotated its token', async () => {
  failures.push({ status: 401, body: '{"detail":"expired"}', onHit: () => { validToken = 'tok-2'; writeSession('tok-2'); } });
  assert.deepEqual((await call('find_word', { word: 'Wispr' })).json.found, true);
});

test('a 401 with an unchanged token tells you to open the app', async () => {
  validToken = 'other';
  const { error, out } = await call('list_words', {});
  assert.ok(error);
  assert.match(out, /failed with 401: Invalid token\. The session was rejected\. Open the Wispr Flow app/);
});

test('a gateway error is retried once; a second shows the cleaned message', async () => {
  failures.push({ status: 503, type: 'text/html', body: '<html><h1>Service Unavailable</h1></html>' });
  assert.equal((await call('find_word', { word: 'Wispr' })).json.found, true);
  failures.push({ status: 502, type: 'text/html', body: '<html><h1>Bad Gateway</h1></html>' }, { status: 502, type: 'text/html', body: '<html><h1>Bad Gateway</h1></html>' });
  assert.match((await call('list_words', {})).out, /failed with 502: Bad Gateway\.$/);
});

test('an expired or missing session explains itself', async () => {
  writeSession('tok-1', Date.now() / 1000 - 590);
  assert.match((await call('list_words', {})).out, /expired 10 min ago\. Open the Wispr Flow app/);
  writeFileSync(sessionFile, '{}');
  assert.match((await call('list_words', {})).out, /signed out/);
});
