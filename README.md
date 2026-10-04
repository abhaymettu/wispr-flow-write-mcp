# wispr-flow-write-mcp

An MCP server that lets an AI agent change what you can change in the [Wispr Flow](https://wisprflow.ai) app: your personal dictionary, snippets, writing styles and polish instructions, custom transforms, scratchpad notes, todos, meeting titles and notes, and your profile name.

It is the write companion to Wispr Flow's official MCP server, which is read-only.

Unofficial. Not affiliated with or endorsed by Wispr.

## Why

Wispr Flow's official MCP server covers the Notetaker: meetings, calendar events, and scratchpad notes. It can read them but not change them, and it doesn't expose the dictionary, snippets, styles, or transforms at all. There is no public API for any of these. So an agent that notices Flow keeps mishearing a name, or that you want a snippet for your sign-off, has no way to act on it.

This server fills that gap. Every tool talks to the same endpoint the Wispr Flow desktop app uses for its own sync, so changes show up in the app on its next sync.

| | Official Wispr Flow MCP | This server |
|---|---|---|
| Meetings, calendar | Read | Rename, replace notes |
| Scratchpad notes | Read | List, add, edit, delete |
| Personal dictionary | No | List, find, add, bulk add (with dry run), remove |
| Snippets | No | List, add, remove |
| Styles, polish instructions, languages, other synced settings | No | Read, change |
| Custom transforms | No | List, create or edit, remove |
| Todos | No | List, add, edit, complete, archive, delete |
| Profile name | Read (account info) | Change |
| Team dictionary, billing, enterprise, sharing | No | No |
| Auth | OAuth with Wispr | Your signed-in desktop app's session |

Run both side by side: the official server to find things, this one to change them.

## Tools

| Tool | Input | What it does |
|---|---|---|
| `list_words` | `query?` | Lists personal dictionary words (not snippets), optionally filtered by a case-insensitive substring. Replacements show as `word -> replacement`. |
| `find_word` | `word` | Says whether a word or snippet trigger is in the dictionary, ignoring case, with its stored spelling and replacement. When it is absent, lists up to 5 entries that contain it. |
| `add_word` | `word`, `replacement?` | Adds a word. With `replacement`, Flow writes the replacement when it hears the word. A word already present in any casing is skipped, and the result names the stored spelling. |
| `bulk_add` | `words[]` (up to 1000), `dry_run?` | Adds many words in one request. Blank lines are dropped; repeats within the list, words already present in any casing, and invalid entries are skipped and listed with the reason. With `dry_run: true` it reports what it would add and writes nothing. |
| `remove_word` | `word` | Removes a word or snippet. Tries an exact match first, then a case-insensitive match; if that is ambiguous it refuses and lists the candidates. Exact duplicates are removed together. |
| `list_snippets` | `query?` | Lists snippets as `trigger -> expansion`. |
| `add_snippet` | `trigger`, `expansion` | Adds a snippet: say the trigger, Flow types the expansion. |
| `get_preferences` | | Shows your synced preferences. |
| `update_preferences` | any of the fields below | Changes only the fields given; nested objects merge. |
| `list_transforms` | | Lists your custom transforms. |
| `set_transform` | `name`, `prompt` | Creates a transform, or replaces the prompt of the one with that name. Up to 9. |
| `remove_transform` | `name` | Deletes a transform. |
| `list_notes` | `query?` | Lists scratchpad notes with their ids, newest first. |
| `add_note` | `content`, `title?` | Creates a note. The title defaults to the first three words, as the app does. |
| `update_note` | `id`, `content?`, `title?` | Replaces a note's content and/or title. |
| `delete_note` | `id` | Deletes a note. |
| `list_todos` | `include_archived?` | Lists todos with their ids. |
| `add_todo` | `title` | Adds an open todo. |
| `update_todo` | `id`, `title?`, `status?`, `archived?` | Renames, completes (`done`) or reopens (`open`), archives or unarchives a todo. |
| `delete_todo` | `id` | Deletes a todo. |
| `update_meeting` | `id`, `title?`, `notes?` | Renames a meeting or replaces its notes. Get ids from the official server's `search_meetings`. |
| `update_profile` | `first_name?`, `last_name?` | Changes the name on your account. |

`update_preferences` accepts:

- `personalization_styles`: `personal` (messages), `work` (Slack, Teams), `email`, `other`, each one of `formal`, `casual`, `veryCasual`, `excited`, `default`.
- `polish_instructions`: `{ default: { label: on/off }, custom: { "your instruction": on/off } }`. Set a custom instruction to `null` to delete it.
- `output_languages` (codes such as `["en", "es"]`), `auto_cleanup_level` (`none`, `light`, `medium`, `high`, `full`).
- `privacy_mode`, `share_data`, `cloud_sync`, `teammates_added_digest_enabled`.
- `notetaker_transcript_retention` and `notetaker_preference` (default note visibility, calendar notice, auto-share).

Turning `cloud_sync` off also stops this server's changes from reaching the app. The data-retention policy (`local_data_policy`) is not exposed, because changing it makes the app delete local history.

## Requirements

- macOS with the Wispr Flow desktop app installed and signed in
- Node.js 18 or later

## Install

```sh
git clone https://github.com/abhaymettu/wispr-flow-write-mcp.git
cd wispr-flow-write-mcp
npm install
```

Claude Code:

```sh
claude mcp add --scope user wispr-flow-write -- node /absolute/path/to/wispr-flow-write-mcp/index.js
```

Claude Desktop, Cursor, or any other MCP client (JSON config):

```json
{
  "mcpServers": {
    "wispr-flow-write": {
      "command": "node",
      "args": ["/absolute/path/to/wispr-flow-write-mcp/index.js"]
    }
  }
}
```


## Install as a Claude plugin

This repo is also packaged as a Claude plugin (MCP server + setup skill).

When the plugin is approved and listed in the Claude plugin directory, install it from the community marketplace in Claude Code:

```sh
/plugin marketplace add anthropics/claude-plugins-community
claude plugin install wispr-flow-write@claude-community
```

The plugin ships disabled by default (`defaultEnabled: false`) because it connects to an external service; enable it with `claude plugin enable wispr-flow-write` or from `/plugin`. Dependencies install automatically on first start.

To test the plugin layout locally from a clone:

```sh
claude plugin validate . --strict
claude --plugin-dir .
```

## Usage

Ask your agent in plain language. For example:

- "Flow keeps writing 'whisper flow'. Add Wispr Flow to my dictionary."
- "Here are 200 names from my contacts. Dry-run a bulk add first, then add the ones that aren't there yet."
- "Is Kubernetes in my Flow dictionary?"
- "Add a snippet: when I say 'my calendar link', type https://cal.com/me."
- "Switch my email style to formal."

Words are single-line, up to 255 characters. Matching ignores case, so `github` is reported as already present when you have `GitHub`. To change a word's casing, remove it and add it again.

## Errors and retries

Errors say what to do next: an expired or rejected session asks you to open the Wispr Flow app, and an API error shows the status and the server's message.

Each request is retried once when a retry can help: a network failure, a 502, 503 or 504, or a 401 sent with a token the app has since replaced. Every write is keyed by item id or replaces a whole record, so a retried write that already landed changes nothing. Requests time out after 30 seconds. A 409 on `update_preferences` (the preferences changed after they were read) is reported, not retried.

## Seeing changes in the app

- **Dictionary and snippets**: the app syncs these when it starts, after an edit in the app, and when you press **Refresh** on the Dictionary page. It does not poll. Press Refresh or restart Flow.
- **Notes, todos, meetings, preferences**: the app pulls these on its own sync cycle, so they show up without doing anything.
- **Transforms**: the app loads them when it starts. Restart Flow to see a change.

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

Found by reading the app's bundled JavaScript (Wispr Flow 1.6.957 for macOS). All of it goes to `https://api.wisprflow.ai/api/v1`:

| Surface | Endpoint | Protocol |
|---|---|---|
| Dictionary, snippets | `GET` / `POST /dictionary/personal` | Array of items, merged by `id` or `word`, last writer wins on `modified_at`. Snippets are items with `is_snippet: true`. |
| Preferences | `GET` / `POST /user/preferences` | `{ preferences, modified_at }`. The `modified_at` must match the server's copy or the write is refused with 409. |
| Transforms | `GET` / `PUT /user_context` | `polish_prompts`, a map of slots `polish_prompt_1` to `polish_prompt_9` to `{ prompt, prompt_name, shortcut }`. |
| Notes, todos, meetings | `POST /notes/sync`, `/todos/sync`, `/meetings/sync` | Push changed items, pull everything changed since `last_sync_time`. Timestamps go up as epoch-millisecond strings. |
| Profile | `GET` / `PUT /user/profile` | `{ first_name, last_name }`. |

Deletes are soft (`is_deleted: true` with a newer `modified_at`), which is how the app deletes and what its sync propagates. The server never writes to the app's SQLite database, which avoids fighting the running app over its own file.

Meeting edits resend the fields the app itself pushes, copied from the server's copy, so only the title or notes change. Transcripts, sharing, and deleting meetings stay in the app.

Because this relies on undocumented endpoints, a Wispr Flow update can break it. If that happens, open an issue with your app version.

## Development

```sh
npm test
```

The tests start the server over stdio and point it at a fake dictionary API on localhost (through the `WISPR_FLOW_API` and `WISPR_FLOW_SESSION` environment variables), so they run offline and never touch your account. For changes to how the server talks to the real API, also follow the live testing steps in `AGENTS.md`.

## License

MIT
