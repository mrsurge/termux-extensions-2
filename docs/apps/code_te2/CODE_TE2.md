# CODE_TE2 (Monaco Editor) — End‑to‑End Reference

This is the current wiring and ownership reference for the Monaco-based
`code_te2` application. It covers the deployed app-worker, WBA, framework, and
native-client stack; planning documents record migration history rather than
runtime authority.

## How To Read This Doc

- Current source wins over this document. In particular, generated bundles and
  planning documents do not establish runtime behavior.
- Read §§0–6 for architecture and app contracts, then use the focused later
  sections for a subsystem. `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`
  is direction/history, despite its legacy name.

### Stable section map

This pass keeps existing section numbers stable so links do not change alongside
the pending source work. Deliberately absent numbers are removed historical
material: §§16–18 were replaced by the current §§14–15 reference, and §§27–29
were folded into §§22 and 26. A future navigation-only pass may renumber after
link consumers are updated.

---

## Current Architecture

The live division is deliberately narrow:

- TE2 worker SSOT owns edits, saves, drafts, preferences, client foregrounds,
  and cross-surface orchestration.
- `code-server` owns extension execution; the Node workbench adapter (WBA)
  owns the VS Code protocol and editor-facing language RPC.
- The inline editor calls `/wba` directly for language features and `/rpc/editor`
  for state/control. Host and Explorer remain WBA-blind and use backend lanes.
- Framework routes proxy bytes and lifecycle; they do not become document or
  namespace authority.

Code-server is a pipe-backend framework shell at the resolved
`$TE2_RUNTIME_HOME/code_te2/code_server.sock`; readiness gates WBA startup.
The WBA retains stdio JSON-RPC only for backend control work. Its browser hot
path is `/wba`. `te2.resync` is an editor-frontend `/wba` request, while project
switching, watcher resubscription, extension menus/navigation, webview backend,
and logical-document reconcile remain backend control-plane work.

TextMate uses the vendored workbench runtime in
`monaco_editor/editor_textmate_runtime.ts` and WBA grammar metadata. A provider
is still required for meaningful language features.

### Extension validation matrix (next milestone)
We will validate at least 2 deterministic features (hover + symbols + diagnostics) per language:
- Python: `ms-pyright` (baseline) — **validated**: open file, document symbols, hover, diagnostics.
- TypeScript/JavaScript: built-in TS language service — **validated**: diagnostics working for `.ts`, `.js`, `.mjs`, `.tsx`, `.jsx` files. JS files get JavaScript-level strictness (lenient), TS files get full type checking.
- C++: `llvm-vs-code-extensions.vscode-clangd` — **validated**: diagnostics on open + live diagnostics on edit (after endColumn fix). Clangd is strict about UTF-16 range validity — sentinel endColumn values like INT32_MAX cause `"utf-16 offset ... is invalid for line N"` rejection and break subsequent analysis.
- Rust: `rust-lang.rust-analyzer` — **validated** on desktop and Termux when a
  host-native `rust-analyzer` is installed and selected in the extension's
  normal server-path configuration.

---

## 0) High-level map

```text
Browser host shell (code_te2/template.html + main.ts -> static/dist/host.js)
  ├─ Explorer frontend: src/explorer/ rendered inside the host shell
  │     └─ Socket.IO path /api/app/code_te2/socket.io, namespace /rpc/explorer
  ├─ Sidebar/terminal drawers: host-owned shell surfaces
  └─ Inline editor host mount
        ├─ Host container: #editor-frame in template.html
        ├─ Inline host loader: monaco_editor/inline_host.ts
        ├─ Monaco runtime source: monaco_editor/m_editor_app.ts
        ├─ Monaco assets: /api/app/code_te2/ui/monaco_vscode/esm/...
        ├─ Editor state/control RPC: /api/app/code_te2/socket.io namespace /rpc/editor
        ├─ WBA language RPC/events: /api/app/code_te2/services/wba/socket.io namespace /wba
        └─ Touch selection: /api/app/code_te2/static/vendor/monaco-touch-selection/...

Rust/Axum framework process
  ├─ Proxies /app/code_te2 -> worker port
  ├─ Loads the app registry and shellspec metadata
  ├─ Owns app lifecycle/readiness and native Ferrous framework services
  ├─ Owns Rust pipe services for filesystem, Git, search, settings/state, and shell orchestration
  ├─ Proxies app Socket.IO public path /api/app/code_te2/socket.io -> worker /socket.io/
  ├─ Proxies WBA Socket.IO public path /api/app/code_te2/services/wba/socket.io -> Node /wba_ws/socket.io
  └─ Proxies TE2 console/FastMCP to the Python runtime sidecar

App worker process (app/apps/code_te2/main.py)
  ├─ HTTP routes: /api/app/code_te2/*
  ├─ Monaco/VS Code asset routes under /ui/*
  ├─ Shared Socket.IO server mounted at /socket.io/
  │     ├─ /rpc/editor: editor state/control JSON-RPC
  │     ├─ /rpc/explorer: Explorer JSON-RPC
  │     ├─ /ui_ipc: host/main-page JSON-RPC and typed app UI facts
  │     ├─ /sidebar_ipc: sidebar backend lane
  │     └─ /terminal: Code TE2 terminal lane
  ├─ Backend boot/runtime priming for code-server + WBA
  └─ SSOT stores: _history_store (project sidecar), _preferences_store

Framework shells (service processes owned by the framework_shells orchestrator)
  ├─ code-server (pipe backend): real VS Code-compatible backend + remote extension host
  │     listens on the resolved UDS path, stdout piped to Python for readiness detection
  └─ workbench adapter (pipe backend, Node)
        ├─ backend control plane: stdin/stdout JSON-RPC (<<<RPC>>> / <<<PUSH>>>)
        ├─ editor-facing RPC/event plane: Socket.IO namespace /wba
        └─ remote agent/client side: connects to code-server over UDS

Editor language feature pipeline (current hot path):
  browser inline editor runtime
    -> /wba Socket.IO JSON-RPC
    -> workbench adapter
    -> code-server remote agent / extension host
    -> /wba notifications / replies
    -> browser inline editor runtime

Editor state/control pipeline:
  browser inline editor runtime
    -> /rpc/editor JSON-RPC
    -> app worker editor backend / project sidecar / save / draft / open flows
    -> /rpc/editor notifications

Host boot / readiness pipeline:
  host page
    -> /ui_ipc JSON-RPC boot snapshot
    -> worker boot_snapshot_backend primes code-server/WBA
    -> /ui_ipc adapter_state facts back to host

Explorer/backend WBA control-plane residue:
  explorer/backend
    -> adapter_rpc(...) over stdio
    -> switch/workspace, watcher, extension, webview, and reconcile control work

File watcher pipeline:
  code-server parcel watcher detects disk change
    -> remoteFilesystem IPC channel fires EventFire (ResponseType 204)
    -> src/client/workbench-client.ts onEvent({type: "watcher/fileChanges", changes: [...]})
    -> wba_event_bridge.py / workspace_events.py normalize and fan out
    -> Explorer watcher handlers update backend-owned tree state and emit typed Explorer notifications
  Fallbacks: raise inotify limit -> watchexec --poll -- cat -> none (manual refresh)

UI IPC pipeline:
  host/main page
    -> /ui_ipc msgpack-v1 JSON-RPC
    -> ui_ipc_ws.py parses typed RPC/facts and dispatches backend hooks
    -> target backend hook/service
    -> target surface notification
```

---

## 0.5) Framework Shells (Transport vs Execution)

Terminology used in TE2:
- A **framework shell** is a long-lived subprocess managed by `framework_shells` (start/adopt/terminate + readiness).
- **Transport level** is "how bytes move" (Socket.IO/WS/HTTP proxies). It must stay proxy-only.
- **Execution level** is "who runs logic/state" (worker SSOT, extension host, adapter decode/encode).

