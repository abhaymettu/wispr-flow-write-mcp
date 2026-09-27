#!/usr/bin/env node
// Write-side MCP server for Wispr Flow. Every tool uses the same endpoint and payload
// shape the desktop app uses for its own sync, so the app pulls the change on its next sync.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = 'https://api.wisprflow.ai/api/v1';
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

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: token(), 'Content-Type': 'application/json' }, // raw token, no "Bearer"
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wispr Flow API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Notes, todos and meetings share one sync protocol: POST changed items, get back every
// item changed since last_sync_time. Sending "0" pulls everything; cursors page through it.
async function pullAll(path, listKey, body, reqCursor, resCursor) {
  const items = [];
  let cursor = null;
  do {
    const page = await api('POST', path, { ...body, last_sync_time: '0', hard_refresh: false, ...(cursor && { [reqCursor]: cursor }) });
    items.push(...page[listKey]);
    cursor = page[resCursor] ?? null;
  } while (cursor);
  return items;
}

function findById(items, itemId, label) {
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new Error(`No ${label} with id ${itemId}.`);
  return item;
}

// Pulled timestamps are naive UTC ISO strings; pushes want epoch milliseconds as strings.
const epoch = (iso) => String(Date.parse(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`));
const now = () => String(Date.now());

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ ...text(message), isError: true });
const word = z.string().trim().min(1).max(255);
const id = z.string().uuid();

const server = new McpServer({ name: 'wispr-flow-write', version: '0.2.0' });

// ---- Dictionary and snippets: one list, snippets are items with is_snippet set.

const personalItems = async () => (await api('GET', '/dictionary/personal')).filter((i) => i.team_dictionary_id === PERSONAL);

function newItem(word, replacement, isSnippet) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), team_dictionary_id: PERSONAL, word, replacement: replacement ?? null,
    replacement_html: null, is_manual: true, created_at: now, modified_at: now, is_deleted: false,
    frequency_used: 0, last_used: null, source: 'manual', observed_source: null, is_snippet: isSnippet,
  };
}

// Words the dictionary already holds are skipped; previously deleted ones are revived
// in place, since the app keys items on word + team.
async function addWords(entries, isSnippet = false) {
  const byWord = new Map((await personalItems()).map((i) => [i.word, i]));
  const now = new Date().toISOString();
  const changes = [];
  const skipped = [];
  for (const { word, replacement } of entries) {
    const existing = byWord.get(word);
    if (existing && !existing.is_deleted) { skipped.push(word); continue; }
    const item = existing
      ? { ...existing, is_deleted: false, is_manual: true, is_snippet: isSnippet, replacement: replacement ?? null, modified_at: now }
      : newItem(word, replacement, isSnippet);
    byWord.set(word, item);
    changes.push(item);
  }
  if (changes.length) await api('POST', '/dictionary/personal', changes);
  return { added: changes.map((i) => i.word), skipped };
}

async function listItems(query, snippets) {
  const q = query?.toLowerCase();
  const lines = (await personalItems())
    .filter((i) => !i.is_deleted && !!i.is_snippet === snippets && (!q || i.word.toLowerCase().includes(q)))
    .map((i) => (i.replacement ? `${i.word} -> ${i.replacement}` : i.word))
    .sort((a, b) => a.localeCompare(b));
  return text(`${lines.length} ${snippets ? 'snippets' : 'words'}\n${lines.join('\n')}`);
}

server.registerTool('list_words', {
  description: 'List words in the Wispr Flow personal dictionary (snippets excluded). Optional case-insensitive substring filter.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => listItems(query, false));

server.registerTool('add_word', {
  description: 'Add a word to the Wispr Flow personal dictionary, optionally with a replacement that Flow writes instead.',
  inputSchema: { word, replacement: z.string().max(255).optional() },
}, async (entry) => text(await addWords([entry])));

server.registerTool('bulk_add', {
  description: 'Add many words to the Wispr Flow personal dictionary in one request. Existing words are skipped.',
  inputSchema: { words: z.array(word).min(1).max(1000) },
}, async ({ words }) => text(await addWords(words.map((w) => ({ word: w })))));

server.registerTool('remove_word', {
  description: 'Remove a word or snippet from the Wispr Flow personal dictionary. Exact match first, then a unique case-insensitive match.',
  inputSchema: { word },
}, async ({ word: target }) => {
  const live = (await personalItems()).filter((i) => !i.is_deleted);
  let matches = live.filter((i) => i.word === target);
  if (!matches.length) matches = live.filter((i) => i.word.toLowerCase() === target.toLowerCase());
  if (matches.length !== 1) {
    const reason = matches.length ? `matches ${matches.map((i) => i.word).join(', ')}; pass the exact word` : 'is not in the dictionary';
    return fail(`"${target}" ${reason}.`);
  }
  // Soft delete with a newer modified_at, which is how the app deletes and what its sync propagates.
  await api('POST', '/dictionary/personal', [{ ...matches[0], is_deleted: true, modified_at: new Date().toISOString() }]);
  return text({ removed: matches[0].word });
});

server.registerTool('list_snippets', {
  description: 'List Wispr Flow snippets (spoken trigger -> expanded text). Optional case-insensitive filter on the trigger.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => listItems(query, true));

server.registerTool('add_snippet', {
  description: 'Add a Wispr Flow snippet: when you say the trigger phrase, Flow types the expansion instead. Remove with remove_word.',
  inputSchema: { trigger: word, expansion: z.string().min(1).max(10000) },
}, async ({ trigger, expansion }) => text(await addWords([{ word: trigger, replacement: expansion }], true)));

// ---- Preferences: styles, polish instructions, languages, cleanup, privacy, notetaker.

const style = z.enum(['formal', 'casual', 'veryCasual', 'excited', 'default']);

server.registerTool('get_preferences', {
  description: 'Show Wispr Flow synced preferences: writing styles per context, polish instructions, output languages, cleanup level, privacy and notetaker settings.',
  inputSchema: {},
}, async () => text((await api('GET', '/user/preferences')).preferences));

// Nested objects merge key by key; null deletes a key (used to drop a custom polish instruction).
function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base?.[k] ?? {}, v) : v;
  }
  return out;
}

server.registerTool('update_preferences', {
  description: 'Change Wispr Flow synced preferences. Only the fields given change; nested objects merge. Styles apply per context (personal = messages, work = Slack/Teams, email, other). polish_instructions.custom maps your own instruction text to on/off; set one to null to delete it.',
  inputSchema: {
    personalization_styles: z.object({ personal: style, work: style, email: style, other: style }).partial().optional(),
    polish_instructions: z.object({
      default: z.record(z.string(), z.boolean()),
      custom: z.record(z.string().min(1).max(500), z.boolean().nullable()),
    }).partial().optional(),
    output_languages: z.array(z.string().max(8)).min(1).optional().describe('Language codes, e.g. ["en"], ["en", "es"]'),
    auto_cleanup_level: z.enum(['none', 'light', 'medium', 'high', 'full']).optional(),
    privacy_mode: z.boolean().optional(),
    share_data: z.boolean().optional(),
    cloud_sync: z.boolean().optional().describe('Turning this off also stops this server\'s changes from reaching the app.'),
    teammates_added_digest_enabled: z.boolean().optional(),
    notetaker_transcript_retention: z.enum(['never_delete', '1_day', '7_days', '30_days', '90_days', '180_days', '365_days']).optional(),
    notetaker_preference: z.object({
      default_note_visibility: z.enum(['anyone_with_link', 'domain', 'invited_only']),
      notetaker_calendar_notice: z.enum(['off', 'notice_only', 'notice_and_link']),
      notetaker_auto_share_notes: z.enum(['off', 'domain', 'all']),
      notetaker_auto_share_notes_type: z.enum(['all', 'calendar_notice']),
    }).partial().optional(),
  },
}, async (patch) => {
  const current = await api('GET', '/user/preferences');
  const preferences = merge(current.preferences, JSON.parse(JSON.stringify(patch)));
  // modified_at must match the server's; a newer server copy returns 409 and nothing is written.
  await api('POST', '/user/preferences', { preferences, modified_at: current.modified_at });
  return text(preferences);
});

// ---- Transforms: custom prompts stored in user_context.polish_prompts, one per slot.

const SLOTS = Array.from({ length: 9 }, (_, i) => `polish_prompt_${i + 1}`);
const transforms = async () => (await api('GET', '/user_context'))?.polish_prompts ?? {};
const findTransform = (all, name) => Object.entries(all).find(([slot, t]) => SLOTS.includes(slot) && t?.prompt_name?.trim().toLowerCase() === name.toLowerCase());

server.registerTool('list_transforms', {
  description: 'List your custom Wispr Flow transforms (named prompts that rewrite selected or dictated text).',
  inputSchema: {},
}, async () => {
  const all = Object.entries(await transforms()).filter(([, t]) => t?.prompt_name);
  return text(all.length ? all.map(([slot, t]) => `${t.prompt_name} (${slot}): ${t.prompt}`).join('\n') : 'No custom transforms.');
});

server.registerTool('set_transform', {
  description: 'Create a custom Wispr Flow transform, or replace the prompt of the one with this name. Up to 9. Keyboard shortcuts are bound in the app.',
  inputSchema: { name: z.string().trim().min(1).max(100), prompt: z.string().trim().min(1).max(10000) },
}, async ({ name, prompt }) => {
  const all = await transforms();
  const existing = findTransform(all, name);
  const slot = existing?.[0] ?? SLOTS.find((s) => !all[s]);
  if (!slot) return fail('All 9 transform slots are in use. Remove one first.');
  await api('PUT', '/user_context', { polish_prompts: { ...all, [slot]: { shortcut: [], ...existing?.[1], prompt, prompt_name: name } } });
  return text({ [existing ? 'updated' : 'created']: name, slot });
});

server.registerTool('remove_transform', {
  description: 'Delete a custom Wispr Flow transform by name.',
  inputSchema: { name: z.string().trim().min(1) },
}, async ({ name }) => {
  const all = await transforms();
  const existing = findTransform(all, name);
  if (!existing) return fail(`No transform named "${name}".`);
  const { [existing[0]]: _, ...rest } = all;
  await api('PUT', '/user_context', { polish_prompts: Object.keys(rest).length ? rest : null });
  return text({ removed: existing[1].prompt_name });
});

// ---- Scratchpad notes.

const syncNotes = (notes) => api('POST', '/notes/sync', { notes, last_sync_time: now(), hard_refresh: false, image_uploads: [], refresh_image_ids: [] });
const pullNotes = async () => (await pullAll('/notes/sync', 'pull', { notes: [], image_uploads: [], refresh_image_ids: [] }, 'cursor', 'next_cursor')).filter((n) => !n.is_deleted);
const titleFrom = (content) => content.trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 255);

const findNote = async (noteId) => {
  const note = findById(await pullNotes(), noteId, 'scratchpad note');
  return { ...note, created_at: epoch(note.created_at) };
};

server.registerTool('list_notes', {
  description: 'List Wispr Flow scratchpad notes with ids, newest first. Optional case-insensitive filter on title and content.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => {
  const q = query?.toLowerCase();
  const notes = (await pullNotes())
    .filter((n) => !q || `${n.title}\n${n.content}`.toLowerCase().includes(q))
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
    .map((n) => `${n.id}  ${n.title}  |  ${n.content.slice(0, 120).replace(/\s+/g, ' ')}`);
  return text(`${notes.length} notes\n${notes.join('\n')}`);
});

server.registerTool('add_note', {
  description: 'Create a Wispr Flow scratchpad note. Title defaults to the first three words, as the app does.',
  inputSchema: { content: z.string().min(1).max(100000), title: z.string().trim().min(1).max(255).optional() },
}, async ({ content, title }) => {
  const note = { id: randomUUID(), title: title ?? titleFrom(content), content, created_at: now(), modified_at: now(), is_deleted: false, image_keys: [] };
  await syncNotes([note]);
  return text({ created: note.id, title: note.title });
});

server.registerTool('update_note', {
  description: 'Replace the content and/or title of a Wispr Flow scratchpad note.',
  inputSchema: { id, content: z.string().min(1).max(100000).optional(), title: z.string().trim().min(1).max(255).optional() },
}, async ({ id: noteId, content, title }) => {
  const note = await findNote(noteId);
  await syncNotes([{ ...note, ...(content !== undefined && { content }), ...(title && { title }), modified_at: now() }]);
  return text({ updated: noteId });
});

server.registerTool('delete_note', {
  description: 'Delete a Wispr Flow scratchpad note.',
  inputSchema: { id },
}, async ({ id: noteId }) => {
  const note = await findNote(noteId);
  await syncNotes([{ ...note, is_deleted: true, modified_at: now() }]);
  return text({ deleted: noteId, title: note.title });
});

// ---- Todos.

const syncTodos = (todos) => api('POST', '/todos/sync', { todos, last_sync_time: now(), page_cursor: null, hard_refresh: false });
const pullTodos = async () => (await pullAll('/todos/sync', 'todos', { todos: [] }, 'page_cursor', 'next_page_cursor')).filter((t) => !t.is_deleted);
const todoPush = (t) => ({
  id: t.id, meeting_id: t.meeting_id ?? null, title: t.title, status: t.status, is_archived: !!t.is_archived,
  is_deleted: !!t.is_deleted, created_at: epoch(t.created_at), modified_at: now(),
});

const findTodo = async (todoId) => findById(await pullTodos(), todoId, 'todo');

server.registerTool('list_todos', {
  description: 'List Wispr Flow todos with ids. Archived ones are hidden unless include_archived is set.',
  inputSchema: { include_archived: z.boolean().optional() },
}, async ({ include_archived }) => {
  const todos = (await pullTodos())
    .filter((t) => include_archived || !t.is_archived)
    .map((t) => `${t.id}  [${t.status === 'done' ? 'x' : ' '}] ${t.title}${t.is_archived ? ' (archived)' : ''}`);
  return text(`${todos.length} todos\n${todos.join('\n')}`);
});

server.registerTool('add_todo', {
  description: 'Add an open todo to Wispr Flow.',
  inputSchema: { title: z.string().trim().min(1).max(2000) },
}, async ({ title }) => {
  const todo = { id: randomUUID(), meeting_id: null, title, status: 'open', is_archived: false, is_deleted: false, created_at: now(), modified_at: now() };
  await syncTodos([todo]);
  return text({ created: todo.id, title });
});

server.registerTool('update_todo', {
  description: 'Change a Wispr Flow todo: title, status (open or done), or archived.',
  inputSchema: { id, title: z.string().trim().min(1).max(2000).optional(), status: z.enum(['open', 'done']).optional(), archived: z.boolean().optional() },
}, async ({ id: todoId, title, status, archived }) => {
  const todo = await findTodo(todoId);
  await syncTodos([todoPush({ ...todo, ...(title && { title }), ...(status && { status }), ...(archived !== undefined && { is_archived: archived }) })]);
  return text({ updated: todoId });
});

server.registerTool('delete_todo', {
  description: 'Delete a Wispr Flow todo.',
  inputSchema: { id },
}, async ({ id: todoId }) => {
  const todo = await findTodo(todoId);
  await syncTodos([todoPush({ ...todo, is_deleted: true })]);
  return text({ deleted: todoId, title: todo.title });
});

// ---- Meetings: title and notes only. Transcripts, sharing and deletion stay in the app.

server.registerTool('update_meeting', {
  description: 'Rename a Wispr Flow meeting or replace its notes. Find meeting ids with the official Wispr Flow MCP (search_meetings).',
  inputSchema: { id, title: z.string().trim().min(1).max(500).optional(), notes: z.string().max(200000).optional() },
}, async ({ id: meetingId, title, notes }) => {
  if (title === undefined && notes === undefined) return fail('Pass a title, notes, or both.');
  const pull = await pullAll('/meetings/sync', 'pull', { meetings: [], supports_refined_stamp_fetch: true }, 'cursor', 'next_cursor');
  const m = pull.find((x) => x.id === meetingId && !x.is_deleted);
  if (!m) return fail(`No meeting with id ${meetingId}.`);
  // The same fields the app pushes, copied from the server copy so nothing else changes.
  const meeting = {
    id: m.id, title: title ?? m.title, created_at: epoch(m.created_at), modified_at: now(), is_deleted: false,
    finalized: m.finalized, live_transcript_uploaded: !!m.live_transcript_uploaded, calendar_external_id: m.calendar_external_id,
    calendar_event_id: m.calendar_event_id, ended_at: m.ended_at && new Date(Number(epoch(m.ended_at))).toISOString(),
    recorded_ms: m.recorded_ms, import_source: m.import_source, ...(notes !== undefined && { notes }),
  };
  const res = await api('POST', '/meetings/sync', { meetings: [meeting], last_sync_time: now(), hard_refresh: false, supports_refined_stamp_fetch: true });
  if (res.rejected?.length) return fail(`Server rejected the change: ${JSON.stringify(res.rejected)}`);
  return text({ updated: meetingId, title: meeting.title });
});

// ---- Profile.

server.registerTool('update_profile', {
  description: 'Change the first and/or last name on your Wispr Flow account.',
  inputSchema: { first_name: z.string().trim().min(1).max(100).optional(), last_name: z.string().trim().min(1).max(100).optional() },
}, async ({ first_name, last_name }) => {
  const current = await api('GET', '/user/profile');
  const profile = { first_name: first_name ?? current.first_name, last_name: last_name ?? current.last_name };
  await api('PUT', '/user/profile', profile);
  return text(profile);
});

await server.connect(new StdioServerTransport());
