# Code TE2 Native Android Implementation Tracker

Status values: `pending`, `in_progress`, `blocked`, `verified`, `deferred`.

## Goal State

`in_progress` - The Android WebView flavor intercepts `file_editor_cm6` and provides
a usable native Sora client over the existing Code TE2 editor, Explorer, UI IPC,
and WBA contracts, without introducing a second backend or moving authority
into the Android frontend. Kotlin owns the native client's browser-equivalent
boot, readiness, reconnect, and document-replay orchestration; Sora remains the
editor widget. Device workflow validation remains the acceptance boundary.

## Scope Guard

- [x] `verified` Work is isolated on `native-android-editor`.
- [x] `verified` The branch initially matched `main` at `49f30881`.
- [x] `verified` The first implementation target is the WebView flavor.
- [x] `verified` Final Slice 1 implementation scope approved by the user.
- [x] `verified` Sora LGPL-2.1 license and exact `0.23.5` dependency pin
  recorded with the implementation.
- [x] `verified` Existing unrelated untracked files remain untouched.
- [x] `verified` Shared TE2 framework was not restarted.

## Phase 0: Contract Confirmation

- [x] `verified` Editor, Explorer, UI IPC, and WBA are separate namespaces on
  the existing Socket.IO service family.
- [x] `verified` Migrated lanes use strict binary MessagePack JSON-RPC payloads.
- [x] `verified` Explorer/UI IPC use acknowledgement responses; Editor/WBA use
  in-band responses.
- [x] `verified` WBA already abstracts the VS Code remote workbench and remains
  the native editor's intelligence backend.
- [x] `verified` Direct editor-to-WBA requests are the established hot path.
- [x] `verified` WBA exposes the live extension-host TextMate catalog and
  grammar bodies; Android assets supply only the GitHub Dark Default theme.
- [x] `verified` Re-read every method and notification used by Slice 1 immediately
  before implementing its adapter.

## Phase 1: Android RPC Foundation

- [x] `verified` Add a recursive MessagePack value codec.
- [x] `verified` Add a reusable Socket.IO JSON-RPC lane client.
- [x] `verified` Support acknowledgement and in-band response modes.
- [x] `verified` Support request timeout and pending-request cleanup.
- [x] `verified` Support reconnect and notification resubscription.
- [x] `verified` Generalize `UiIpcClient` without creating a duplicate UI IPC
  connection.
- [ ] `in_progress` Preserve focus/blur behavior in WebView and GeckoView;
  both flavors compile, device behavior remains to be checked.
- [ ] `in_progress` Add transport unit tests; recursive codec fixtures are
  covered, while live acknowledgement/in-band behavior is part of device
  integration validation.

## Phase 2: Native Mode And Lifecycle

- [x] `verified` Add exact-pinned Sora dependencies to the WebView flavor.
- [x] `verified` Add required core-library desugaring.
- [x] `verified` Add a native editor content host to the WebView activity layout.
- [ ] `in_progress` Intercept launcher intent for `file_editor_cm6`; source and
  APK are complete, device navigation remains to be checked.
- [ ] `in_progress` Intercept framework `/app/file_editor_cm6` navigation.
- [ ] `in_progress` Implement native enter, back, home, reload, and exit lifecycle.
- [x] `verified` Release Sora, sidebar WebView, and RPC resources on exit/destruction.
- [x] `verified` Keep non-Code-TE2 apps on the existing WebView path.
- [x] `verified` Leave GeckoView app routing unchanged; Gecko staging compiles.

## Phase 3: Editor Projection

- [ ] `in_progress` Consume `editor.state.ssot`.
- [ ] `in_progress` Render the backend-selected active document in Sora.
- [ ] `in_progress` Publish debounced editor mirror updates.
- [ ] `in_progress` Save through `editor.save` with the backend digest contract.
- [ ] `in_progress` Handle backend active-file and open-state notifications.
- [ ] `in_progress` Preserve unsaved local text across safe reconnects.
- [ ] `in_progress` Handle project switch and stale document events correctly.
- [ ] `in_progress` Surface save conflict and transport failure states.

## Phase 4: TextMate And WBA

- [x] `verified` Request `ui.host.bootSnapshot.get` so native launch primes the
  backend-owned WBA runtime without another browser client.
- [x] `verified` Consume backend adapter-state facts and connect WBA only after
  the adapter reports `ready`.
- [x] `verified` Replay `vscode.openFile` plus the complete active document on
  WBA socket attach, adapter readiness, and workspace reconnect before
  incremental changes resume.
- [x] `verified` Keep WBA lifecycle orchestration in Kotlin; do not embed Node or
  reimplement the editor in Kotlin.
- [x] `verified` Resolve active-language grammar metadata and bodies through
  WBA `vscode.textmate.grammars.list` / `vscode.textmate.grammars.load`.
- [ ] `in_progress` Apply GitHub Dark Default.
- [x] `verified` Map backend language IDs to preferred WBA TextMate scopes and
  include grammars that declare injection into the selected scope.
- [x] `verified` Fail WBA grammar loading visibly and stale-drop results after
  a document or adapter-session transition.
