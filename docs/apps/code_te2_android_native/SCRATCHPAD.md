# Code TE2 Android Native Scratchpad

This file holds investigation evidence, unresolved questions, and temporary
implementation notes for the native Android Code TE2 experiment. Promote stable
decisions into `NATIVE_EDITOR_PLAN.md` and completion state into
`IMPLEMENTATION_TRACKER.md`.

## Working Context

- Branch: `native-android-editor`
- Initial branch point: identical to `main` at `49f30881` when the branch was
  checked out.
- Target: Android WebView flavor only for the first experiment.
- Intercepted app: `file_editor_cm6`.
- Existing GeckoView behavior must remain unchanged.
- The existing Code TE2 backend and transport contracts remain authoritative.
- Sora is a native editor view and input surface. It is not a new language
  server, extension host, filesystem backend, or project-state owner.

## Current Source Anchors

### Android shell

- `android/app/src/webview/java/com/termux/extensions/MainActivity.kt`
  currently recognizes framework `/app/<app_id>` navigation and owns
  `loadApp(appId)`.
- `android/app/src/webview/res/layout/activity_main.xml` currently hosts the
  WebView surface and native Android chrome.
- `android/app/build.gradle.kts` already enables Compose and targets Java/Kotlin
  17 with `minSdk = 24`.
- `android/app/src/main/java/com/termux/extensions/UiIpcClient.kt` already
  connects to `/ui_ipc` with strict `msgpack-v1`, but its decoder currently
  handles only the focus/blur subset needed by the wrapper.
- `EditorAssetManager` owns the installed and OTA-updated Code TE2 asset tree.
  Native Sora uses its GitHub Dark Default theme, while WBA remains authoritative
  for extension-host TextMate grammar metadata and bodies.

### Code TE2 lanes

| Concern | Namespace | Socket.IO path | Response shape |
| --- | --- | --- | --- |
| Editor state and file lifecycle | `/rpc/editor` | `/editor_ws/socket.io` | In-band JSON-RPC response on `rpc` |
| Explorer tree and search | `/rpc/explorer` | `/explorer_ws/socket.io` | Socket.IO acknowledgement |
| Host and sidebar orchestration | `/ui_ipc` | `/ui_ipc_ws/socket.io` | Socket.IO acknowledgement |
| Workbench intelligence | `/wba` | `/wba_ws/socket.io` | In-band JSON-RPC response on `rpc` |

All four lanes use binary MessagePack application payloads containing JSON-RPC
2.0 envelopes. Explorer and UI IPC use Socket.IO acknowledgements; Editor and
WBA return responses in-band on `rpc`. These lane differences must be
configuration in one Android RPC client, not four unrelated protocol
implementations.

### Authority boundaries

- Editor RPC owns active-document bootstrap, open/save/mirror lifecycle, and
  backend-projected editor state.
- Explorer RPC owns directory listing, search, file operations, and Explorer
  projections.
- UI IPC owns host actions and sidebar-window projections.
- WBA owns code-server intelligence and extension-host interaction.
- Direct native-editor-to-WBA calls are appropriate for latency-sensitive
  language features, matching the existing browser editor.
- Diagnostics displayed by the native shell should consume the backend project
  projection so project generation and stale-result filtering remain
  backend-authoritative.

## Sora Notes

- Exact pin for the experiment: Sora `0.23.5` from the historical
  `io.github.Rosemoe.sora-editor` Maven group. It is the last release line built
  against Kotlin 1.9. Sora `0.23.6` requires Kotlin 2.1, and `0.24.4` requires
  Kotlin 2.2, which would force an unrelated Android Kotlin/Compose migration.
- Initial modules: `editor` and `language-textmate`.
- Sora supports API 21+, while the local Android app uses API 24+.
- `language-textmate` requires core library desugaring on this SDK range.
- `CodeEditor.release()` is a required lifecycle cleanup.
- `TextMateLanguage` can remain responsible for syntax analysis and editor
  behaviors while a thin language wrapper sources completion items from WBA.
- Native Sora must not treat the browser/WebWorker grammar assets as its
  authority. It consumes WBA `grammars.list` / `grammars.load` and keeps only
  the visual theme in the Android asset path.

Official references:

- [Sora getting started](https://project-sora.github.io/sora-editor-docs/guide/getting-started)
- [Sora language integration](https://project-sora.github.io/sora-editor-docs/guide/using-language)
- [Sora Compose integration](https://project-sora.github.io/sora-editor-docs/guide/code-editor-in-compose)
- [Sora releases](https://github.com/Rosemoe/sora-editor/releases)

## Slice 1 Implementation Checkpoint

- `UiIpcClient` now uses the shared RPC transport and remains the only native
  `/ui_ipc` connection. It replays the latest typed projections when the native
  Code TE2 controller attaches.
- Editor and WBA use in-band JSON-RPC responses; Explorer and UI IPC use
  Socket.IO acknowledgements through the same configurable client.
- `MainActivity` intercepts only `file_editor_cm6`. Other apps remain in the
  launcher WebView, and Gecko routing is unchanged.
- `NativeEditorController` is the lane adapter and projection reducer. It owns
  no backend project, filesystem, diagnostics, or sidebar authority.
- Native launch now requests the same UI IPC boot snapshot as the browser host.
  The native WBA lane attaches immediately, queries/polls `adapter.status`, and
  does not depend on receiving a one-time adapter-state push.
- Each native model generation publishes `editor.modelReady`, which invokes the
  backend `te2.resync` path and replays the existing workspace/provider state.
- WBA attach and workspace reconnect force-open the active model with its local
  generation. Debounced changes and completion requests remain blocked until
  the exact path/generation open acknowledgement arrives. This orchestration is
  implemented in Kotlin; Sora remains the editor and Android embeds no Node
  runtime.
- Sora consumes the live WBA extension-host grammar catalog and grammar bodies,
  while GitHub Dark Default remains an installed theme asset. Android inserts
  an in-memory unscoped token fallback derived from that theme's own editor
  foreground/background so unmatched TM4E punctuation/import scopes remain
  visible. Active-language loading runs off the UI thread and stale results are
  dropped across document or adapter-session transitions.
- The stable completion subset maps label, detail, insert text, kind, and the
  single-line replacement prefix. Snippet expansion, documentation UI, and
  additional edits remain follow-up work.
- A dedicated sidebar WebView is created only while the native sidebar panel is
  active and is destroyed with that composition. The sidebar panel now occupies
  the complete native editor surface.
- The first command surface contains save, backend-orchestrated run, Explorer,
  search, problems, sidebar, home, reconnect, Tools, and quit.

Validation completed on 2026-07-14:

```text
./gradlew -Pandroid.aapt2FromMavenOverride="$ANDROID_SDK_ROOT/build-tools/34.0.0/aapt2" \
  :app:testWebviewDebugUnitTest \
  :app:assembleWebviewDebug

BUILD SUCCESSFUL
```

The minified APK also requires explicit R8 retention for msgpack-core's
reflectively selected `MessageBufferU`/`MessageBufferBE` implementations.

## WBA Device Evidence

- A clean native-only launch originally had an editor model but
  `adapterStatus=idle`, no WBA client, and no TextMate catalog. The device WBA
  itself was already ready; the native client had missed edge-triggered adapter
  state and never sent the browser's `editor.modelReady` replay signal.
- After the fix, a process-recreated WebView attached to the already-running WBA
  with no Monaco client: adapter ready, one WBA socket, matching model/open-ACK
  generation, 95 grammar descriptors, `source.python`, and the Python
  completion provider.
- Opening `app/apps/file_editor_cm6/open_state_events.py` through Explorer RPC
  advanced the native generation and WBA ACK together. A completion probe at a
  real Python position returned 82 items.
- Python punctuation and imports are visibly high contrast in the native Sora
  screenshot. No invalid MessagePack notification warnings remained in Logcat.
- Direct Sora completion-popup interaction is still a focused UI validation
  item; the WBA provider/model/completion path itself is verified.

## Investigation Rules

- Verify contracts against current source before implementing each lane.
- Do not add an Android-only backend or duplicate WBA/LSP implementation.
- Do not move project or open-file authority into Android UI state.
- Do not alter GeckoView behavior as part of the WebView experiment.
- Do not edit generated Android asset copies by hand.
- Record newly discovered contract gaps here before expanding implementation
  scope.