For `code_te2`, we intentionally separate responsibilities:
- **App worker Socket.IO transport**: canonical public path `/api/app/code_te2/socket.io`, worker mount `/socket.io/`, namespaces `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`.
- **Legacy app Socket.IO aliases**: `/editor_ws/socket.io`, `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, and `/terminal_ws/socket.io` route to the same worker service declared by `sio_service.json`.
- **Editor WBA transport**: canonical public path `/api/app/code_te2/services/wba/socket.io`, WBA namespace `/wba`, legacy alias `/wba_ws/socket.io`.
- **Execution**:
  - Worker owns drafts/saves/versioning and host/explorer state.
  - Rust pipe services own filesystem, Git, and search DTO production.
  - `code-server` owns extension execution and remote-agent services.
  - Node workbench adapter owns protocol translation, provider state, editor-facing WBA RPC/events, and backend stdio control hooks.

Current deterministic runtime endpoints:
- `code-server`
  - resolved only from TE2's pinned private runtime at `$TE2_DATA_HOME/code_server/4.130.0` after canonical root resolution
  - launched with `--socket` and `--socket-mode 0600`
  - stdout piped to Python for readiness detection
- workbench adapter
  - backend-owned HTTP/Socket.IO listen: `127.0.0.1:18181`
  - stdio JSON-RPC remains the backend control plane
  - `/wba` is the browser-facing editor RPC/event namespace

Discovery / control endpoints (worker, proxied via main process):
- `GET /api/app/code_te2/workbench_adapter/{discover,start,attach,status}`
- `POST /api/app/code_te2/workbench_adapter/cmd`

The `workbench_adapter/*` HTTP routes are still backend-owned control/discovery surfaces. They are not the editor hot path once the inline editor runtime is connected to `/wba`.

Spinner / Status indicator (host UI):
- The host UI uses a **3-state status indicator** (`#fe-lsp-spinner`) that is always visible:
  - **busy** (CSS `fe-lsp-status--busy`): animated spinner — adapter starting, readiness chain running, or diagnostics in progress.
  - **ok** (CSS `fe-lsp-status--ok`): green check — adapter connected and operational.
  - **error** (CSS `fe-lsp-status--error`): warning/error state.

## 0.6) Current cross-cutting contracts

- Explorer, editor/Python, direct editor/WBA, and UI IPC use strict `msgpack-v1` application payloads on their Socket.IO namespaces. Browser encoding is owned by `src/rpc/codec.ts`; Python encoding/decoding is owned by `frontend_rpc_codec.py`; WBA runtime encoding is owned by `workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.ts`.
- Sidebar IPC retains its current codec. Migrating `/ui_ipc` must not implicitly change the sibling `/sidebar_ipc` namespace.
- Shared document membership is the bounded `ProjectSidecar` recent/logical-document set. Each stable `clientInstanceId` owns one backend-projected foreground path through `open_state_backend.py`; `ProjectSidecar.last_file` is only a one-time migration seed. Frontend `currentPath` values are exact-client projections.
- Shared content projections carry a durable per-path `document_revision` drawn from one monotonic project stream. Matched frontends reject missing or lower revisions before changing Monaco or active-path chrome; equal revisions are valid for the correlated mirror/cache pair emitted by one backend transition.
- App-lane outbound traffic uses websocket-only `volatile.emit` with connected-state guards. Disconnected RPC requests fail, notifications and terminal input drop, and connect handlers rebuild authoritative state.
- Code Server launch, VSIX/Open VSX commands, builtin-extension discovery, and WBA nid extraction all use the same pinned TE2-managed installation. System, `PATH`, NVM, and executable environment overrides are not runtime authorities.
- Every WBA protocol actor, including language intelligence, commands, messages, and webviews, receives its resolved nid through named runtime-adapter fields. The generated config for the pinned managed Code Server runtime is production authority; `RPC_DEFAULTS` is only the matching 4.130 no-config fallback.
- The installed WBA MessagePack codec is one self-contained bundled ESM file at `workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs`.

## 0.7) Relay Boundaries

Several relays participate in a native client session, but they have separate
owners and must not be treated as interchangeable.

- **Framework app and Socket.IO proxies** are Rust-server routes. They expose
  public per-app mounts and forward to an already-running loopback app worker or
  declared service endpoint. They are non-launching transport/policy boundaries;
  Socket.IO routes forward physical Engine.IO traffic without interpreting
  namespaces or RPC payloads.
- **`AndroidFrameworkRelay`** is a process-local Android client relay owned by
  `PersistentNetworkService`. It gives the GeckoView or Cefrium browser a local
  loopback framework origin, serves native Android routes and declared installed
  assets locally, and streams all remaining framework HTTP, SSE, Socket.IO, and
  WebSocket traffic to the configured upstream framework origin. Gecko and
  Cefrium activities bind this service; it is not a Rust app-worker proxy.
- **Run Target relays** are native client port-forwarders for remote Run Profile
  listeners. They reconcile the framework's route projection and do not serve
  framework pages or establish the browser framework origin.

The Cefrium module configures Cefrium-specific local routes, but it does not
create a competing framework-route authority: its process-local client runtime
owns browser-relay lifecycle and upstream retargeting. Gecko uses the same
client-runtime pattern in its own process.

---

## 1) Key files (where to look)

### Monaco editor runtime (worker)
- `app/apps/code_te2/monaco_editor/inline_host.ts`
  - Mounts the inline editor into `#editor-frame`
  - Injects the inline host markup (`#te2-breadcrumbs`, `#fh-monaco`)
  - Loads required CSS/vendor assets and then imports `m_editor_app.ts`
- `app/apps/code_te2/monaco_editor/m_editor_app.ts`
  - Monaco editor bootstrap source of truth
  - Model management (plain editor vs diff editor)
  - Draft overlay decorations (blue inserts / yellow deletes)
  - Editor RPC client wiring for `/rpc/editor`
  - Direct WBA Socket.IO client wiring for `/wba`
- `app/apps/code_te2/monaco_editor/editor_rpc_transport.ts`
  - Editor-facing JSON-RPC transport over `/rpc/editor`
- `app/apps/code_te2/monaco_editor/editor_wba_rpc_transport.ts`
  - Editor-facing JSON-RPC transport over `/wba`
- `app/apps/code_te2/monaco_editor/editor_workbench_runtime.ts`
  - Maps editor workbench calls to direct WBA RPC methods

### Editor RPC (worker)
- `app/apps/code_te2/socketio_gateway.py`
  - Registers shared app Socket.IO namespaces on the worker server.
- `app/apps/code_te2/monaco_editor/editor_rpc_socketio.py`
  - Owns `EditorRpcSocketIONamespace("/rpc/editor")`.
  - Decodes strict msgpack-v1 JSON-RPC requests and emits typed editor notifications.
- `app/apps/code_te2/monaco_editor/editor_rpc_contract.py`
- `app/apps/code_te2/monaco_editor/editor_rpc_contract.ts`
  - Python and TypeScript method/notification constants.
- `app/apps/code_te2/monaco_editor/editor_ws.py`
  - Backend hook/service layer for open, mirror, git baselines, draft diff, save, cache state, and target-surface notifications.

### Explorer RPC (worker)
- `app/apps/code_te2/socketio_gateway.py`
  - Registers `/rpc/explorer` on the shared app Socket.IO server.
- `app/apps/code_te2/explorer/transport/rpc_socketio.py`
  - `ExplorerRpcSocketIONamespace("/rpc/explorer")`
  - Parses strict msgpack-v1 JSON-RPC explorer requests and adapts them onto the backend dispatcher.
- `app/apps/code_te2/explorer/transport/rpc_contract.py`
  - Explorer RPC method aliases and notification constants.
- `app/apps/code_te2/explorer_runtime.py`
  - Runtime/composition shell for `ExplorerDispatcher`.
  - Owns explorer session lifecycle, transport-edge delegation, and handler assembly.
- `app/apps/code_te2/explorer/handlers/*` and `app/apps/code_te2/explorer/services/*`
  - Own the extracted file-tree, Rust-pipe FS/Git/search integration, project, watcher, review, prefs, and editor-integration behavior.

### Socket.IO route proxy (main process, proxy-only)
- `framework/rust/crates/te2-server/src/sio_proxy.rs` and `app_proxy.rs`
  - Rust-owned public app and raw Engine.IO route proxies.
  - They forward traffic only; they do not parse namespaces or JSON-RPC payloads.
- `app/apps/code_te2/sio_service.json`
  - Declares `/api/app/code_te2/socket.io` -> app worker `/socket.io/`.
  - Declares `/api/app/code_te2/services/wba/socket.io` -> Node WBA `/wba_ws/socket.io`.
  - Keeps legacy aliases explicit: `/editor_ws/socket.io`, `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, `/terminal_ws/socket.io`, and `/wba_ws/socket.io`.
- The app worker owns `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`.
- The Node WBA service owns `/wba`.
- All Socket.IO route proxies: bidirectional WS frame forwarding, no SSOT access, no namespace dispatch, no payload parsing.

### Host shell (browser, worker-served)
- `app/apps/code_te2/template.html`
  - Layout + inline editor placement.
- `app/apps/code_te2/main.ts`
  - Host frontend bundle entrypoint.
  - Boots `main_page/frontend/` modules and imports the Explorer frontend source.
- `app/apps/code_te2/main_page/frontend/`
  - Toolbar/menu logic, explorer integration, session state UI, UI IPC, readiness, settings, sidebar/terminal drawer shells, and host panels.
- `app/apps/code_te2/src/explorer/`
  - Explorer frontend source tree bundled into `static/dist/host.js`.
  - Tree rendering, search overlays, review panel, project navigation, git/status presentation, and Explorer RPC client.

#### Host decomposition status (current)
The old `src/host/` path has migrated to `main_page/frontend/`, and `main_page/frontend/**/*.ts` is included in the strict TypeScript lane. Representative modules:

| Module | Responsibility |
|---|---|
| `main_page/frontend/connections/ui-ipc-rpc.ts` | Strict msgpack-v1 UI IPC JSON-RPC connection |
| `main_page/frontend/connections/ui-ipc.ts` | UI IPC fact handling and host integration |
| `main_page/frontend/ui/watcher-settings.ts` | Watcher mode/raise-limit UI and handlers |
| `main_page/frontend/ui/preferences.ts` | Preferences fetch/update/menu apply orchestration |
| `main_page/frontend/ui/layout-manager.ts` | Desktop/mobile layout mode management |
| `main_page/frontend/ui/cache-indicator.ts` | Draft/crash cache badge behavior |
| `main_page/frontend/ui/settings-manager.ts` | Extension card rendering and Settings modal logic |

Remaining high-value decomposition targets:
- Remaining file-ops/open-save flow partitioning.
- Final wiring reduction so `main.ts` remains mostly boot + module assembly.
- Continued conversion of any remaining loose JS adjacent to the host lane.

### SSOT and persistence
- `app/apps/code_te2/stores.py`
  - Singleton store instances: `_history_store`, `_preferences_store`
- `app/apps/code_te2/project_sidecar.py`
  - Disk-backed "session_cache" (draft cache entries) at `$TE2_DATA_HOME/code_te2/projects/{hash}.json`
  - `_instances`: per-process ClassVar cache (not shared across processes)
  - `reload()`: re-reads from disk to pick up cross-process writes
- `app/apps/code_te2/draft_index_sidecar.py`
  - Lightweight per-project draft index at `{hash}.draft_index.json`
  - `snapshot()` returns `(draft_files, draft_dirs)` sets for O(1) hasDraft checks
  - `_rebuild_from_project_sidecar()`: reads ProjectSidecar file directly from disk
- `app/apps/code_te2/history_store.py`
  - `upsert_cached_document()`: writes to ProjectSidecar + updates DraftIndexSidecar
  - `list_project_drafts()`: calls `sidecar.reload()` before reading (cross-process safe)
  - `get_cached_document()`: calls `sidecar.reload()` before reading
- `app/apps/code_te2/explorer/review.py`
  - `list_reviews(project, lightweight)`: queries drafts, optionally computes diff hunks
  - `discard_reviews(project, files)`: clears drafts, reverts active editor if file is open
- `app/apps/code_te2/preferences_store.py`
  - Disk-backed preferences at `$TE2_CONFIG_HOME/code_te2/preferences.json`

The companion global history ledger is stored at
`$TE2_DATA_HOME/code_te2/history.json`. Code TE2 startup does not probe or
import the former `cm6_editor`, `cm6_sessions`, or `termux-extensions-2`
roots. Recovery from those roots is reserved for the explicit opt-in migration
command.

---

## 1.5) Frontend build process (host + inline editor bundles)

TE2 host/inline-editor frontend bundling for `code_te2` uses `esbuild` (with TypeScript type-check support via `tsc --noEmit`):

- Config: `app/apps/code_te2/build.mjs`
- Scripts: `app/apps/code_te2/package.json`
  - `npm run build` -> production bundle (minified, sourcemaps)
  - `npm run build:watch` -> watch mode (non-minified)
  - `npm run typecheck` -> TypeScript checking only

Current build output:
- Host bundle: `static/dist/host.js` (entry: `main.ts`, format: ESM)

Notes:
- There is no separate `static/dist/editor.js` output in the current app build. The inline Monaco runtime is statically included through the `main.ts` -> `inline_host.ts` -> `m_editor_app.ts` import chain.
- Vendor assets remain external (`/static/vendor/*`) and are still loaded separately.
- This host/inline-editor bundle process is separate from the Monaco pinned-VSCode asset publication described later in this document.

### Current host TS migration state (important)
- The live host runtime served to the browser is `static/dist/host.js`, bundled from `main.ts` by `build.mjs`.
- `main_page/frontend/**/*.ts` and `src/explorer/**/*.ts` are included in `tsconfig.json`.
- The old `src/host/` decomposition path no longer exists; host frontend modules live under `main_page/frontend/`.
- The remaining host-focused target is to keep shrinking raw template-owned behavior and keep durable UI contracts in typed frontend modules where possible.

---

## 2) URL & mount conventions (the "prefix math")

### User-facing routes
- App HTML: `/app/code_te2`
- App API prefix: `/api/app/code_te2/...`

### Monaco editor runtime routes (served by the worker, under the app API prefix)
- Monaco ESM: `/api/app/code_te2/ui/monaco_vscode/esm/vs/...`
- Monaco "lang bundles": `/api/app/code_te2/ui/monaco_vscode/lang/...`
- Inline asset CSS/JS loaded by `inline_host.ts`:
  - `/api/app/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.css`
  - `/api/app/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js`
- TextMate runtime is bundled into `static/dist/host.js`.
- Oniguruma WASM is served from `/api/app/code_te2/ui/monaco_editor/textmate/onig.wasm`.
- Editor-facing WBA RPC/event socket: `/api/app/code_te2/services/wba/socket.io` namespace `/wba`.

### App Socket.IO transport
- Canonical public path: `/api/app/code_te2/socket.io`
- Worker mount: `/socket.io/`
- Namespaces: `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, `/terminal`
- Legacy aliases declared by `sio_service.json`: `/editor_ws/socket.io`, `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, `/terminal_ws/socket.io`

### Editor RPC transport
- Canonical path: `/api/app/code_te2/socket.io`
- Legacy path alias: `/editor_ws/socket.io`
- Namespace: `/rpc/editor`
- Payload codec: strict `msgpack-v1` JSON-RPC

Important:
- The **framework** registers public app Socket.IO paths and proxies them to the worker.
- The **worker** mounts one shared Socket.IO ASGI app at `/socket.io/` plus legacy alias mounts in `SUBAPPS`.
- The transport is websocket-only; the route proxy is not a namespace dispatcher and does not inspect payloads.

---

## 3) Manifest services and physical routes

`sio_service.json` is the active Code TE2 physical Socket.IO-route declaration.
Rust reads the manifest and proxies those routes; it does not import or execute
Python `services` modules. The current Sidebar lane is worker-owned
`/sidebar_ipc`, not a main-process service-loader feature. Treat
`services/sidebar_backchannel_uds.py` and its README as historical/orphaned
until source either wires or retires them. The removed `vscode_rpc` side channel
is not part of the current architecture.

---

## 4) SSOT (HistoryStore / PreferencesStore) model

### Active project
SSOT tracks a single “active project root”. The worker derives most behavior from:
- `_history_store.get_active_project()`

### Active file (one foreground per stable client)

The active path is backend-projected per stable `clientInstanceId` through
`open_state_backend.py` and bounded `ProjectSidecar.client_foregrounds` state.
Shared recents remain the admitted/open document membership. Browser, Electron,
GeckoView, and Cefrium use the same frontend identity contract; `windowId` is
presentation/console metadata rather than another foreground authority.
`ProjectSidecar.last_file` is consumed only as a one-time migration seed.
Frontend `currentPath` values project their exact client's foreground and never
act as cross-client authority.

Every foreground retains an authenticated `primary` or `secondary` role. New
secondary identities start empty rather than inheriting shared MRU. Removing a
shared document commits membership and each affected foreground together, emits
one `DocumentClosed` fact, falls affected primary clients back to shared MRU,
clears affected secondary clients, and projects exact-client editor SSOT so
Monaco replaces or disposes the visible model.

Complete boot snapshots share only their disk-heavy cross-client core. Before
returning, Python materializes and overlays the requesting client's exact
foreground editor SSOT, including the file payload. Shared open-state
notifications remain document-membership facts and never clear or dispose a
client's Monaco model; exact-client SSOT and file-open notifications exclusively
own visible model lifetime.

A project-root switch remains shared and atomic across every connected client
even though visible foreground ownership is client-scoped. After the new
sidecar is installed, the backend publishes shared membership once and sends
one exact `editor.state.ssot` snapshot to each connected stable client. A
client whose new-project foreground is explicitly empty receives
`{ path: null }`, which clears its stale Monaco model. The successful
`ProjectSwitchFinished` event is the sole global `explorer.project.opened`
projection; failures before that event publish no completion.

### Drafts (project sidecar / session_cache)
Drafts are stored in project sidecar "session_cache" entries:
- key = absolute file path
- content = entire draft text (current buffer)
- metadata includes:
  - `base_sha256` (disk baseline hash when draft started)
  - `content_sha256` (draft content hash)
  - `unsaved` (True/False, computed as `content_sha256 != base_sha256`)
  - `document_revision` (durable monotonic ordering fence for that path)
  - runtime identifiers (run_id, etc.)

The editor Socket.IO server (`editor_ws.py`) is the worker-side entry point for persisting drafts from the inline editor runtime.

Draft mutations trigger the following pipeline:
1. `on_editor_mirror` persists to `ProjectSidecar.session_cache` via `upsert_cached_document`
2. `DraftIndexSidecar` is updated with the file's unsaved status (fast O(1) hasDraft)
3. `editor:mirror` and `editor:cache_state` carry the same newly assigned
   document revision; clients showing another path ignore them, and clients on
   the same path reject an older revision before changing content or chrome
4. `notify_draft_state_changed()` broadcasts `explorer:updateDecorations` + `review:setEntries` to explorer clients

The active-file draft badge is a destructive affordance. Its click path must
show the shared `teUI` danger confirmation before issuing
`ui.host.draft.discard`, and the confirmation/request sequence is single-flight
so rapid taps cannot submit duplicate draft clears. Cancelling is silent and
does not contact the backend.

### DraftIndexSidecar (fast hasDraft lookups)
- Lightweight per-project index separate from ProjectSidecar
- Stores only relative paths of unsaved files (no content)
- `snapshot()` returns `(files, dirs)` sets for hasDraft icons on files and folders
- Reads directly from the ProjectSidecar **disk file** (not `_instances` cache), so it works cross-process

### Cross-process sync (important architectural note)
- `ProjectSidecar._instances` is a per-process in-memory cache
- Worker process writes drafts; explorer (also in worker after refactor) reads them
- `sidecar.reload()` re-reads from disk before any read operation that might see stale data
- `DraftIndexSidecar._rebuild_from_project_sidecar()` reads disk directly, bypassing `_instances`


### Preferences (PreferencesStore)
Editor preferences are stored per active project and used to initialize the inline editor options.

Preferences changes use Monaco backend hooks and typed editor/UI IPC
notifications. `/editor/*` routes are owned by `monaco_editor/editor_backend.py`.

---

## 5) HTTP endpoints the Monaco editor runtime uses (worker API)

The inline editor runtime gets `apiBase` from the inline-host bootstrap override:
- `inline_host.ts` sets `window.__te2InlineMonacoApiBase = '/api/app/code_te2'`
- `editor_api_base_utils.ts` uses that override first and only falls back to URL-prefix math if needed

It then fetches:

### SSOT snapshot
- `GET /api/app/code_te2/state`
  - returns project, recents, preferences, git diff base info, runtime metadata

### Read from disk
- `GET /api/app/code_te2/read?path=<abs_or_rel>`
  - returns `{path, content, sha256}`
  - the endpoint enforces that `path` must remain under `$HOME`

### Draft cache lookup (Monaco editor backend route)
- `POST /api/app/code_te2/editor/check_cache`
  - returns `{has_draft, content, base_sha256}` when a cached draft exists
  - route owner: `app/apps/code_te2/monaco_editor/editor_backend.py`
  - implementation service: `app/apps/code_te2/monaco_editor/editor_backend_services/cache_routes_service.py`
  - frontend caller: `app/apps/code_te2/monaco_editor/editor_open_cache_fetch_utils.ts`

Notes:
- The Monaco editor runtime uses `/editor/check_cache` as a “draft wins” read path when opening/restoring a file.
- The authoritative socket open payload comes through the typed editor RPC lane (see below).

---

## 6) Editor RPC transport (events + payloads)

### Transport
- canonical path: `/api/app/code_te2/socket.io`
- legacy path alias: `/editor_ws/socket.io`
- namespace: `/rpc/editor`
- wire event: `rpc`
- payload codec: strict `msgpack-v1` JSON-RPC
- connection identity: validated `client_instance_id`, optional `window_id`, and
  authenticated `client_role` (`primary` or `secondary`)

Important:
- This section describes the **worker-owned editor state/control lane**.
- It is no longer the primary transport for WBA-owned language intelligence.
- The inline editor runtime uses `/wba` for workbench/language RPC and `/rpc/editor` for state/control requests and notifications.

### Request methods
Representative methods from the Python/TypeScript editor RPC contracts:

| Method | Purpose |
|---|---|
| `editor.open` | Open a file through the backend-owned open service. |
| `editor.jumpToLine` | Open/jump without requiring direct frontend-to-frontend focus coupling. |
| `editor.gitBaselines.get` | Fetch HEAD/disk baselines for Git diff rendering. |
| `editor.draftDiff.get` | Fetch draft diff hunks for editor decorations. |
| `editor.mirror.publish` | Publish current editor buffer state to the backend. |
| `editor.save` | Save the active draft through backend write guards. |
| `editor.mention.request` | Request mention data. |
| `editor.agentEdits.documentState.get` | Fetch editor document state for agent-edit surfaces. |
| `editor.agentEdits.decide` | Accept/reject agent edit decisions. |
| `editor.host.save` | Host-originated save bridge. |
| `editor.focus` / `editor.blur` | Focus state publication. |
| `editor.ready.publish` | Editor readiness publication. |
| `editor.cacheState.publish` | Cache/draft state publication. |
| `editor.draftState.publish` | Draft state publication. |
| `editor.notify.publish` | Typed editor notification publication. |
| `editor.openComplete.publish` | Open-complete publication. |
| `editor.diagnosticsCounts.publish` | Diagnostics count publication. |
| `editor.scrollState.publish` | Scroll state publication. |
| `editor.modelReady` | Active Monaco model-ready hook. |
| `editor.save.snapshot.response` | Save snapshot response. |
| `editor.issues.dump.response` | Issues dump response. |
| `editor.breadcrumb.navigate` | Breadcrumb navigation request. |
| `editor.codeInspector.publish` | Publish a retained Code Inspector projection. |

### Notifications
Representative notifications:

| Notification | Purpose |
|---|---|
| `editor.state.ssot` | Editor/project/session snapshot. |
| `editor.file.opened` | Authoritative file-open payload. |
| `editor.file.jumpToLine` | Open or line-jump notification. |
| `editor.mirror.updated` | Mirrored document content/state update. |
| `editor.gitBaselines.updated` | Git baseline payload. |
| `editor.draftDiff.updated` | Draft diff payload. |
| `editor.prefs.changed` | Preference update. |
| `editor.cache.state` | Draft/cache badge state. |
| `editor.draft.state` | Draft state update. |
| `editor.ready` | Editor readiness update. |
| `editor.notify` | General editor notification. |
| `editor.open.complete` | Open-complete update. |
| `editor.diagnostics.updated` / `editor.diagnostics.counts` | Diagnostics updates/counts. |
| `editor.adapter.state` | Adapter readiness/state update. |
| `editor.semanticTokens.providerRegistered` | Provider-registration update. |
| `editor.issues.dump.request` / `editor.issues.dump.response` | Issues dump request/response. |
| `editor.save.snapshot.request` | Save snapshot request. |
| `editor.issues.command` | Marker navigation command. |
| `editor.find.command` | Find/replace command. |
| `editor.edit.command` | Editor edit command. |
| `editor.search.highlight` | Search-term highlight update. |
| `editor.openState.changed` | Open-state update. |
| `editor.project.switching` / `editor.project.switched` | Project switch lifecycle. |
| `editor.agentEdits.changed` | Agent edit state update. |
| `editor.codeInspector.command` | Code Inspector command projection. |

### Open/draft/save flow
- Open requests atomically admit the path into shared document membership, update only the source `clientInstanceId` foreground, and send the materialized file-open notification to that exact client room.
- Mirror updates persist draft state into `ProjectSidecar.session_cache` and refresh draft/decorations state.
- Save requests write through backend guards, clear draft cache entries, invalidate dependent state, and notify Explorer/editor consumers.
- Open, mirror, cache, save/clean, discard, and external-change projections are fenced by `document_revision`. The backend owns revision assignment; frontend state is bounded and memory-only. This prevents delayed arrival from overwriting newer state but does not provide CRDT/OT same-file collaboration.

### Diagnostics and language features
Primary editor diagnostics, hovers, completions, symbols, semantic tokens, folding, inlay hints, and similar language-intelligence calls use the direct `/wba` path. The `/rpc/editor` lane carries state/control and typed editor notifications.

---

## 6.5) Explorer Socket.IO transport (events + payloads)

### Transport
- canonical path: `/api/app/code_te2/socket.io`
- legacy path alias: `/explorer_ws/socket.io`
- namespace: `/rpc/explorer`
- worker-side namespace: `ExplorerRpcSocketIONamespace("/rpc/explorer")`
- Rust route proxy: `framework/rust/crates/te2-server/src/sio_proxy.rs`, using
  `app/apps/code_te2/sio_service.json`
- payload codec: strict `msgpack-v1` JSON-RPC

### Connection
Client connects with app-scoped auth/codec metadata. On connect, the server creates an `ExplorerDispatcher` per client SID and sends the authoritative bootstrap state for the active project.

### Client -> Server RPC methods
Explorer keeps legacy method aliases for frontend compatibility, but the contract is JSON-RPC on the `/rpc/explorer` namespace.

| Method | Alias | Purpose |
|---|---|---|
| `explorer.list` | `tree:list` | Request directory listing. |
| `explorer.openDirs.set` | `tree:expand` | Set expanded directory state. |
| `explorer.search.run` | `search:run` | Start a file-name or content search. |
| `explorer.search.more` | `search:more` | Request more cached search results from the session. |
| `explorer.search.moreInFile` | `search:moreInFile` | Request more cached matches for one file. |
| `explorer.search.cancel` | `search:cancel` | Cancel an active search. |
| `explorer.review.list` | `review:list` | Request review entries. |
| `explorer.review.save` | `review:save` | Save selected drafts to disk. |
| `explorer.review.discard` | `review:discard` | Discard selected drafts. |
| `explorer.prefs.ui.update` | `prefs:updateUi` | Update one global UI preference key. |
| `explorer.prefs.agentIcon.vendor` | `prefs:vendorAgentIcon` | Vendor an icon asset into the SSOT cache dir. |

### UI Preferences (global)
- Store: `_preferences_store` (disk-backed) at
  `$TE2_CONFIG_HOME/code_te2/preferences.json`, under the `ui` object.
- Update flow:
  - client -> server: `prefs:updateUi` payload `{key, value}`
  - server -> all clients: `prefs:setUi` payload `{ui: { ...full snapshot... }}`
- Icon vending flow (used by agent shortcuts/toggle):
  - client -> server: `prefs:vendorAgentIcon` payload `{abs_path: "/abs/to/icon.svg"}`
  - server -> requesting client: `prefs:vendorAgentIconResult` payload `{ok: true, name, url}`
  - asset URL is served by the worker: `GET /api/app/code_te2/agent_icons/{name}`

### Agent Toggle + Shortcuts (host shell)
The agent toggle is owned by the host shell and configured through the Explorer RPC/UI preference channel.

Behavior:
- The toolbar button (`#fe-agent-toggle`) is always icon-only.
- The `icon/text/both` setting applies only to how entries render inside the agent shortcuts dropdown (`#fe-agent-dd`).
- Toolbar icon precedence:
  1. If the active `agentDrawerIframeUrl` matches a shortcut that has an icon, that shortcut icon wins.
  2. Otherwise use the global `agentToggleIcon` (emoji/asset).
  3. If `agentToggleIcon.kind == "default"`, keep the default/manifest icon.
- Dropdown open gesture: right-click (desktop) or long-press (touch) opens the shortcuts dropdown.
- Selecting a shortcut updates `agentDrawerIframe=true` and sets `agentDrawerIframeUrl` via `prefs:updateUi`.
- No full page reload: mode/header changes hot-swap the agent controller in-place to preserve SSOT session/editor state.

### Server -> Client broadcasts

| Type | Purpose |
|---|---|
| `explorer:updateDecorations` | Draft flags `{drafts: {rel: {hasDraft: true}}}`. |
| `review:setEntries` | Review list `{entries: [{path, rel, has_draft, hunks?, timestamp}]}`. |
| `explorer:tree` | File tree data. |
| `explorer:gitStatus` | Git status decorations projected as presentation state. |
| `explorer.search.started` | Search session started. |
| `search.job.progress` | Search progress/count update. |
| `search.job.result` | Progressive search result payload. |
| `search.job.done` | Terminal search completion payload. |
| `search.job.error` | Terminal search error payload. |
| `explorer.search.more.result` | More cached search results response. |
| `explorer.search.moreInFile.result` | More cached matches for one file. |
| `explorer.search.cancelled` | Search cancellation acknowledgement. |
| `explorer.project.opened` | One global successful project-switch projection emitted from `ProjectSwitchFinished`; failed switches do not publish it. |

### Draft decoration pipeline
When a file is edited:
1. `on_editor_mirror` -> `upsert_cached_document` -> `DraftIndexSidecar.update_from_abs_file`
2. `notify_draft_state_changed()` fires (debounced)
3. `_broadcast_draft_decorations()` reads `DraftIndexSidecar.snapshot()` and broadcasts:
   - `explorer:updateDecorations` with `{drafts: {rel: {hasDraft: true}, ...}}`
   - `review:setEntries` with full review list (including diff hunks)
4. Explorer UI applies `data-hasDraft="1"` attribute to file/folder nodes (CSS handles visual indicator)

### Review panel flow
1. User opens Review Edits tab -> frontend sends `review:list`
2. Server calls `review.list_reviews(project, lightweight=False)` -> computes diff hunks per draft
3. Server broadcasts `review:setEntries` with entries
4. Live updates: `_broadcast_draft_decorations()` also broadcasts `review:setEntries`, so the review list auto-refreshes when drafts change
5. User selects files and clicks Save/Discard:
   - `review:save` -> `handle_review_save` -> writes to disk, clears caches, emits editor cache state through the editor backend hook
   - `review:discard` -> `handle_review_discard` -> clears caches, reverts editor if file open, emits editor cache state through the editor backend hook

### Cross-surface communication (explorer -> editor)
Explorer does not connect to the editor frontend directly. Cross-surface actions flow through backend hooks/services and then through the target surface notification lane:

```text
Explorer frontend -> /rpc/explorer -> Explorer backend -> editor backend hook/service -> /rpc/editor notification
```

Used by review save/discard, open/jump, search highlighting, and project-switch notifications.

## 6.6) Search system (progressive Rust pipe provider)

### Ownership
- Rust framework service: `service.search`
- Python pipe wrapper/client: `explorer/search.py`
- Python session cache and notification projection: `explorer/services/search_sessions.py`
- Explorer RPC methods: `explorer.search.run`, `explorer.search.more`, `explorer.search.moreInFile`, `explorer.search.cancel`

### Pipe methods and notifications

| Method / notification | Purpose |
|---|---|
| `search.files.start` | Start file-name search. |
| `search.content.start` | Start content search. |
| `search.job.cancel` | Cancel an active search job. |
| `search.job.progress` | Progress/count notification from Rust to the initiating pipe lane. |
| `search.job.result` | Progressive result notification. |
| `search.job.done` | Terminal completion notification. |
| `search.job.error` | Terminal error notification. |

### Presentation and limits

- File/folder name search is an inline Explorer-tree projection, not a search
  overlay. The project-root label becomes the query field, direct hits and their
  ancestor paths are expanded in a sibling result tree, and a direct directory
  hit is hydrated with only one shallow child listing. The normal tree DOM and
  its open-directory state remain intact behind that projection.
- Shallow directory hydration is backend-composed. Python collects every direct
  directory hit and requests one bounded `fs.listDirectories` pipe DTO from the
  Rust filesystem service, then includes those listings in the initiating
  client's `explorer.search.results.updated` payload. The browser must not issue
  an `explorer.list` RPC for every hit.
- The browser constructs the complete result projection in a detached tree,
  attaches it once, and runs aggregate Git/diagnostic decoration once. Repeated
  results with the same projection are idempotent, while previous/next changes
  only the active-hit class and scroll position instead of rebuilding the tree.
- A dedicated `🔭` button beside the Explorer ellipsis opens the separate
  advanced search surface for By contents, By changes, Drafts, and Diagnostics.
  The ellipsis does not duplicate that action. Opening either search surface
  closes the other before it starts a progressive search.
- Inline name search keeps its query while files are opened. Its clear control
  cancels the active search and restores the normal tree while leaving the empty
  field focused; an empty blur closes the field. Selecting a result directory
  requests `explorer.openDirs.set` with that directory and its ancestor chain.
  The backend persists and validates that chain, returns its authoritative
  `dirs` plus shallow listings, and publishes an `ExplorerRenderStateChanged`
  fact. The render-state projector broadcasts `explorer.openDirs.updated` and
  listings to every project client; each client reconciles its normal-tree DOM,
  and the invoking client closes search only after applying its reply. It then
  waits 350 ms for the restored tree layout to settle and smooth-centers the
  exact directory, unless the project changed or search reopened meanwhile.
- When Explorer sticky headers are enabled, they remain operational throughout
  search, mirror the root query controls, and permit the first direct hit to be
  centered automatically. With sticky headers disabled, typing never scrolls the
  tree away from the root query field. Previous/next controls always remain an
  explicit centered smooth-scroll action in either mode.
- Sticky-chain or viewport recomposition must preserve the existing sticky
  search input while it remains bound to the same authoritative root input.
  Controls and the current menu target update in place. Replacing a focused
  clone dismisses Android IME and can feed a false empty `focusout` into the
  search-close rule, so replacement is reserved for an actual source-input or
  search-mode transition.
- Sticky-scope push geometry uses the represented source directory's rendered
  border-box bottom as the collision boundary. That box already encloses its
  subtree and every nested margin, border, and padding. The visual push leads
  that boundary by one lower-left card radius (currently 8 px) so the rounded
  edge cannot bleed through. Never infer scope end from the next row or a fixed
  ancestor-climb allowance.
- Extremely large, deeply expanded trees may still show minor transient sticky
  animation artifacts while browser layout and live DOM measurements settle.
  This is a known presentation limitation, not a reason to reintroduce inferred
  row boundaries or fixed ancestor-gap compensation.
- Python requests a presentation window with `maxInitialMatchesTotal=50` and `maxInitialMatchesPerFile=10`.
- Python imposes `maxMatchesTotal: 700` for broad/noisy content searches.
- Rust reports truncation metadata with `matchLimit` and `truncatedReason: "matchLimit"` when the cap is hit.
- Python stores compact cached result state so the frontend can request more results without rerunning the search.
- Search worker thread count can be passed per request; when omitted, Rust uses its configured default.

---

## 7) Monaco asset pipeline (pinned VS Code build)

The Monaco editor runtime uses the pinned VS Code `monaco-editor-core` ESM output:
- mounted at `/api/app/code_te2/ui/monaco_vscode/esm/...`

The harness also serves language-bundle assets when they are present:
- `/api/app/code_te2/ui/monaco_vscode/lang/...`

Because the VS Code Monaco ESM imports CSS files, the harness serves `.css` as:
- `Content-Type: application/javascript` module shim (injects `<link>` to `?raw=1`)
- raw CSS is available when `?raw=1` is present

### Publication boundary
The committed deployed ESM tree is
`app/static/vendor/monaco-editor-core/esm/`. Its patched VS Code source checkout
is external and user-local; this repository does not contain a rebuildable
`worktrees/vscode-te2-diff` checkout. Do not treat source-map paths inside the
vendored bundle as a dependency or issue a guessed build command.

When an approved external publication is available, copy its verified ESM output
into the committed vendor tree, then rebuild Code TE2 with `node build.mjs`.

### Common failure mode: inline editor boot is blank but worker is running
Symptom:
- The host page loads, but `#editor-frame` stays blank or the inline Monaco boot falls back to an error panel.

Cause:
- Required Monaco build artifacts or the built host bundle were missing, so the host could not complete inline editor boot.

Fix:
- Verify the committed ESM tree and rebuild `app/apps/code_te2` with
  `node build.mjs`. Restart only the relevant app worker when approved, then
  hard refresh.

---

## 8) UI "knobs" (what you can safely tune)

### Preferences -> Monaco options mapping
The inline editor runtime builds Monaco options from SSOT preferences (`buildMonacoOptionsFromPrefs()`):
- line numbers
- word wrap
- minimap on/off (but forced off in Git diff mode)
- indent guides
- auto closing brackets
- autocompletion toggles (`quickSuggestions`, `suggestOnTriggerCharacters`, etc.)
- font scale -> `fontSize`
- font family (default `JetBrains Mono Nerd`)
- font ligatures (`fontLigatures` enabled by default for the local Nerd Font)
- theme (Monaco base: `vs` / `vs-dark`, plus official `monaco-editor-themes` ids)
  - `github-dark-default` (preferred)
  - `github-light-default` (preferred)
  - `github-dark` (legacy alias -> `github-dark-default`)
  - `github-light` (legacy alias -> `github-light-default`)
  - the nine vendored GitHub themes under
    `monaco_editor/themes/vendored/github/`
  - `te2-vs-dark`, used only for the diff-scoped dark presentation

Note: TE2 loads Monaco first (`editor.main.js`), then registers official themes from
`/api/app/code_te2/ui/monaco_editor/themes/*.json`. If Monaco isn't loaded yet,
theme registration is skipped (by design) to avoid caching a no-op run.

### Diff mode behavior
- Git diff mode uses Monaco DiffEditor in inline mode (not side-by-side).
- Draft diff mode is a custom overlay (decorations + view zones).
- Minimap is forced off in diff mode to avoid layout artifacts.
- File switches clear the previous diff pair, complete the visible Monaco open,
  then issue a non-blocking `editor.gitBaselines.get` request. Its returned
  disk/HEAD payload is applied only while its path is still active; original
  models are not retained as per-tab authority.
- Diff editor children hide vertical scrollbar chrome but retain automatic
  10-pixel horizontal scrollbars for long lines.

### Z-index policy
- The inline Monaco editor host remains at `z-index: auto`.
- Only Monaco's `.find-widget` is raised to `z-index: 300`, above drawers and resize handles but below framework dropdowns and modals.
- Editor-container overflow clipping remains intentional.

---

## 9) Debugging checklist (what to verify first)

### 1) Transport is correct (no reconnect loops)
- Confirm Rust framework Socket.IO route proxy:
  `framework/rust/crates/te2-server/src/sio_proxy.rs`.
- Confirm file_editor route config: `app/apps/code_te2/sio_service.json`.
- Confirm worker `SUBAPPS` mount shape:
  ```python
  SUBAPPS = [
      ("/socket.io", CODE_TE2_ASGI_APP),
      ("/editor_ws/socket.io", CODE_TE2_ASGI_APP),
      ("/explorer_ws/socket.io", CODE_TE2_ASGI_APP),
      ("/ui_ipc_ws/socket.io", CODE_TE2_ASGI_APP),
      ("/terminal_ws/socket.io", CODE_TE2_ASGI_APP),
  ]
  ```
- Editor RPC: canonical path `/api/app/code_te2/socket.io`, alias `/editor_ws/socket.io`, namespace `/rpc/editor`.
- Explorer RPC: canonical path `/api/app/code_te2/socket.io`, alias `/explorer_ws/socket.io`, namespace `/rpc/explorer`.
- UI IPC: canonical path `/api/app/code_te2/socket.io`, alias `/ui_ipc_ws/socket.io`, namespace `/ui_ipc`.
- Terminal: canonical path `/api/app/code_te2/socket.io`, alias `/terminal_ws/socket.io`, namespace `/terminal`.
- WBA: canonical path `/api/app/code_te2/services/wba/socket.io`, alias `/wba_ws/socket.io`, namespace `/wba`.

### 2) Inline editor boot completes
- The host boot path is `template.html` -> `main.ts` -> `static/dist/host.js` -> `bootInlineEditorHost(...)` -> `inline_host.ts` -> `m_editor_app.ts`.
- If the editor surface stays blank, inspect:
  - `static/dist/host.js` load/boot
  - Monaco ESM asset freshness under `static/vendor/monaco-editor-core/esm/`
  - worker stderr for boot-snapshot / adapter bootstrap failures
  - browser console for `[inline_monaco] boot failed`

### 3) SSOT is present
- `GET /api/app/code_te2/state` returns:
  - `activeProject`, `preferences`, `lastFile`, etc.

### 4) Open path convergence
- `editor.open` / `editor.jumpToLine` should update only the originating stable-client foreground, retain shared membership, and result in typed `/rpc/editor` file-open notifications in that client's exact room.

### 5) Draft persistence and live indicators
- `editor.mirror.publish` should produce a cached draft entry (project sidecar).
- `editor.save` should clear the draft and write disk.
- On save, the server broadcasts clean cache/draft state; the inline editor runtime must refresh git baselines so the inline git diff view updates.
- On edit, mirror publication emits dirty cache state and triggers Explorer draft decorations/review entries.

### 6) Cross-process consistency
- If drafts appear empty in the review panel, verify `sidecar.reload()` is called before reads.
- If Explorer shows stale hasDraft icons, verify `DraftIndexSidecar` is being updated by `upsert_cached_document`.
- Editor and Explorer namespaces must run on the same shared worker Socket.IO server, not on separate main-process servers.

---

---

## 11) Monaco language backend modes and ownership

### Mode boundary

Code TE2 has two mutually exclusive language backends selected by the persisted
`webWorkersEnabled` preference:

- **Code Server mode** (the default) loads Monaco editor core without Monaco's
  basic/rich language contributions. It opens the direct strict-MessagePack
  `/wba` lane, obtains language and grammar metadata from the WBA, installs
  client-side TextMate tokenization from the contributed grammars, and registers
  WBA-backed Monaco providers.
- **Web Worker mode** lazy-loads Monaco's basic/rich language contributions and
  language workers. It does not open or probe the WBA, install the WBA language
  catalog, or register WBA-backed providers.

The modes must not be blended. Code Server mode must not register Monaco worker
providers and then remove them through private Monaco registries. Worker mode
must not quietly fall back to Code Server. Switching into Worker mode stops the
live WBA and Code Server shells but preserves the pinned managed installation
under `$TE2_DATA_HOME/code_server/4.130.0`; changing runtime mode must never
turn into a 709 MiB uninstall. The app-worker eager-start hook also honors the
persisted Worker-mode selection.

Before presenting an install choice, host boot performs a fresh backend
prerequisite read when its first snapshot reported the managed runtime missing.
This closes the cross-view install/reload race: an installation and shells that
became ready after the first snapshot are adopted instead of prompting again.

### Generic WBA language path

The Code Server path is data-driven:

1. The WBA publishes language, language-configuration, grammar, theme, and
   provider-registration metadata from the installed built-in and user
   extensions. Contributions with the same language ID are composed rather
   than replaced: file-association arrays are unioned, higher-priority user
   metadata wins where it is present, and language configuration changes owner
   only when that contribution supplied readable configuration content. A
   partial user declaration therefore cannot erase the built-in bracket,
   auto-closing, or indentation rules.
2. The inline editor registers the contributed language IDs and applies the
   contributed language configuration.
3. `editor_textmate_runtime.ts` selects the first grammar contribution for the
   language in WBA catalog order, loads the raw grammar through
   `grammars_load`, and installs it in Monaco using the vendored TextMate and
   Oniguruma runtimes.
4. Provider registration events and reconnect snapshots install one stable
   Monaco bridge per advertised language and feature. There are no JavaScript,
   HTML, CSS, or other language-specific routing branches.

Document highlights use `$provideDocumentHighlights` and back Monaco's
cursor-occurrence highlighting. Definitions, references, and implementations
use their public Monaco provider APIs. Call hierarchy remains on the existing
Code Inspector path because Monaco's public `languages` API does not expose a
call-hierarchy registration surface.

### Bootstrap and validation

`scripts/build_monaco_bootstrap_bundle.mjs` builds the shared Monaco bootstrap.
Its contribution imports are lazy and execute only for Web Worker mode. The
inline editor itself remains part of the single `static/dist/host.js` bundle;
it has no separate editor document or frontend bundle.

For Code TE2 frontend changes, run:

```bash
cd app/apps/code_te2
npm run typecheck
node build.mjs
node --test tests/*.test.mjs
```

When the Monaco bootstrap source changes, also run:

```bash
node scripts/build_monaco_bootstrap_bundle.mjs
```

## 12) Draft deletion widgets ordering (Git diff + Draft diff together)

### The “3-row” mental model (recommended)
When both Git diff and Draft diff are enabled, the intended visual model is:
- Git baseline row (HEAD)
- Current disk/SSOT row
- Draft-applied row (what you’ll save)

### Ordering invariant (important)
In unified inline Git diff mode, Git deletions are rendered using Monaco **view zones**.
Our draft deletion widgets are also view zones.

To keep the UI readable:
- Draft deletion zones must render **below** Git deletion zones.

### Implementation note
We re-append the draft zones after Git diff updates by:
- installing a `onDidChangeViewZones` hook on the DiffEditor’s **modified** editor
- re-applying the last computed draft zones after Git diff inserts/removes its own view zones

Primary implementation lives in:
- `app/apps/code_te2/monaco_editor/m_editor_app.ts`
  - `_installDraftZoneOrderingHook()`
  - `applyDraftZones(...)`
  - `reapplyDraftZones()`

---

## 13) Diff and draft stability invariants

Inline Git and draft-diff presentation must preserve cursor stability under
autosave and EOF edits:

- Projection gates use `te2AutosaveMode`; autosave takes the normal diff
  recompute path instead of draft-projection machinery.
- EOF range mappings absorb the trailing-line boundary rather than depending on
  an assertion or a deletion widget.
- Switching from autosave to draft mode snapshots current model content as the
  draft baseline.
- Mirror-originated cache updates suppress autosave so a second client does not
  create an echo loop.

The current runtime is split across the editor diff and baseline modules, rather
than the historic line locations in `m_editor_app.ts`. Frontend behavior is
the validation target: rapid typing must not reset the model, move the cursor,
or reapply a stale baseline.

## 14) Workbench Adapter and Extension-Host Protocol

The workbench adapter is the headless VS Code client between the direct editor
lane and the remote code-server extension host. Editable sources are
`workbench_protocol_proxy/node_workbench_adapter/src/server/server.ts` and
`src/client/workbench-client.ts`; framework shells execute their `dist/`
output. The adapter is not a replacement app SSOT.

### Transport and ownership

- The inline editor uses strict MessagePack JSON-RPC on the public
  `/api/app/code_te2/services/wba/socket.io` path and `/wba` namespace for
  `vscode.openFile`, hover, symbols, changes, provider events, and diagnostics.
- Backend lifecycle/control work uses the pipe protocol
  (`<<<RPC>>>` replies and `<<<PUSH>>>` facts). The local HTTP `/cmd`
  endpoint remains a control compatibility surface, not the editor hot path.
- WBA tracks one shared extension-host document per URI and projects a synthetic
  editor facade per stable client. Client role is established by the app editor
  and UI IPC lanes; WBA document membership remains role-neutral.

### Extension-host invariants

- Builtin loading filters problematic wildcard-activating non-language
  extensions while retaining user extensions, language/grammar/theme
  contributions, language-feature extensions, and
  `vscode.configuration-editing`.
- Bootstrap uses `onLanguage`; a file open adds `onLanguage:<languageId>`.
  Do not emit wildcard activation.
- Extension-host replies must use the expected typed value. In particular:
  storage receives `{}`, tools receives `[]`, initial state is focused and
  active, workspace trust is granted, output registration receives a string
  channel id, file search receives bounded URI results, text search receives
  `null`, and commands may use an empty acknowledgement.
- The client derives a language id from the path when an open request does not
  provide one, preserving distinct JavaScript and TypeScript activation.

### Validation and source inspection

Validate language behavior as a feature set, not merely an installed extension:
open, symbols, hover, and diagnostics for Python, TypeScript/JavaScript, C++,
and Rust as applicable. The sprint plan is
`MONACO_WORKBENCH_SPRINT_PLAN.md`; this document owns architecture and protocol
facts.

When inspecting an intentionally targeted bundle, keep the operation
stream-only, for example `prettier <file> 2>/dev/null | nl -ba | rg`. The
repository policy is **Search Discipline** in `AGENTS.md`; annotations live at
`app/CTAG-ANNOTATIONS.md`. Do not infer a local worktree from source-map
paths embedded in a vendored bundle.

## 15) Breadcrumb navigation

Breadcrumbs are implemented as a TE2-native plain-DOM bar. `inline_host.ts`
injects `#te2-breadcrumbs`; `editor_breadcrumb_runtime.ts` renders path and
symbol state. Path clicks use `editor.breadcrumb.navigate`; symbol clicks
navigate within the active model. Only the deployed stylesheet from the
vendored Monaco tree is used. The former external-worktree extraction and
build plan is not a current dependency.

## 19) File watcher pipeline — triple fallback

### Architecture
Code TE2 relies primarily on code-server's native watcher/IPC path, with fallback support for inotify-limit raising, optional watchexec polling, and manual refresh.

### Pipeline

```text
code-server parcel watcher detects disk change
  -> remoteFilesystem IPC channel fires EventFire (ResponseType 204)
  -> src/client/workbench-client.ts onEvent({type: "watcher/fileChanges", changes: [...]})
  -> wba_event_bridge.py handles watcher/fileChanges and watcher/enospc
  -> workspace_events.py publishes normalized file-change events
  -> Explorer watcher handlers update backend-owned tree/decorations state
  -> Explorer emits typed state notifications to the frontend
```

### Triple fallback modes
1. Native code-server watcher path.
2. Raise inotify limits when the environment allows it.
3. `watchexec --poll -- cat` framework-shell fallback.
4. None/manual refresh when watcher support is unavailable.

### watchexec framework shell
- Shellspec: `app/apps/code_te2/shellspec/watchexec.yaml`
- Poll mode is declared as `watchexec-poll`.
- Watchexec is a fallback watcher source; it is not the primary code-server IPC watcher path.

### Key files
- `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/src/src/client/workbench-client.ts`: receives code-server watcher events.
- `app/apps/code_te2/wba_event_bridge.py`: handles `watcher/enospc` and `watcher/fileChanges` events from WBA.
- `app/apps/code_te2/workspace_events.py`: publishes normalized file-change events and calls `handle_external_file_change`.
- `app/apps/code_te2/watchexec_shell_manager.py`: fallback watchexec shell manager.
- `app/apps/code_te2/shellspec/watchexec.yaml`: fallback shellspec.
- `app/apps/code_te2/explorer/handlers/watcher.py`: Explorer watcher integration.
- `app/apps/code_te2/main_page/frontend/ui/watcher-settings.ts`: watcher settings UI wiring.

### External edit detection (watcher -> editor pipeline)
- Watcher events enter through `wba_event_bridge.py` / `workspace_events.py`.
- The backend checks whether a changed/created/deleted path affects the active file and then notifies the editor lane through backend hooks.
- Explorer updates are model/state notifications; the frontend should render the state it receives, not rediscover filesystem or Git facts itself.

### VS Code watcher settings sync (dual-watcher suppression)
The WBA/code-server side remains the primary watcher source. TE2 fallback watcher settings should avoid running a duplicate expensive watcher unless the native watcher path is unavailable or explicitly degraded.

---

## 20) Cursor stability and published Monaco artifacts

Autosave and Git/draft diff must not reset a model or move the cursor while a
user types. The inline runtime debounces mirror and Git-baseline work, ignores
stale path/revision results, and delays baseline application during active
typing. Published Monaco diff logic additionally honors `te2AutosaveMode`.

The deployed ESM tree is the only in-repository source for its patched Monaco
behavior. Copy an approved external publication **into** its contents, never as
a nested `esm/esm` directory, then rebuild `static/dist/host.js`. No local
VS Code worktree is required or documented here.

## 21) UI IPC — Backend-mediated app UI facts

### Problem

The editor, host/main page, Explorer, sidebar, and terminal surfaces remain separate authority domains. When one surface needs another surface to act, the request must travel through its own backend lane and then through a target backend hook/service. UI IPC is the host/main-page app lane for typed facts and low-frequency host coordination; it is not a frontend-to-frontend event bus.

### Architecture

`/ui_ipc` is a Socket.IO namespace on the shared app Socket.IO path. It uses strict `msgpack-v1` JSON-RPC payloads and backend dispatch in Python.

```text
Host/main page frontend
  -> /ui_ipc msgpack-v1 JSON-RPC
  -> ui_ipc_ws.py decodes and validates with frontend_rpc_codec.py
  -> ui_ipc.rpc_contract dispatch method
  -> backend hook/service
  -> target surface notification when needed
```

### Current responsibilities

| Area | Contract |
|---|---|
| Host/main page boot/readiness | Backend-owned boot snapshots and adapter-state facts. |
| Native/Android IME focus hints | Typed focus/blur facts on `/ui_ipc`; Android consumes strict msgpack-v1, not raw JSON `ui_event`. |
| Secondary-editor close | `ui.host.clientForeground.clear` accepts only the authenticated secondary browser client, clears that exact foreground, and requests an exact-client editor SSOT projection. |
| Cross-surface actions | Frontend -> own backend -> target backend hook/service -> target notification. |
| Metrics | `CODE_TE2_RPC_CODEC_METRICS=1` enables default-off codec metadata on stdout. |

### Key files

- `app/apps/code_te2/ui_ipc/ui_ipc_ws.py` — `/ui_ipc` namespace, msgpack-v1 decode, JSON-RPC parsing, dispatch.
- `app/apps/code_te2/ui_ipc/rpc_contract.py` — Python UI IPC method/notification contract.
- `app/apps/code_te2/src/ui_ipc/rpc_contract.ts` — TypeScript UI IPC contract.
- `app/apps/code_te2/main_page/frontend/connections/ui-ipc-rpc.ts` — browser `/ui_ipc` JSON-RPC connection.
- `app/apps/code_te2/main_page/frontend/connections/ui-ipc.ts` — host/main-page UI IPC fact handling.
- `app/apps/code_te2/frontend_rpc_codec.py` — strict Python msgpack-v1 encode/decode and auth validation.
- `app/apps/code_te2/sio_service.json` — route proxy declaration for canonical app Socket.IO path and legacy alias.

### Extending

To add a new UI IPC operation:
1. Add the method/notification to `ui_ipc/rpc_contract.py` and `src/ui_ipc/rpc_contract.ts`.
2. Add the backend dispatch/hook in `ui_ipc/ui_ipc_ws.py` or the appropriate backend service.
3. Emit a target-surface notification from that target backend when another surface needs to react.
4. Do not add raw `ui_event` relays or synthetic DOM-event bridges.

Browser UI IPC sessions carry the same validated stable client identity and
`clientRole` as the editor lane. A host action must not forge a client id or
clear a primary foreground on behalf of a secondary presentation.

---

## 22) Extension configuration and settings

The WBA initializes extension configuration from three effective scopes:

1. extension `contributes.configuration.properties` defaults;
2. Code TE2 User settings; and
3. the active project `.vscode/settings.json`.

`src/client/workbench-client.ts` scans every extension contribution, nests each
declared default into `IConfigurationInitData.defaults`, and publishes
`` plus ``. This removes
per-extension hardcoding while retaining normal VS Code precedence.

### User and Workspace authority

The Languages & Extensions UI exposes only these scopes:

- **User**: registry-v2 `user_settings`, atomically materialized with TE2 gates
  at `/code_te2/code_server/User/settings.json` and sent as
  `userRemote`.
- **Workspace**: `<projectRoot>/.vscode/settings.json`, sent as both
  `workspace` and `folders[0]`.

The schema form and JSON editor are two views of the same scope; neither creates
a third settings store. WBA leaves application, policy, user-local, and profile
sections empty. Workspace settings override User values, while language servers
can still apply their own on-disk project-configuration precedence.

`rebuild_settings_gate()` writes the User file atomically: generated global
and language gates, existing framework watcher exclusions, then user-owned
settings with the last value winning. Registry-v1 values migrate once into
`user_settings`.

### Key files

| File | Role |
|---|---|
| `extension_registry.py` | Registry settings, migration, and User-file materialization. |
| `explorer/handlers/extensions.py` | User and Workspace settings RPC handlers. |
| `src/client/configuration.ts` | WBA configuration-model conversion. |
| `main_page/frontend/ui/settings-*.ts` | Scope-aware JSON and schema presentation. |

## 23) Semantic tokens and TextMate tokenization

The inline editor receives semantic-token replies over direct WBA JSON-RPC and
installs normal Monaco providers. Token data is the VS Code five-integer delta
stream: delta line, delta start, length, legend token type, and modifier mask.

### Runtime invariants

- Cancellable WBA calls do not add a fake cancellation argument; the protocol
  owns cancellation framing.
- Adapter decoding copies Buffer data before constructing a Uint32Array, so a
  pooled unaligned byte offset cannot break semantic-token decoding.
- The committed standalone theme service enables semantic highlighting. The
  editor runtime also repairs a theme that reports it disabled.
- vscodeThemeToMonacoTheme() converts contributed semantic rules and
  TextMate-compatible theme data before Monaco defineTheme / setTheme.
- The TextMate registry applies the selected raw theme, publishes its color map
  through monaco.languages.setColorMap(), and resets all loaded models for
  retokenization.

No _patchSemanticTokenColorIndices() runtime exists. Do not document a
palette-index monkey patch or infer a replacement from stale history; inspect
the committed Monaco vendor tree and the current theme runtime before changing
palette behavior.

### Reconnect

te2.resync is a frontend WBA request. A fresh editor client asks the WBA to
replay provider and diagnostics state without restarting the extension host.
The replay is idempotent and supplies each client only through the WBA lane.

### Key files

| File | Role |
|---|---|
| src/client/workbench-client.ts and src/server/server.ts | WBA semantic-token request and event handling. |
| editor_wba_rpc_transport.ts | Direct editor WBA transport. |
| editor_textmate_runtime.ts | Encoded TextMate provider, color-map publish, and model reset. |
| editor_theme_apply_runtime_utils.ts | Theme definition and application order. |
| editor_ui_editor_runtime.ts | Defensive semantic-highlighting repair. |

## 24) Completions Pipeline (End-to-End)

### Overview

Completions flow from the frontend through the same WBA RPC pipeline as other editor language features. The user types → Monaco fires `provideCompletionItems` → the inline editor runtime serializes the request onto `/wba` → the adapter calls `$provideCompletionItems` on the ext host → results come back as a minified `ISuggestResultDto` → the adapter inflates the DTO → results propagate back to Monaco.

### Data flow

```
Monaco CompletionItemProvider.provideCompletionItems()
  → editor_language_bridge_providers.ts / editor_workbench_runtime.ts
  → editor_wba_rpc_transport.ts: /wba RPC "vscode.completions"
  → src/server/server.ts: route to wb.completions()
  → src/client/workbench-client.ts: $provideCompletionItems(handle, resource, position, context, token)
  → ext host: language server computes completions
  ← ISuggestResultDto (minified wire format)
  ← src/client/workbench-client.ts: _inflateCompletionItems() → Monaco suggestions
  ← src/server/server.ts → /wba reply → Monaco widget
```

### The debounce race condition

The ext host computes completions against its internal document model. `didChange` events are debounced at 180ms (`_localMirrorDebounceMs`) before being sent to the ext host. Completion requests fire immediately on every keystroke. Result: the ext host's document is 1 keystroke behind.

**Symptoms**:
- First character after trigger: zero-width completion range (ext host has no word yet)
- Second character: range covers only 1 char, results are generic globals instead of contextual
- Third character: finally correct (previous didChange has arrived)
- Deleting back makes results work for the position that previously failed

### Solution: pre-flight document sync

Two-part fix ensures the ext host always has the latest document content:

**Part 1 — Frontend (`m_editor_app.ts`)**:
- `_flushMirrorDebounce()` force-fires the pending debounce timer before each completion request
- `text: m.getValue()` is included in every completion RPC as the authoritative full document content

**Part 2 — Adapter (`src/client/workbench-client.ts`)**:
- `completions()` checks for `params.text`; if present, calls `this.didChange()` synchronously before `$provideCompletionItems`
- `didChange()` writes `$acceptModelChanged` directly to the ext host's stdin pipe — synchronous, no transport delay
- The ext host processes the didChange before the completion request because both run in the same Node.js event loop tick

### Wire format — `ISuggestResultDto`

The ext host returns a minified DTO with single-letter field names for wire efficiency:

**Top-level `ISuggestResultDto`**:
- `a`: defaultRanges (applied to items without their own range)
- `b`: completions array (`ISuggestDataDto[]`)
- `c`: isIncomplete flag
- `d`: duration
- `x`: cache ID for `$releaseCompletionItems`

**Per-item `ISuggestDataDto`**:
- `a`: label, `b`: kind, `c`: detail, `d`: documentation
- `e`: sortText, `f`: filterText, `g`: preselect
- `h`: insertText, `i`: insertTextRules
- `j`: range (overrides defaultRanges), `k`: commitCharacters
- `l`: additionalTextEdits, `m`: kindModifier (tags)
- `n/o/p`: command (ident/id/arguments), `x`: item cache ID

### Key files

| File | Role |
|---|---|
| `editor_language_bridge_providers.ts` | Monaco `provideCompletionItems` bridge and request shaping. |
| `m_editor_app.ts` | `_flushMirrorDebounce()` and editor-runtime assembly. |
| `editor_wba_rpc_transport.ts` | direct `/wba` RPC transport |
| `editor_workbench_runtime.ts` | maps completion requests to WBA RPC |
| `src/server/server.ts` | `vscode.completions` route — passes text to `wb.completions()` |
| `src/client/workbench-client.ts` | `completions()` — pre-flight didChange, `$provideCompletionItems`, `_inflateCompletionItems()` |

### Inflation and range handling

`_inflateCompletionItems()` in `src/client/workbench-client.ts`:
1. Reads `dto.a` as `defaultRanges` (insert + replace ranges for all items)
2. For each item in `dto.b`: maps minified fields to Monaco's `CompletionItem` shape
3. If an item has its own `c.j` range, uses that; otherwise uses `defaultRanges`
4. Ranges are `{ insert: { startLineNumber, startColumn, endLineNumber, endColumn }, replace: {...} }` (1-based, Monaco convention)

### Resolve and release

- `$resolveCompletionItem(handle, id, token)` — lazily loads full documentation for a selected item
- `$releaseCompletionItems(handle, id)` — frees the cached completion set when the widget closes

## 25) Console Observability System (vConsole + Socket.IO)

Console observability is framework-owned. Browser producers and drawer clients use namespace `/te2_console` on path `/te2_console_ws/socket.io`, backed by `app/te2_console_runtime.py` and mounted by `app/te2_runtime_mounts.py`.

The old worker-owned `/ui_ipc` console relay has been removed from the live source path. `ui_ipc` does not handle `console:*` events.

### Architecture overview

```text
main_page bridge --console:log--> framework TE2 console --console:log/replay/eval--> Console drawer / MCP
                                      |
                                      v
                         $TE2_CACHE_HOME/console/te2_console_log.jsonl
```

### Files

| File | Role |
|---|---|
| `app/te2_console_runtime.py` | Framework-owned Socket.IO console runtime and transcript storage. |
| `app/te2_runtime_mounts.py` | Mounts `/te2_console_ws/socket.io`. |
| `app/te2_mcp/te2_console_client.py` | MCP in-process eval/list bridge to the framework console runtime. |
| `app/cli/console_cli.py` | `te2 console` CLI implementation. |
| `app/apps/code_te2/main_page/frontend/console_bridge.js` | Code TE2 browser console monkey-patcher; emits `console:log` and handles `console:eval` / `console:evalCancel`. |
| `app/apps/code_te2/main_page/frontend/host-console-drawer.ts` | vConsole drawer client; registers as `role: "drawer"` on `/te2_console`. |

### Event protocol

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `console:register` | client -> server | `{ role: "drawer" | "worker", workerId?, workerLabel?, tail_lines? }` | Drawers join `console:drawers`; workers join `console:<workerId>`. |
| `console:log` | worker -> server -> drawers | `{ workerId, workerLabel?, level, ts, args[] }` | Appended to the framework transcript and fanned out to drawers. |
| `console:eval` | drawer/MCP -> server -> worker | `{ targetWorkerId, reqId, code, timeoutSeconds }` | Routed only to `console:<workerId>`. |
| `console:evalCancel` | server -> worker | `{ reqId, targetWorkerId }` | Sent when Python-side eval times out so the Code TE2 bridge can reject the pending Promise. |
| `console:evalResult` | worker -> server -> drawers/MCP waiter | `{ workerId, reqId, ok, value|error, errorType? }` | Resolves pending evals and fans out to drawers. |
| `console:replay` | drawer -> server | `{ tail_lines? }` | Replays transcript entries from `$TE2_CACHE_HOME/console/te2_console_log.jsonl` after canonical root resolution. |
| `console:clear` | drawer -> server -> drawers | `{}` | Clears transcript and drawer state. |

### CLI

```bash
te2 console list-workers
te2 console eval --worker <worker-id> --code 'document.title'
te2 console eval --worker <worker-id> < debug-script.js
te2 console tail --worker <worker-id> --limit 100
te2 console search "query" --worker <worker-id> --limit 100
```

`list-workers` and `eval` require a running framework. `tail` and `search` can inspect the local transcript offline.

### vConsole integration notes

- vConsole is drawer-only. The producer bridge just patches browser `console.*`, serializes args, and ships events.
- The drawer writes TE2 console rows through vConsole's `model.addLog(..., { noOrig: true })` path so replayed rows do not feed back into the framework console bridge.
- The Code TE2 main-page bridge uses `workerLabel: "main_page"` plus `uniquePerWindow: true`; runtime inspection should target the exact generated worker id.
- The shared static bridge at `app/static/js/te2_console_bridge.js` is not necessarily at the same feature level as the Code TE2 main-page bridge. Do not document Code TE2-only timeout/cancel behavior as a shared bridge guarantee unless the shared bridge is updated too.

---

## 26) Themes, TextMate palette, and retokenization

Theme selection is a preference-backed editor concern. Code TE2 registers the
vendored GitHub themes and extension-contributed themes, resolves the selected
theme JSON, converts it to Monaco data, then applies it through the theme
runtime. The live loader is loadVscodeTextmateThemesRuntime() and the live
application path is applyMonacoThemeRuntime().

The same raw VS Code theme is applied to the TextMate registry. Its color map is
published to Monaco and every loaded model is reset for tokenization. This
sequence keeps encoded TextMate scopes, semantic-token rules, and visible Monaco
theme state aligned. It does not use the removed palette-index monkey patch.

Theme changes are idempotent: load or reuse JSON, define the Monaco theme when
needed, set the selected id, update the page base class, apply the TextMate
theme/color map, then reset tokenization. A missing contributed theme must fail
locally without changing the active theme.

Key sources: editor_theme_loader_runtime_utils.ts,
editor_theme_apply_runtime_utils.ts, editor_textmate_runtime.ts, and the
vendored GitHub theme directory.

## 30) RPC Protocol IDs (`rpcId`) — How They Work and Auto-Discovery

### How VS Code assigns rpcIds

The extension-host ↔ renderer protocol uses numeric IDs (`rpcId`) to route
messages to the correct service (LanguageFeatures, OutputService, Configuration,
etc.).  These IDs are **not negotiated at runtime** — they are determined by
**declaration order** of `createProxyIdentifier()` calls in a single file:

```
src/vs/workbench/api/common/extHost.protocol.ts
```

`ProxyIdentifier` has a static counter (`ProxyIdentifier.count`) that starts at 0
and auto-increments with each call.  All ~150 identifiers (both `MainContext.*`
and `ExtHostContext.*`) share the same counter, so the nid is simply the 1-based
position in the file.

**There are no other files that call `createProxyIdentifier()`** — the mapping
is fully contained in `extHost.protocol.ts`.

### How the real front end resolves them

Both sides (renderer and extension host) import the same `MainContext` /
`ExtHostContext` objects from `extHost.protocol.ts`.  When either side calls
`getProxy(identifier)`, it reads `identifier.nid` and uses that as the `rpcId`
for all `_remoteCall()` invocations:

```typescript
// rpcProtocol.ts:243
public getProxy<T>(identifier: ProxyIdentifier<T>): Proxied<T> {
    const { nid: rpcId, sid } = identifier;
    if (!this._proxies[rpcId]) {
        this._proxies[rpcId] = this._createProxy(rpcId, sid);
    }
    return this._proxies[rpcId];
}
```

Because both sides import the same module, the nids always agree.  There is no
handshake or discovery step.

### How TE2 handles them — `rpc-config.json` auto-discovery

The workbench adapter (`src/client/workbench-client.ts`) replaces the real renderer.
Since it doesn't import `extHost.protocol.ts`, the rpcIds are resolved via a
**cached config file** (`te2_rpc_config.json`) that is auto-generated by
structurally parsing the installed code-server bundle, with `extHost.protocol.ts` as a fallback/cross-check when available.

The following historical subset illustrates how rpcIds shift with Code OSS
declaration order. The authoritative required-name set lives in
`extension_registry.py`, and the generated config includes the newer command,
message, storage, and webview-panel actors as well:

| `ProxyIdentifier` name | Code OSS 1.109 | Code OSS 1.117 | TE2 usage |
|---|---:|---:|---|
| `MainThreadOutputService` | 29 | 30 | Reply to `$register` with synthetic channel ID |
| `ExtHostConfiguration` | 80 | 85 | `$initializeConfiguration`, `$acceptConfigurationChanged` |
| `ExtHostDocumentsAndEditors` | 84 | 89 | `$acceptDocumentsAndEditorsDelta` |
| `ExtHostDocuments` | 85 | 90 | `$acceptModelChanged`, `$acceptDirtyStateChanged` |
| `ExtHostEditors` | 88 | 93 | Editor diff/properties/position updates |
| `ExtHostFileSystemInfo` | 91 | 96 | `$acceptProviderInfos` |
| `ExtHostLanguages` | 93 | 98 | `$acceptLanguageIds` |
| `ExtHostLanguageFeatures` | 94 | 99 | Word definitions and inline-completion state |
| `ExtHostStatusBar` | 97 | 102 | `$acceptStaticEntries` |
| `ExtHostExtensionService` | 99 | 104 | `$activateByEvent` |
| `ExtHostWorkspace` | 106 | 111 | Workspace initialization/trust |
| `ExtHostEditorTabs` | 113 | 119 | Tab model/operations |
| `ExtHostOutputService` | 122 | 128 | `$setVisibleChannel` |

### Auto-discovery pipeline

The nid extraction is **managed-runtime keyed** and runs automatically at boot:

1. **Python helper** (`extension_registry.py: ensure_rpc_config()`) runs before
   the adapter launches (called from `workbench_adapter_shell_manager.py`).

2. **Pinned installation resolution and cache check** — resolves only TE2's
   managed Code Server 4.130.0 executable, reads that exact runtime's version
   and commit, and compares them against cached `te2_rpc_config.json`. If
   version + commit match → cache hit, skip. The same absolute executable and
   bundled Code tree are used by the code-server shell, extension management,
   builtin discovery, and WBA nid extraction.

3. **Structural extraction** — reads the installed minified bundle
   (`extensionHostProcess.js`), locates and balances the `MainContext` and
   `ExtHostContext` object literals independently, discovers the minified
   `createProxyIdentifier` factory as a JavaScript identifier (including `$`),
   and concatenates their property order. It extracts **property keys**, not
   call strings, because some VS Code keys intentionally differ from their
   runtime string IDs.

4. **Source fallback/cross-check** — when an installation also ships
   `extHost.protocol.ts`, parses its `MainContext` and `ExtHostContext`
   declarations. Source is a fallback when the bundle cannot be parsed and a
   strict order cross-check when both are present.

5. **Validation** — aborts and keeps stale config if entry count is outside
   the structural bounds or any current required name is missing.

6. **Writes** the generated probe beneath
   `$TE2_CACHE_HOME/code_server/probes/te2_rpc_config.json` with the complete
   nid map plus extraction strategy/source metadata.

7. **Adapter loads** the config synchronously at startup into `_rpcIds`.
   All `_sendExt()` calls use named lookups (`_rpcIds.ExtHostConfiguration`
   instead of literal `80`).  If the config file is missing, hardcoded
   defaults remain as fallback. Every language-intelligence runtime receives
   `_rpcIds.ExtHostLanguageFeatures`; hover, completions, document symbols,
   folding ranges, semantic tokens, inlay hints, inline completions, and
   document colors do not carry a version-specific numeric nid.

### Logging

- Python side reports the exact strategy, source path, and count, for example
  `minified-proxy-objects:$` with 160 entries for code-server 4.117.
- Adapter side: `[rpc-config] source: rpc-config.json (code-server 4.130.0, N/N applied)`
  or `[rpc-config] source: hardcoded-defaults` (logged during `connect()`)

### Minified object details

The minified bundle contains adjacent objects for the main-thread and extension
host declarations. Factory names are not stable across minifiers:
```
var Q={MainThreadAuthentication:N("MainThreadAuthentication"),...},ne={ExtHostCodeMapper:N("ExtHostCodeMapper"),...};
var F={MainThreadAuthentication:$("MainThreadAuthentication"),...},ge={ExtHostCodeMapper:$("ExtHostCodeMapper"),...};
```

String identifiers survive minification (they're runtime values, not type annotations).
Anchored balanced-object extraction avoids false hits elsewhere in the multi-MB
bundle and does not depend on `var`, a specific minified variable name, or an
alphanumeric-only factory name.

### Key files

| File | Role |
|------|------|
| `extHost.protocol.ts` (code-server) | Single source of all `createProxyIdentifier()` calls |
| `proxyIdentifier.ts` (code-server) | `ProxyIdentifier` class with static counter |
| `rpcProtocol.ts` (code-server) | `getProxy()` / `_remoteCall()` — wires nid to RPC |
| `src/client/workbench-client.ts` (TE2) | Named `_rpcIds` lookups, config loader, hardcoded fallback defaults |
| `extension_registry.py` (TE2) | `ensure_rpc_config()` — version-gated extraction and caching |
| `workbench_adapter_shell_manager.py` (TE2) | Calls `ensure_rpc_config()` before adapter launch |
| `$TE2_CACHE_HOME/code_server/probes/te2_rpc_config.json` | Cached nid map (auto-generated, version-gated) |

## 31) Adapter restart and status

Extension installation, removal, enablement, and settings changes restart the
minimum WBA or code-server path necessary to rebuild extension-host state. The
backend restart implementation lives in explorer/services/extension_restarts.py;
the Explorer request handler is explorer/handlers/extensions.py. The restart
fact is explorer.extensions.adapter.restarting.

The host exposes one persistent busy, ok, or error adapter indicator and
remounts the editor frame through _reloadEditorFrame() when a replacement editor
runtime is required. The indicator is presentation only: readiness remains a
backend and framework-shell fact. Termination releases adapter pipe state and
pending requests before a new shell is adopted.

## 32) Touch selection

Code TE2 ships a patched vendored monaco-touch-selection UMD and stylesheet at
static/vendor/monaco-touch-selection/. It supplies mobile cursor/selection
handles, a context menu, drag-to-reveal, and rendered-column hit testing without
changing desktop right-click behavior.

The deployed integration keeps Monaco option lookup at editor-init time, updates
handle geometry after configuration changes, samples drag movement at a bounded
rate, and uses the rendered visual row/column rather than a raw character
estimate. The default touch menu supplies clipboard, undo/redo, word/all
selection, hover, and close actions. Tab-navigation and Code Inspector controls
are separate utility islands.

editor_touch_menu_utils.ts initializes the helper after editor DOM readiness.
It passes the current mobile flag plus leading and navigation tools; it does not
rely on an implicit all-tools default. inline_host.ts loads the UMD asset.

The repository contains deployment artifacts, not a rebuildable local source
worktree. Update these assets only from an approved external source publication
and validate touch handles, wrapped lines, configuration changes, and the menu
on a target device.

## 33) Diagnostics owner-keyed markers

Extension-host diagnostics preserve their original owner. Monaco marker writes are
replace-all only within an owner, so sharing one owner would make a later
TypeScript, ESLint, or other update erase earlier markers.

The editor WBA runtime keeps a marker service keyed by resource and owner. It
reprojects every owner for the active model, clears rendered owners when leaving
a model, and aggregates toolbar counts from the retained marker state. A WBA
resync replays the bounded owner/resource snapshot to a newly connected editor;
there is no polling or frontend-to-frontend diagnostics relay.

The backend normalization path is separate from that direct editor path:
adapter stdout PUSH frames enter workbench_adapter_shell_manager.py, flow through
wba_event_bridge.py, and call diagnostics_bridge.handle_wba_diagnostics_update().
That cache is bounded by DIAG_CACHE_MAX = 500. The removed adapter-WebSocket
subscriber and its older consumer-ready, nudge, and pending-entry helper names
are not current interfaces.

Key files: editor_workbench_runtime.ts, src/server/event-bridge.ts,
src/extensions/intelligence/diagnostics-snapshot.mjs,
wba_event_bridge.py, and diagnostics_bridge.py.

## 34) Multi-provider language features

Provider registration is WBA-driven and generic. The registry matches the exact
document selector (language, scheme, authority, and path), not just a language
id, and invokes every matching provider. Results are merged where meaningful:
hover contents and completion/symbol lists combine; semantic-token requests use
the richest compatible response.

The editor installs public Monaco providers from WBA registration events and a
reconnect snapshot. It registers a missing contributed language before applying
TextMate tokenization, then repeats bridge installation after the asynchronous
language application so a plaintext cold model cannot permanently miss its
providers.

Extension contribution metadata remains available to activation and
configuration. Unsupported vscode scheme file-system calls receive typed error
replies rather than an empty value with the wrong wire type. Hover content is
normalized and type-checked before Monaco receives it; grammar loading for a
fenced language is cancelled when the active document version changes.

Key sources: editor_language_bridge_providers.ts,
editor_wba_runtime_handlers.ts, src/extensions/provider-registry.ts,
src/extensions/intelligence/code-navigation.ts, and
src/server/request-dispatch.ts.

## 35) Android / GeckoView IME and Browser Text Input

### Problem

Android IME composition, especially Gboard, can fight Monaco's desktop-oriented textarea transaction model. Cursor position, composition ranges, and visible model content can diverge when composition text is applied through the browser path as if it were desktop input.

### Current architecture

There are three distinct layers:

1. **Android native focus/filter layer**
   - `FilteredGeckoView.kt` subclasses `GeckoView` and can wrap the platform `InputConnection` with `EditorInputFilter`.
   - `EditorInputFilter.kt` can strip composition-style calls into simpler committed text when the native workaround is enabled.
   - `UiIpcClient.kt` connects to the complete configured framework origin and consumes strict `msgpack-v1` `/ui_ipc` focus/blur facts. It does not consume raw JSON `ui_event` messages.
   - `InputMethodManager.restartInput(geckoView)` is called on filter state changes so `onCreateInputConnection()` re-runs with the current policy.

2. **Monaco browser-side Android transaction layer**
   - Android disables Monaco native `EditContext` even when Chromium exposes it.
   - The patched Monaco `TextAreaEditContext` / `TextAreaInput` path uses a physically detached textarea containing `⇝` + the complete model line + two trailing newlines.
   - Native `input` events coalesce to one latest-value read per animation frame.
   - The coalesced transaction retains the latest `InputEvent.inputType`.
   - One cumulative UTF-16 range edit is applied before a generation-guarded canonical reseed.
   - Android composition start/update/end events do not gate input or create Monaco's visible composition textarea.
   - Aligned ordinary insertion remains on Monaco's typing path. An aligned
     `insertLineBreak` or `insertParagraph` newline is also routed through
     typing so `EnterOperation` applies language indentation; multiline paste,
     replacement, and recomposition newlines remain raw Android range edits.
   - The legacy rapid raw-key paste classifier cannot suppress `\n`, so a real
     Enter remains a command boundary even immediately after a fast text burst.
   - The mobile Ctrl state reuses the terminal helper's Gboard keycode-229
     conversion. Monaco's adapter replays the resulting control byte as one
     synthetic Ctrl chord while bypassing helper re-entry, allowing Monaco's
     normal keybinding service to resolve commands such as Ctrl+S. One tap arms
     Ctrl for the next command, a double tap locks it across dock and Gboard
     actions, and another tap releases it; the locked state is never represented
     by an unpaired synthetic keydown.
   - The mobile special-key dock is visible by default and has two rows. The
     first provides Ctrl, Alt, persistent Select/Shift, and arrow navigation;
     the second provides Tab, Home, End, Page Up, and Page Down. Ctrl, Alt, and
     Select combine through the same synthetic-key path, so Monaco's normal
     Ctrl+Shift navigation and selection rules remain authoritative. When the
     Terminal drawer owns focus, navigation keys use its established request
     bridge instead of inventing another input path.
   - A horizontally scrollable translucent action rail preserves editor focus
     and exposes hover, touch context, cut/copy/paste, and the
     client-owned Second Window shortcut. Save is pinned at the opposite edge
     and reserves Gecko's existing keyboard-recovery slot when that control is
     present. Save publishes the same `editor.host.save` action used by Ctrl+S.
     The rail's Ctrl control collapses or reveals the dock and auxiliary actions;
     it is not a second modifier authority.

3. **Shared xterm Android transaction layer**
   - The maintained `xterm-te2` fork gives Android custom mode exclusive
     ownership of printable text through a guarded cumulative helper-textarea
     projection.
   - Printable keydown and xterm's upstream keypress fallback do not emit text
     in that mode. Enter, Backspace, navigation, Ctrl/Alt combinations, and
     other non-text terminal keys retain xterm's keydown path.
   - A key-code-229 composition restores the projection guard if xterm cleared
     the helper after Enter or Ctrl+C.
   - This contract is shared by the standalone Terminal and Code TE2 terminal
     drawer. Non-Android and screen-reader paths retain upstream xterm behavior.

### Key files

| File | Role |
|---|---|
| `android/.../FilteredGeckoView.kt` | GeckoView subclass, IC interception point. |
| `android/.../EditorInputFilter.kt` | InputConnection wrapper, composition stripping. |
| `android/.../UiIpcClient.kt` | Strict msgpack-v1 `/ui_ipc` native focus/blur consumer. |
| `android/.../MainActivity.kt` | Wires filter, IPC client, restartInput callback. |
| `monaco_editor/editor_mobile_ctrl_helper_utils.ts` | Adapts vendored Gboard Ctrl control bytes into Monaco keybinding chords. |
| `monaco_editor/editor_mobile_special_keys_utils.ts` | Owns two-row mobile keys, modifier state, and the shared translucent action rail. |
| `src/mobile-input/terminal-special-key-bridge.ts` | Carries combined Ctrl/Alt/Shift navigation to the active editor or Terminal target. |
| `app/static/vendor/monaco-editor-core/esm/` | Committed patched Monaco artifacts; their editable VS Code source is external. |
| `app/static/vendor/xterm/xterm.js` | Published shared xterm browser artifact; editable source is in the external `xterm-te2` worktree. |

### Publication path

An approved external Monaco publication overlays scoped ESM/CSS into
`app/static/vendor/monaco-editor-core/esm`, then Code TE2 rebuilds
`static/dist/host.js`. Android native source is not part of that publication
unless the native filter layer itself changes.

---

## 36) Android Static Asset Bundling

### Problem

Without the native asset seed, GeckoView would fetch every static editor asset
from the remote framework server on each load. That adds first-load latency and
makes rendering unnecessarily sensitive to the remote connection.

### Architecture

**Two-tier storage:**
- **APK `assets/editor_static/`** — Read-only, manifest-generated seed (currently 205 files / ~39 MiB unpacked)
- **`filesDir/editor_static/`** — Runtime source of truth, seeded from APK on first boot

`app/android_editor_assets_bundle.json` is the only bundle inventory. The
publication script renders that inventory into a temporary tree and atomically
replaces the APK seed, so renamed app identities and removed assets cannot
survive as stale files.

**Request interception via WebExtension:**
- `asset_intercept` extension uses `webRequest.onBeforeRequest` to redirect matching static asset URLs to a local HTTP file server
- Local server (`LocalAssetServer.kt`) runs on a random port, serves from `filesDir/editor_static/`
- Port communicated to extension via native messaging (`MessageDelegate`)

**Cefrium routing through the framework relay:**
- `AndroidFrameworkRelay` resolves the same declared asset families into
  `filesDir/editor_static/` before considering the upstream framework server.
- A declared asset missing from the local root returns `404`; it never falls
  through to the upstream server.

For both renderers, the materialized local tree is the asset authority rather
than a best-effort cache. The remote framework remains authoritative for
server-rendered documents, APIs, Socket.IO/WebSockets, and other dynamic
services. Local file responses carry
`X-TE2-Android-Asset-Source: files-dir` so live network inspection can prove
their provenance.

Native Android framework documents do not use TE2's PWA Service Worker. The
shared framework relay rejects the exact root `/sw.js` request before local
routing or upstream proxying. Other Service Worker script paths are unaffected.
This prevents Cache Storage from becoming an asset authority ahead of the
APK-seeded/OTA tree.

### What gets bundled

The manifest currently includes the framework shell assets, canonical
`code_te2` host build and icons, TextMate grammars/themes, the selected Monaco
bootstrap and worker assets, Android launcher/settings assets, and the app
catalog support files needed by the native shell.

Anything not declared in the manifest is excluded. Tree entries additionally
exclude source maps, backup files, Python bytecode/cache directories, and
`node_modules`. Server-rendered application content remains dynamic.

### Asset versioning

- The canonical version comes from the manifest's `version_file`, currently
  `app/apps/code_te2/static/version.txt`.
- The script rejects a supplied version that differs from that source version.
- Publication writes the same value to `editor_static/version.txt`; APK
  `versionCode`/`versionName` are advanced to identify the native package that
  carries that seed.
- `EditorAssetManager.seedFromApk()` compares bundled vs local version; skips copy if matching
- A frontend/native contract change must advance the synchronized frontend
  versions before handoff. When Android source participates, build Code TE2,
  publish that exact version into the APK seed, and only then assemble the APK.
  GeckoView and Cefrium do not use a Service Worker for these assets, so a
  stale same-version seed cannot be repaired by browser cache invalidation.

### URL pattern interception

The WebExtension intercepts these URL patterns (redirecting to local server):

| URL Pattern | Local Path (mirrors server structure) |
|-------------|--------------------------------------|
| `/static/vendor/codicons/*` | `static/vendor/codicons/*` |
| `/static/vendor/monaco-editor-core/te2-lang/*` (not workers) | `static/vendor/monaco-editor-core/te2-lang/*` |
| `/static/vendor/monaco-editor-core/esm/*` | `static/vendor/monaco-editor-core/esm/*` |
| `/static/fonts/*`, `/static/js/*` | `static/fonts/*`, `static/js/*` |
| `/apps/code_te2/static/*` | `apps/code_te2/static/*` |
| `/api/app/code_te2/static/*` | → remapped to `apps/code_te2/static/*` |
| `/api/app/code_te2/ui/monaco_editor/*` | `api/app/code_te2/ui/monaco_editor/*` |
| `/api/app/code_te2/ui/monaco_vscode/lang/*` | `static/vendor/monaco-editor-core/te2-lang/*` |
| `/api/app/code_te2/ui/monaco_vscode/esm/*` | `static/vendor/monaco-editor-core/esm/*` |

### Bundle script

```bash
# Re-bundle assets (from repo root):
./scripts/bundle_gecko_assets.sh "$(<app/apps/code_te2/static/version.txt)"

# Then rebuild the native clients:
cd android
./termux-sdk-env.sh ./gradlew :app:assembleGeckoDebug :cefrium:assembleDebug
```

### Boot sequence

1. `onCreate()` → `initEditorAssets()`
2. `EditorAssetManager.seedFromApk()` — copies APK assets → filesDir (skips if version matches)
3. `LocalAssetServer.start()` — binds random port
4. `installAssetExtension()` — installs `asset_intercept` WebExtension, sends port via `MessageDelegate`
5. GeckoSession opens → pages load → WebExtension intercepts static requests → local server responds

### Key files

| File | Role |
|------|------|
| `app/android_editor_assets_bundle.json` | Canonical, explicit Android asset inventory and version source |
| `scripts/bundle_gecko_assets.sh` | Validates, stages, and atomically publishes the manifest inventory into the APK seed |
| `android/.../EditorAssetManager.kt` | APK→filesDir seeding, version comparison |
| `android/.../LocalAssetServer.kt` | Lightweight HTTP file server for local assets |
| `android/.../assets/asset_intercept/manifest.json` | WebExtension manifest |
| `android/.../assets/asset_intercept/background.js` | URL pattern matching + redirect logic |
| `android/.../MainActivity.kt` | `initEditorAssets()`, `installAssetExtension()`, lifecycle cleanup |

## 37) Run Profiles, Runtime Launchers, And Draft-Save Transaction

Run Profile execution is backend-owned through `ui.host.file.run`. The frontend sends run intent; backend hooks resolve the active project/file, select a profile, decide what must be saved, and only then launch a runner shell or the default terminal fallback.

Run Profile shell state is projected from one process-local fact store. The existing FWS lifecycle bridge performs one authoritative `fws.dashboard.open` snapshot after namespace connection, replaces the complete running-shell set, then applies `fws.shell.*` events; launch and stop paths update the same facts immediately. The initial connect handler yields one event-loop turn before requesting the snapshot so python-socketio completes `/fws` namespace bookkeeping. `runner_profile_shell_state()` and `page_preview_shell_state()` are constant-time fact reads and never query the Framework-Shell manager. Before the first authoritative snapshot, absence is not proof of a stopped shell and stale-route cleanup is suppressed. There is no polling. Live validation on 2026-08-17 reduced `ui.host.runProfile.state.get` from about 6.7 seconds to about 107 ms end-to-end and full boot from about 13 seconds to about 154 ms; the exact three-profile `test-python` projection measured a 4.8 ms median.

### Config and schema

Project-local config lives at `.code_te2/run_profiles.json`, owned by `runner_profiles.py`.

A config may be an object with `profiles`, a single profile object, or a profile list. The normalized object shape is:

```json
{
  "version": 1,
  "fallback": { "showSaveWarning": true },
  "profiles": [
    {
      "profileId": "page-preview",
      "runner": "pagePreview",
      "entry": "index.html",
      "include": ["index.html"],
      "runningBehavior": "just save",
      "saveDrafts": "included",
      "showSaveWarning": true,
      "devTools": false
    },
    {
      "profileId": "express-vite",
      "runner": "custom",
      "include": ["server.js", "src/**"],
      "exec": "node",
      "args": ["server.js"],
      "sidebarUrl": "http://127.0.0.1:8000/",
      "port": 8000,
      "additionalPorts": [
        { "port": 5173, "label": "Vite / HMR" }
      ],
      "devRuntime": true
    }
  ]
}
```

Current profile fields:

| Field | Purpose |
|---|---|
| `profileId` / `profile_id` | Stable profile id. Required and unique within the project config. |
| `runner` | `pagePreview`, `node`, `python`, or `custom`; defaults to `custom`. |
| `entry` | Page Preview entry, defaulting to `index.html` for `pagePreview`. |
| `include` | Relative path/glob matchers. Required, except `pagePreview` can derive it from `entry`. |
| `sidebarUrl` / `sidebar_url` | Optional sidebar URL to open after launch. `pagePreview` defaults to `http://127.0.0.1:3000/`. |
| `port` | Optional preferred native-client loopback port for a non-`pagePreview` runner. It requires a credential-free loopback HTTP `sidebarUrl` whose effective port matches this integer in `1..65535`. |
| `additionalPorts` / `additional_ports` | Up to eight labeled auxiliary ports, such as Vite/HMR. Requires `port`; ports must be unique and cannot duplicate the primary port. Unsupported for Page Preview. |
| `runningBehavior` / `running_behavior` | `just save` or `relaunch`; defaults to `just save`. |
| `exec` | Runner command or project-relative executable path. Required for non-`pagePreview` runners. |
| `cwd` | Optional project-relative or absolute cwd; must resolve inside the project. |
| `args` | Extra argv list. |
| `env` | Extra environment, validated as shell-safe names with string values. |
| `saveDrafts` / `save_drafts` | `included`, `opened`, `all`, or `none`; defaults to `included`. |
| `showSaveWarning` / `show_save_warning` | Boolean warning setting; JSON `0`/`1` are accepted for compatibility. |
| `devRuntime` / `dev_runtime` | Boolean, default `false`. For custom/node/python URL profiles, one umbrella enabling save-triggered refresh plus native-client console instrumentation and exact-origin no-cache/no-store HTTP policy. Page Preview receives the native runtime behavior implicitly while Vite owns its save/HMR refresh. |
| `devTools` | Boolean, default `false`. On GeckoView, expose this profile's Sidebar URL iframe as a selectable native Inspector target. |

The generated Run Profiles form renders `additionalPorts` as repeatable Port and Label rows. `5173` and `Vite / HMR` are placeholders, not implicit configuration. Its declarative `visibleWhen` rules hide Page Preview-inapplicable process, URL, routing, running-behavior, and explicit `devRuntime` controls. Page Preview keeps its identity, entry/include, save policy/warning, and applicable instrumentation controls. Hidden incompatible keys remain round-trippable in raw JSON so changing the runner is reversible, but the Page Preview parser ignores them and supplies canonical backend-owned runtime values before validation.

### Runner dispatch

- `host/terminal_actions_backend.py` owns the `ui.host.file.run` flow, draft-save confirmation, save-before-play, and terminal fallback.
- `host/runner_profiles_backend.py` resolves ordinary owner candidates or an explicit profile id and dispatches already-resolved profiles.
- `runner_profile_shell_manager.py` launches `node`, `python`, and `custom` runners via `shellspec/runner_profile.yaml#runner-profile`.
- `page_preview_shell_manager.py` launches page previews via `shellspec/page_preview.yaml#page-preview` and one deterministic `page-preview:<app>:<project>:<profile>` label.
- `host/page_preview_backend.py` installs the default Page Preview profile into the project config.

`pagePreview` profiles start a project-local preview shell and create an owned URL surface after the URL becomes ready. Non-preview profiles do the same only when `sidebarUrl` is non-empty; URL-less profiles retain process state without a Sidebar surface. When `devTools` is enabled, the backend projects a stable project/profile target id with that URL slot. The Sidebar places the id in a namespaced iframe `window.name` marker before navigation; it does not append target metadata to the application URL.

Ordinary Play keeps the one-owner fast path. If more than one profile owns the
active file, Python returns a candidate-selection projection instead of treating
the overlap as a launch error. The shared `teUI.dialog` selector then sends the
chosen `profileId` back through the same backend Run transaction. Right-click or
touch long-press on Play opens the forced selector with every configured profile
plus `Run current file`; an explicit profile may therefore intentionally run
even when its `include` patterns do not own the active file. `Run current file`
is an explicit bypass and cannot fall back into profile matching on confirmation.
Profile selection is independent of `saveDrafts`; only after selection does the
chosen profile's existing save policy run.

Run Profile process lifecycle is not fire-and-forget. The app worker opens one
Socket.IO subscription to Framework-Shells `/fws`, requests
`fws.dashboard.open` once after each transport connection for the authoritative
snapshot, and then consumes `fws.shell.*` lifecycle notifications. It filters
those facts to the deterministic `runner-profile:code_te2:*` and
`page-preview:code_te2:*` labels and republishes the resolved state as a
backend `RunProfileStateChanged` fact.

Boot snapshots, UI IPC reconnect snapshots, active-file/project changes,
profile-config saves, Run/Stop actions, and natural shell exits all converge on
`ui.runProfile.state.changed`. Every client therefore renders the same state
without a frontend or backend polling timer. The one-shot
`ui.host.runProfile.state.get` method remains available for explicit repair,
debugging, and the user-triggered forced selector. The projection separates
active-file `candidates` from project-wide `runningProfiles`, so running state
does not depend on the currently active file.

Play remains a stable Run action while an adjacent Stop control appears whenever
`runningProfiles` is non-empty. One running profile stops directly; multiple
running profiles require exact selection from a running-only modal. Ambiguous
and forced Run selectors omit profiles that are already running, while the
forced selector retains `Run current file`. A sole owner already running can
still apply its configured `runningBehavior`. `ui.host.runProfile.stop` accepts
the exact project/profile/shell identity and terminates only that shell. Page
Preview and ordinary runner profiles share this state contract.

### Native preferred-port routing

The optional `port` and `additionalPorts` fields solve remote native-client access to server processes that listen only on the framework host's loopback interface. They are deliberately unsupported as user configuration for `pagePreview`; its backend always registers the active primary HTTP port `3000` and Vite middleware HMR port `24678`.

After a routed shell starts, Python registers its deterministic owner label, exact Framework-Shell id, primary port, and bounded auxiliary list through Rust pipe target `2400` (`service.runTarget`) using `runTarget.routes.register`. For non-preview profiles those ports come from the profile; for Page Preview they come from the backend implementation. Rust returns an atomic `RunTargetRouteSet`: one primary descriptor plus one labeled descriptor per auxiliary port. Every port receives an independent unguessable 256-bit bearer ticket and 24-hour renewable tunnel path:

```text
/api/run-targets/<ticket>/tunnel
```

Each Axum WebSocket route connects only to its registered `127.0.0.1:<port>` destination on the framework host and bridges binary WebSocket frames to raw TCP. Registration validates the complete owner/shell route set before replacing live state. An exact repeated registration reuses and renews the group; relaunch replaces every prior ticket; owner/shell release removes the complete group. The singular `runTarget.route.register` operation remains compatible by delegating to a one-port route set.

The Sidebar preserves the original primary URL and the complete route set.
Ordinary browsers use the original URL. Rust additionally exposes
`runTarget.routes.list`, a full projection of the active owner/shell route
generations. The framework serves that projection directly through no-store
`GET /api/run-targets/routes` and an event-driven no-store
`GET /api/run-targets/events` SSE stream. Every SSE connection begins with an
authoritative snapshot and then receives complete replacement projections after
registration or release. Code TE2 also publishes
`ui.runTarget.routes.changed` over strict MessagePack UI IPC for Electron and
sends Electron a current snapshot when its native client reconnects.

Android's started-and-bound client-runtime service reconciles the framework SSE
projection after its stable process-local framework relay is ready; Electron
reconciles its direct UI IPC projection. Both determine locality once from the
configured framework origin:
`localhost`, `127.0.0.1`, and `::1` are local, while every other configured host
is remote. No DNS, loopback-port, or framework-identity probe participates. A
configured local framework needs no Run Target listeners. A remote framework binds the primary
preferred port and every declared auxiliary port on `127.0.0.1` before marking
the projection ready. Any occupied port is a fatal collision; auxiliary failure
rolls back the complete partially created group, and `EADDRINUSE` /
`BindException` never implies locality. Generation fencing prevents a
superseded projection from binding or resurrecting a removed group.

Requests and WebSocket upgrades to auxiliary ports, including declared Vite
ports or Page Preview HMR port 24678, traverse their own ticketed raw-TCP
tunnels. The projection event itself creates, reuses, and removes listener
groups; no page, iframe, preload, or WebExtension request participates. A route
feed interruption preserves existing listeners, and the reconnect snapshot
reconciles them. Electron gates new app navigation while its UI IPC authority is
unavailable; Android gates only an actual pending cold-session restore. A fully
restarted Android service reconstructs every required listener from its first
fresh snapshot before a bound Gecko or Cefrium Activity restores the app.
Projection snapshots are serialized with route registration and release
publications, preventing a connect-time snapshot from overwriting a newer
lifecycle event. Android cold start retargets its framework relay, opens the
framework projection stream, reconciles the first snapshot, and only then
allows remote-app restoration. A complete serialized `GeckoSession` is restored
only when both random loopback origins still match; otherwise Gecko loads the
saved app URL rebased through the current framework relay. Cefrium applies the
same fresh-projection restore gate without a serialized Gecko session. Warm
background return preserves the live renderer without reloading it. Exact
Framework-Shell removal immediately closes that generation's owned listeners;
same-owner relaunch replaces its old generation. Framework retarget, service
shutdown, and process death retain whole-client cleanup.

There is no route/proxy polling. The only retry loop in this flow is the bounded
backend HTTP page-readiness check before initial surface publication.

`PersistentNetworkService` owns Android's configured upstream identity, stable
`AndroidFrameworkRelay`, Run Target SSE client/listener manager, UI IPC socket,
and native-console socket. Gecko and Cefrium Activities bind only to observe
projection/connection state and receive IME, console, or native-command
callbacks; Activity recreation and ordinary backgrounding do not close those
service-owned transports. A service process restart reads only Android settings,
starts the framework relay first, and then reconnects for a fresh complete Run
Target projection. Route sets are never persisted as restart authority.

Persistent remote runtime is an explicit Settings opt-in. While a non-loopback
remote app is active, the service uses the `connectedDevice` foreground-service
type and holds a partial CPU wake lock plus a high-performance Wi-Fi lock only
while an Internet-capable Wi-Fi network is present. Exiting the app shell,
disabling persistence, task removal, timeout, or service shutdown releases this
power policy. Settings show the current battery-optimization exemption and link
to Android's system panel; TE2 does not grant itself an exemption. Notification
permission denial does not disable the runtime.

Native negotiation never changes URL paths, queries, or fragments, never dynamically remaps ports, and never exposes an arbitrary framework-host TCP destination.

### Owned URL surfaces and development refresh

Python creates a project/profile-scoped `RunProfileSurface` only for a profile
with a resolved URL. Its stable `surfaceId` is independent of the current
Framework-Shell generation and client presentation. The surface records project,
profile, runner, exact shell id/label, source URL, `devRuntime`, and
`refreshRevision`; the Sidebar slot additionally retains the route set and
Inspector metadata. Browser iframe, GeckoView target, and Electron detached
window identifiers are presentations, not lifecycle authority.

After Framework-Shell readiness and before creating the surface, Python performs
one bounded, cancellable HTTP readiness transaction. Connection failures and
HTTP 404 retry with bounded backoff; any non-404 response succeeds without
reading the body. Stop, relaunch, project switch, or shell-generation replacement
cancels the transaction. A newly launched shell that times out is stopped and
its route set is released; a reused shell remains running without creating a
new surface. This is launch readiness, not periodic health polling.

Exact Stop, terminal lifecycle, and stale-shell reconciliation remove the owned
Sidebar slot. The dock icon's right-click/touch-long-press menu routes Stop
through Python with the surface's project/profile/shell identity rather than
inferring ownership from the active editor file.

The canonical active-file save path and bulk `save_reviews` path publish typed
post-commit `FileSaved` worker events. Publication is scheduled outside the save
response path. Each running custom/node/python profile with `devRuntime: true`,
a URL surface, and an include match advances that exact surface's
`refreshRevision`; the Sidebar reloads the presentation while retaining its
surface and route identity. Page Preview is implicitly a development runtime,
but Vite owns its watch, cache invalidation, HMR, and full reload behavior, so
TE2 does not add a duplicate hard refresh.

For GeckoView and Electron, the same `devRuntime` surface metadata is registered
before navigation. Gecko's Run Target WebExtension and Electron's framework
session apply request `no-cache` and response `no-store` headers only to the
surface's exact primary and auxiliary origins, excluding WebSocket upgrades.
They also inject the shared TE2 console bridge into the marked Run Profile frame
with an explicit framework origin and a profile-aware unique worker label.
Run Profile selectors use the compact
`rp-<profile4>-<injector4>-<owner4>` worker-id form: the profile segment is the
first four normalized alphanumeric characters (or `prof`), the injector is
`gkvw` or `elct`, and the four-character base62 owner remains stable in session
storage for that page/window. The full surface-aware label remains registered as
worker metadata and is not repeated in the selector id.
Surface removal carries the stable `surfaceId` independently of `devRuntime` and
releases runtime/cache policy, console injection, Inspector registration, and
presentation state. It does not own relay listener lifetime. Native listeners
are owned by exact Run Target `ownerId + shellId` generations and reconcile from
the client's authoritative projection feed. A shell removed during an asynchronous
resolve cannot bind or resurrect a listener afterward. Framework retarget,
service shutdown, and process death retain whole-client relay cleanup; Activity
recreation and ordinary backgrounding do not.
The separate `devTools` option still controls only GeckoView's full Chobitsu
Inspector target runtime. Ordinary browsers keep refresh behavior but cannot
receive native cross-origin header mutation or bridge injection.

### Draft-save transaction

Profiles that omit `saveDrafts` default to `included`, and profiles that omit `showSaveWarning` default to warning enabled.

Save policies:

| Policy | Meaning |
|---|---|
| `included` | Intersect the profile `include` matchers with unsaved sidecar drafts. Clean matching files are not rewritten. |
| `opened` | Save the canonical bounded sidecar open-file set. |
| `all` | Save every unsaved project draft. |
| `none` | Perform no pre-run writes. |

For a file with no matching profile, the fallback runner keeps active-file-only save behavior, and its warning suppression is stored under `fallback.showSaveWarning` because there is no profile object.

When warning is enabled, the first Run request returns a confirmation projection and performs no save or launch. A confirmed request preserves the explicit profile/current-file intent, re-resolves the target and current profile config, verifies the confirmation key against the current target, save policy, and include set, then obtains a fresh active Monaco snapshot for the expected active path. The active project/file is checked before the save transaction and again before launch. Stale confirmation, a tab/project switch, or any required save error prevents launch. Concurrent Run requests for one project are serialized.

The Run Profiles modal is `main_page/frontend/ui/run-profiles-modal.ts`. It uses CM6 JSON fields and preserves top-level config such as `fallback` while editing profile forms or raw JSON.

---

## 38) Native clients and secondary-editor integration

The active Linux desktop client is the Electron shell under `desktop_client/electron/`. `desktop_client/ui.py` remains a GTK/WebKit behavioral reference, not the current runtime.

### Runtime shape

- A local `te2-desktop://shell/` renderer owns the desktop launcher, Settings, persistent header, asset version/toasts, zoom, app-scoped Quit, and window controls.
- Framework apps run in a separate `WebContentsView` with Node integration disabled and context isolation enabled.
- The app view uses the `persist:te2-framework` partition.
- Electron keeps Chromium's automatic native Ozone backend selection; Wayland sessions are not forced through X11.
- Development and packaged launch paths intentionally pass `--no-sandbox` because the client runs from a user-owned tree and Ubuntu AppArmor blocks the unprivileged namespace sandbox.
- Selecting a saved framework bookmark immediately enters the same Electron-main `saveConnection` transaction as the editable Save action. The launcher projects intent only; Electron main persists the endpoint, reconnects UI IPC, clears stale Run Target state, and retargets the stable loopback relay.

### Relay and assets

Electron binds one dynamically allocated `127.0.0.1` HTTP origin for each configured HTTP or HTTPS framework target. The in-process relay:

- proxies ordinary HTTP, streaming SSE, Socket.IO, and raw WebSocket upgrades;
- serves only inventory-approved installed assets from the same browser origin, preserving Monaco module-worker same-origin requirements;
- retargets the existing listener when the framework target changes, closing active connections without restarting Electron;
- appends `gv_native=1` to app URLs so the PWA Service Worker cannot mask the desktop asset layer.

Shared desktop assets reuse `/api/editor_version` and `/api/editor_assets_bundle`. They install under `$TE2_DATA_HOME/desktop_assets` after canonical root resolution through monotonic staged validation, backup, atomic rename, and rollback. The desktop asset inventory is `desktop_client/desktop_asset_inventory.json`; Android's `android-shell/` launcher is intentionally omitted because desktop owns a separate launcher and Settings surface.

Successful asset installs clear the `persist:te2-framework` HTTP cache and generated V8 code cache, then reload an active app view with cache bypass. Forced same-version updates must activate without requiring an Electron restart.

### Native app-view bridge

Code TE2 app views in Electron expose frozen `window.te2Electron` from `desktop_client/electron/src/preload/app-view-preload.ts`. The shared contract is `desktop_client/electron/src/shared/app-view-contracts.ts`.

Allowed app-view commands are:

| Command | Purpose |
|---|---|
| `inspect` | Return current URL, relay origin, configured framework origin, cache size, Electron/Chromium versions, and asset status. |
| `reload` | Reload the exact app view. |
| `home` | Return to the desktop launcher. |
| `read_client_identity` | Read the calling renderer role's stable Electron client identity from `$TE2_CONFIG_HOME/desktop-state.json`. |
| `reset_client_identity` | From the primary renderer only, atomically rotate both desktop editor identities and clear secondary presentation after Code TE2 removes the old reconstruction records. |
| `wait_for_app_prerequisites` | Await the first current Code TE2 Run Target projection after backend readiness; both primary and reduced secondary Code TE2 renderers use this shared app-shell gate, while all other apps are a no-op. |
| `force_asset_update` | Run the desktop asset updater. |
| `register_run_target_surface` | Register exact-frame `devRuntime` instrumentation metadata; it does not create a proxy. |
| `release_run_target_surface` | Release exact-frame instrumentation metadata; it does not tear down a running shell's proxy. |
| `open_sidebar_menu` | Present one bounded OS-native Sidebar dock menu and return only the selected action id. |
| `read_sidebar_presentation_state` / `write_sidebar_presentation_state` | Read or persist the bounded per-client Sidebar presentation state. |
| `place_sidebar_surface` | Create or reposition one persistent extension renderer over its DOM-owned embedded placeholder. |
| `detach_sidebar_surface` | Move a persistent extension renderer into an Electron-main-owned floating window, or reconstruct an ordinary URL surface there. |
| `focus_sidebar_surface` | Focus the exact detached surface presentation. |
| `close_sidebar_surface` | Close the exact detached presentation and request inline reattachment. |
| `reconcile_sidebar_surfaces` | Close native presentations absent from the current authoritative Sidebar ledger. |
| `refresh_sidebar_surface` | Explicitly reload the exact native Sidebar renderer. |
| `set_projection_probe_enabled` / `inspect_projection_probe` | Control and inspect the bounded native projection diagnostic probe. |
| `open_second_editor` | From the primary renderer only, open one selected admitted project path in the stable secondary editor client. |
| `sync_second_editor_project` | From the primary renderer only, reconcile the secondary presentation against the active project. |
| `place_second_editor_surface` | From the primary renderer only, place the retained secondary view over the Code TE2-owned grid placeholder. |
| `set_second_editor_dock_size` | From the primary renderer only, persist a bounded dock width in the current framework/project presentation record. |
| `set_second_editor_mode` | Change the secondary presentation among closed, docked, collapsed, and detached. |
| `second_editor_ready` | Let only the current secondary renderer release its queued canonical file-open intent. |

The command allowlist is exact-view and origin validated in Electron main. The
preload also delivers bounded detached-surface events only to that exact app
view. Code TE2 console workers in Electron app views register as
`main_page:<clientInstanceId>:<windowId>` with the existing
`electron:main_page` label. Browser and GeckoView use the same exact worker-id
shape with their own stable client identity providers.

### Detached Sidebar presentations

Detachment changes only the requesting Electron client's presentation. The
backend ledger and stable `surfaceId` remain lifecycle authority. For an
extension surface, Electron main creates one framework-partition
`WebContentsView` at the first embedded presentation, while Code TE2 owns a DOM
placeholder that reports its bounds and visibility. Hidden presentation makes
that view invisible without destroying it. Detach moves the exact same view
from the main window into a normal floating `BrowserWindow` with trusted local
header chrome; Attach moves it back over the placeholder. Neither transition
navigates the view, reconnects the trusted wrapper, or replaces the extension
document's JavaScript heap. A main-page reload temporarily hides the retained
view until the reconstructed host reports its current placement.

Ordinary user URL and Run Profile surfaces keep the prior reconstruction path:
their detached frame starts at `about:blank`, receives the complete namespaced
`window.name` marker, and then navigates to the final URL.

The Electron Sidebar dock's icon/action, refresh, and app-drawer menus use the
exact-view native bridge instead of DOM dropdowns that cannot composite above a
sibling `WebContentsView`. The request is declarative and bounded to labels,
separators, enabled action ids, and coordinates. Electron returns only the
selected id; Code TE2 executes the existing action, so Electron never becomes
Sidebar lifecycle authority. Browser and Gecko retain the DOM menus.

The trusted header exposes Attach, Refresh, Console, DevTools, exact Stop, and
Close. Attach or user Close publishes an exact reattach event. Extension
surfaces retain their deterministic client/surface presentation identity and
live renderer; ordinary URL surfaces recreate an inline iframe with a new
transient presentation id. Stop travels back through the existing
project/profile/shell backend action and never kills Framework-Shells directly
from Electron. Backend ledger removal, app-view loss, renderer loss, framework
retarget, and process exit close the native presentation without recreating
stale inline state.

Detached window lifetime remains independent from Run Target listener lifetime.
The exact `ownerId + shellId` framework projection owns primary and auxiliary
relay listeners; detach, attach, window close, and iframe reconstruction do not
release that group. Runtime/cache/console instrumentation remains surface-scoped
and is applied before either embedded or detached navigation.

Run-target listeners are owned by Electron main, not the renderer. Electron main
also owns a direct strict-MessagePack Code TE2 UI IPC client which receives the
authoritative owner/shell route projection. Electron app navigation loads the
shared app shell immediately, so the framework-owned lifecycle/readiness SSE
remains visible and authoritative. After backend readiness and before Code TE2's
frontend template is injected, the shared shell asks the exact-view preload to
await one current Run Target projection event; other apps have no native
prerequisite. The preload exposes no Run Target resolve operation, and neither
readiness layer polls. App-view navigation does not tear down a still-running
shell's group. Electron closes all relay listeners and active streams when the
framework connection changes or the desktop process exits.

### Second editor surface

Electron exposes one **Open in a Second Window** surface. It is a complete
second Code TE2 client with a stable `clientInstanceId`, not another
presentation id for the primary client. The backend-owned
`ProjectSidecar.client_foregrounds` entry therefore remains its canonical file
state, while shared membership, drafts, writes, diagnostics, and WBA logical
documents retain their existing project-scoped authorities.

Electron main owns one retained framework-partition `WebContentsView`. Dock,
Collapse, Detach, and Attach reparent that exact renderer between the main
window and a frameless `BrowserWindow` without navigation. Close disposes the
renderer but does not clear its backend foreground, so reopen reconstructs a
fresh renderer against the warm client state. The reduced renderer mounts one
inline Monaco surface and a filename/action header without a background tab
strip. Its Save, Save As, Discard Draft, file open, and WBA traffic use its own
authenticated UI IPC, Editor, and WBA identities; Editor-originated Save, Focus,
and Blur notifications target only that client's presentation room.

When embedded, the primary Code TE2 page reserves a grid column below the
shared toolbar and between the primary editor and Sidebar. A DOM placeholder
reports CSS-pixel bounds and visibility through the exact-view preload;
Electron applies the primary app-view zoom and places the retained native view
over it while leaving the primary app view full-sized. The primary tab strip's
Electron-only right-click/Context Menu action opens the clicked admitted path in
the secondary client without activating it in the primary client. The reduced
renderer may use the shared Code TE2 app-readiness prerequisite, but placement,
project synchronization, and path-open initiation remain primary-only native
commands.

The reduced boot removes only the primary template's visual nodes and retains
the injected link/style/font assets required by Monaco, its breadcrumb widget,
and Codicons. In docked mode, a primary-page drag handle owns the boundary. It
temporarily hides the sibling native view so the primary page keeps pointer
capture, updates the grid column during the gesture, and commits the final
bounded width through `set_second_editor_dock_size`. The existing Electron
presentation store remains the sole dock-size authority; Code TE2 layout
`localStorage` does not retain that value.

Versioned `$TE2_CONFIG_HOME/desktop-state.json` atomically owns distinct primary
and secondary client identities, existing Sidebar presentation, and bounded
secondary presentation keyed by configured upstream framework origin plus
canonical project path. It migrates the former identity and Sidebar files once.
The random loopback relay origin is never a persistence key. Browser, GeckoView,
and Cefrium do not receive this Electron-native placement contract; their mobile
secondary presentation uses the portable drawer contract below.

Cold restoration is WBA-gated in Code Server mode. The primary page may restore
and visibly attach its own Monaco model immediately, but it retains the latest
secondary-project request until the backend projects authoritative adapter
`ready`; only then does it ask Electron to recreate a persisted non-closed
secondary renderer. A manual **Open in a Second Window** action awaits the same
event-driven readiness promise. Monaco web-worker mode is exempt because it
intentionally has no WBA lifecycle.

When the Python app worker restarts while the global WBA Framework-Shell
survives, the shell manager re-subscribes to its pipe and performs one
`adapter.status` adoption handshake. It accepts only a connected extension-host
session for the exact active workspace, or explicitly retargets a connected
session before publishing `ready`. A late WBA `adapter/ready` event repairs
Python state after a slow `adapter.connect`; there is no readiness polling. This
prevents the restored secondary foreground from racing extension-host
initialization while preserving the rule that ordinary visible Monaco opens do
not wait for WBA acknowledgement.

### Mobile second editor surface

Eligible mobile browser profiles, GeckoView, and Cefrium expose the same
**Open in a Second Window** document semantics through a retained same-origin
iframe in the bottom drawer. Capability comes from the mobile/native client
identity, never from a narrow desktop viewport. The iframe boots the portable
reduced editor under an independently persisted secondary `clientInstanceId`
and its own authenticated UI IPC, Editor, and WBA lanes. Its canonical file is
the existing `ProjectSidecar.client_foregrounds` entry for that client; shared
membership, drafts, writes, diagnostics, and WBA documents remain unchanged.

Ordinary mobile browsers store a separate primary/secondary identity pair in
browser storage. GeckoView and Cefrium store both installation identities in
Android application-private preferences and expose the requested role through
their existing native identity bridges. Reset rotates both ids in one native
transaction. The random process-local framework relay origin is never identity
authority.

The mobile host owns drawer visibility and the iframe presentation lifetime.
Collapse and mobile breakpoint exit retain the iframe and its backend
foreground. Close is different: the authenticated secondary UI IPC client asks
Python to clear its own foreground, exact-client SSOT disposes the Monaco model,
and the host destroys the iframe and removes the **Second Window** tab. An
explicit `clientForeground.path: null` is authoritative empty state and never
falls back to the primary/shared `currentPath`; a newly observed secondary
identity also starts empty instead of seeding from shared MRU. The retained
iframe reports its exact foreground to the host, so the tab is visible only
while that foreground is populated. Explorer file cards send a validated
file-only request through `/rpc/explorer`; Python checks project containment and
document admission, then notifies only the invoking client's UI IPC room. The
secondary renderer performs the canonical open, so the host reveals the tab
only after that open succeeds, the primary foreground does not move, and no
document content crosses the presentation `postMessage` channel.

The portable reduced header consumes the auxiliary client's exact diagnostics
count projection and renders the same error/warning pills as the primary
editor. Its Next Issue action stays on that auxiliary UI IPC lane. A translucent
mobile Second Window shortcut exists only while the auxiliary foreground is
populated and reopens a locally dismissed or collapsed drawer without choosing
or creating a file.

The former bottom-drawer Problems presentation is removed. Explorer Diagnostics
remains the project-wide diagnostics UI, while a nonvisual host projection keeps
summary/export consumers independent of hidden DOM.

Opening the bottom-drawer shell is presentation-only. Console, Extensions,
Code Inspector, and Second Window may open an otherwise empty drawer without
constructing xterm, connecting `/terminal`, or creating a PTY. Terminal runtime
initialization occurs only when the Terminal tab or an explicit terminal command
is selected.

### Desktop shell behavior

- Native Quit validates the current `/app/<app_id>` URL, posts only that app's quit endpoint, and returns to the desktop launcher without terminating Electron.
- The native context menu contains only Copy and Paste and invokes the focused renderer's native commands directly.
- Offline framework state leaves the app view intact and exposes a native-header route back to the local launcher. Recovery clears that control without restarting Electron.
- Electron modal/dialog windows use the shared modal presenter and retain parent-modal ownership without global always-on-top behavior.

Validation owner docs live in `desktop_client/desktop_client.md` and `desktop_client/electron/README.md`.

---

## 39) WBA Logical Documents And Multi-File Extension Handling

Code TE2 now separates each client's visible editor from semantic working-set
hydration. Every stable client renders at most one foreground Monaco model per
editor surface, while WBA retains one shared extension-host document per URI and
one synthetic editor facade per `clientInstanceId`. Multiple Electron and mobile
surfaces may therefore point at the same URI without duplicating the logical
document or stealing one another's active editor identity.

Host file-open intent does not preflight a boot snapshot. The frontend may use its last projected project root only to form a tentative path, then sends the request directly to Python; the backend's canonical returned path drives visible-open acknowledgement and editor connection for the originating client. A failed host-state refresh preserves the last valid frontend projection. Lightweight `scope: hostState` refreshes are single-flight in the frontend, while complete backend boot snapshots share only their disk-heavy core assembly across concurrent clients and materialize each requesting client's exact editor SSOT off-loop before returning. Initial UI IPC connection does not trigger a duplicate resync; only a genuine reconnect requests fresh host state.

### Authority split

- `ProjectSidecar` recents provide the shared bounded admitted/open set.
- `open_state_backend.py` and bounded `ProjectSidecar.client_foregrounds` provide one reconnectable foreground per stable `clientInstanceId`; legacy `last_file` is migration seed only.
- Each foreground entry retains its authenticated `primary` or `secondary` client role. Removing a shared document commits membership and all affected foreground transitions atomically, then publishes one `DocumentClosed` fact: affected primary clients move to shared MRU, affected secondary clients clear, and exact-client editor SSOT replaces or disposes their Monaco model.
- Shared open-state projections carry membership only and never dispose or clear a client's Monaco model. Exact-client SSOT and file-open notifications own visible model creation and replacement.
- `ProjectSidecar.document_state_revision` plus its bounded 256-entry `document_revisions` map order path-scoped content state. Evicted paths fall back to the global watermark, so pruning cannot lower their next revision.
- Python owns sidecar-to-WBA projection in `logical_document_reconciler.py`.
- WBA owns extension-host document lifetime in `workbench_protocol_proxy/node_workbench_adapter/src/workspace/document-registry.ts`.
- WBA retains one shared, role-neutral logical document registry and extension host while projecting one synthetic editor facade per stable client. `windowId` remains metadata; Electron's secondary editor follows this rule by allocating an explicit second stable client rather than inferring authority from a window.
- Client-sensitive extension commands, menus, editor state, and navigation pass through one fair bounded operation gate. Ordinary concurrency is FIFO even for the same client. Only an in-process operation token or an exact registered `requestId`/`operationId` round trip may reenter the owner; client-id equality alone is never reentrancy authority. A bounded lease or reset rejects the owner and queued callers so one stalled operation cannot poison every later client.
- The direct WBA Socket.IO boundary authenticates and injects `clientInstanceId` plus metadata-only `windowId`. The worker editor and UI IPC lanes additionally carry the authenticated client role; WBA does not infer that role from a window. Request normalization must preserve the WBA identity through `vscode.openFile` into `WorkbenchClient.openFile`; otherwise the client facade cannot acknowledge the active document, leaving hover and semantic-token requests blocked even though shared extension-host diagnostic pushes can still arrive.
- Draft-aware materialization is centralized in `monaco_editor/editor_backend_services/document_materialization_service.py`.

### Metadata-first reconcile

`logical_document_reconciler.py` builds a metadata-only snapshot:

- `projectPath`
- `projectGeneration`
- `openStateRevision`
- `activePath`
- bounded `background` descriptors

Background descriptors carry only identity first: path, `contentIdentity`, `baseSha256`, and dirty state. For unsaved drafts, identity is the draft content SHA. For clean files, identity is a stat tuple. This lets WBA decide what it already has without Python materializing every background file.

WBA exposes two stdio JSON-RPC methods through the existing adapter control plane:

| Method | Purpose |
|---|---|
| `vscode.logicalDocuments.reconcile` | Accept sidecar metadata and return only missing or content-stale hydration requests. |
| `vscode.logicalDocuments.hydrate` | Accept exact materialized text for one requested background document. |

Hydration carries exact content, language, content/base identities, dirty state, and reconcile-time active epoch. Stale project generations, open-state revisions, active epochs, and active-document replacement are rejected.

Before WBA reconciles that Python snapshot, `WorkbenchClient` injects the exact
union of every retained client facade path and every in-flight open. Those paths
are protected from hydration replacement and release even though Python's
metadata snapshot intentionally has no global active path.

### Document and editor lifetime

The document registry has no global `active`, `background`, or provisional role.
It owns one shared document entry per canonical path. Client foreground is a
separate reference set derived from the synthetic editor-facade map plus
in-flight opens. A new client opening an already-retained URI gets a distinct
editor id while reusing the same extension-host document; switching one client
removes and replaces only that client's prior editor facade.

The shared document entry owns content, language, document version, and
extension-host lifetime, but it does not own a frontend open generation. Each
client editor facade owns its own current generation. Every document-backed
activation, provider request, and `didChange` therefore enters the fair
exact-client projection gate with the authenticated `clientInstanceId` before
consulting that facade. This prevents one client's newer generation from making
another client's valid edits or intelligence requests look stale when both
surfaces display the same URI.

A normal client tab switch therefore does not duplicate `addedDocuments` or
cause LSP close/open churn. Logical reconciliation releases a document only when
it is absent from the shared desired set and from every client/open reference.
Workspace switches release all retained documents and editor facades.
Extension-host reset clears WBA-local registry, facade, correlation, and gate
state.

After a client foreground open, WBA publishes `document/activeChanged` with that
client identity over the existing framework-shell pipe so Python schedules
latest-wins reconciliation. Draft changes, workspace-file changes,
adapter-ready/reset, and project-switch facts also drive reconciliation. There
is no timer, polling path, new socket, or Python editor-intelligence hop.

### Foreground transaction and reconnect boundaries

A foreground switch first creates and attaches the replacement Monaco model,
then disposes the detached previous model. After the expected URI is visibly
attached, the transaction invokes one canonical `openFileFlow`; visible
`editor.openComplete.publish` remains independent of that WBA promise.

`editor.modelReady` is only a frontend-to-Python lifecycle notification. It
does not flush a WBA open or replay providers. A genuine direct-WBA Socket.IO
connection calls `te2.resync`, then flushes the active model and hydrates the
provider snapshot. This keeps late/reconnected clients complete without making
ordinary file switches replay workspace, provider, and webview state.

WBA treats a same-client, same-path open with the same non-null generation as an
idempotent duplicate. It does not reread disk, replace text, clear dirty state,
advance the document version or mutation epoch, emit another active-document
event, or invalidate prewarmed semantic tokens. A newer generation remains a
real facade refresh and retains the draft-safe full-text synchronization path.
An A -> other file -> A reopen therefore replays A's facade and current
generation even when another client still retains A's shared document. If the
full text is byte-identical, this replay does not fabricate an edit, duplicate
the extension-host document, advance its version, or cause LSP close/open churn.

### Extension activation and language resolution

WBA extension activation is extension-agnostic:

- `extensions/activation-events.ts` derives declared activation events and Code OSS implicit activation events from each executable extension manifest's `contributes` map.
- Missing or `plaintext` document language IDs are resolved from extension-contributed filenames, extensions, filename patterns, and first-line expressions.
- File open starts non-blocking language activation.
- Language-provider RPCs await both `onLanguage:<id>` and generic `onLanguage`
  before dispatch. Code Server activates every matching extension for those
  events; WBA does not choose one activation candidate.
- Provider selection is a separate document-scoped step. WBA matches every
  registered selector against the exact language, scheme, authority, and path,
  then aggregates all matching providers. This includes valid pattern-only
  selectors without a `language` field, such as HTML-to-CSS completion
  providers registered for `**/*.{css,scss,less,sass,styl}`.
- Extension-host `workspace.findFiles` calls are handled generically through
  `$startFileSearch`. WBA searches the requested relative root or active
  workspace, honors explicit include/exclude glob patterns and `maxResults`,
  and returns remote-workspace URI components. This scan is part of provider
  initialization for extensions that derive completion state from other files;
  returning a fabricated empty result activates the extension but leaves its
  provider semantically empty.
- Missing background documents must be published before `onLanguage` activation so newly-started language clients discover the complete open set.

The visible frontend open path does not wait for WBA background hydration. `editor.openComplete.publish` is the control-plane acknowledgement that visible open completed; WBA and agent hydration remain outside that critical path.

---

## 40) Code Inspector And Navigation

Code Inspector is a backend-retained bottom-drawer projection for References, Implementations, and Call Hierarchy. It is not a direct frontend-to-frontend channel and does not add a new socket or HTTP endpoint.

### Flow

```text
editor context action
  -> direct /wba request
  -> WBA provider dispatch and normalization
  -> editor publishes normalized projection through /rpc/editor
  -> Python retains revision-guarded projection
  -> worker event bus publishes CodeInspectorChanged
  -> /ui_ipc projects host bottom-drawer state