- [ ] `in_progress` Send WBA open-file lifecycle notifications.
- [ ] `in_progress` Send debounced WBA document changes.
- [ ] `in_progress` Request WBA completions from Sora's completion hook.
- [ ] `in_progress` Map stable completion text, range, kind, and detail fields;
  snippet expansion, docs UI, and additional edits remain Slice 2.
- [ ] `in_progress` Consume backend-projected diagnostics in Sora.
- [ ] `deferred` Hover UI.
- [ ] `deferred` Semantic tokens and inlay hints.
- [ ] `deferred` Symbols, folding ranges, colors, and inline completions.

## Phase 5: Explorer And Search

- [ ] `in_progress` Render backend-projected Explorer roots and open directories.
- [ ] `in_progress` Implement lazy directory expansion.
- [ ] `in_progress` Mark the backend-projected active file.
- [ ] `in_progress` Open files through Explorer backend intent.
- [ ] `in_progress` Implement search start, more, cancel, and result navigation.
- [ ] `in_progress` Render git and diagnostic decorations.
- [ ] `pending` Implement create, rename, delete, move, and copy through existing
  backend RPC methods.
- [ ] `in_progress` Verify project switching does not depend on local Explorer
  state; implementation clears projections and requests backend replay.

## Phase 6: Native Mobile Shell And Sidebar

- [ ] `in_progress` Add compact native toolbar and command menu.
- [ ] `in_progress` Add Explorer, search, and problems overlays.
- [ ] `in_progress` Consume UI IPC sidebar catalog/order/active-slot state.
- [ ] `in_progress` Add sidebar app rail.
- [ ] `in_progress` Render the active sidebar URL in a contained WebView.
- [x] `verified` Render the sidebar overlay as a full-screen native surface;
  on-device layout confirmation remains in Phase 7.
- [ ] `in_progress` Send sidebar and host intents only through UI IPC.
- [x] `verified` Ensure no native frontend connects to `/sidebar_ipc`.
- [ ] `pending` Validate Android keyboard, selection, and drawer focus behavior.

## Phase 7: Verification

- [x] `verified` Register each Android flavor as a persistent TE2 console worker
  (`android_webview:<pid>` or `android_gecko:<pid>`) over the existing console
  Socket.IO namespace.
- [x] `verified` Stream targeted native editor/RPC info and debug entries plus
  process warnings/errors into the shared console transcript with a bounded
  disconnected queue.
- [x] `verified` Add bounded native console commands: `runtime.snapshot`,
  `logcat.tail`, `native.snapshot`, `wba.ping`, `wba.status`, and `wba.events`.
- [x] `verified` Keep arbitrary Kotlin execution, reflection, scripting engines,
  and destructive WBA commands outside the native console contract.
- [ ] `pending` Verify the Android worker appears in MCP and use its probes to
  diagnose the missing Sora completion request.

- [x] `verified` Run Android unit tests for the WebView staging variant.
- [x] `verified` Run Android unit tests for the Gecko staging variant after the
  shared native console change.
- [x] `verified` Compile WebView staging Kotlin.
- [x] `verified` Compile Gecko staging Kotlin after common transport changes.
- [x] `verified` Assemble WebView staging APK.
- [x] `verified` Assemble Gecko staging APK after the shared native console
  change.
- [ ] `pending` Verify open/edit/save/reopen.
- [ ] `pending` Verify Explorer and search.
- [ ] `pending` Verify TextMate highlighting and WBA completion.
- [ ] `pending` Verify diagnostics and project switching.
- [ ] `pending` Verify sidebar activation and return-home flow.
- [ ] `pending` Verify disconnect/reconnect and process recreation.
- [x] `verified` Review `git diff --check` and exact changed-file scope.
- [x] `verified` Update `.repo_memory.md` with only verified durable architecture.

## Deferred Publication Work

- [ ] `deferred` Android payload version bump.
- [ ] `deferred` APK seed/OTA asset publication changes.
- [ ] `deferred` GeckoView native interception decision.
- [ ] `in_progress` Create and push the user-approved targeted checkpoint.

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-14 | Use Sora as a frontend adapter, not an LSP/workbench replacement. | Code TE2 already abstracts the remote VS Code workbench through WBA. |
| 2026-07-14 | Target WebView flavor first. | It proves the native client without disturbing the GeckoView path. |
| 2026-07-14 | Source native grammars from WBA and keep only the theme local. | Extension-host contributions remain authoritative while Android avoids a second grammar corpus. |
| 2026-07-14 | Keep direct WBA language requests. | This matches the established latency-sensitive editor path. |
| 2026-07-14 | Consume backend diagnostics projection. | Project generation and stale-result filtering remain backend-owned. |
| 2026-07-14 | Port browser orchestration, not the editor, to Kotlin. | Sora already owns native editing; Kotlin must participate in backend boot/readiness and WBA model lifecycle without embedding Node. |
| 2026-07-14 | Reuse `/te2_console` for Android diagnostics and bounded probes. | It exposes the device-side half through existing MCP/runtime tooling without another transport or arbitrary native code evaluation. |

## Blockers

None currently. Device workflow validation is the next gate.
