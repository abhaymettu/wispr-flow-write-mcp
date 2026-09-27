#!/usr/bin/env node
// MCP server for the Wispr Flow personal dictionary. Uses the same endpoint and
// item shape the desktop app uses for its own dictionary sync.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = 'https://api.wisprflow.ai/api/v1/dictionary/personal';
const SESSION = join(homedir(), 'Library/Application Support/Wispr Flow/session.json');
const PERSONAL = '00000000-0000-0000-0000-000000000000';

// The app keeps its Supabase session in plaintext here. Read it fresh each call and
// never refresh it ourselves: refreshing rotates the refresh token and would sign the app out.
function token() {
  let session;
  try {
    const file = JSON.parse(readFileSync(SESSION, 'utf8'));
    session = JSON.parse(file[Object.keys(file).find((k) => /^sb-.*-auth-token$/.test(k))]);
  } catch {
    throw new Error(`No Wispr Flow session found at ${SESSION}. Open Wispr Flow and sign in.`);
  }
  if (session.expires_at * 1000 < Date.now()) {
    throw new Error('Wispr Flow session has expired. Open the Wispr Flow app so it refreshes its session, then retry.');
  }
  return session.access_token;
}

async function api(method, body) {
  const res = await fetch(API, {
    method,
    headers: { Authorization: token(), 'Content-Type': 'application/json' }, // raw token, no "Bearer"
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wispr Flow API ${method} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const personalItems = async () => (await api('GET')).filter((i) => i.team_dictionary_id === PERSONAL);

function newItem(word, replacement) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), team_dictionary_id: PERSONAL, word, replacement: replacement ?? null,
    replacement_html: null, is_manual: true, created_at: now, modified_at: now, is_deleted: false,
    frequency_used: 0, last_used: null, source: 'manual', observed_source: null, is_snippet: false,
  };
}

// Words the dictionary already holds are skipped; previously deleted ones are revived
// in place, since the app keys items on word + team.
async function addWords(entries) {
  const byWord = new Map((await personalItems()).map((i) => [i.word, i]));
  const now = new Date().toISOString();
  const changes = [];
  const skipped = [];
  for (const { word, replacement } of entries) {
    const existing = byWord.get(word);
    if (existing && !existing.is_deleted) { skipped.push(word); continue; }
    const item = existing
      ? { ...existing, is_deleted: false, is_manual: true, replacement: replacement ?? null, modified_at: now }
      : newItem(word, replacement);
    byWord.set(word, item);
    changes.push(item);
  }
  if (changes.length) await api('POST', changes);
  return { added: changes.map((i) => i.word), skipped };
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const word = z.string().trim().min(1).max(255);

const server = new McpServer({ name: 'wispr-flow-dictionary', version: '0.1.0' });

server.registerTool('list_words', {
  description: 'List words in the Wispr Flow personal dictionary. Optional case-insensitive substring filter.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => {
  const q = query?.toLowerCase();
  const words = (await personalItems())
    .filter((i) => !i.is_deleted && (!q || i.word.toLowerCase().includes(q)))
    .map((i) => (i.replacement ? `${i.word} -> ${i.replacement}` : i.word))
    .sort((a, b) => a.localeCompare(b));
  return text(`${words.length} words\n${words.join('\n')}`);
});

server.registerTool('add_word', {
  description: 'Add a word to the Wispr Flow personal dictionary, optionally with a replacement that Flow writes instead.',
  inputSchema: { word, replacement: z.string().max(255).optional() },
}, async (entry) => text(await addWords([entry])));

server.registerTool('bulk_add', {
  description: 'Add many words to the Wispr Flow personal dictionary in one request. Existing words are skipped.',
  inputSchema: { words: z.array(word).min(1).max(1000) },
}, async ({ words }) => text(await addWords(words.map((w) => ({ word: w })))));

server.registerTool('remove_word', {
  description: 'Remove a word from the Wispr Flow personal dictionary. Exact match first, then a unique case-insensitive match.',
  inputSchema: { word },
}, async ({ word: target }) => {
  const live = (await personalItems()).filter((i) => !i.is_deleted);
  let matches = live.filter((i) => i.word === target);
  if (!matches.length) matches = live.filter((i) => i.word.toLowerCase() === target.toLowerCase());
  if (matches.length !== 1) {
    const reason = matches.length ? `matches ${matches.map((i) => i.word).join(', ')}; pass the exact word` : 'is not in the dictionary';
    return { ...text(`"${target}" ${reason}.`), isError: true };
  }
  // Soft delete with a newer modified_at, which is how the app deletes and what its sync propagates.
  await api('POST', [{ ...matches[0], is_deleted: true, modified_at: new Date().toISOString() }]);
  return text({ removed: matches[0].word });
});

await server.connect(new StdioServerTransport());