```

Key backend files:

- `code_inspector_backend.py`
- `code_inspector_projection.py`
- `code_inspector_events.py`
- `monaco_editor/editor_code_inspector_runtime.ts`
- `workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/code-navigation.ts`

WBA performs Code OSS document-selector scoring/order, semantic provider dispatch, reference/implementation merge-sort-deduplication, and lazy call-hierarchy session management. Reference and implementation locations are enriched with source previews capped at 240 characters; preview reads are deduplicated per file with bounded concurrency. The editor replaces the active file preview from Monaco's live model so unsaved text remains authoritative.

Lazy call-hierarchy expansion and release return through backend-mediated editor commands. Browser reload does not release a WBA call-hierarchy session; project switch, adapter reset, replacement, or worker teardown invalidates it.

Go to Definition is intentionally separate from the retained Code Inspector drawer mode. It is a direct editor-to-WBA action that invokes selector-ordered definition providers, returns the first canonical target, and navigates through backend-owned `editor.open` with `focus: false` and centered reveal.

---

## 41) Code-Server Installer

The private Code Server installer is pinned to Code Server 4.130.0 and serialized by a cache-scoped filesystem lock. Startup and readiness inspection must not download or mutate anything; installation only runs after the frontend obtains user confirmation through the existing UI IPC path.

### Linux

Linux uses the official standalone Code Server installer:

- `code_server_bootstrap.py` downloads `https://code-server.dev/install.sh` with a bounded 1 MiB script limit.
- The installer runs with `--method=standalone`, `--prefix=<stage>`, and `--version 4.130.0`.
- Installation happens in a staged TE2 data prefix, then atomically activates the staged prefix.
- The official installer emits an absolute launcher symlink into the staging prefix. TE2 verifies that the target remains inside the staged tree and rewrites it as a relative in-prefix symlink before activation.
- Prefixes created by the former broken relocation are repaired without downloading the payload again when possible.
- Managed-runtime resolution checks the exact private `lib/code-server-4.130.0/lib/vscode` tree. It does not walk launcher parents to `/lib`, where a system Code Server installation could otherwise be mistaken for the private runtime's bundled workbench.

