# Feature Specification: polish pass

**Created**: 2026-10-03 | **Status**: Approved (autonomous build)

## Goal
Make the existing tools behave well when input is messy or the app's session is mid-refresh, without renaming any tool.

## Scope
In: readable API errors, input cleanup and validation, case-insensitive duplicate handling in the dictionary, `bulk_add` input dedupe and `dry_run`, a `find_word` lookup tool, session re-read on 401, one retry on network errors and 502/503/504, a request timeout, an offline test suite against a fake API.
Out: refreshing the token ourselves (signs the app out), retrying a preferences 409 (FR-004 of spec 002 stands), new surfaces.

## Requirements
- **FR-001**: Every existing tool name and input field keeps working; new inputs are optional.
- **FR-002**: Adding a word that already exists in any casing is skipped, and the result names the existing entry.
- **FR-003**: `bulk_add` drops blank and repeated (case-insensitive) inputs before writing; `dry_run: true` reports what would happen and writes nothing.
- **FR-004**: `find_word` reports whether a word or snippet trigger exists, matching case-insensitively.
- **FR-005**: A 401 re-reads `session.json` and retries once if the app has written a new token; otherwise the error says to open the app.
- **FR-006**: API errors show the status and the server's message, not a raw HTML page.

## Acceptance
`npm test` passes offline. Each changed tool is run over MCP stdio against the live account, read back, and restored; the final dictionary is diffed against a snapshot taken before the test.
