# RUNLOG

## 2026-10-03T20:50:00 | wispr-mcp-polish-oct03 | DONE
- DONE: polish 0.3.0 committed locally as 29c8216 (find_word, bulk_add dry_run and dedupe, case-insensitive skips, validation, clearer errors, 401 session re-read retry, gateway/network retry, 30 s timeout); npm test 12/12; live stdio run left the 1669 live dictionary items identical to the snapshot; claude -p smoke test passed.
- DECIDED: kept find_word near-miss suggestions despite ponytail review because "not found" alone forces a second list_words call; kept preferences 409 unretried per spec 002 FR-004; did not trim snippet expansions so intentional newlines survive.
- OPEN: package-lock.json still says 0.2.0 (file is permission-denied to this lane); nothing pushed or published; RUNLOG.md itself left uncommitted.
- REJECTED: refreshing the Supabase token on 401 because rotation signs the app out; a separate lib.js for unit tests because driving the real server over stdio against a fake API needs no export surface.
- ARTIFACT: /Users/abhay/audit/wispr-mcp-polish-2026-10-03.md (commit 29c8216, npm test 12 pass)