### Termux / Android aarch64

Termux uses a TE2-published package instead of the official installer:

- Installs only the package's declared runtime dependencies with `apt`.
- Downloads the TE2 `0.2.327` `code-server_4.130.0_aarch64.deb` release asset.
- Verifies the published SHA-256 before extraction.
- Manually extracts `lib/code-server` into the staged TE2 prefix.
- Creates a private relocatable shell launcher under the TE2-managed prefix.
- Resolver discovery recognizes that launcher's adjacent `lib/code-server/lib/vscode` tree directly rather than evaluating its shell-local `$ROOT`; existing managed prefixes do not require reinstallation.

The bootstrap does not register the Code Server package with `apt` and does not vendor the 709 MiB Code Server tree in the repository.

The managed executable and its mutable user state have separate ownership:

- the pinned executable remains under `$TE2_DATA_HOME/code_server/4.130.0`;
- Code TE2 owns private code-server user data, installed extensions, extension
  registry, and generated User settings beneath
  `$TE2_DATA_HOME/code_te2/code_server`;
- the code-server Unix socket is
  `$TE2_RUNTIME_HOME/code_te2/code_server.sock`;
- WBA receives the exact extension manifest, User settings, and generated RPC
  configuration paths through its Framework-Shell environment; it never probes
  the user's global `~/.config/code-server`; and
