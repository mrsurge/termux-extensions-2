# Code TE2 Native Android Editor Plan

## Goal

Prove that the Android WebView flavor can replace the `file_editor_cm6` web
frontend with a native Sora-based Code TE2 client while retaining the existing
Code TE2 backend, workbench abstraction, project authority, and strict
MessagePack Socket.IO contracts.

The result should feel like the current Code TE2 portrait/mobile layout, but
Sora and native Android components render the editor shell. The browser
frontend remains the implementation for web, GeckoView, and non-intercepted
apps during this experiment.

## End State

When the WebView launcher opens `/app/file_editor_cm6`:

1. `MainActivity` intercepts that app route before WebView navigation.
2. A native Code TE2 surface replaces the launcher WebView in the activity.
3. Sora renders and edits the backend-authoritative active document.
4. Native Explorer and search overlays use the existing Explorer RPC lane.
5. Native host controls and sidebar state use the existing UI IPC lane.
6. Sidebar apps continue to render their existing URLs in a WebView contained
   by the native sidebar drawer.
7. TextMate syntax uses WBA's extension-host grammar catalog and bodies with
   the installed GitHub Dark Default theme.
8. Language intelligence uses the existing WBA abstraction directly for hot
   editor requests.
9. Save, mirror, project switch, diagnostics, reconnect, and stale-state rules
   retain their current backend ownership.
10. Leaving native editor mode releases Sora and lane subscriptions and returns
    to the Android launcher without restarting the TE2 framework.

## Non-Goals

- Reimplementing VS Code remote workbench or extension-host behavior.
- Adding a second LSP client or language server.
- Replacing Code TE2 backend services or typed event projections.
- Changing Socket.IO paths, namespaces, MessagePack framing, or JSON-RPC method
  contracts merely for Android.
- Porting GeckoView in the first vertical slice.
- Reproducing every desktop layout affordance before the native client is
  proven usable.
- Making Android UI state authoritative for project, file, diagnostics, or
  sidebar state.

## Architecture

```text
Android WebView launcher
  -> intercept file_editor_cm6 app intent
  -> NativeEditorController
       -> boot snapshot request ----> backend runtime/WBA prime
       -> adapter-state projection -> WBA readiness gate
       -> Editor RPC client ------> /rpc/editor
       -> Explorer RPC client ----> /rpc/explorer
       -> shared UI IPC client ---> /ui_ipc
       -> direct WBA client ------> /wba
       -> native console worker --> /te2_console
       -> NativeEditorState (projection only)
       -> Compose mobile shell
            -> Sora CodeEditor
            -> Explorer/search overlays
            -> toolbar and compact menus
            -> sidebar drawer + sidebar WebView
```

The Android state model is a reducer over backend snapshots and notifications.
Local state may track transient UI concerns such as which overlay is visible,
but it must not become the source of truth for the active project, active file,
diagnostics, or sidebar catalog.

## Transport Adapter

Add one reusable Android MessagePack JSON-RPC Socket.IO client with lane
configuration for:

- namespace and Socket.IO path;
- strict `rpcCodec = msgpack-v1` authentication;
- Socket.IO acknowledgement responses for Explorer and UI IPC;
- in-band `rpc` responses for Editor and WBA;
- `rpc.notify` and WBA notification dispatch;
- request correlation, bounded timeouts, reconnect, and pending-request failure
  on disconnect;
- recursive MessagePack values: map, list, string, number, boolean, null, and
  binary.

Generalize the current Android UI IPC implementation around this client rather
than opening two `/ui_ipc` connections. Preserve existing native focus/blur
behavior for both Android flavors.

## Native Surface

The WebView activity receives a second, initially hidden native content surface.
Native editor mode owns:

- a compact top toolbar;
- a mobile menu row or equivalent native command surface;
- Sora as the primary content region;
- Explorer and search as overlays, not permanently narrow side columns;
- a problems view backed by projected diagnostics;
- a full-width sidebar drawer with app icon rail and embedded sidebar WebView;
- connection, loading, conflict, and error states that do not destroy local
  edit content.

The implementation should use stable dimensions and existing Code TE2 mobile
behavior as a functional reference. It should not copy the browser DOM or CSS
architecture into Compose.

## Editor Lifecycle

1. Connect UI IPC, request `ui.host.bootSnapshot.get`, and let that existing
   backend transaction prime the adapter runtime.
2. Connect Editor RPC, consume `editor.state.ssot`, and attach the WBA lane
   immediately. Recover current readiness through `adapter.status` polling in
   addition to consuming `editor.adapter.state` / `ui.adapter.state` pushes.
3. Open the backend-selected active file in Sora.
4. Publish `editor.modelReady` for each native model generation so the backend
   replays the existing workspace baton and cached provider registrations.
5. After adapter readiness, force-open the current model through
   `vscode.openFile` with its generation. Hold document changes and provider
   calls until the exact path/generation open acknowledgement arrives. Repeat
   that replay after WBA reconnect or workspace reset.
6. Publish debounced editor mirror changes through Editor RPC. Treat returned
   mirrors as projections rather than file-open commands: reject the native
   editor's own `source_client`, wrong-path/duplicate payloads, and projections
   inside the local-edit hot window before model mutation. Apply accepted
   same-document content as one batched Sora edit while preserving selection.
