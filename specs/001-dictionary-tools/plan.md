# Implementation Plan: Wispr Flow personal dictionary tools over MCP

## Technical Context
- **Language**: Node.js ESM (plain JS, no build), Node >= 18 for global `fetch` and `crypto.randomUUID`.
- **Dependencies**: `@modelcontextprotocol/sdk`, `zod`.
- **Platform**: macOS (the session path is macOS-specific; Windows path can be added via env override later).
- **Testing**: end-to-end against the live account (add harmless word, check UI, remove).

## Findings the design rests on (from app 1.6.957 bundle)
- Local store: `flow.sqlite` table `Dictionary` (Sequelize). Not written by us.
- Sync: `DictionaryManager.syncDictionary` does GET `/api/v1/dictionary/personal`, merges by `id` or `word+team_dictionary_id`, last-writer-wins on `modified_at`, POSTs changed items as an array to the same path, then pulls newer remote items into SQLite. Runs at startup, after every in-app edit, and on the Dictionary page Refresh button.
- Auth: `Authorization: <supabase access_token>` (no `Bearer` prefix; `Bearer` returns 401). Session JSON stored plaintext in `session.json`.

## Constitution Check
I (app contract) yes; II (token read-only, never refreshed) yes; III (soft delete) yes; IV (one file, two deps) yes.

## Structure
```
index.js        # MCP server, all four tools
package.json
README.md
LICENSE
```