- generated probe records stay beneath `$TE2_CACHE_HOME/code_server/probes`.

Extension install and uninstall commands receive both the private
`--user-data-dir` and `--extensions-dir`. Existing global code-server data is
left untouched and is not imported during startup.

### Open VSX marketplace installs

Open VSX search and detail views use the public metadata API, but marketplace installation does not delegate extension selection to Code Server's gallery client. TE2 resolves the requested extension and exact version from Open VSX metadata, validates that the artifact and digest URLs belong to the same namespace/name/version under the Open VSX API, and accepts only the corresponding identity-preserving redirect through the Open VSX Eclipse content CDN.

The VSIX and published SHA-256 are downloaded with explicit byte limits. The artifact is streamed to a temporary file, verified before use, and removed on success or failure. TE2 then invokes the existing managed-runtime local-VSIX install path with the private `--user-data-dir` and `--extensions-dir`, and verifies that the expected extension id is present after installation.

This artifact-driven path is required on Termux because Node reports the Android platform and Code Server consequently classifies the gallery target as web. Its gallery client filters out workspace-only extensions before installation even when the extension's Linux/server process is usable on Termux or configurable to use a Termux `apt` language server. TE2 therefore does not hard-code language or extension exceptions and does not fall back to `publisher.name@version` gallery installation.

