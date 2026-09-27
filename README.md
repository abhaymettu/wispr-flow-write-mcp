# wispr-flow-dictionary-mcp

An MCP server that lets an AI agent read and edit your [Wispr Flow](https://wisprflow.ai) personal dictionary: list words, add one, add many, remove one.

Unofficial. Not affiliated with or endorsed by Wispr.

## Why

Wispr Flow's official MCP server covers the Notetaker: meetings, calendar events, and scratchpad notes. It's read-only and doesn't expose the dictionary at all, and there is no public API for it. So an agent that notices Flow keeps mishearing a name, a library, or a bit of jargon has no way to fix that for you.

This server fills that gap. It talks to the same endpoint the Wispr Flow desktop app uses to sync your dictionary, so changes show up in the app the next time it syncs.

| | Official Wispr Flow MCP | This server |
|---|---|---|
| Meetings, notes, calendar | Read | No |
| Personal dictionary | No | List, add, bulk add, remove |
| Team dictionary | No | No |
| Auth | OAuth with Wispr | Your signed-in desktop app's session |

## Tools

| Tool | Input | What it does |
|---|---|---|
| `list_words` | `query?` | Lists personal dictionary words, optionally filtered by a case-insensitive substring. Replacements show as `word -> replacement`. |
| `add_word` | `word`, `replacement?` | Adds a word. With `replacement`, Flow writes the replacement when it hears the word. Words already present are skipped. |
| `bulk_add` | `words[]` (up to 1000) | Adds many words in one request. Words already present are skipped. |
| `remove_word` | `word` | Removes a word. Tries an exact match first, then a case-insensitive match; if the case-insensitive match is ambiguous it refuses and lists the candidates. |

## Requirements

- macOS with the Wispr Flow desktop app installed and signed in
- Node.js 18 or later

## Install

```sh
git clone https://github.com/abhaymettu/wispr-flow-dictionary-mcp.git
cd wispr-flow-dictionary-mcp
npm install
```

Claude Code:

```sh
claude mcp add wispr-flow-dictionary -- node /absolute/path/to/wispr-flow-dictionary-mcp/index.js
```

Claude Desktop, Cursor, or any other MCP client (JSON config):

```json
{
  "mcpServers": {
    "wispr-flow-dictionary": {
      "command": "node",
      "args": ["/absolute/path/to/wispr-flow-dictionary-mcp/index.js"]
    }
  }
}
```

## Seeing changes in the app

The desktop app syncs its dictionary when it starts, after any edit you make in the app, and when you press **Refresh** on the Dictionary page. It does not poll. After adding or removing words through this server, press Refresh on the Dictionary page (or restart Flow) to see them.
## Where the token comes from

Nothing is hardcoded and nothing is stored by this server.

The Wispr Flow desktop app signs in with Supabase and keeps its session as plaintext JSON at:

```
~/Library/Application Support/Wispr Flow/session.json
```

under a key shaped like `sb-<project>-auth-token`. On every tool call the server reads that file, takes the `access_token`, checks `expires_at`, and sends the token as the `Authorization` header (the raw token, with no `Bearer` prefix, which is what the app sends).

The server never refreshes the token. Supabase rotates refresh tokens, so refreshing from outside the app could sign the app out. If the token has expired, the tool returns an error asking you to open Wispr Flow; the app refreshes its own session and the next call works.

Any process running as your user can read that file. This server doesn't change that exposure, but you should know it exists.

## How it works

Found by reading the app's bundled JavaScript (Wispr Flow 1.6.957 for macOS):

- The app stores the dictionary locally in `flow.sqlite`, table `Dictionary`.
- `DictionaryManager.syncDictionary` does `GET https://api.wisprflow.ai/api/v1/dictionary/personal`, merges local and remote items by `id` (or `word` + `team_dictionary_id`) with last-writer-wins on `modified_at`, sends changed items as a JSON array to `POST` on the same path, then pulls newer remote items into SQLite.
- Deletes are soft: `is_deleted: true` with a newer `modified_at`.

This server only speaks that HTTP contract. It never writes to the app's SQLite database, which avoids fighting the running app over its own file. Adds use the app's item shape (`is_manual: true`, `source: "manual"`). Removes are soft deletes, so the app's sync propagates them instead of re-uploading the word. Adding a word you previously deleted revives the old entry rather than creating a duplicate.

Because this relies on an undocumented endpoint, a Wispr Flow update can break it. If that happens, open an issue with your app version.

## License

MIT