7. Publish debounced WBA document changes directly on the WBA lane.
8. Save through `editor.save` with path, content, and base digest.
9. Apply backend open-state and file-state notifications by generation/version,
   preserving unsaved local content according to the existing conflict rules.
10. Release Sora, subscriptions, pending RPC calls, and sidebar WebView state on
   native editor exit.

This is an orchestration port, not an editor rewrite. Sora remains the native
editing implementation, and no Node runtime is embedded in the Android client.

## Native Observability

Each Android flavor registers a persistent output/probe worker on the existing
TE2 console namespace. Process-local Logcat streams targeted native editor and
RPC diagnostics plus warnings/errors into the shared transcript. The worker
answers a bounded command registry for runtime snapshots, Logcat tails, native
lane state, and read-only WBA ping/status/events requests. It does not provide
arbitrary Kotlin execution, reflection, a scripting runtime, or destructive WBA
commands. The Tools overlay temporarily adds the drawer role to the same socket.

## Language And Diagnostics

The first vertical slice includes:

- TextMate syntax highlighting from WBA-projected extension grammars;
- GitHub Dark Default theme;
- WBA `openFile`, `didChange`, and completion requests;
- completion item mapping into Sora;
- diagnostics markers from the backend-projected diagnostics stream.

Hover UI, semantic-token overlays, inlay hints, document symbols, folding-range
integration, inline completion rendering, and color decorators are follow-up
adapters. Their WBA methods already exist; they should be added only after the
native document lifecycle and reconnect behavior are proven.

## Explorer And Search

The native Explorer is a dumb projection of Explorer RPC state:

- lazy directory expansion through `explorer.list`;
- active-file and open-directory updates from backend notifications;
- file open intent through `explorer.editor.open`;
- search start, pagination, cancellation, and result navigation through the
  current search methods;
- create, rename, delete, move, and copy only through existing backend methods;
- git and diagnostics decorations from backend projections.

No directory or search result needs to be mirrored to every client unless the
current backend contract already defines it as a shared fact.

## Sidebar And Host Actions

UI IPC remains the native shell's host-control lane. The native client consumes
sidebar catalog/order/active-slot projections and sends existing create,
activate, close, reorder, save, run, and related host intents. Sidebar app URLs
render in a dedicated contained WebView, while sidebar authority stays in the
backend.

The native frontend must not connect to `/sidebar_ipc`; that lane belongs to
sidebar app backends.

### Known Sidebar Defect

Every backend-open sidebar window loads in the background and remains connected
when the drawer closes and reopens. Switching the active window still causes an
unnecessary reload on roughly 80 percent of transitions across all tested apps.
This is an activation-transition defect, not a persistence failure, and is
intentionally deferred from the current slice. Investigate stale URL/load logic
left from the earlier single-active-window implementation before changing the
backend ledger or persistence contract.

## Delivery Slices

### Current checkpoint

Slice 1 source implementation is complete on `native-android-editor` and the
WebView staging APK assembles. The tracker intentionally leaves user workflows
`in_progress` until they are exercised on-device; build success alone is not
the acceptance boundary. No framework restart, version bump, commit, push, or
Gecko routing change is part of this checkpoint.

### Slice 1: Native vertical proof

- Add Sora and transport dependencies for the WebView flavor.
- Add reusable strict MessagePack JSON-RPC lane client.
- Intercept `file_editor_cm6` in WebView `MainActivity`.
- Render native toolbar, Sora editor, Explorer/search overlays, problems view,
  and sidebar shell.
- Implement editor SSOT/open/save/mirror and reconnect.
- Implement Explorer list/open/search and projected decorations.
- Implement UI IPC sidebar projection and host actions.
- Load TextMate grammar metadata/bodies from WBA and the visual theme from
  installed Code TE2 assets.
- Integrate WBA open/change/completion.

### Slice 2: Workbench feature depth

- Hover presentation.
- Semantic tokens and inlay hints.
- Symbols, folding ranges, and document colors.
- Completion snippets and additional text edits beyond the stable Slice 1
  subset.
- Remaining Explorer context operations and richer git presentation.

### Slice 3: Native polish and publication

- Accessibility and Android keyboard/selection validation.
- Rotation, process recreation, and saved transient UI state.
- Performance and memory instrumentation.
- Android payload versioning and publication assets.
- Decision on whether GeckoView should gain the same native interception.

## Validation Gates

- Unit-test MessagePack recursion, JSON-RPC correlation, both response modes,
  notification dispatch, timeout, disconnect, and reconnect behavior.
- Unit-test backend projection reducers and path/language mappings.
- Compile both WebView and Gecko variants when common Android transport code is
  changed.
- Run the WebView staging unit tests and assemble the WebView staging APK.
- Manually validate launcher interception, return-home flow, project switch,
  open/edit/save/reopen, Explorer navigation, search, diagnostics, completion,
  sidebar activation, disconnect/reconnect, and process recreation.
- Do not restart the shared TE2 framework as part of validation without
  explicit approval.

## Acceptance Criteria

The first slice is accepted when the WebView flavor can perform a normal mobile
Code TE2 workflow entirely in the native surface: launch Code TE2, browse or
search for a file, open it, edit with syntax highlighting and WBA completion,
save it, observe diagnostics, open a sidebar app, survive a connection loss,
and return to the launcher. Backend/browser clients must continue to observe
the same authoritative project and file state.