---

## 42) Android Cefrium Client

The isolated `:cefrium` Android application module evaluates Cefrium 0.7.1 while reusing the shared Android source and packaged assets. GeckoView in `android/app` remains the primary Android renderer.

### Module boundary

The Cefrium module is intentionally isolated:

- `:cefrium` owns its activity, layout, manifest, and Cefrium-specific local
  relay routing; its process-local `PersistentNetworkService` owns the
  `AndroidFrameworkRelay` lifecycle.
- It applies the `com.cefrium` Gradle plugin only inside the Cefrium module.
- The plugin must not be applied to Gecko variants because it generates Chromium resource classes and carries the large CEF runtime.
- The module shares the packaged asset model and common Android source, but remains an evaluation path until the primary-renderer decision changes.
- Keep at least 2 GB free before Android builds.

### Runtime behavior

Cefrium always loads TE2 through one dynamically allocated `127.0.0.1` relay origin owned by the shared `AndroidFrameworkRelay`, even when a configured framework host is reachable directly.

The relay behavior is:

- `/android-shell` and `/android-api` are handled locally.
- Declared installed editor assets are served locally.
- Other HTTP and SSE traffic streams to the configured TE2 target.
- WebSocket upgrades tunnel byte-for-byte to TE2.
- Changing the framework address retargets the relay without changing the browser origin; existing connections close so Socket.IO and other clients reconnect against the new target.
- Redirects pointing back to the configured TE2 origin are rewritten to the relay origin.

