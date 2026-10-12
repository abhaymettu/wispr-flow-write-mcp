# Wispr Flow Mac review and MCP improvements

October 8, 2026. Target: installed Wispr Flow 1.6.1102. Repository: https://github.com/abhaymettu/wispr-flow-write-mcp .

## Result

The highest-value finding is a real privacy-settings bug in the MCP: it previously allowed `privacy_mode` and `share_data` to be written independently, while the current app treats them as inverse fields and gives explicit `share_data` priority when a record conflicts. A request to enable privacy could therefore leave sharing enabled. The MCP now normalizes either supplied field into both inverse values and refuses contradictory input before any network call.

The review also found why configured styles can appear not to work: the app gates them on `personalizationOnboardingCompleted`. That field is now available explicitly. It is never enabled as a hidden side effect.

All implementation changes are independently written. No Wispr application source, audio, customer dictation, account token, or private writing sample is included in this repository.

## Method and evidence boundaries

REA source was pinned to `de5bfec79fe862816350b2deeb42a12c0734d855`, version 6.1.0, from https://github.com/morluto/rea . Its JavaScript workflow inventories artifacts, parses inert syntax, builds relationships and seals hashed evidence. Native and runtime evidence are separate authorities. I compiled the pinned source and used its static analyzer without registering it with any client or executing vendor bootstrap code.

The full ASAR analysis refused an integrity mismatch on the unpacked `node_sqlite3.node`: declared `e476b3077cee91f9e8a679e7d8303fb6e5e0c5815c25aa06033159ae533857c6`, calculated `7f0bc70a5f508a80b895a526fdb06f310c2601dc1f32e25fe23d1bbbdc175df0`. This is an unexplained packaging/integrity difference, not proof of malicious modification. No target files were changed and no integrity checks were disabled. Subsequent analysis used separately extracted JavaScript and does not authenticate the installed native components.

ASAR SHA-256: `da64ebcb3d1d48032ac0808b4734a3509596a6cc00a39d84ae0deaf921e9c11d`.
Main JavaScript SHA-256: `24413a433e4cf159816d60f194ad32def76741d7a5e5bed9b27581bb74eebac2`.

The first successful REA pass analyzed main JavaScript and the incremental Opus worker: 2 files, 10,359,909 text bytes, 2,497,287 visited AST nodes, 623 findings, 0 parse failures. Evidence ID: `ev_ee070c2adc9f3729a9ef55bf65472f2e7ee289a3d9161e464f74bacbf4b27662`. Its static Electron summary found 11 browser windows, 3 utility processes and 166 main IPC handler observations. Missing renderer pairing in this deliberately narrow pass is unknown, not absence. The main-plus-hub pass also completed and its JSON parsed successfully: evidence `ev_74d4b5f7145619fd780f0c477ff97f57f8ffd4f54cd33788bb0a9793b972ead4`, 3 files and 0 parse failures. Static IPC observations included 166 operations, 155 literal channels and 11 dynamic channels. This is partial application coverage, not a whole-app reconstruction.

These findings establish code paths present in this build, not which paths execute for every account, feature flag, platform or server deployment. No live dictation, microphone recording, network interception, auth refresh, entitlement bypass, cloud mutation, or native decompilation was performed. Backend model weights, server prompts and exact active model versions remain unknown.

## How the app works

### Capture and insertion

The hub renderer has a `getUserMedia` capture path with mono audio at 16 kHz, echo cancellation, noise suppression and automatic gain control disabled in that path. It advertises Opus at 64 kbps and converts normalized samples to PCM16; the main bundle includes an unsupported-Opus fallback to WAV. These are implementation choices for this path, not a guarantee for all meeting or platform capture modes.

Renderer/main messages cover audio start, stop, chunks, acquisition failure and AudioContext recovery. Meeting capture has separate mic and system-audio messages and encoding paths. A native-helper protocol supplies active app, textbox before/after/selected text, accessibility status and paste outcomes. Capture, transcription and insertion are separate stages: successful transcription does not prove successful paste.

### Transcription and cleanup

The client contains gRPC streaming and HTTP/Baseten request paths, plus an OpenAI-labelled fallback through Wispr endpoints `/llm/asr` and `/llm/asr_audio_chunks`. Presence of provider names does not identify the current server model or prove a particular request uses that provider. Audio requests can carry encoded audio/packets, pipeline stages, prior ASR and formatted text, detected language and request metadata.

The visible pipeline starts with TRANSCRIBE and ALIGN, adds FORMAT depending on mode, and can add LOWERCASE_SENTENCES. Separate `/llm/polish_text`, formatting and command/instruct routes support selected-text rewriting. This is cloud processing, not an offline speech model hidden in the app.

### Context and style adaptation

