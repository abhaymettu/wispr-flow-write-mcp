# Feature Specification: Wispr Flow personal dictionary tools over MCP

**Created**: 2026-09-26 | **Status**: Approved (autonomous build)

## User Scenarios & Testing

### User Story 1 - Add a word (P1)
An AI agent adds a term (optionally with a replacement) to the user's Wispr Flow personal dictionary.
**Independent test**: call `add_word`, press Refresh on the app's Dictionary page, the word is listed.
1. **Given** the word is absent, **When** `add_word("Foo")`, **Then** it exists remotely with `is_manual=true`, `source="manual"`.
2. **Given** the word was previously deleted, **When** `add_word("Foo")`, **Then** the same item is undeleted (no duplicate).

### User Story 2 - Remove a word (P1)
**Independent test**: call `remove_word`, Refresh in the app, the word is gone.
1. **Given** "Foo" exists, **When** `remove_word("Foo")`, **Then** it is soft-deleted and the app drops it after sync.
2. **Given** "Foo" does not exist, **When** `remove_word("Foo")`, **Then** the tool returns an error and changes nothing.

### User Story 3 - List words (P2)
`list_words` returns non-deleted personal entries, optionally filtered by a case-insensitive substring.

### User Story 4 - Bulk add (P2)
`bulk_add` adds many words in one request; already-present words are reported as skipped.

### Edge Cases
- Session file missing or token expired: return a clear error telling the user to open Wispr Flow and sign in. Do not refresh the token.
- Word matches differ only by case: exact match first, then a unique case-insensitive match; ambiguous matches are an error.
- Team dictionary entries are out of scope (read-only to this tool).

## Requirements
- **FR-001**: Tools `list_words`, `add_word`, `remove_word`, `bulk_add` over MCP stdio.
- **FR-002**: Auth token read from `~/Library/Application Support/Wispr Flow/session.json` (key `sb-*-auth-token`) per call.
- **FR-003**: Writes go to `POST https://api.wisprflow.ai/api/v1/dictionary/personal` with the app's item shape.
- **FR-004**: No token or dictionary contents written to disk by this tool.

## Success Criteria
- **SC-001**: A test word added via MCP appears in the Wispr Flow Dictionary UI after Refresh, and disappears after `remove_word` + Refresh.
