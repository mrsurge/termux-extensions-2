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
- [x] `verified` Intercept launcher intent for `file_editor_cm6`; verified from
  the device application launcher into the native editor.
- [x] `verified` Intercept framework `/app/file_editor_cm6` navigation.
- [ ] `in_progress` Implement native enter, back, home, reload, and exit lifecycle.
- [x] `verified` Release Sora, sidebar WebView, and RPC resources on exit/destruction.
- [x] `verified` On Android foreground resume, idempotently reconnect UI IPC,
  Editor, Explorer, WBA, and console sockets and request a fresh authoritative
  boot snapshot even when no disconnect edge was observed.
- [x] `verified` Keep non-Code-TE2 apps on the existing WebView path.
- [x] `verified` Leave GeckoView app routing unchanged; Gecko staging compiles.

## Phase 3: Editor Projection

- [x] `verified` Consume `editor.state.ssot`.
- [x] `verified` Render the backend-selected active document in Sora.
- [ ] `in_progress` Publish debounced editor mirror updates. Native mirror
  intake now drops same-SID echoes, wrong-path and duplicate payloads, and
  remote projections inside the local-edit hot window before state mutation.
  Accepted same-document projections use one batched Sora replacement and
  preserve the clamped selection; device cursor-stability verification remains.
- [ ] `in_progress` Save through `editor.save` with the backend digest contract.
- [x] `verified` Handle backend active-file and open-state notifications; an
  Explorer RPC open projected `open_state_events.py` into the running native
  editor without direct frontend state mutation.
- [ ] `in_progress` Preserve unsaved local text across safe reconnects.
- [ ] `in_progress` Handle project switch and stale document events correctly.
- [ ] `in_progress` Surface save conflict and transport failure states.

## Phase 4: TextMate And WBA

- [x] `verified` Request `ui.host.bootSnapshot.get` so native launch primes the
  backend-owned WBA runtime without another browser client.
- [x] `verified` Attach the WBA lane independently of one-shot adapter-state
  notifications, query/poll `adapter.status`, and still consume typed readiness
  pushes when they arrive. This supports late attachment to an existing WBA.
- [x] `verified` Publish `editor.modelReady` for each native model generation so
  the backend runs `te2.resync` and replays the workspace baton and providers.
- [x] `verified` Replay `vscode.openFile` plus the complete active document on
  WBA socket attach, adapter readiness, and workspace reconnect before
  incremental changes resume.
- [x] `verified` Keep WBA lifecycle orchestration in Kotlin; do not embed Node or
  reimplement the editor in Kotlin.
- [x] `verified` Resolve active-language grammar metadata and bodies through
  WBA `vscode.textmate.grammars.list` / `vscode.textmate.grammars.load`.
- [x] `verified` Apply GitHub Dark Default and derive the TM4E fallback token
  foreground/background from the theme's own editor colors.
- [x] `verified` Map backend language IDs to preferred WBA TextMate scopes and
  include grammars that declare injection into the selected scope.
- [x] `verified` Fail WBA grammar loading visibly and stale-drop results after
  a document or adapter-session transition.
- [x] `verified` Send generation-tagged WBA open-file lifecycle requests and
  hold document/provider traffic behind an exact path-and-generation open ACK.
- [x] `verified` Send debounced WBA document changes only after that open ACK.
- [x] `verified` Request WBA completions from Sora's completion hook and treat
  Sora's interrupted superseded request as cancellation rather than an error.
- [x] `verified` Map stable completion text, range, kind, detail, `filterText`,
  and `sortText`; apply tested case-insensitive character filtering against the
  WBA replacement prefix before publishing candidates to Sora. Snippet
  expansion, docs UI, and additional edits remain Slice 2.
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
- [x] `verified` Consume UI IPC sidebar catalog/order/active-slot state from the
  authoritative host boot snapshot as well as live notifications, so native
  startup does not depend on another browser client perturbing backend state.
- [ ] `in_progress` Add sidebar app rail.
- [x] `verified` Preserve backend slot kind/app/load/readiness metadata and
  `restore_url` query semantics, start framework app slots through the existing
  Rust lifecycle endpoint with concurrent-start dedupe and activation
  stale-drop, then render the active URL in a contained WebView.
- [x] `verified` Keep one WebView attached per backend sidebar slot for the
  native editor lifetime. Load every backend-open slot using
  `/api/apps/running` plus `/start`, keep inactive views connected but invisible,
  and destroy only removed slots or the released editor surface. Native rail
  taps activate slots; long press invokes the existing backend close action and
  waits for the authoritative projection to remove the slot.
- [x] `verified` Replace the temporary title-chip row with a full-screen sidebar
  surface using an active-title header, add-app menu, compact left app rail, and
  persistent content stack aligned with the browser client's layout model.
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
- [x] `verified` Report every terminal native RPC request failure centrally,
  including disconnected clients, timeouts, encode/emit errors, remote errors,
  pending disconnect failures, malformed envelopes, orphan responses, and
  callback exceptions. Reports include bounded lane/method/id/event/payload
  context and reach the existing Android console stream without a JSON fallback.
- [x] `verified` Add bounded native console commands: `runtime.snapshot`,
  `logcat.tail`, `native.snapshot`, `wba.ping`, `wba.status`, and `wba.events`.