The request serializer can include app name, bundle ID, URL/type; Accessibility-derived words; OCR-derived words; VS Code variable/file names; personal/team dictionary context; name fields; nearby text; and textbox before/after/selection. An optional OCR endpoint extracts proper nouns from screenshots. Those code paths are not evidence that screenshots are always captured, nor that context is enabled for this user.

Style selection maps the foreground app/context to the stored personalization styles and checks onboarding completion. Polish requests can carry instructions, selected writing samples, custom prompt and learned voice preference. `/api/v1/user_context` supplies `writing_samples` and `polish_prompts`; the old MCP exposed only the latter through transform tools.

### Integrations and storage

Electron IPC joins the renderer, main process, utility processes and native helper. The client contains Google Calendar/Outlook and meeting flows, and separate notes/todos/meetings sync endpoints. Wispr's public documentation says Calendar/Outlook connections are optional and read-only, including attendee/contact lookup. This review did not connect either service or inspect personal meetings.

Dictionary/snippets, preferences and user context are separate sync surfaces. Preferences carry a `modified_at` conflict marker, and the app treats 409 as a conflict rather than silently overwriting. Notes/todos use cursor-based sync. The app itself limits pagination in sync loops, supporting a fail-closed pagination guard in the MCP.

## MCP changes made

- `update_preferences`: inverse privacy-field normalization; conflicting values fail before GET/POST. This follows the current app's serialization contract.
- `update_preferences`: optional `dry_run` returns the exact merged preferences and original `modified_at` without POST. Control fields are never included in the outgoing preferences object.
- `update_preferences`: explicit `personalizationOnboardingCompleted` input for the discovered style gate. Existing styles are not implicitly activated.
- Empty preference patches fail without network access. Unknown preferences and unrelated nested style keys remain intact.
- `get_user_context`: new read-only tool for writing samples and transform prompts. It does not transcribe, rewrite, upload or edit samples, and only returns the two supported context fields.
- Sync reads reject a malformed list, repeated cursor or excessive page count rather than looping forever. The guard runs before dependent changes.
- README documents the new behavior and distinguishes training consent, cloud storage, local history and Notetaker retention. The sensitive/destructive `local_data_policy` remains unexposed.

## Validation

Baseline: 12 offline tests passed. Updated: 22 offline tests passed, 0 failures. Tests run the real MCP over stdio against local fake HTTP APIs and a synthetic session, with no Wispr account access. New coverage includes inverse normalization, pre-network contradiction rejection, nested dry-run merge, preservation of unknown fields, explicit style onboarding, empty-patch rejection, 409 without retry, read-only user context, transform shortcut/sample preservation, repeated cursor and malformed sync responses.

`node --check index.js` and `git diff --check` passed. Live service acceptance, app refresh and active-client reload have not been tested. Source changes are not an npm release and do not update already-running MCP processes automatically.

## Recommended next steps

1. With the user awake, dry-run a selected style/privacy patch, review the payload and any enforced organization/BAA settings, then validate one approved change in the app. Do not treat test success as permission to change settings.
2. Add read-only diagnostics for effective versus requested policy before broadening privacy writes. The app has stricter org/BAA gates; raw preferences alone do not establish effective policy.
3. Improve write receipts by checking per-item acknowledgements/rejections and post-write readback, with captured protocol fixtures first. Do not guess that every sync response means every write landed.
4. Consider writing-sample editing only after the current sample schema and merge/conflict behavior are verified. Read access is useful now; an opaque whole-object write risks overwriting private style data.
5. Keep transcription/voice-action endpoint execution outside this write-settings server for now. Those routes can transmit content and incur usage, and require their own explicit privacy/cost scope.

## Source references

- REA repository and method: https://github.com/morluto/rea
- MCP repository: https://github.com/abhaymettu/wispr-flow-write-mcp
- Current security/privacy overview: https://docs.wisprflow.ai/articles/3467817258-security-and-compliance-faq
- Context/capture/calendar explanation: https://wisprflow.ai/enterprise-privacy
- Privacy/storage distinctions and policy gates: https://docs.wisprflow.ai/articles/4709791908-understanding-privacy-mode-and-cloud-sync

The public pages differ on certification status and third-party retention wording. This report does not resolve those contractual claims or use them to make a compliance guarantee. The newer help overview was used for general privacy-control distinctions; actual terms need the user's applicable agreement.

Local evidence locations are saved in the review workspace as path + character offset, not copied source. Main privacy serialization: offset 6428855; conflict precedence: 6432067; style gate: 4285542; audio request serializer: 3560050; pipeline: 3567230; hub capture options: 668405 and capture rate: 665196. Offsets are zero-based characters in extracted UTF-8 text, not native addresses or line numbers.
