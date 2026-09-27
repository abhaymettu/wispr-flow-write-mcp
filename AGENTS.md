# AGENTS.md

Write-side MCP server for Wispr Flow. The official Wispr Flow MCP reads; this one writes. One file, `index.js`, Node ESM, no build step. Dependencies: `@modelcontextprotocol/sdk`, `zod`.

## Rules

- Speak only the HTTP contract the desktop app uses. Never write the app's `flow.sqlite`.
- Read the token from `~/Library/Application Support/Wispr Flow/session.json` on every call. Send it raw in `Authorization`, no `Bearer`. Never refresh it: refreshing rotates the refresh token and signs the app out.
- Deletes are soft: `is_deleted: true` plus a newer `modified_at`. Hard deletes don't propagate through the app's sync.
- Copy the app's payload shapes exactly. Before adding a surface, find the call site in the app bundle (`app.asar`, `.webpack/main/index.js`, the `AriaWebClient` class) and mirror the fields it sends.
- Stay out of billing, enterprise, team, referral, account deletion, device registration, telemetry, `/llm/*`, and anything that emails or shares with other people.

## Testing against the live API

There is no test suite; the API is the test. When you change a tool, run it through an MCP stdio client against your own account, then undo it:

1. Snapshot the surface first (GET, or a sync pull with `last_sync_time: "0"`).
2. Write, read back, then restore. Mark test data with a string you can grep for.
3. Diff the final state against the snapshot and check `flow.sqlite` (read-only) for anything the app pulled and kept.

## Surfaces

| Tools | Endpoint |
|---|---|
| `list_words`, `add_word`, `bulk_add`, `remove_word`, `list_snippets`, `add_snippet` | `/api/v1/dictionary/personal` |
| `get_preferences`, `update_preferences` | `/api/v1/user/preferences` (409 when `modified_at` is stale) |
| `list_transforms`, `set_transform`, `remove_transform` | `/api/v1/user_context` (`polish_prompts`) |
| `list_notes`, `add_note`, `update_note`, `delete_note` | `/api/v1/notes/sync` |
| `list_todos`, `add_todo`, `update_todo`, `delete_todo` | `/api/v1/todos/sync` |
| `update_meeting` | `/api/v1/meetings/sync` |
| `update_profile` | `/api/v1/user/profile` |