- [x] `verified` Keep arbitrary Kotlin execution, reflection, scripting engines,
  and destructive WBA commands outside the native console contract.
- [x] `verified` Connect to the Android console worker and use `native.snapshot`,
  `wba.status`, and `wba.events` to diagnose and verify native-only WBA replay.

- [x] `verified` Run Android unit tests for the WebView staging variant.
- [x] `verified` Run Android unit tests for the Gecko staging variant after the
  shared native console change.
- [x] `verified` Compile WebView staging Kotlin.
- [x] `verified` Compile Gecko staging Kotlin after common transport changes.
- [x] `verified` Assemble WebView staging APK.
- [x] `verified` Assemble Gecko staging APK after the shared native console
  change.
- [x] `verified` Run `testWebviewDebugUnitTest` and assemble the minified WebView
  debug APK on Linux x86_64 with the local SDK/JDK environment.
- [x] `verified` Add and run native mirror-policy tests covering self-author
  rejection, local-edit hot-window rejection, remote acceptance, duplicate
  content, and wrong-path payloads.
- [x] `verified` Add and run native completion-filter and RPC-diagnostic tests.
- [x] `verified` Add and run native sidebar persistence-policy tests proving
  every backend-open slot is planned, including inactive lazy app slots.
- [ ] `pending` Verify continuous native typing no longer jumps the cursor when
  debounced mirror broadcasts return from the backend.
- [ ] `pending` Verify open/edit/save/reopen.
- [ ] `pending` Verify Explorer and search.
- [x] `verified` Verify native Python TextMate highlighting on-device, including
  visible punctuation and import tokens against GitHub Dark Default.
- [x] `verified` Verify the active Python WBA model and provider by receiving 82
  completion items at a real position in `open_state_events.py`; direct Sora UI
  trigger ergonomics remain follow-up validation.
- [ ] `pending` Verify diagnostics and project switching.
- [ ] `in_progress` Prevent unnecessary sidebar WebView reloads when switching
  the active window. Static investigation confirmed that Android treated the
  activation-only UI IPC delta as a complete ledger, transiently removed every
  slot, and destroyed the persistent WebViews before the full ledger arrived.
  Activation now updates only active flags, while full-state reduction rejects
  payloads without `slots` and `order`; device verification is still pending.
- [x] `verified` Verify late attachment after WebView process recreation while
  the device WBA remains running, and verify launcher leave/return behavior.
- [x] `verified` Review `git diff --check` and exact changed-file scope.
- [x] `verified` Update `.repo_memory.md` with only verified durable architecture.

### Native-only device evidence (2026-07-14)

- USB device: Pixel 9 Pro XL, package `com.termux.extensions.webview`.
- Isolation: Gecko was stopped; no browser Monaco client was required.
- Final process recreation probe: adapter `ready`, WBA connected, Python model
  generation `1`, matching open ACK generation/path, 95 grammar descriptors,
  `source.python` installed, and one Python completion provider cached.
- The active WBA session reported the same Python path and workspace root.
- A direct WBA completion probe at `open_state_events.py` returned 82 items.
- Screenshot inspection confirmed visible Python `:`, `|`, imports, keywords,
  and identifiers on the native GitHub Dark Default surface.
- The minified APK initially exposed a reflected msgpack buffer class removed by
  R8; narrow keep/dontwarn rules now cover that runtime path.

## Deferred Publication Work

- [ ] `deferred` Android payload version bump.
- [ ] `deferred` APK seed/OTA asset publication changes.
- [ ] `deferred` GeckoView native interception decision.
- [x] `verified` Create and push the user-approved targeted checkpoint.

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
| 2026-07-14 | Attach WBA before adapter readiness and recover readiness with `adapter.status`. | Adapter/UI pushes can be missed by a late native client; current WBA state must be queryable rather than edge-triggered. |
| 2026-07-14 | Treat `editor.modelReady` and exact open ACKs as required native model lifecycle barriers. | `modelReady` triggers provider/workspace replay, while the generation ACK prevents changes and completions from targeting a stale WBA model. |
| 2026-07-14 | Derive unmatched TextMate token colors from the selected theme. | The VS Code theme has no unscoped token rule; TM4E otherwise falls back to low-contrast Sora defaults for punctuation and some import scopes. |
| 2026-07-14 | Put sidebar state in the host boot snapshot and run native app-start orchestration from backend slot facts. | A native client must recover windows, query state, and launch prerequisites without waiting for a JavaScript client to perturb the backend. |
| 2026-07-14 | Log native RPC failures at the shared lane client boundary. | Callers may ignore callbacks, but transport/protocol failures must still reach the persistent Android TE2 console worker. |
| 2026-07-14 | Keep a persistent native WebView per sidebar slot and explicitly replay on foreground resume. | Android process/network suspension must not require another browser client to wake backend state, and closing the drawer must not tear down sidebar app sessions. |
| 2026-07-14 | Treat every backend-open sidebar slot as persistent and close it only through the backend ledger. | Active/eager flags control presentation and startup hints, not window ownership; native long press mirrors the web close affordance. |

## Blockers

Native sidebar activation frequently reloads an already-loaded persistent
WebView. This is deferred for the next sidebar investigation; likely stale
single-active-window URL/load handling remains in the native transition path.
Save/conflict, diagnostics, project switching, and direct Sora completion-popup
interaction remain broader workflow validation gates.