Only paths declared by Cefrium asset routing are served from installed assets. Dynamic API, Socket.IO, terminal, and app-worker traffic pass through the relay.

The activity provides shared launcher and Settings behavior, native controls, app-scoped quit, native context menus, trusted-localhost clipboard permission, file-picker forwarding, renderer recovery, lifecycle pause/resume, native diagnostics, and TE2 console access.

Native app URLs retain `gv_native=1` for the established app-shell contract and add exact `te2_renderer=gecko|cefrium` identity. Code TE2 resolves Electron first, then the explicit Android renderer. A missing renderer on an established `gv_native=1` URL is legacy Gecko compatibility for APKs receiving newer OTA frontend assets; an unknown explicit renderer still fails instead of falling back to browser-local identity. Cefrium uses an exact-relay-origin `cefriumQuery` handler for stable installation identity and Run Profile surface registration, so it never waits for Gecko's WebExtension bridge. The app shell persists and forwards valid explicit renderer identity across its own navigation.

Cefrium shares Android-owned Tools state and remote-app health semantics. The selected tab persists, but overlay visibility is scoped to the current native app-header session and each newly appearing header starts with Tools closed. Console and a persistent Processes browser are supported, with Processes loaded from the relay's `/fws` route. Missing-worker or terminal-readiness snapshots must occur three consecutive times before returning to the launcher. Unreachable or invalid health responses preserve the current app and reset the failure sequence.

The high-level Cefrium wrapper does not expose CDP, but its bundled Chromium runtime includes an application-private `DevToolsServer`. Cefrium relays that abstract-domain socket through a dynamically allocated loopback-only listener, uses one browser control channel for event-driven page-target discovery, and attaches the selected target with a flattened CDP session. Kotlin owns the target picker and persists selection; a separate persistent Cefrium browser hosts the packaged Inspector frontend and exchanges raw protocol messages only through its exact local-asset `cefriumQuery` bridge. Framework Socket.IO and UI IPC are not CDP transports. Code TE2 Sidebar iframes remain frames/execution contexts under their owning page target rather than becoming a second `surfaceId`-based target authority.

One Cefrium Inspector session is owned by each appearance of the native app-shell header. After the main browser completes a real framework-relay app document load, the CDP runtime and persistent Inspector browser start in the background even while Tools is closed or another Tools tab is selected. The first gear open force-reselects the first available target exactly once, including selecting an already-active sole target; if no target exists yet, the one-shot waits for target discovery. This deliberately exercises the same CDP detach/attach or frame-generation reset path as a manual target switch. Overlay close, Tools-tab changes, and app backgrounding retain the runtime/browser. Returning to the launcher, disabling Inspector, Activity destruction, or otherwise removing the app header closes the runtime/browser/targets and resets the one-shot state. The Inspector document's `client_ready` query remains the only document-readiness authority, and browser-wide child-frame loading callbacks must not clear established readiness or delivered target generation.

Cefrium still retains validated Run Profile `devRuntime` registrations by exact `surfaceId`, but reports `cachePolicy=false` and `consoleInjection=false`: Run Target listeners bypass `AndroidFrameworkRelay`, and the Cefrium API cannot mutate response headers or inject into an exact cross-origin child frame. Do not add a partial raw-HTTP parser to the byte-for-byte Run Target relay. Browser-wide Inspector ownership is independent of this instrumentation gap.

Cefrium's wrapper also omits Chromium's selection ActionMode host callback. A narrow same-package `WebContents` shim installs an application callback that delegates to Chromium's `ActionModeCallbackHelper` and enables Chromium's SurfaceControl magnifier. Native Cut/Copy/Paste/Select All and related selection actions remain Chromium-owned and do not use JavaScript editing commands.

After each completed document load, an idempotent page policy wraps Monaco's exact `textarea.inputarea.android-ime-input` focus path and forces `preventScroll: true`. It patches the top realm plus every existing and future same-origin iframe realm, which gives the retained mobile secondary editor the same correction without crossing an origin boundary. Code TE2 additionally marks the editor frame from the explicit native renderer query and applies a Cefrium-only 16 px font size to both the Monaco Find/Replace textarea and the exact editor IME textarea. The native viewport is already locked against page zoom; this renderer-scoped floor prevents Chromium's focused-editable readability zoom when Monaco's hidden input would otherwise inherit its 10 px size, without changing Gecko, desktop, or ordinary editor input styling. Do not replace either correction with a broad page-wide input workaround.

On Android 11/API 30 and newer, Cefrium observes root `WindowInsets.Type.ime()`
animation state. `onPrepare` records the pre-layout visibility and `onStart`
reads the applied end state before the first animated frame is drawn; only a
real `visible -> hidden` animation dispatches. `onEnd` reconciles final
visibility and covers Android's documented cancelled-before-`onStart` case.
The reducer emits at most once per visible epoch and requires exact UI IPC
editor ownership, a resumed/focused app page, and hidden native Tools chrome.
Aggregate browser/subframe loading is not a lifecycle reset or readiness gate.

The native client dispatches one event into the deepest focused same-origin
document. Code TE2 transfers DOM focus from Monaco's exact Android textarea to
the real File toolbar button with `preventScroll`; one next-animation-frame
reconciliation repeats that transfer only if Chromium retained/reclaimed the
textarea during IME teardown. Cefrium's UI IPC callback updates only native
ownership/filter state: it never calls `restartInput` or `showSoftInput`.
This is the inverse of GeckoView's explicit keyboard recovery: a later direct
Monaco tap follows Chromium's ordinary focus path and summons the IME again.
Initial/repeated hidden states, show and visible-to-visible resize animations,
lifecycle transitions, GeckoView, and cross-origin documents do not
participate. There is no IME polling, viewport inference, synthetic click,
native focus sink/query, timer loop, or alternate fallback path.

### Validation

Validate the Cefrium module with:

```bash
./gradlew :cefrium:testDebugUnitTest
./gradlew :cefrium:assembleDebug
```

Keep primary-renderer comparison coverage with:

```bash
./gradlew :app:testGeckoDebugUnitTest
./gradlew :app:assembleGeckoDebug
```

