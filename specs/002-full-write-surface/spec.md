# Feature Specification: every user-writable Wispr Flow surface over MCP

**Created**: 2026-09-26 | **Status**: Approved (autonomous build)

## Goal
Extend the dictionary server to everything a user can change in the Wispr Flow app, so it becomes the write companion to the read-only official MCP.

## Scope
In: snippets, synced preferences (styles, polish instructions, languages, cleanup, privacy, notetaker settings), custom transforms, scratchpad notes, todos, meeting title and notes, profile name.
Out: team dictionary (no team to verify against), billing, enterprise, referral, account deletion, device registration, telemetry, `/llm/*` compute, meeting sharing and deletion, emailing, `local_data_policy` (changing it deletes local history), folders (behind a feature flag that is off for this account).

## Requirements
- **FR-001**: Each surface uses the endpoint and payload shape of the app's own `AriaWebClient` call.
- **FR-002**: Deletes are soft deletes with a newer `modified_at`.
- **FR-003**: Updates copy the server's current record and change only the requested fields.
- **FR-004**: Preferences writes send the server's `modified_at`; a 409 is reported, not retried.

## Acceptance
Each tool is run over MCP stdio against the live account, read back, and restored, and the final state is diffed against a snapshot taken before the test.