---

## 43) GeckoView Native Inspector Targets

The GeckoView Inspector is a separate persistent `GeckoSession` and
`GeckoView`, not an element injected into the inspected page. Its frontend is
Chii 1.15.5; eligible inspected documents host Chobitsu 1.8.6 as the page-local
CDP target.

The transport is direct WebExtension native messaging:

```text
inspected document Chobitsu
  -> te2_devtools_target native port
  -> GeckoDevToolsInspector Kotlin target registry and CDP broker
  -> te2_devtools_client native port
  -> persistent Inspector GeckoView / Chii frontend
```

There is no Socket.IO, raw WebSocket, framework RPC, shared-memory, or FD
negotiation in this path. The WebExtension content scripts run at document
start in all frames, but `target-config.js` only enables the top-level framework
document and child frames carrying the Sidebar's `te2-devtools:` `window.name`
marker. This keeps ordinary framework and application iframes unmodified.

Kotlin stores live targets by stable target id, renders the authoritative native
target picker above the Inspector `GeckoView`, and attaches the existing bounded
`DevToolsProtocolBroker` only to the selected target. The Inspector document's
HTML selector is hidden and retains target snapshots only for client routing and
debug telemetry; GeckoView HTML selector projection is not part of selection.
The framework page is the initial target. A selected Run Profile iframe retains
its selection while navigation recreates the WebExtension port, so the same id
reattaches without a second transport or framework lifecycle dependency.

The source contract is split across:

- `android/app/src/main/assets/devtools_inspector/` for Chii/Chobitsu assets,
  frame eligibility, and target/client native-port bridges.
- `android/app/src/gecko/java/com/termux/extensions/GeckoDevToolsInspector.kt`
  for the persistent Inspector session, target registry, native picker
  projection, selection, and raw CDP routing.
- `android/app/src/gecko/java/com/termux/extensions/MainActivity.kt` and
  `android/app/src/gecko/res/layout/activity_main.xml` for the native picker
  controls and Inspector surface layout.
- `main_page/frontend/sidebar-shortcuts/devtools-target.ts` for the opt-in
  iframe marker.
- `host/runner_profiles_backend.py` and `ui_ipc/sidebar_window_state.py` for
  backend-owned Run Profile target metadata and sidebar-state projection.

Target registration is readiness-gated rather than inferred from a native-port
connection. `target-loader.js` evaluates Chobitsu and the target runtime in
Firefox's page world, verifies both page globals, and only then allows
`target-native-bridge.js` to emit `target_ready`. The native
`android.devTools.state.get` console command exposes bounded frame probes,
target lifecycle events, the Inspector client's target snapshot, and active
Kotlin selection. Opening the Inspector surface republishes the authoritative
target snapshot so a hidden client cannot retain stale routing state.

Run-target routing is independent of the Inspector CDP broker, WebExtension
messages, and Code TE2 UI IPC. After `AndroidFrameworkRelay` is retargeted,
Kotlin opens the Rust framework's no-store `/api/run-targets/events` stream;
each connection starts with a fresh authoritative owner/shell route snapshot,
and every later event is a complete replacement projection. Kotlin immediately
reconciles every listener group. Local mode requires an explicitly configured loopback
origin; every configured non-loopback host uses remote mode and binds the exact
preferred ports. `BindException` is a collision. Shell route removal tears down
the exact group, and a superseded projection cannot resurrect it.

Native Settings retain the real upstream framework IP/port. Gecko itself loads
framework pages through a process-local `AndroidFrameworkRelay` origin, which
proxies HTTP, SSE, Socket.IO, and WebSocket traffic to that upstream. This keeps
the page in a localhost browser security context without making the Run Target
locality check mistake the browser relay for the framework host. Launcher
app-open responses are rewritten through the relay so `/app/...` navigation
activates the Kotlin replacement header. Cold app restoration occurs only after
the first fresh native route snapshot has reconciled. Gecko restores complete
serialized session state only when the saved random loopback origins still
match; otherwise it loads the saved `/app/<id>` URL through the current relay.
Remote-app health distinguishes transport availability from authoritative app
lifecycle. An unreachable or invalid running-app projection preserves the
current/saved remote app and clears the consecutive authoritative-failure
count; it never sends the user to the launcher. Only a successful projection
that omits the app or reports terminal readiness advances the count, and three
consecutive authoritative failures return home. This policy reuses the existing
health path and adds no retry poller.
There is no route polling; iframe refresh performs no proxy request.
Configured-framework changes and client-runtime service shutdown tear down all
groups; Activity recreation and ordinary backgrounding do not.

## 44) UI VSIX Webviews And Editor Contributions

The first supported UI-extension slice is a workspace-scoped activity-bar webview. The existing extension registry remains install/enablement authority, and the existing User/Workspace configuration projection remains settings authority. In particular, the active project's `.vscode/settings.json` continues to populate WBA's `workspace` and `folders[0]` configuration tiers; webview presentation does not add another settings store or project selector.

WBA discovers `contributes.viewsContainers.activitybar` and matching `contributes.views` records whose type is `webview`. It activates `onView:<viewId>`, retains one logical Sidebar-membership surface per workspace/view, and implements the current Code Server 4.130 `MainThreadWebviews`, `MainThreadWebviewViews`, `ExtHostWebviews`, and `ExtHostWebviewViews` actors. The logical surface is not an extension-host webview instance. WBA resolves one lazy runtime per `(surfaceId, clientInstanceId)`, each with its own Code OSS handle, HTML/options/state, resource capability, transport generation, event journal, and binary-safe bidirectional `postMessage` path.

The browser shape is:

```text
extension host
  <-> WBA Code OSS RPC
  <-> shared logical membership surface
       `- client-scoped runtime handle
          |- strict MessagePack /wba browser control
          |- trusted outer wrapper
          |- sandboxed extension-document iframe
          `- shared capability-scoped local-resource HTTP route
  <-> backend ExtensionWebviewSurface snapshot
  <-> existing Sidebar URL slot
```

The outer wrapper supplies one-shot `acquireVsCodeApi()` with `postMessage`, `setState`, and `getState`. Extension HTML retains its own CSP inside the iframe. WBA rewrites `vscode-resource.vscode-cdn.net` URLs to an unguessable WBA-epoch resource scope keyed by extension identity, workspace, extension location, and normalized `localResourceRoots`. Identical activity-view and panel roots reuse that URL and browser cache, but their document, message, state, visibility, and disposal lifecycles remain separate. The scope is reference-counted by live runtimes and serves a file only while realpath containment succeeds beneath its exact roots; extension location and workspace are the normal defaults. Extension-install resources use private immutable caching bounded by the epoch token, while mutable admitted roots retain weak ETag/Last-Modified revalidation. Text, JavaScript, JSON, and SVG resources use asynchronous Brotli/gzip negotiation so large remote extension bundles do not repeatedly traverse the network uncompressed. The Rust app proxy retains `Content-Encoding` with those unchanged encoded bytes; its reqwest transport does not decode them. Script and form capabilities follow the webview content options.

WBA publishes complete workspace-scoped `ExtensionWebviewSurface` snapshots over its existing Framework-Shell event pipe. Python validates them and projects membership into the Sidebar ledger. Browser and GeckoView use the existing inline URL presentation. Electron creates one framework-partition `WebContentsView` from the extension surface's first embedded presentation, positions it over a DOM-owned Sidebar placeholder, and retains that renderer while the surface is embedded, hidden, or detached. Activity-view Close changes only that client's presentation to `hidden`; WBA membership survives, and the contributed extension icon remains in the Extension Views app-drawer section for reopening. Provider/workspace/WBA lifecycle removal remains authoritative. Ordinary user URL slots retain destructive close behavior and the existing URL-reconstruction detach path.

Provider activation and shared membership discovery do not call `$resolveWebviewView`. The first attach from a stable client creates that client's runtime and only then asks the provider to resolve it, so an extension's startup watchdog cannot begin while no renderer exists. A resolve failure disposes only that client runtime and cannot replace another client's HTML with its error page or remove the shared launcher membership. Events carry the exact `clientInstanceId`, and wrappers ignore events for other clients. A presentation reconnect reuses its warm runtime for the WBA/workspace lifetime.

Workspace switch disposes every old client runtime before creating membership for the new workspace. Provider registrations survive that switch because the extension host survives; full WBA reset, provider unregister, and stale/empty snapshots remove membership and every associated runtime. A browser presentation disconnect does not dispose its provider runtime. Secondary-Sidebar views, custom editors, and chat-session APIs remain deferred. Multiple Codex conversations still require the extension's panel/custom-editor identities; multiple client handles for the single activity view do not manufacture conversation surfaces.

Ordinary extension webview panels use the same secure document runtime but have a distinct lifecycle. WBA implements the Code Server 4.130 `MainThreadWebviewPanels` and `ExtHostWebviewPanels` actors, retains panel title/icon/column/context-retention metadata, publishes each panel as temporary Sidebar membership, and reports view-state changes to the extension host. Panel Close crosses the host UI IPC lane into WBA and truly disposes the extension-host panel; it never reuses the activity-view hidden state.

Code Server's management scan remains extension-admission authority, but its
DTOs are not assumed to retain every manifest contribution. WBA overlays
manifest-owned fields from the canonical private `extensions.json` package only
for matching, already-admitted non-builtin extension ids. Management-owned
runtime identity/location data wins, and disk-only or management-rejected
extensions are not added. This prevents a partial scan DTO from silently
dropping commands such as Codex's `chatgpt.addToThread` while preserving Code
Server's enablement and compatibility decisions.

The bounded contributed-command slice reads `contributes.commands` plus `editor/title`, `editor/context`, `editor/title/context`, `explorer/context`, and `webview/context` menus. WBA retains command icons, group/order, enablement, alternate-command, and extension-defined `setContext` state, evaluates the implemented `when` forms, activates `onCommand:<id>`, and invokes the registered command through `ExtHostCommands`. Unprojected positive context keys evaluate false rather than becoming truthy string literals; unquoted right-hand comparison literals such as `.json` remain supported. This suppresses built-in Debug Pretty Print and Copilot accept/reject editor-title actions until TE2 projects their real debug or active-diff context and supports the corresponding editor semantics. The suppression is eligibility-based, not a command-id/title blacklist. The editor resolves and executes eligible commands over its existing strict MessagePack WBA lane: icon-bearing navigation commands render in the horizontally scrollable `.fe-toolbar` extension-action strip. The touch surface installs one stable Extension Context launcher synchronously, then resolves `editor/title/context` and `editor/context` from the current file and selection each time it opens; asynchronous WBA results are never frozen at Monaco construction time. The Explorer resolves and executes its Extension Context submenu only through `/rpc/explorer` and Python; the backend verifies the clicked and selected resources against the active project before WBA evaluates or invokes the contribution. For `webview/context`, the inner opaque document forwards only bounded primitive `data-vscode-context` values and pointer metadata to the trusted wrapper. The wrapper supplies the authoritative surface `webviewId`, resolves the menu over strict MessagePack, renders the popup above the sandbox, and invokes the command without pretending it is an editor-selection action. The strip uses native horizontal touch panning and maps mouse-wheel input to horizontal movement without moving its fixed Run/Stop/status siblings. Resolution is event-driven on model, menu open, and WBA reconnect; there is no selection polling. `MainThreadMessageService` maps extension information/warning/error requests to the existing editor notification UI. WBA's `workspaceContains` activation matching uses the vendored `picomatch` implementation, including brace expressions.

Active Monaco cursor and selection state is also an event-driven extension-host
projection independent of command invocation. The editor coalesces rapid
selection changes to at most one direct strict-MessagePack WBA notification per
16 ms. WBA accepts only the current active path/editor and forwards the exact
selection plus Code OSS source kind through
`ExtHostEditors.$acceptEditorPropertiesChanged`; this updates
`window.activeTextEditor.selection` and fires
`window.onDidChangeTextEditorSelection` in extensions such as Code Visualizer.
Notifications are volatile while disconnected. The authoritative recovery is
one exact resynchronization after WBA acknowledges opening the active document;
there is no polling or reconnect-era notification replay. Command invocation
still performs its own exact selection synchronization as the final execution
barrier.

Extension-requested navigation uses the bounded Code Server 4.130
`MainThreadTextEditors` actor and the internal `_workbench.open` command. WBA
emits one correlated backend request; Python routes it through Code TE2's
canonical project-contained open action and waits for Monaco's existing
`editor.openComplete.publish` acknowledgement before WBA returns the logical
editor id. Supported follow-up selection, reveal, and focus operations cross
the direct strict-MessagePack editor/WBA lane and use public Monaco APIs.
Unsupported editor mutation and hide calls fail explicitly rather than
reporting empty success. Workspace replacement cancels pending navigation and
clears extension context state; no part of this protocol polls.

The current command surface remains smaller than the complete Code OSS menu
service. Extension-view context and `view/title` placement, targeted initial
panel reveal, generic diff surfaces, custom editors, and arbitrary editor
mutation remain deferred.

The first acceptance fixture is `openai.chatgpt_26.5803.41515.vsix`, using `chatgpt.sidebarView`.

The inner document intentionally keeps an opaque sandbox origin. Host messages are re-emitted with `window.location.origin` so origin-validating extension runtimes receive the native webview event shape. Because opaque origins cannot access browser Web Storage, the injected API supplies synchronous `localStorage` and `sessionStorage` adapters without adding `allow-same-origin` or exposing the framework DOM.

Destroyed webview documents reconstruct from a client-partitioned opaque record,
not from shared Sidebar membership or extension content state. The stable
`surfaceId` remains WBA's logical workspace/view identity. The main page adds a
stable `clientInstanceId`, a reload-stable per-window `windowId`, and a renderer
`presentationId`. Browser profiles store the client identity in
`localStorage`; Electron stores it beneath `$TE2_CONFIG_HOME`; GeckoView projects
its existing application-private installation id through the always-on
asset-intercept WebExtension. Editor Settings displays and copies the identity;
reset is confirmation-gated and removes only that client's records before the
native/browser identity changes and the page reloads.

The trusted wrapper authenticates its own strict-MessagePack `/wba` Socket.IO
connection with that exact `clientInstanceId` and `windowId`; identity in the
wrapper document URL is not inherited by the nested Socket.IO handshake. A
missing window identity may be generated only in canonical
`window_<lowercase-alphanumeric>` form and retained for that page session, while
an explicitly supplied malformed identity fails closed. Inline, hidden, and
Electron-detached presentations therefore retain the same authenticated client
runtime instead of falling into `invalid_client_presentation_identity`.

WBA stores bounded reconstruction records beneath
`$TE2_DATA_HOME/code_te2/code_server/User/te2-webview-reconstruction`, keyed by
the hashes of `(clientInstanceId, surfaceId)`. Each attach atomically issues a
new writer lease and a one-time document bootstrap token. The trusted wrapper
uses that token to inject the last accepted `acquireVsCodeApi()` state and
persistent Web Storage entries before the first extension-authored script can
run. Writes require the current lease and a strictly newer revision, so a
destroyed inline or detached renderer cannot overwrite its replacement. Other
clients remain isolated while the extension host's semantic workspace/content
state stays shared. `windowId` and `presentationId` are routing/observability
metadata, not persistence keys. Electron extension surfaces keep one deterministic
client/surface presentation id while their live `WebContentsView` moves between
embedded and detached parents; Browser and Gecko presentations remain transient
when their renderer is reconstructed. There is no state polling or `allow-same-origin`
fallback.

Extension-document lifetime is independent of the wrapper's WBA Socket.IO
connection. The WBA process owns a random epoch, each client-scoped activity
runtime owns a generation and monotonically increasing event sequence, and each
HTML/options replacement advances that runtime's `htmlRevision`. On the first
token-backed load, WBA also returns the retained `message` suffix after the
current HTML revision's last authoritative reload event. The wrapper queues
that bounded startup suffix until the inner document reports ready; if the
revision boundary has fallen out of the journal, it reports an incomplete
bootstrap instead of replaying an arbitrary partial suffix. After the initial load, the
wrapper reports those four facts plus its last applied event sequence on every
reconnect. WBA answers with an explicit `resume`, bounded `replay`, or `reload`
decision. A valid resume or replay leaves the existing iframe, DOM, JavaScript
heap, and scroll/selection state alive; only an epoch/generation/revision change,
event-journal gap, or authoritative reload/dispose crosses the reconstruction
boundary. Per-surface event retention is bounded to 256 events and 2 MiB.
The generic Sidebar shortcut version never treats an `ExtensionWebviewSurface`
HTML revision as an outer-wrapper reload request: the trusted wrapper remains
stable while WBA reconstructs only its sandboxed extension document. Ordinary
URL slots retain their version-triggered wrapper reload.
Within the current WBA epoch and surface generation, the wrapper discards a
buffered event whose sequence is already covered by the latest attach before
comparing its HTML revision. A temporary loading document followed immediately
by final HTML therefore causes one final reconstruction rather than repeatedly
reconciling the stale temporary revision.

Interactive browser RPCs are never a reconnect queue. A disconnect rejects all
pending calls and clears Socket.IO's client send buffer, so a message that may
already have executed is not replayed. Reconstruction state is deliberately
different: the wrapper retains the newest local VS Code API/Web Storage
projection, renews its writer lease during resume, and coalesces one newer write
after reconnect. The lease/revision fence rejects the replaced presentation.
The protocol remains strict MessagePack and fully event-driven; raw WebSocket is
deferred unless live Socket.IO acceptance proves its heartbeat or delivery
behavior nondeterministic.

Extension-context Mementos are a separate WBA main-thread contract. WBA implements Code Server 4.130's `MainThreadStorage` actor: `$initializeExtensionStorage` returns the last persisted raw JSON value and `$setValue` serializes an atomic replacement beneath `$TE2_DATA_HOME/code_te2/code_server/User/te2-extension-storage`. Global state is keyed by canonical extension id; workspace state is additionally partitioned by the resolved active-workspace identity. The exact root is resolved by Python and passed through the Framework-Shell environment, so Node does not independently resolve TE2/XDG roots. `$registerExtensionStorageKeysToSync` intentionally retains data locally because TE2 does not currently implement VS Code Settings Sync. This store is neither extension settings authority nor webview presentation state.

The current extension-webview theme contract is intentionally fixed rather than coupled to Monaco's selectable editor theme. WBA requires the packaged `monaco_editor/themes/vendored/github/dark-default.json`, projects its string color entries with Code Server's `--vscode-<color-id>` naming, and decorates the extension body with the `vscode-dark` class and VS Code theme data attributes before extension scripts run. The trusted wrapper uses the same GitHub Dark Default Sidebar background. Missing or mismatched theme assets fail WBA initialization; WBA-provided dynamic themes remain deferred.

Python reconciles each complete WBA extension-surface snapshot as one idempotent Sidebar ledger transaction. It removes stale project surfaces, upserts changed members, writes preferences at most once, and publishes one membership update only when material state changed. Identical snapshots do not advance slot timestamps or rewrite preferences.

---

## 45) Sidebar Membership And Host Presentation Ownership

Sidebar state deliberately has two authorities. The shared backend ledger owns
which surfaces exist; every client host owns how those surfaces are presented.
This separation prevents a browser, Electron, GeckoView, or Cefrium renderer
from overwriting another renderer's local dock order or foreground choice.

### Shared membership ledger

Ledger v2 persists only stable slot identity, membership, lifecycle/readiness,
and surface metadata. It does not persist dock order and it has no global-active
Sidebar surface. A complete membership snapshot deterministically removes
missing slots, preserves valid identities, and publishes only a material change.
An unchanged snapshot must not rewrite preferences or advance slot timestamps.

The backend remains the authority for lifecycle removal. An ordinary user URL
slot has destructive Close semantics. An activity-bar extension webview instead
changes only the current client's presentation to `hidden`; its WBA membership
and Extension Views drawer entry remain available for reopening. See §44 for
the extension-webview runtime and lifetime rules.

### Per-host presentation

Each host stores versioned local presentation state: dock order, foreground host,
stable last-agent host, and embedded/hidden/detached mode. It is partitioned by
the selected framework origin plus normalized project path and retains a bounded
most-recent project map. Browser, GeckoView, and Cefrium use origin-local
storage. Electron uses its validated preload/main bridge and atomic XDG-config
storage. Only an authoritative complete membership snapshot prunes absent
slots; transient WBA reset/disconnect snapshots preserve ledger membership and
parked client preferences while the adapter rehydrates. Authoritative
reconciliation preserves surviving local order, appends new slots, and chooses
a local fallback foreground.

`clientInstanceId` is the stable client authority. `windowId` is reload-stable
metadata and `presentationId` identifies a transient inline/detached incarnation.
Neither is shared Sidebar membership authority, and `presentationId` is never
durable state. A re-created host must publish its fresh presentation identity
before exact-client mention routing may succeed. Canonical legacy slot and
presentation identities migrate once; canonical records win collisions.

### Exact-client Sidebar mentions

An agent/Sidebar mention carries the originating `clientInstanceId`, stable
agent host id, and current `presentationId`. The host republishes that ephemeral
tuple when its iframe is created/replaced and after Sidebar IPC registration.
Python derives the client from its connection and validates the tuple against
the live host, ledger membership, agent conversation, and registered app peer.
It derives conversation identity from the ledger slot and emits only to that
app room. A missing or stale tuple fails closed: there is no global-active or
broadcast fallback.

### Lane boundary

Presentation actions follow the normal Code TE2 rule: frontend -> own backend
-> target backend hook -> target notification. Do not connect frontend lanes
directly or use Sidebar state as cross-client editor/document authority. The
general UI IPC contract is §21; WBA extension-surface reconciliation is §44.
