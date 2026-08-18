# CODE_TE2 (Monaco Editor) — End‑to‑End Reference

This document describes the **current** Code TE2 editor surface used by `code_te2` inside TE2:

- **Monaco is mounted inline in the host page** served by the **app worker**.
- The live editor path now spans **multiple logical Socket.IO namespaces** with different owners: worker-owned SSOT lanes, backend-owned relay lanes, and the direct WBA editor lane.
- Document content, drafts, and preferences are governed by SSOT (`_history_store` / project sidecar, `_preferences_store`).

This is intentionally written as a wiring and ownership reference: what runs where, what talks over which lane, and which sections are authoritative for the current live stack.

## How To Read This Doc

- The sections from **Current Architecture** through **4) SSOT (HistoryStore / PreferencesStore) model** are the authoritative current-state summary for the live direct-WBA editor path.
- The deeper sections after that remain useful operational reference, but some were written across earlier migration stages. If a lower section conflicts with the current-state summary, trust the code and `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.
- This document is the **current wiring reference**. The remaining refactor direction lives in `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.

---

## Current Architecture

This is the live operating model today:
- TE2 remains the **only** authority for edit/save/draft/autosave/versioning (SSOT).
- `code-server` owns extension execution and the remote VS Code extension host.
- The Node **workbench adapter** owns the VS Code protocol boundary.
- The **inline editor runtime** is the only frontend that talks directly to the WBA for language intelligence.
- The **host page** and **Explorer** remain backend-owned surfaces; they do not need editor-grade latency.

Cross references:
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`
- `docs/planning/FILE_EDITOR_CM6_DIAGNOSTICS_PROJECTION_DEBOUNCE_IDEA.md`
- `docs/planning/FILE_EDITOR_CM6_WBA_ACK_AND_DECOMPOSITION_AUDIT.md`
- `docs/planning/FILE_EDITOR_CM6_EDITOR_DIAGNOSTICS_SIDEBAND_AND_WBA_WS_PLAN.md`

### Current milestone (direct WBA editor intelligence + live diagnostics)
Status: implemented and working for the active built-in language lane.

Current facts:
- `code-server` runs as a **pipe-backend** framework shell on a **Unix domain socket**, currently `~/.config/code-server/code-server.sock`, using `--socket` and `--socket-mode 0600`. Stdout is still used by Python for readiness detection (`HTTP server listening`).
- The Node **workbench adapter** runs as a **pipe-backend** framework shell. Its backend-owned control plane still uses **stdio JSON-RPC** (`adapter_rpc(...)`) for lifecycle and control operations.
- The inline editor runtime language-intelligence hot path is now **direct `/wba` Socket.IO JSON-RPC**, not `editor_workbench_*` through `editor_ws.py`.
- The host page remains **WBA-blind**. It gets boot snapshot and adapter readiness from backend-owned `/ui_ipc` flows.
- Explorer/backend still uses the WBA stdio control plane for a few **control-plane** operations such as `adapter.switchWorkspace`, `adapter.resubscribeWatcher`, and editor-backend `te2.resync`. Those are residual control hooks, not the editor hot path.
- Raw editor diagnostics and provider-registration notifications arrive through the WBA editor-facing event stream. `diagnostics_bridge.py` remains relevant for normalized explorer/problems diagnostics, not as the primary editor diagnostics transport.
- The workbench adapter and code-server are still started eagerly at worker boot. Code-server readiness gates adapter startup.
- File watching still relies on code-server's native filesystem/IPC path plus optional watchexec poll fallback. Watcher fanout is owned by `wba_event_bridge.py`, `workspace_events.py`, and Explorer watcher handlers.
- Builtin language extensions are still loaded through the WBA bootstrap/runtime path.

### Current milestone (workbench TextMate runtime on the direct-WBA path)
Status: implemented and user-verified.

Current facts:
- TextMate tokenization now uses vendored `vscode-textmate` and `vscode-oniguruma` from `monaco_editor/editor_textmate_runtime.ts`, not the old frontend UMD bootstrap lane.
- The active grammar factory/runtime helpers now live under `monaco_editor/vscode_workbench_textmate_vendor/` and consume WBA-provided grammar metadata from `grammars_list` / `grammars_load`.
- `inline_host.ts` no longer loads the old TextMate/oniguruma UMD scripts into the active path.
- `m_editor_app.ts` now replays active-model language application after WBA connect so boot-time grammar/catalog races recover on `main_page`.
- User-verified after reload: bracket matching, TextMate scopes/colors, semantic tokens, hovers with syntax highlighting, and folding all remained operational.

Known limitations / residue:
- Some backend control paths still use the stdio WBA control plane.
- Some source modules are still loose JS and should continue to move to TS incrementally.
- Files without a supporting language provider still will not produce meaningful diagnostics.

### Current refactor direction

The active docs-first refactor track is:
- finish strict typing outside the already-clean editor, explorer, and WBA lanes
- make every remaining Socket.IO surface intentionally JSON-RPC compliant instead of event-name RPC
- collapse the app-specific Socket.IO server sprawl behind one server/path while preserving the current logical namespaces
- keep transport consolidation proxy-only; do not move SSOT or WBA ownership just to get one physical socket server
- defer HTML live preview until this refactor track lands

That target architecture and migration order live in `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.

### Extension validation matrix (next milestone)
We will validate at least 2 deterministic features (hover + symbols + diagnostics) per language:
- Python: `ms-pyright` (baseline) — **validated**: open file, document symbols, hover, diagnostics.
- TypeScript/JavaScript: built-in TS language service — **validated**: diagnostics working for `.ts`, `.js`, `.mjs`, `.tsx`, `.jsx` files. JS files get JavaScript-level strictness (lenient), TS files get full type checking.
- C++: `llvm-vs-code-extensions.vscode-clangd` — **validated**: diagnostics on open + live diagnostics on edit (after endColumn fix). Clangd is strict about UTF-16 range validity — sentinel endColumn values like INT32_MAX cause `"utf-16 offset ... is invalid for line N"` rejection and break subsequent analysis.
- Rust: `rust-lang.rust-analyzer` — pending.

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
    -> adapter.switchWorkspace / adapter.resubscribeWatcher / te2.resync

File watcher pipeline:
  code-server parcel watcher detects disk change
    -> remoteFilesystem IPC channel fires EventFire (ResponseType 204)
    -> workbench_client.mjs onEvent({type: "watcher/fileChanges", changes: [...]})
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
- `GET /api/app/code_te2/code_server/discover`
- `GET /api/app/code_te2/workbench_adapter/discover`
- `GET /api/app/code_te2/workbench_adapter/start`
- `GET /api/app/code_te2/workbench_adapter/status`
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
- `app/apps/code_te2/explorer/rpc_contract.py`
  - Explorer RPC method aliases and notification constants.
- `app/apps/code_te2/explorer_runtime.py`
  - Runtime/composition shell for `ExplorerDispatcher`.
  - Owns explorer session lifecycle, transport-edge delegation, and handler assembly.
- `app/apps/code_te2/explorer/handlers/*` and `app/apps/code_te2/explorer/services/*`
  - Own the extracted file-tree, Rust-pipe FS/Git/search integration, project, watcher, review, prefs, and editor-integration behavior.

### Socket.IO route proxy (main process, proxy-only)
- `app/extensions/apps/sio_service.py`
  - Framework-owned raw Engine.IO websocket route proxy loaded from app manifests.
  - It forwards websocket frames only; it does not parse Socket.IO namespaces or JSON-RPC payloads.
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

## 3) Main‑process service loader (why services exist)

Services declared in `app/apps/code_te2/manifest.json` currently include non-Socket.IO service modules:

```json
"services": {
  "path": "services",
  "modules": [
    "sidebar_backchannel_uds"
  ]
},
"sio_service": "sio_service.json"
```

Loaded by the main framework’s apps extension loader:
- `app/extensions/apps/loader.py`
  - imports each `services/<module>.py`
  - calls `register(app)` if present
  - auto‑includes any `APIRouter` objects found in the service module

Services run in the **main process** and should provide only:
- Transport shims/proxies
- Infrastructure that must outlive worker restarts

They must **not** mutate app worker SSOT (HistoryStore / ProjectSidecar).

Important current note:
- `sio_service.json` is the active physical Socket.IO route source of truth.
- The old `vscode_rpc` side-channel has been removed; editor intelligence is WBA-owned.

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

Complete boot snapshots share only their disk-heavy cross-client core. Before
returning, Python materializes and overlays the requesting client's exact
foreground editor SSOT, including the file payload. Shared open-state
notifications remain document-membership facts and never clear or dispose a
client's Monaco model; exact-client SSOT and file-open notifications exclusively
own visible model lifetime.

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

Preferences changes are performed through Monaco editor backend HTTP routes/backend hooks and typed editor or UI IPC notifications. `/editor/*` routes are Monaco editor backend routes in current source, not NiceGUI-owned routes.

---

## Transitional Note About The Rest Of This File

The sections below remain useful as operational reference, but they were accumulated across multiple architecture stages. Expect some lower subsections to still mention transitional or historical surfaces such as:

- pre-direct-WBA editor workbench relay wording
- older explorer naming before the `explorer/transport/` and `explorer_runtime.py` split
- legacy `vscode_api` / `vscode_rpc` context that is no longer the current hot path

If a lower section conflicts with the current-state summary above, trust the code and `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.

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
- main-process proxy: `app/extensions/apps/sio_service.py` using `app/apps/code_te2/sio_service.json`
- payload codec: strict `msgpack-v1` JSON-RPC

### Connection
Client connects with app-scoped auth/codec metadata. On connect, the server creates an `ExplorerDispatcher` per client SID and sends the authoritative bootstrap state for the active project.

### Client -> Server RPC methods
Explorer keeps legacy method aliases for frontend compatibility, but the contract is JSON-RPC on the `/rpc/explorer` namespace.

| Method | Alias | Purpose |
|---|---|---|
| `explorer.tree.list` | `tree:list` | Request directory listing. |
| `explorer.tree.expand` | `tree:expand` | Expand a directory node. |
| `explorer.search.run` | `search:run` | Start a file-name or content search. |
| `explorer.search.more` | `search:more` | Request more cached search results from the session. |
| `explorer.search.moreInFile` | `search:moreInFile` | Request more cached matches for one file. |
| `explorer.search.cancel` | `search:cancel` | Cancel an active search. |
| `explorer.review.list` | `review:list` | Request review entries. |
| `explorer.review.save` | `review:save` | Save selected drafts to disk. |
| `explorer.review.discard` | `review:discard` | Discard selected drafts. |
| `explorer.prefs.updateUi` | `prefs:updateUi` | Update one global UI preference key. |
| `explorer.prefs.vendorAgentIcon` | `prefs:vendorAgentIcon` | Vendor an icon asset into the SSOT cache dir. |

### UI Preferences (global)
- Store: `_preferences_store` (disk-backed) in `~/.local/share/termux-extensions-2/code_oss_prefs.json` under the `ui` object.
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

### Build procedure (current source)
The current `worktrees/vscode-te2-diff` publication path produces the pinned Monaco ESM tree:

- Output dir: `worktrees/vscode-te2-diff/out-monaco-editor-core/esm/`
- Produced by: `NODE_OPTIONS="--max-old-space-size=4096" npx gulp editor-distro` inside `worktrees/vscode-te2-diff`

There is no current `worktrees/vscode-te2-diff/build_monaco_te2.sh` script and no current `out-monaco-editor-core/te2-lang/` output in the checked source. If language-worker publication is needed, verify the current owning script before documenting or running it.

### Common failure mode: inline editor boot is blank but worker is running
Symptom:
- The host page loads, but `#editor-frame` stays blank or the inline Monaco boot falls back to an error panel.

Cause:
- Required Monaco build artifacts or the built host bundle were missing, so the host could not complete inline editor boot.

Fix:
- Rebuild the Monaco ESM output, rebuild `app/apps/code_te2` (`node build.mjs`), restart only the relevant app worker when approved, and hard refresh.

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
  - `atom-dark`
  - `atom-light`
  - `material-dark`
  - `material-light`
  - `darcula`
  - `monokai-pro`
  - `one-dark-pro`
  - TE2-local extras (optional):
    - `te2-dark` (diff colors match `github-dark-default`)
    - `te2-light` (diff colors match `github-light-default`)

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
- Confirm framework Socket.IO route proxy: `app/extensions/apps/sio_service.py`.
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

## 10) Transitional state (what is still legacy)

As of now:
- The Monaco editor surface is **not** NiceGUI.
- `/editor/*` HTTP endpoints used by the Monaco runtime are Monaco editor backend routes, with route ownership in `monaco_editor/editor_backend.py` and service implementations under `monaco_editor/editor_backend_services/`.
- `nicegui_editor/editor_app.py` is not the current owner for `/editor/check_cache`.
- Historical `/editor` Socket.IO namespace references are pre-`/rpc/editor` context. Current editor state/control traffic uses `/rpc/editor` on the shared app Socket.IO path.

The current transition is not a NiceGUI migration; it is a consolidation around typed backend hooks, strict msgpack-v1 RPC lanes, and Rust pipe-owned framework services where appropriate.

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

## 13) Resolved: Git diff + drafts assertion / thrash

When Git diff mode is enabled and the user types at EOF, the diff-projection engine previously
hit an assertion in `lineRangeMappingFromRangeMappings` (trailing-line invariant). This caused
visual thrash (green insertion flash, editor re-render on every keystroke) unless the last line
happened to have a deletion widget.

### Root cause

Stock Monaco had `applyModifiedEdits` and `applyOriginalEdits` **stubbed out** (`return undefined; // TODO@hediet`).
The TE2 pinned-baseline branch un-stubbed them for draft-diff projection but did not re-stub them
for autosave mode. The un-stubbed projection produced bad mappings at EOF boundaries where the
trailing-line invariant (`originalTrailing === modifiedTrailing`) fails.

`assertFn` in Monaco calls `onUnexpectedError` which is **non-throwing** (fires via `setTimeout`),
so try/catch at the call site cannot intercept it.

### Fix: Projection gating (`diffEditorViewModel.ts`)

All 3 projection zones are now gated with `!model.te2AutosaveMode`:

| Zone | Location | Gate |
|------|----------|------|
| 1 | `modified.onDidChangeContent` (~line 239) | `if (diff && !model.te2AutosaveMode)` |
| 2 | `original.onDidChangeContent` (~line 271) | `if (diff && !model.te2AutosaveMode)` |
| 3 | post-`computeDiff` autorun (~line 367) | `else if (!model.te2AutosaveMode)` |

When `te2AutosaveMode = true`: projection skipped entirely (stock behavior), debouncer does clean
full `computeDiff` — no thrash, no assertion.

When `te2AutosaveMode = false`: projection runs for pinned-baseline draft-diff tracking.

### Fix: EOF trailing-line invariant (`rangeMapping.ts`)

Instead of `assertFn` (non-throwing, crashes error handler), the last mapping is **extended to
absorb the EOF boundary** — simulating what a deletion widget naturally provides:

```typescript
const origTrailing = originalLines.length.lineCount - lastChange.original.endLineNumberExclusive;
const modTrailing = modifiedLines.length.lineCount - lastChange.modified.endLineNumberExclusive;
if (origTrailing !== modTrailing) {
    const maxTrailing = Math.max(origTrailing, modTrailing);
    changes[changes.length - 1] = new DetailedLineRangeMapping(
        new LineRange(lastChange.original.startLineNumber,
                      lastChange.original.endLineNumberExclusive + maxTrailing),
        new LineRange(lastChange.modified.startLineNumber,
                      lastChange.modified.endLineNumberExclusive + maxTrailing),
        lastChange.innerChanges,
    );
}
```

### Fix: Mode switch baseline snapshot (`m_editor_app.ts`)

When toggling autosave OFF → draft mode, the baseline is now a **snapshot of the current editor
content** (not `gitDiskModel`, which after autosave equals the editor = empty diff):

```javascript
var baselineContent = model.getValue();
diffModel.modifiedBaseline = monaco.editor.createModel(baselineContent, lang);
```

Applied in both `applyGitBaselines` (~line 2716) and `prefs_changed` handler (~line 4071).

### Fix: Mirror client autosave suppression (host cache indicator path)

Mirror clients no longer trigger autosave for mirrored content. The host cache-indicator path accepts
`{ skipAutosave: true }`, passed when `reason === 'mirror'` in `_applyCacheIndicatorImpl`.

### Debugger note
If your browser keeps pausing on this, DevTools likely has "Pause on exceptions" enabled; disable it while iterating so the UI remains usable.

---

## 14) Historical: pre-direct-WBA removal planning for `vscode_rpc` and `vscode_api`

This section is archival context from the period before the direct `/wba` editor transport and UDS code-server cutover. Do not treat it as the authoritative description of the current hot path. Current source has removed the `vscode_api` and `vscode_rpc` transport/shell/service files; only legacy sidecar migration keys remain.

### Background
Early in development, two standalone Node.js JSON-RPC harnesses were created as separate framework shells:
- **`vscode_rpc`**: a minimal WS JSON-RPC server intended to provide semantic tokens, themes, and grammars.
- **`vscode_api`**: a larger harness intended to manage VSIX install/registry, TextMate grammars, themes, and eventually language features.

These were designed before the **workbench adapter** (stdio pipe transport) was fully operational. Now that the adapter provides direct access to the real VS Code extension host (diagnostics, hover, symbols, didChange — all working), the standalone harnesses are redundant for language features.

### What the adapter already covers
The workbench adapter (`workbench_client.mjs` + `server.mjs`) talks to the real code-server extension host and provides:
- All language intelligence (diagnostics, hover, symbols, didChange) via stdio pipe
- All built-in extension activation (~30 language extensions)
- Provider registration and handle tracking
- Document model synchronization

### What `vscode_api` provided historically (removed)
The removed `vscode_api` harness historically handled:
- **VSIX install/registry**: `vscode.vsix.*` methods (install, list, enable/disable per-project)
- **TextMate grammars**: `vscode.textmate.grammars.list` / `vscode.textmate.grammars.load`
- **Theme loading**: `vscode.themes.list` / `vscode.themes.load`
- **Language configuration**: `vscode.languages.list` (returns `configuration_raw` for bracket matching, comments, etc.)
- **Bootstrap snapshot**: `vscode.bootstrap.snapshot` (cached grammar/theme/language index)

At the time, these were considered static asset queries that did not require a running extension host. Current source no longer uses the standalone `vscode_api` harness; current integration should use the live code-server/WBA-backed services or Monaco editor backend routes instead of reviving this path.

### Files removed (`vscode_rpc`)
| File | Purpose |
|------|---------|
| `services/vscode_rpc_transport.py` | Main-process WS proxy |
| `vscode_rpc_shell_manager.py` | Shell lifecycle manager |
| `shellspec/vscode_rpc.yaml` | Framework shell definition |
| `manifest.json` (references) | Service registration |

### Files removed (`vscode_api`, after migration)
| File | Purpose |
|------|---------|
| `services/vscode_api_transport.py` | Main-process WS proxy |
| `vscode_api_shell_manager.py` | Shell lifecycle manager |
| `shellspec/vscode_api.yaml` | Framework shell definition |
| `main.py` (references) | Discovery/resolve endpoints |
| `main.js` (references) | Frontend bootstrap/snapshot calls |
| `m_editor_app.ts` (references) | Grammar/theme loading calls |
| `inline_host.ts` (references) | Inline editor bootstrap / mount path |

### Historical migration strategy (superseded)
The workbench adapter already scans all extensions at startup (`_buildExtensionsSnapshot()`), so it has the full `contributes.grammars`, `contributes.themes`, and `contributes.languages` metadata in memory. The preferred migration path is to add new JSON-RPC methods to the adapter rather than building separate Python utilities.

**Phase 1: Grammar/theme/language queries via adapter** (preferred path)
Add these methods to `server.mjs` `handleJsonRpc()`:

| Method | What it does | Data source |
|--------|-------------|-------------|
| `vscode.grammars.list` | List all contributed grammars (scopeName, language, path) | Scanned extensions `contributes.grammars` |
| `vscode.grammars.load` | Load raw `.tmLanguage.json` content by scopeName or path | `fs.readFile` on extension content path |
| `vscode.themes.list` | List all contributed themes (label, uiTheme, path) | Scanned extensions `contributes.themes` |
| `vscode.themes.load` | Load raw theme JSON by path or label | `fs.readFile` on extension content path |
| `vscode.languages.list` | List language contributions + configuration | Scanned extensions `contributes.languages` |
| `vscode.languages.config` | Load raw language configuration JSONC | `fs.readFile` on extension content path |

These reuse the existing stdio pipe transport (browser → Socket.IO → `editor_ws.py` → adapter stdin → response). No new transport or framework shell needed.

Python-side: add corresponding `editor_ws.py` handlers (same pattern as `on_editor_workbench_hover`).
Historical frontend target: update `m_editor_app.ts` away from the `vscode_api` WS harness. Current source has already moved editor language intelligence to `/wba` and editor state/control to `/rpc/editor`.

**Phase 2: VSIX management via Python**
VSIX install/registry is pure file management (download, extract, update `extensions.json`). This doesn't need the adapter or an extension host. A Python utility reading `~/.local/share/termux-extensions-2/code-te2-extensions/` directly is sufficient.

**Phase 3: Bootstrap snapshot consolidation**
The old `vscode.bootstrap.snapshot` direction is superseded; do not add new boot dependencies on the removed `vscode_api` harness.

### Priority
- `vscode_rpc`: removed; nothing depends on it in production.
- `vscode_api`: removed. Treat the remaining details in this section as archival context only.

---

## 15) Historical: `vscode_api` harness snapshot

This section is retained as background for legacy/secondary surfaces and migration history. It is not the current editor language-intelligence architecture.

`vscode_api` was a historical follow-up to `vscode_rpc`. The live source has removed this harness; this snapshot is preserved only as archival context.

Goal:
- Provide a **single** WS JSON-RPC connection that becomes the long-lived “VS Code API harness”.
- This is the place where TE2 will eventually support:
  - VSIX install/registry
  - TextMate grammars + themes from installed extensions
  - Extension host services (vscode.* APIs) where needed
  - Language feature providers (semantic tokens, diagnostics, completions, etc.)

Important invariant:
- TE2 main process is **proxy-only**; all SSOT interaction remains in the worker.

### Current scaffolding (v0)
- Worker discovery: `GET /api/app/code_te2/vscode_api/discover`
  - starts/adopts a framework shell
  - returns `ws_url` like `/vscode_api_ws?shell_id=<shell_id>`
  - returns `instance_id` (currently always `"primary"`)
- Host WS shim (service): `WS /vscode_api_ws?shell_id=<shell_id>`
  - proxy-only, forwards frames verbatim to the shell’s WS
- Shellspec: `app/apps/code_te2/shellspec/vscode_api.yaml#vscode-api`
- Server entrypoint: `worktrees/vscode-te2-diff/te2/vscode_api_server.mjs`
  - currently supports:
    - `rpc.ping`
    - `vscode_api.version`
    - `vscode_api.capabilities`
    - `vscode.vsix.*` (registry + per-project enable/disable)
    - `vscode.themes.*` (list/load raw theme json)
    - `vscode.textmate.*` (list/load raw grammars)
    - `vscode.languages.list` (enabled extensions only; includes `configuration_raw`)

Storage:
- Global VSIX install pool: `~/.local/share/termux-extensions-2/code-te2-extensions/`
- Per-project enablement SSOT: `ProjectSidecar.vscode_api.enabled_extensions`

Resolve by path (future multi-instance hook):
- `GET /api/app/code_te2/vscode_api/resolve?path=<abs>`
  - Today: only resolves if `path` is under the active project root.
  - Future: selects the best running instance by workspace-folder match (code-server session registry pattern).

Themes (global SSOT):
- Theme selection is stored in `_preference_store` using the existing `theme` preference key.
- Built-in themes use simple ids like `te2-dark`, `te2-light`, `github-dark-default`, etc.
- VSIX-provided themes use: `vscode:<extensionId>:<relPath>`
  - Example: `vscode:GitHub.github-vscode-theme:extension/themes/dark-default.json`
- The Monaco editor runtime converts VS Code theme `tokenColors` into Monaco theme rules and applies it after loading via `vscode_api` (`vscode.themes.load`).

TextMate apply (grammars from VSIX):
- Monaco editor runtime uses `vscode-oniguruma` + `vscode-textmate` (UMD globals) to tokenize lines using TextMate grammars.
- Grammar resolution prefers `vscode_api` (`vscode.textmate.grammars.list` + `vscode.textmate.grammars.load`) and falls back to legacy static assets under `monaco_editor/textmate/` when present.
- Boot-time prefetch:
  - `vscode.bootstrap.snapshot` (cached on `window.__te2VscodeBootstrap`)
    - includes `languages` (enabled extensions only), plus `themes` and `grammars`
  - `_refreshVscodeGrammarIndex()` (cached for scopeName/language mapping)
- Scope selection:
  - Uses VSIX grammar `language` field when available to map to Monaco `languageId`.
  - Supports extension-sensitive scopes for `.jsx`/`.tsx` when present.
  - Falls back to the previous hard-coded scope map when no VSIX grammar matches.

VSIX language configuration (per-project):
- `vscode.languages.list` returns `contributes.languages` (only for enabled extensions) plus `configuration_raw` (jsonc).
- Monaco editor runtime calls `monaco.languages.setLanguageConfiguration(languageId, cfg)` so bracket auto-closing, comments, etc. follow VSIX language configs.

Current-source note:
- Do not build new integration against `vscode_api`; the live source uses code-server/WBA-backed services and Monaco editor backend routes instead.

Language providers (working):
- **Stdio LSP bridge has been removed** (2026-02-07). It caused marker owner collisions with the workbench adapter path.
- Diagnostics now flow through the direct WBA event path plus backend normalization/projection where needed; `diagnostics_bridge.py` is not the editor hot path:
  - Subscribes to adapter WS (`127.0.0.1:18181/ws`) for `diagnostics/update` events
  - Caches per-path (max 100 entries) and broadcasts via editor Socket.IO (`editor:diagnostics`)
  - On client connect (`on_connect`): sends cached diagnostics + nudges adapter for fresh ones
  - On file switch (`on_editor_open_request`): sends cached diagnostics for the new file + nudges adapter
  - Nudge mechanism: POST `vscode.openFile` to adapter `/cmd` to force extension host re-emit
  - Monaco editor runtime handler converts bridge payload to `_applyDiagnosticsUpdate()` format
- **All built-in language extensions** are loaded (filtered to language-only subset, ~30 of 95 scanned).
- Diagnostics work for Python, TypeScript, JavaScript, CSS, HTML, JSON, and all other languages with built-in VS Code support.
- RPC features (hover, symbols, openFile, didChange) flow through direct `/wba` JSON-RPC; older editor Socket.IO -> adapter stdio relay wording is historical.

Editor command notifications now live on the typed `/rpc/editor` lane; older `editor_ws.py` Socket.IO event names are historical context.

Diagnostics debug overlay + logs (current):
- Debug overlay text (lower-left): `ext=yes/no og=yes/no diag=rx/ap/np/nm/mm` plus optional `touch=reinit:*`.
  - `ext`: `monaco-touch-selection` helper detected.
  - `og`: `.overflow-guard` element present in current editor DOM.
  - `diag=rx/ap/np/nm/mm` counters:
    - `rx`: diagnostics events received by Monaco editor runtime.
    - `ap`: `setModelMarkers` calls performed (includes cache reapply and empty arrays).
    - `np`: dropped because path could not be derived from URI.
    - `nm`: dropped because no model available.
    - `mm`: dropped because item path != active model path.
  - Counters are cumulative for the editor-runtime lifetime (not per file).
  - `touch=reinit:*` appears when touch-selection UI re-installs after editor DOM rebuild.
- Frontend console logs (Monaco editor runtime):
  - `[editor:diagnostics] rx diagnostics/update path=... markers=N currentPath=...`
  - `[vscode_api] setModelMarkers count=... sevs=[...] lines=[...]`
  - `[vscode_api] verify getModelMarkers count=...`
- Adapter-side console logs (Node workbench adapter):
  - `[wb_client] $changeMany owner=... pairs=... markerCounts=[...]`
  - `[server] diagnostics/changeMany -> norm=owner=... items=... markerCounts=[...]`


Legacy LSP config (`lsp_servers.json`) is no longer used. The following section is preserved for reference only:

LSP server mapping (legacy — removed):
- The bridge was driven by a json mapping file:
  - default path: `~/.local/share/termux-extensions-2/code-te2-extensions/lsp_servers.json`
  - override: `TE2_LSP_CONFIG_PATH=/abs/path/to/lsp_servers.json`
- Format:
  - `servers.<languageId>.cmd` is an argv array (first item is executable).
  - Optional: `servers.<languageId>.key` lets multiple languageIds share one spawned server.
  - Optional: `servers.<languageId>.env` and `servers.<languageId>.initializationOptions`.
  - Template vars inside `cmd` strings:
    - `${project_root}` → active project root
    - `${ext:<publisher.name>}` → VSIX install content root for that extension (e.g. `${ext:ms-python.python}`)
- Minimal built-ins:
  - JS/TS uses vendored `app/static/vendor/lsp_servers/node_modules/.bin/typescript-language-server --stdio`
  - Python uses `pyright-langserver --stdio` **only if present on PATH**

Example `lsp_servers.json`:
```json
{
  "version": 1,
  "servers": {
    "typescript": { "key": "ts", "cmd": ["typescript-language-server", "--stdio"] },
    "javascript": { "key": "ts", "cmd": ["typescript-language-server", "--stdio"] },
    "python": { "key": "pyright", "cmd": ["pyright-langserver", "--stdio"] }
  }
}
```

Example (use a VSIX-bundled language server binary):
```json
{
  "version": 1,
  "servers": {
    "python": {
      "key": "pyright",
      "cmd": ["${ext:ms-python.python}/node_modules/.bin/pyright-langserver", "--stdio"]
    }
  }
}
```

---

## 16) Multi-client fanout + future multi-instance (code-server pattern)

Historical note: this section predates removal of the standalone `vscode_api` harness. Keep the multi-instance ideas as design context, but current implementation should be expressed in terms of code-server/WBA-backed editor instances and typed app RPC lanes.

### Goal (TE2 direction)
Maintain **multiple clients → single backend instance** fanout as the default:
- Many browser clients (desktop/mobile, multiple tabs, GeckoView, etc.) can attach to the same active project editor.
- The backend is the authority for “workspace-ish” runtime state (enabled extensions, indexing, language services, etc.).
- SSOT remains worker-owned (`_history_store`/ProjectSidecar + `_preferences_store`).

Keep the option open to support **multiple editor instances** later (e.g. two projects, or two “workspaces” under one project) without redesign.

### Why this is the right default
- TE2 already uses a SSOT model and atomic persistence (drafts + writes).
- Multi-client fanout is easier to reason about than multi-instance from day 1:
  - one set of indexes
  - one extension host
  - one language-service hub
  - one source of truth for “what is enabled”

### The minimal invariant to keep multi-instance possible later
Make instance identity explicit **now**, even if we only run one instance:

- `project_root`: absolute path for the active project
- `instance_id`: stable string for a backend instance (default: `"primary"`)
- `client_id`: stable per-browser/tab id (already exists in other TE2 transports)

Every client→server request should carry at least `{project_root, instance_id, client_id}` so later we can add parallel instances without changing payload formats.

### Discovery & routing contract (recommended)
Two related but distinct problems:

1) **Discover**: “Start or adopt an instance for the *current* active project.”
   - Historical note: the removed `vscode_api` harness used the former-id route `GET /api/app/file_editor_cm6/vscode_api/discover`; do not treat that route as current source.

2) **Resolve**: “Given a file path, which running instance should handle it?”
   - This is the missing piece that enables “open file from outside,” multi-tab/multi-instance, and clean attach behavior.

Historical resolve endpoint shape (worker-owned API, host proxy-only):
- `GET /api/app/code_te2/vscode_api/resolve?path=<abs>`
  - returned `{ws_url, token, project_root, instance_id, shell_id}` in the old design. A future current implementation should not reuse the removed harness name.

### Reference pattern (code-server)
The code-server project solved the “which instance should handle this file?” problem by maintaining a session registry:

- Patch: `../mrselect6-2/code-server/patches/store-socket.diff`
  - The extension host registers its IPC socket + workspace folders into a local session manager server.
- Implementation: `../mrselect6-2/code-server/src/node/vscodeSocket.ts`
  - Keeps a Map of active sessions.
  - Selects the best session by:
    - “workspace folder prefix match” against the file path
    - “can connect” probing to prune dead sockets

The current TE2 analogue would be:
- A registry of active code-server/WBA-backed editor instances keyed by `{project_root, instance_id}` (and optionally workspace folders).
- A resolve routine that selects the right backend for a given absolute path.

### Storage / collision notes (important for multi-client)
If multiple workspaces can be served under the same origin, avoid browser-storage collisions:
- Reference: `../mrselect6-2/code-server/patches/unique-db.diff`
  - Hashes by `location.pathname` to prevent IndexedDB collisions between `/workspace1` and `/workspace2`.

TE2 should apply the same principle anywhere we persist client-side state:
- per-app localStorage keys
- IndexedDB keys (if used)
- caches related to `client_id`

### What stays where (TE2 boundary rule)
- **Main framework**: proxy-only (services provide WS shims, no SSOT writes).
- **App worker**: SSOT owner (preferences/history/project sidecar).
- **code-server/WBA-backed services**: heavy work (VSIX metadata, TextMate data, language features, indexing) where current source supports it.
- **browser editor runtime**: thin renderer (Monaco UI + provider shims that call backend).

### Immediate follow-ups (ties to your priorities)
1) **TextMate/grammars/tokens/styling**
   - Keep grammar/theme indexing on current code-server/WBA-backed or Monaco editor backend paths.
   - Keep TextMate as baseline tokenization; semantic detail comes from language features.
2) **Language servers**
   - Provide document symbols, diagnostics, semantic tokens over the same WS JSON-RPC surface.
3) **Extension UI iframes**
   - Defer; this becomes “webviews” and CSP/origin problems (see code-server `patches/webview.diff`).

---

## 17) Historical: workbench adapter bring-up and protocol notes

Most of this section is bring-up history. The authoritative current transport split is described earlier in this document; use the notes here for protocol/implementation background, not for deciding today's hot path.

Goal: **avoid rebuilding** VS Code / code-server workbench JS while still extracting language “gold” (diagnostics, hover, completion, symbols) into TE2.

Approach:
- Run stock code-server as-is.
- Put a small **WS mirror+decode proxy** in front of it (transparent relay).
- Decode the workbench protocol frames (Mgmt + ExtHost) and publish a **TE2-friendly side channel**.

### Important non-goal
- **Do not** treat any “trace replay” as a production protocol. Traces/HARs are for discovery + debugging only.

### Key reference
- `../mrselect6-2/vscode-protocol/README.md`
  - Documents the **wire framing protocol** (Regular/Ack/KeepAlive/etc) and the **two WS connections**:
    - renderer-Management (channel protocol)
    - renderer-ExtensionHost (RPC protocol)

### Offline decoder (protocol discovery)
Tooling (TE2):
- `scripts/vscode_ws_decode_har.py`
  - Decodes Firefox HAR `_webSocketMessages` and prints:
    - handshake type counts (auth/sign/connectionType/ok)
    - wire frame type counts
    - management channel top methods
    - extension host top methods
  - Recent improvements:
    - tolerates “comment line” prefix before JSON in HAR files
    - decodes ExtHost **mixed-args** frames (RequestMixedArgs / RequestMixedArgsWithCancellation)

Captured HARs (examples):
- `newwsdata1.har`, `newwsdata2-oneclient.har`, `newwsdata3-oneclient-second_stream.har`
- `newestws1.har`, `newestws2.har`

### Live decoder proxy (Go, current)
For live interception + decoding (browser or headless client → proxy → code-server):
- Upstream proxy/decoder: `../mrselect6-2/vscode-protocol/proxy.go`
  - Can emit TE2-friendly JSON events (`-te2-json`) and optionally write a capped JSONL trace (`-trace-out ... -trace-max-bytes ...`).
- Example trace file (repo-local): `tmp/go_te2_decoder_trace.jsonl`

Use this as:
- a transparent relay
- a deterministic “ground truth” logger/decoder for what the real workbench does

Do not use it as:
- a “replay engine” that pretends to be the workbench

### What we know works from HARs (important findings)

#### Two websockets per session (invariant)
Each captured HAR contains **2 WS URLs** (same base path, different reconnection tokens):
- one Management stream
- one ExtensionHost stream

#### Language features seen on ExtensionHost stream
These are already present in the traces (so proxy extraction is feasible):
- `$provideHover`
- `$provideCompletionItems`
- `$provideDocumentSymbols`
- `$provideCodeActions`

#### Diagnostics payload shape (confirmed)
Diagnostics are pushed via ExtensionHost method:
- **`$changeMany`**

Decoded example (normalized):
```json
[
  "python",
  [
    [
      {"scheme":"vscode-remote","authority":"localhost:8080","path":"/.../agent_bridge.py"},
      [
        {
          "startLineNumber":12,"startColumn":11,"endLineNumber":12,"endColumn":16,
          "message":"SyntaxError: invalid syntax (agent_bridge.py, line 12)",
          "source":"compile","severity":8,
          "modelVersionId":1
        }
      ]
    ]
  ]
]
```

Interpretation:
- arg0: marker owner / source id (here: `"python"`)
- arg1: list of `[resourceUri, markers[]]`

This is the payload we want to convert into TE2 diagnostics to render in Monaco.

#### Hover request/response (confirmed)
Hover is served via ExtensionHost method:
- **`$provideHover`**

Observed request shape (from `maximal-hover-scrape.hal` via `scripts/vscode_ws_decode_har.py --extract-te2 --extract-method '$provideHover'`):
```json
{
  "type": "ext/request",
  "method": "$provideHover",
  "args": [
    25,
    {"scheme":"vscode-remote","authority":"localhost:8080","path":"/.../agent_bridge.py"},
    {"lineNumber": 25, "column": 16},
    {}
  ]
}
```

Observed reply shapes:
- `ReplyOKEmpty` when nothing applies
- `ReplyOKJSON` with a payload like:
```json
{
  "range": {"startLineNumber":25,"startColumn":8,"endLineNumber":25,"endColumn":18},
  "contents": [{"value": "```python\\n...```\\n---\\n```text\\n...```", "isTrusted": false}],
  "id": 0
}
```

Important: the first argument (`25` in the example) is a **provider handle/id** chosen by the workbench session.
It is **not stable across sessions** unless we derive it by observing provider registrations (e.g. `$registerHoverProvider`)
or by piggybacking on real workbench requests.

### Proxy POC (do this first)
**POC v0** (“observe-only”):
- proxy WS frames untouched (browser ↔ proxy ↔ code-server)
- decode ExtHost frames and stream TE2 events:
  - `diagnostics/changed` (from `$changeMany`)
  - `hover/response`, `completion/response`, `symbols/response` (observe-only for now)

**POC v1** (“inject one request”):
- pick a single predetermined opened file in code-server session
- inject exactly one request and wait for response:
  - hover request → hover response

Notes:
- For injection, the document must already exist in code-server’s model.
- Later we can drive open/close via Management channel (workbench actions) or by reproducing doc/editor delta traffic, but that is out of scope for v0/v1.

### Headless workbench adapter (Node, stdio pipe transport)
The adapter is a headless workbench client that replaces browser-based bootstrapping:
- Server: `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
  - Exposes **stdio JSON-RPC** (production transport): Python writes JSON-RPC to stdin, reads `<<<RPC>>>` prefixed responses from stdout.
  - Also exposes HTTP JSON-RPC on port 18181 (vestigial, will be removed).
  - `console.log` is redirected to `console.error` so adapter logs go to stderr (visible in framework shells UI) while stdout is reserved for the pipe protocol.
- Client core: `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
  - Uses VS Code OSS remote agent connection/runtime code (`remoteAgentConnection`, `browserSocketFactory`, IPC runtime) to connect in **remote mode**
  - Sends the ExtensionHost init JSON over the ExtHost websocket
  - Sends the minimal editor/document delta events required to open a file (`$acceptDocumentsAndEditorsDelta`, tab model, editor properties, dirty state)
  - Learns provider handles by observing `$register*Provider` frames (when present)
  - Universal provider lookup: `_findProviderHandle(type, languageId)` searches registered providers by language
  - Multi-provider lookup: `_findAllProviderHandles(type, languageId)` returns **all** matching handles (used by hover to call providers in parallel, VS Code style)

Python-side integration:
- `workbench_adapter_shell_manager.py`:
  - `adapter_rpc(method, params, timeout)` — sends JSON-RPC over stdin, awaits `<<<RPC>>>` response from stdout reader
  - `_stdout_reader_loop()` — reads adapter stdout in 1MB chunks (no line length limit), routes `<<<RPC>>>` lines to pending futures, logs the rest
  - `ensure_workbench_adapter_shell()` — spawns adapter (pipe backend, `wait_ready=False`), does stdio ping readiness loop, then calls `adapter.connect` bootstrap with code-server URL
- `editor_ws.py` handlers:
  - `on_editor_workbench_open_file` → `adapter_rpc("vscode.openFile", ...)`
  - `on_editor_workbench_hover` → `adapter_rpc("vscode.hover", ...)`
  - `on_editor_workbench_symbols` → `adapter_rpc("vscode.documentSymbols", ...)`
  - `on_editor_workbench_did_change` → `adapter_rpc("vscode.didChange", ...)` (fire-and-forget)
- `diagnostics_bridge.py`:
  - `nudge_diagnostics_for_file()` → `adapter_rpc("vscode.openFile", ...)` (replaced old httpx POST)

Current status (facts observed in adapter runs):
- Adapter can establish remote-mode mgmt+ext connections and keep them alive.
- `vscode.openFile`, `vscode.documentSymbols`, `vscode.hover`, and `vscode.didChange` are wired end-to-end through the stdio pipe.
- **All built-in language extensions** are loaded and activated (TypeScript, JavaScript, Python, CSS, HTML, JSON, etc.)
- Python provider flow is validated with `ms-pyright.pyright` in the current dev setup.
- TS/JS provider flow validated via built-in `typescript-language-features` — diagnostics, hover, symbols all working.
- C++ (clangd): validated — diagnostics on open and **live diagnostics on edit** working after endColumn fix.
- Keepalive/ack handling is stable enough for iterative feature validation.

Per-document tracking maps (in `workbench_client.mjs`):
- `_docVersions`: path → versionId (monotonically increasing, reset to 1 on openFile)
- `_docLineCount`: path → number of lines
- `_docCharCount`: path → total character count (for `rangeLength`)
- `_docLastLineLength`: path → character length of the last line (for valid `endColumn`)

### Extension host protocol findings (important for future work)

#### Builtin extension loading
- code-server scans ~95 builtin extensions. Including all of them causes the ext host to hang.
- **Root cause**: non-language extensions (git-base, emmet, npm, etc.) activate on `"*"` event and try filesystem operations (`$ensureActivation("file")`) that the headless adapter cannot serve. This blocks the serial activation queue.
- **Solution**: `_buildExtensionsSnapshot()` applies a language-only filter that keeps:
  - All user-installed extensions (always)
  - `*-language-features` extensions (typescript-language-features, css-language-features, etc.)
  - Grammar/language extensions (vscode.python, vscode.javascript, etc.) without `"*"` activation
  - Theme extensions
  - `vscode.configuration-editing` (JSON schema completions)
- This reduces ~95 → ~30 extensions and allows full activation in under 2 seconds.
- Controlled via env: `TE2_INCLUDE_BUILTIN_EXTS=0` reverts to user-extensions-only mode.

#### Extension host RPC reply requirements

Not all ext host requests can be answered with `ReplyOkEmpty`. Key methods that need typed replies:
- `$initializeExtensionStorage` → `ReplyOkJson("{}")` (JSON string — ext host calls `JSON.parse()` on the deserialized result, then `safeParseValue` calls `JSON.parse("{}")` → `{}`)
- `$getTools` → `ReplyOkJson([])` (empty tools array)
- `$getInitialState` → `ReplyOkJson({ isFocused: true, isActive: true })`
- `$checkExists` → `ReplyOkJson(false)`
- `$requestWorkspaceTrust` → `ReplyOkJson(true)` (followed by `$onDidGrantWorkspaceTrust`)
- `$register` (rpcId 29, MainThreadOutputService) → `ReplyOkJson("<channelId>")` (string — clangd blocks waiting for this; returns a synthetic channel ID like `"te2-output-<req>"`)
- `$startFileSearch` → `ReplyOkJson(UriComponents[])` after WBA's bounded workspace glob search; an unconditional empty array prevents workspace-scanning extensions from functioning.
- `$startTextSearch` → `ReplyOkJson(null)`
- `$executeCommand` → `ReplyOkEmpty`

#### Activation events
- `$activateByEvent("*")` must NOT be sent — it activates problematic non-language extensions.
- `$activateByEvent("onLanguage")` is sent at bootstrap (generic).
- `$activateByEvent("onLanguage:<id>")` is sent per-file at openFile time (e.g. `"onLanguage:python"`).

#### LanguageId detection
- `workbench_client.mjs` includes a `_languageIdFromPath()` helper (40+ file extensions → VS Code language IDs).
- Falls back to path-based detection when `params.languageId` is empty/missing.
- Critical for correct activation: `$activateByEvent("onLanguage:javascript")` vs `"onLanguage:typescript"` determines which extensions activate and what strictness level applies.

### Extension validation milestones (current track)
Goal: verify deterministic language-feature parity (open file -> symbols/hover/diagnostics) across popular ecosystems before broadening scope.

Execution reference:
- `docs/apps/code_te2/MONACO_WORKBENCH_SPRINT_PLAN.md`
- `docs/apps/code_te2/README.md` (Roadmap Update section)
- `docs/apps/code_te2/VSCODE_API_CONTRACT.md`
- `docs/apps/code_te2/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_te2/VSCODE_API_DEPRECATIONS.md`

1. Python (`ms-pyright.pyright`) - **validated**
   - validated: open file, document symbols, hover, diagnostics
   - pending: sustained diagnostics/completions stability under longer sessions
2. TypeScript/JavaScript (built-in TS service) - **validated**
   - validated: diagnostics for `.ts`, `.js`, `.mjs`, `.jsx`, `.tsx` files
   - JS files receive JavaScript-level strictness (lenient); TS files receive full type checking
   - pending: hover, symbols, completions verification
3. C++ (`llvm-vs-code-extensions.vscode-clangd`) - **validated**
   - validated: diagnostics on open, live diagnostics on edit
   - required fix: `endColumn` must use actual last-line length (clangd rejects INT32_MAX as invalid UTF-16 offset)
   - required fix: `$register` (rpcId 29, OutputService) must return a string channel ID (clangd blocks on this)
   - pending: hover, symbols verification
4. Rust (candidate extension under test) - pending
   - target checks: provider registration, document symbols, hover, diagnostics

Baseline note:
- TypeScript/JavaScript language intelligence is built into the VS Code stack (TypeScript service), so TS/JS acts as a baseline control in this milestone plan rather than an external-extension test case.

Planning boundary:
- `CODE_TE2.md` remains architecture/protocol truth.
- `MONACO_WORKBENCH_SPRINT_PLAN.md` remains the actionable sprint execution plan.

### Minified code reverse engineering workflow (policy)
When we need to learn the “real” sequence from installed/minified code-server JS, use a stream-only workflow:
- Prefer: `prettier <file> 2>/dev/null | nl -ba | rg -n '<pattern>'` for deterministic line numbers
- Then: re-run and extract context with `sed -n '<start>,<end>p'`

See:
- `AGENTS.md` (“Minified Code Search Policy”)
- `CTAG-ANNOTATIONS.md` (tagging prettified functions for later lookup)

### TE2 integration surface (current)
Editor language intelligence now uses the direct editor-facing WBA socket:
- inline editor runtime connects to `/wba_ws/socket.io` namespace `/wba`
- `editorWorkbenchCall(...)` maps workbench methods to WBA JSON-RPC methods
- WBA replies and notifications return directly to the inline editor runtime without the old Python workbench relay in the hot path

Current hot-path examples:
- `open_file` → `/wba` RPC `vscode.openFile`
- `hover` → `/wba` RPC `vscode.hover`
- `symbols` → `/wba` RPC `vscode.documentSymbols`
- `did_change` → `/wba` RPC `vscode.didChange`
- provider registration / editor diagnostics notifications → `/wba` JSON-RPC notifications (`te2.event` fanout)

Current backend/control-plane residue:
- Explorer/backend project-switch and watcher-resubscribe flows still call `adapter_rpc(...)` over stdio
- editor-backend model-ready resync still calls `adapter_rpc("te2.resync")`

Current diagnostics split:
- raw editor diagnostics are WBA/editor-owned and flow to the inline editor runtime through `/wba`
- normalized explorer/problems diagnostics remain backend-owned
- `diagnostics_bridge.py` is no longer the primary editor diagnostics hot path

Live editor diagnostics data flow:
- User types in Monaco → direct `/wba` `vscode.didChange` → WBA → `$acceptModelChanged` → extension host re-analyzes → WBA notification fanout → browser editor diagnostics store
- The adapter tracks per-document `versionId` (monotonically increasing, reset to 1 on `openFile`), previous line count, char count, and **last line length** for correct range replacement
- **endColumn tracking**: `_docLastLineLength` map stores the character length of each document's last line. Initialized on `openFile()` from `lines[lines.length - 1].length`, updated on every `didChange()` after splitting the new text. Used as `endColumn: prevLastLineLen + 1` in the change range. Fallback is `10000` for documents opened before tracking was added (safe for clangd, clamped by the mirror model).
- File watchers (Section 19) handle post-save diagnostics automatically — code-server's parcel watcher detects disk changes and feeds `$onFileEvent` to the extension host; TE2 subscribes to the same IPC channel for explorer updates

Document-symbol ordering hardening (validated):
- Monaco now gates workbench flow by `(path, generation)` and requires `open_file` ack before queued `didChange` and symbols flush.
- `editor:ssot`, `editor:open`, baton replay, and `openPathFromBackend` all use the same ordered open flow.
- Adapter invariants return `document_not_open` / `stale_generation` for out-of-order requests.
- Backend stdio writes are still serialized in `workbench_adapter_shell_manager.py` for the remaining control-plane calls.

The old `vscode_rpc_ws` path has been removed. The old `vscode_api_ws` path is not the active editor intelligence transport; treat related text as historical unless a specific current feature still depends on it.

The UI (Monaco editor runtime) remains a thin renderer:
- It subscribes to TE2 events, updates Monaco markers/hover providers, and never runs an extension host itself.
- Hover and symbol providers are registered immediately for the current file's language (no async dependency on VSIX language list).
---

## 18) Planned: Breadcrumb navigation widget (extracted from VS Code)

### Goal
Add a VS Code-style breadcrumb bar above the Monaco editor runtime showing:
- File path segments (project root → current file)
- Document symbols (outline: classes → methods → current scope based on cursor position)

Clicking path segments navigates the explorer; clicking symbol segments scrolls to that symbol.

### Source reference
The VS Code breadcrumb implementation lives in the code-server submodule:
- **Worktree**: `../mrselect6-2/code-server/lib/vscode/src/vs/`
- **Core widget** (standalone, extractable):
  - `base/browser/ui/breadcrumbs/breadcrumbsWidget.ts` (~366 lines)
  - `base/browser/ui/breadcrumbs/breadcrumbsWidget.css` (37 lines)
- **Workbench integration** (NOT extractable, too entangled):
  - `workbench/browser/parts/editor/breadcrumbsControl.ts` (~878 lines)
  - `workbench/browser/parts/editor/breadcrumbsModel.ts` (~147 lines)
  - `workbench/browser/parts/editor/breadcrumbsPicker.ts` (~438 lines)
  - `workbench/browser/parts/editor/breadcrumbs.ts` (~308 lines)
  - `workbench/browser/parts/editor/media/breadcrumbscontrol.css`

### Feasibility analysis

**The core `BreadcrumbsWidget` is highly extractable.** It's a pure DOM widget with minimal dependencies:
- `vs/base/browser/dom.js` — DOM helpers (createElement, classList, events)
- `vs/base/browser/ui/scrollbar/scrollableElement.js` — Horizontal scrollbar
- `vs/base/common/event.js` — Event emitters (Emitter, Event)
- `vs/base/common/lifecycle.js` — Disposable pattern
- `vs/base/common/themables.js` — ThemeIcon (for separator chevron)

It renders with plain DOM manipulation (no React, no VS Code UI framework). The `BreadcrumbsItem` is abstract — you subclass it and implement `render(container: HTMLElement)` to put whatever you want in each crumb.

**The workbench integration layer is NOT extractable.** `BreadcrumbsControl` depends on 12+ VS Code services (IOutlineService, IEditorService, IWorkspaceContextService, IConfigurationService, etc.). Don't even try.

### Recommended approach: extract widget, build our own data model

**Step 1: Transpile the core widget (~400 lines)**
- Extract `breadcrumbsWidget.ts` + its `vs/base/` dependencies
- Transpile to ES module (esbuild single-file bundle, externalize nothing)
- Dependencies are all from `vs/base/` (utility code, no workbench)
- The `DomScrollableElement` is the biggest transitive dep (~600 lines) but also standalone
- Estimated total bundle: ~2-3KB minified

**Step 2: Build a TE2 `BreadcrumbsItem` subclass**
- `FilePathItem`: renders seti icon + directory/file name per path segment
- `SymbolItem`: renders codicon + symbol name from document outline
- Both use the existing seti icons (`app/static/vendor/seti-icons/`) for file type icons

**Step 3: Wire data from the workbench adapter**
- **File path**: already known from SSOT (`currentPath` + `project_root`). Split into segments. No adapter call needed.
- **Document symbols**: already available via `vscode.documentSymbols` adapter RPC. Returns a symbol tree.
- **Cursor → symbol mapping**: when cursor position changes, walk the symbol tree to find the deepest symbol whose range contains the cursor. This is ~20 lines of JS.

**Step 4: Mount in the editor UI**
- Place between `fe-toolbar` and the Monaco editor runtime
- Update on: file open (`editor:open`), cursor move (Monaco `onDidChangeCursorPosition`), symbol response
- Click handler: path segments emit `editor_open_request` (for folder nav) or scroll to symbol range

### Icon infrastructure (already available)
- **Seti icons**: `app/static/vendor/seti-icons/` — `getIcon(fileName)` returns SVG + color for 500+ file types
- **Codicons**: available from the Monaco bundle (`vs/base/common/codicons`) for symbol kind icons
- No additional icon assets needed

### What this does NOT need
- No `IOutlineService` — we have `vscode.documentSymbols` via the adapter
- No `IEditorService` — we have SSOT `currentPath`
- No `IWorkspaceContextService` — we have SSOT `project_root`
- No `BreadcrumbsControl` or `BreadcrumbsModel` — we build our own (much simpler)
- No `BreadcrumbsPicker` — optional future addition (dropdown on click)

### Build plan (esbuild from code-server worktree)

**Why esbuild, not manual vendoring:**
The core widget imports ~54 transitive files from `vs/base/` (dom.ts alone is 2633 lines, event.ts is 1812, lifecycle.ts is 888). Manually copying and maintaining those is impractical. Instead, we use esbuild to bundle the widget + all deps into a single tree-shaken ESM file.

**Directory structure:**
```
app/apps/code_te2/monaco_editor/vscode_build_src/
  ├─ README.md                  # What this is, how to rebuild
  ├─ build.mjs                  # esbuild script
  ├─ breadcrumbs_entry.ts       # Thin entrypoint (re-exports BreadcrumbsWidget)
  └─ out/
      └─ breadcrumbsWidget.js   # Bundled ESM artifact (served to browser)
```

**Build script (`build.mjs`):**
- Uses esbuild with `bundle: true, format: 'esm', platform: 'browser'`
- Resolves imports from `../mrselect6-2/code-server/lib/vscode/src/` (the worktree)
- Tree-shakes unused exports (breadcrumbsWidget.ts only uses ~10 functions from dom.ts's 2633 lines)
- Outputs single file to `out/breadcrumbsWidget.js`
- CSS is embedded (breadcrumbsWidget.css is 37 lines)
- Expected output: ~10-20KB minified (the widget + scrollbar + event/lifecycle/dom utilities)

**Entrypoint (`breadcrumbs_entry.ts`):**
```typescript
export { BreadcrumbsWidget, BreadcrumbsItem, IBreadcrumbsWidgetStyles, IBreadcrumbsItemEvent }
  from 'vs/base/browser/ui/breadcrumbs/breadcrumbsWidget';
export { ScrollbarVisibility } from 'vs/base/common/scrollable';
export { ThemeIcon } from 'vs/base/common/themables';
export { Codicon } from 'vs/base/common/codicons';
```

**Dependency resolution chain:**
```
breadcrumbsWidget.ts (366 lines)
  ├─ dom.ts (2633 lines, but tree-shaken to ~10 used functions)
  ├─ domStylesheets.ts (~50 lines)
  ├─ mouseEvent.ts (~100 lines)
  ├─ ui/scrollbar/scrollableElement.ts + 6 scrollbar files
  ├─ common/event.ts (1812 lines)
  ├─ common/lifecycle.ts (888 lines)
  ├─ common/arrays.ts (949 lines, tree-shaken to commonPrefixLength)
  ├─ common/themables.ts (117 lines)
  └─ common/scrollable.ts (522 lines)
Total transitive: ~54 unique .ts files from vs/base/ (all MIT licensed)
```

### Integration plan (after build)

**Step 1: Build the widget bundle**
- Create `vscode_build_src/` with build script + entrypoint
- Run esbuild → `out/breadcrumbsWidget.js`
- Serve via existing Monaco static route

**Step 2: Create TE2 breadcrumb component (`te2_breadcrumbs.js`)**
- Import `BreadcrumbsWidget`, `BreadcrumbsItem` from the bundle
- Implement `FilePathItem extends BreadcrumbsItem`:
  - `render()`: seti icon + segment name
  - Click → navigate explorer to that directory
- Implement `SymbolItem extends BreadcrumbsItem`:
  - `render()`: codicon + symbol name (class/function/variable)
  - Click → scroll Monaco to symbol range
- Mount widget in a container div between `fe-toolbar` and the inline editor container

**Step 3: Wire data sources**
- **File path**: listen to `editor:open` → split `currentPath` relative to `project_root` → update crumbs
- **Document symbols**: call `editor_workbench_symbols` on file open (already implemented)
- **Cursor tracking**: listen to Monaco `onDidChangeCursorPosition` → walk symbol tree → update active symbol crumbs
- **Symbol tree walk**: find deepest symbol whose `range.startLineNumber <= cursor.lineNumber <= range.endLineNumber`

**Step 4: Style to match TE2 theme**
- Map `IBreadcrumbsWidgetStyles` colors to TE2 CSS variables
- Separator icon: `Codicon.chevronRight` (already in the bundle)
- Height: ~22px (matches VS Code's breadcrumb bar)

## 19) File watcher pipeline — triple fallback

### Architecture
Code TE2 relies primarily on code-server's native watcher/IPC path, with fallback support for inotify-limit raising, optional watchexec polling, and manual refresh.

### Pipeline

```text
code-server parcel watcher detects disk change
  -> remoteFilesystem IPC channel fires EventFire (ResponseType 204)
  -> workbench_client.mjs onEvent({type: "watcher/fileChanges", changes: [...]})
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
- `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/src/workbench_client.mjs`: receives code-server watcher events.
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

## 20) Cursor Stability Hardening (Autosave + Git Diff)

This section documents the stabilization work that removed full-page thrash and significantly reduced cursor jumps under rapid typing.

### Root causes observed

1. **Diff mode flag drift in inline editor context**
   In `applyGitBaselines()`, `diffEditor.setModel(...)` was skipped when model refs matched, even if `te2AutosaveMode` / `te2FreezeProjection` / `modifiedBaseline` flags were stale.

2. **Mirror echo/jitter under autosave**
   `editor:mirror` applied full-buffer updates (`model.setValue(...)`) during active typing windows.

3. **Git baseline recompute racing typing**
   In autosave + inline diff mode, baseline updates could apply while the user was still entering text.

### Runtime fixes (inline-editor-only)

#### A) Diff flag parity enforcement

Inside `applyGitBaselines()`:
- Compute desired flags from current prefs (`autoSave`, inline diff state).
- If refs match but flags differ, force `diffEditor.setModel(desiredModel)` (no stale mode drift).
- Debug badge now surfaces this via:
  - `flags=ok as=<0|1> fr=<0|1> mb=<0|1>`
  - `flags=rebind ...`
  - `flags=set ...`

#### B) Mirror echo guards + autosave debounce

Mirror publisher/consumer now includes:
- Local mirror publish debounce:
  - autosave ON: `1000ms`
  - autosave OFF: `180ms`
- Hot-typing guard for inbound `editor:mirror`:
  - autosave ON: `850ms`
  - autosave OFF: `250ms`
- Drop conditions in mirror handler:
  - self echo (`source_client` matches socket id)
  - stale/no-op SHA (`payload.content_sha256 == lastContentSha256`)
  - hot typing window

Overlay counters:
- `mir=rx<...>/ap<...>/self<...>/sha<...>/hot<...>`

#### C) Debounced git baseline requests

Client-side request debounce:
- autosave ON: `320ms`
- autosave OFF: `180ms`
- Save-complete path still uses immediate request (`requestGitBaselines({ immediate: true })`).

#### D) Idle apply for autosave + diff

For **autosave ON + inline diff ON**, incoming `editor:git_baselines` payloads are deferred until typing is idle:
- apply idle window: `1000ms`
- latest payload wins (`pendingGitBaselinePayload`)
- debug badge shows `git=defer <ms>` while deferring.

### Build/linking caveat (critical)

If you copy build artifacts with:
`cp -r out-monaco-editor-core/esm/ app/static/vendor/monaco-editor-core/esm/`
you can accidentally create `esm/esm/...` and serve stale code from root `esm/...`.

Correct copy pattern:
`cp -r out-monaco-editor-core/esm/* app/static/vendor/monaco-editor-core/esm/`

Verification checks:
- `app/static/vendor/monaco-editor-core/esm/vs/.../diffEditorViewModel.js` contains `te2AutosaveMode` logic.
- Verify the current published Monaco ESM artifact containing the patched logic under `app/static/vendor/monaco-editor-core/esm/`.

### Key files

- `app/apps/code_te2/monaco_editor/m_editor_app.ts`
  - flag parity check in `applyGitBaselines()`
  - mirror debounce/guards and mirror debug counters
  - debounced/idle git baseline scheduling
- `worktrees/vscode-te2-diff/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts`
  - autosave-gated TE2 diff control flow (`te2AutosaveMode`)
- `worktrees/vscode-te2-diff/src/vs/editor/common/editorCommon.ts`
  - `IDiffEditorModel.te2AutosaveMode?: boolean`

---

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

---

## 22) Extension Configuration Auto-Extraction

### Problem

VS Code extensions read settings during `activate()` via `workspace.getConfiguration("section").get("key")`.
This reads from the ext host's in-memory configuration model, which is populated by the
`$initializeConfiguration` RPC (rpcId=80) sent from the workbench adapter at boot.

If an extension's config keys are missing from the data we send, `get()` returns `undefined`.
Extensions that gate on enable flags (e.g. clangd checks `clangd.enable`) silently skip
starting their language server — no error, no crash, just no providers registered.

Previously `_buildConfigurationInitData()` hardcoded per-extension configs (Python only).
Every new extension required manual additions. This doesn't scale and is fragile.

### Solution — automatic defaults from `package.json`

Every VS Code extension declares its settings in `package.json` under
`contributes.configuration.properties`. Each property has a dotted key and a schema with a
`"default"` value:

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "clangd.enable": { "type": "boolean", "default": true },
        "clangd.path":   { "type": "string",  "default": "clangd" }
      }
    }
  }
}
```

`_buildConfigurationInitData(folder, authority, scannedExtensions)` now:

1. Iterates ALL `scannedExtensions` (already available from mgmt scan)
2. For each extension, reads `packageJSON.contributes.configuration.properties`
3. For each property with a `"default"` value, splits the key at dots
   (e.g. `"clangd.enable"` → section `clangd`, prop `enable`) and nests it into a
   `contents` object — handles deeply nested keys like `"python.analysis.autoSearchPaths"`
4. Sends the whole thing as the `defaults` field of `IConfigurationInitData`
5. User/extension overrides come from `User/settings.json` via `userRemote` (see §29)

The result: any installed extension gets its declared defaults automatically. No hardcoding.

### Wire format

The `$initializeConfiguration` payload is `IConfigurationInitData`:

```
{ defaults, policy, application, userLocal, userRemote, workspace, folders, configurationScopes }
```

Each section is an `IConfigurationModel`:

```
{ contents: { section: { key: value, ... } }, overrides: [], keys: ["section.key", ...] }
```

`defaults` carries the extension-contributed defaults. `userRemote` carries TE2 overrides
from `User/settings.json`. `workspace` and `folders[0]` carry project-scoped overrides
from `<projectRoot>/.vscode/settings.json` (see §29). All other sections are empty.

After `$initializeConfiguration`, we also send `$acceptConfigurationChanged` with the same
data and the full key list so extensions that listen for config changes pick up the values.

### TE2 overrides (applied after scan)

No hardcoded extension overrides remain in the WBA configuration builder. The Languages & Extensions modal exposes only two effective scopes:

1. **User** is the global remote-workbench scope. Both the extension schema form and the User JSON editor read and write the same registry v2 `user_settings` map.
2. **Workspace** is the active repository scope and reads/writes `<projectRoot>/.vscode/settings.json` directly.

`rebuild_settings_gate()` atomically materializes the User map together with TE2's generated global and language gates into `~/.config/code-server/User/settings.json`. The WBA reads that one file into `userRemote`; TE2 intentionally leaves `userLocal` and profile-specific settings empty. Workspace settings are sent through `workspace` and `folders[0]`, so normal VS Code precedence makes repository values override global User values.

Registry v1 data is migrated once. Legacy per-extension `configuration_values`, effective non-generated values from the existing User file, and legacy `custom_settings` are folded into `user_settings`; explicit legacy User JSON values win historical conflicts.

### Key file

`workbench_client.mjs` → `_buildConfigurationInitData()` (~line 1120)


## 29) Settings Pipeline - User and Workspace Settings

### Overview

The settings UI and WBA expose two scopes, not VS Code's full local/remote/profile matrix:

```text
Extension schema form -+
                       +-> registry v2 user_settings
User Settings JSON ----+           |
                                   | rebuild_settings_gate()
                                   v
                     User/settings.json -> userRemote

Workspace schema form -+
                       +-> <projectRoot>/.vscode/settings.json
Workspace JSON --------+              -> workspace + folders[0]
```

The extension schema form is only a typed view over keys in the same User or Workspace object. It is not a third settings authority and does not store values on extension registry entries.

### Materialization priority in `rebuild_settings_gate()`

The global User file is generated atomically in this order, with later values winning:

1. `_GLOBAL_GATE`, which disables smart editor features globally.
2. `_LANGUAGE_SLOT_OVERRIDES` for active language-feature slots.
3. The existing framework-owned `files.watcherExclude` value.
4. Registry `user_settings`, which is the user-owned global map.

This allows an explicit User value to override a generated gate. Removing a schema key removes it from `user_settings` and therefore from the next materialized User file.

### VS Code configuration precedence (adapter-level)

The adapter builds `IConfigurationInitData` with these effective sections, low to high:

1. `defaults` from extension `contributes.configuration` defaults.
2. `userRemote` from `User/settings.json`.
3. `workspace` from `<projectRoot>/.vscode/settings.json`.
4. `folders[0]`, which mirrors `workspace` for the single-root project.

`application`, `policy`, `userLocal`, and profile-specific settings are intentionally empty in TE2. Workspace settings override User settings for overlapping keys.

### Adapter relay

The WBA configuration builder reads both settings files:

- Flat dotted User keys are nested and sent in `userRemote`.
- User language blocks such as `[python]` become configuration overrides.
- Workspace keys and language blocks use the same conversion and are sent in `workspace` plus `folders[0]`.
- After `$initializeConfiguration`, `$acceptConfigurationChanged` republishes the effective configuration and key list.

A settings save restarts only the adapter path required to rebuild extension-host configuration; it does not introduce another persistent settings tier.

### Project config files override editor settings

Extensions such as basedpyright may read project config files directly from disk, including `pyrightconfig.json` and `pyproject.toml`. Their own precedence rules can override both User and Workspace editor settings. This is extension behavior, not another TE2 settings scope.

### User Settings UI

The User tab offers two synchronized views of one global map:

- extension schema forms edit only the keys declared by that extension;
- the User Settings JSON editor can edit arbitrary global keys.

Both persist to registry `user_settings` and materialize to `User/settings.json`. Saving one view is immediately reflected when the other view is reopened.

### Workspace Settings UI

The Workspace tab reads and writes the active project's `.vscode/settings.json`. Schema forms merge only the selected extension's keys, while the Workspace JSON editor exposes the complete object. Saving creates the `.vscode` directory when needed and restarts the adapter.

Extension enable/disable and uninstall remain global operations, so those controls are hidden while Workspace scope is active.

### Legacy migration

Loading a registry older than version 2 performs a one-time migration into `user_settings`. The migration combines effective non-generated User file values and legacy per-extension values, then applies legacy `custom_settings` last so explicit User JSON wins conflicts. Legacy `configuration_values` and `custom_settings` fields are removed.

### Key files

| File | Role |
|------|------|
| `extension_registry.py` | User settings authority, legacy migration, schema-key merge, and atomic User file materialization |
| `explorer/handlers/extensions.py` | User and Workspace settings RPC handlers |
| `workbench_protocol_proxy/node_workbench_adapter/src/client/configuration.ts` | Maps User to `userRemote` and repository settings to `workspace` / `folders[0]` |
| `main_page/frontend/ui/settings-refresh.ts` | User and Workspace JSON loading/saving |
| `main_page/frontend/ui/settings-manager.ts` | Scope-aware extension schema configuration |
| `main_page/frontend/ui/settings-config-modal.ts` | Typed schema form save behavior |
| `template.html` | Languages & Extensions modal and User/Workspace tabs |

## 23) Semantic Tokens Pipeline (End-to-End)

### Problem

Monaco standalone has no built-in semantic token support from VS Code's extension host. Five barriers had to be overcome:

1. **CancellationToken argument bug** — VS Code's RPC layer auto-pushes a real `CancellationToken` onto the args array. Passing `{}` as a placeholder shifted all parameters, causing `n.onCancellationRequested is not a function` errors on every semantic token request.

2. **Uint32Array alignment crash** — Node.js Buffer pool uses a shared ArrayBuffer. `buf.byteOffset` isn't guaranteed to be 4-byte aligned, so `new Uint32Array(buf.buffer, buf.byteOffset, ...)` throws RangeError. This crash was caught silently and returned as a JSON-RPC error to the frontend.

3. **Monaco `semanticHighlighting = false`** — `standaloneThemeService.ts` hardcodes this flag to `false`, so `isSemanticColoringEnabled()` always returns false and Monaco never applies semantic tokens even when data arrives.

4. **No semantic-to-TextMate scope mapping** — Monaco standalone's `getTokenStyleMetadata()` matches semantic token type names directly against theme rules, but themes only define TextMate scope names. Without a bridge, `function` tokens get white instead of purple, `variable` tokens get orange instead of white, etc.

5. **`setColorMap` palette conflict** — Encoded TextMate tokenization (`tokenizeLine2`) requires `setColorMap()` to sync the ~300-color TextMate palette to Monaco. But this replaces the rendering palette, making semantic token foreground indices (compiled against the ~20-color theme palette from `defineTheme`) point to wrong colors. E.g., index 7 = orange in the theme palette but some random blue in the TextMate palette.

### Solution

1. **CancellationToken fix**: Never include `{}` in args for cancellable requests. The `cancellable: true` flag sets wire type 2/4, and the RPC layer handles the rest. See `WORKBENCH_SEMANTIC_COMPLETIONS_KNOWLEDGE.md` for the full arg patterns table.

2. **Alignment fix**: Copy buffer to a fresh aligned `Uint8Array` before creating `Uint32Array`. Applied to both `semanticTokens()` and `semanticTokensRange()` in `workbench_client.mjs`.

3. **semanticHighlighting source fix**: Changed `standaloneThemeService.ts:182` from `false` to `true` in the TE2 Monaco build. A runtime monkey-patch (`_forceSemanticHighlighting()`) also exists as a fallback.

4. **Semantic token color mapping**: `buildSemanticTokenRules()` (in `editor_semantic_token_rules_utils.js`, called by theme conversion runtime) mirrors VS Code's `TokenClassificationRegistry` by mapping each semantic token type (e.g., `function`, `variable`, `parameter`) to its equivalent TextMate scope (e.g., `entity.name.function`, `variable.other.readwrite`, `variable.parameter`), resolves the color from the theme's `tokenColors`, and injects the rules into the Monaco theme.

5. **Palette index translation**: `_patchSemanticTokenColorIndices()` monkey-patches `getTokenStyleMetadata` on the active theme object. After `setColorMap` overrides the rendering palette, the patch translates foreground indices: tokenTheme index → hex color (via `Color.toString()`) → find matching hex in TextMate color map → return TextMate index. This ensures semantic tokens render the correct color even when the rendering palette has been overridden.

### Encoded TextMate tokenization

TE2 uses vscode-textmate's encoded mode (`tokenizeLine2`) instead of text mode (`tokenizeLine`). Text mode only provides the innermost scope string per token — Monaco matching this single scope against theme rules produces different colors than code-server, which evaluates the full scope stack.

Encoded mode resolves the full scope stack against the theme internally and returns a `Uint32Array` with pre-computed color indices, matching code-server exactly. Requirements:
- `registry.setTheme(IRawTheme)` must be called before tokenization
- `monaco.languages.setColorMap(registry.getColorMap())` syncs the rendering palette
- Provider exposes `tokenizeEncoded(line, state)` — Monaco auto-detects this via `isEncodedTokensProvider()`

### Data flow

```
ext host ($provideDocumentRangeSemanticTokens)
  → workbench_client.mjs (decode Uint32Array, attach legend)
  → server.mjs (vscode.semanticTokensRange route)
  → /wba reply
  → m_editor_app.ts / editor_workbench_runtime.ts
  → Monaco getTokenStyleMetadata() → _patchSemanticTokenColorIndices translation → rendered colors
```

### Token data format

5-element tuples in a flat Uint32Array: `[deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifiersMask]`

- `tokenTypeIndex` indexes into `legend.tokenTypes` (e.g., 0 = "namespace", 7 = "variable", 11 = "function")
- `tokenModifiersMask` is a bitmask indexing into `legend.tokenModifiers` (e.g., bit 0 = "declaration", bit 3 = "readonly")

### Monaco build required

The `semanticHighlighting = true` source change requires a Monaco rebuild:

```bash
cd worktrees/vscode-te2-diff
NODE_OPTIONS="--max-old-space-size=4096" npx gulp editor-distro
# Copy ESM artifacts
VENDOR_DIR="../../app/static/vendor/monaco-editor-core"
rm -rf "$VENDOR_DIR/esm" && mkdir -p "$VENDOR_DIR/esm"
cd out-monaco-editor-core/esm
find . \( -name "*.js" -o -name "*.css" -o -name "*.ttf" \) \
  -exec sh -c 'mkdir -p "'"$VENDOR_DIR"'/esm/$(dirname "$1")" && cp "$1" "'"$VENDOR_DIR"'/esm/$1"' _ {} \;
# Rebuild the inline editor bootstrap bundle
cd ../.. && node ../../scripts/build_monaco_bootstrap_bundle.mjs
```

### Key files

| File | Role |
|---|---|
| `workbench_client.mjs` | CancellationToken fix, Uint32Array alignment fix, legend extraction, semantic token RPC, `resync()` |
| `server.mjs` | `vscode.semanticTokensRange` route, `te2.resync` RPC |
| `editor_wba_rpc_transport.ts` | direct `/wba` transport for semantic-token RPC and notifications |
| `editor_workbench_runtime.ts` | direct semantic-token request path and readiness gating |
| `editor_ws.py` | residual backend `te2.resync` trigger in readiness/model-ready paths |
| `m_editor_app.ts` + `editor_*_utils.js` | Theme/runtime orchestration (`_forceSemanticHighlighting()`, `_patchSemanticTokenColorIndices()`, encoded TextMate provider `tokenizeEncoded`, `_applyThemeToTextmateRegistry()`), with semantic/theme rule builders extracted to utility modules |
| `standaloneThemeService.ts` | Source fix: `semanticHighlighting = true` |
| `tokenClassificationRegistry.ts` | VS Code's semantic-to-TextMate mapping (reference) |

### Page reload / multi-client: `te2.resync`

Provider registrations are one-time events from ext host boot. A fresh frontend (page reload) or second client never sees them. The `te2.resync` RPC solves this:

1. A backend control-plane caller sees the adapter is already running
2. It calls `te2.resync` over stdio `adapter_rpc(...)`
3. The adapter replays cached provider/diagnostics-side events through its editor-facing `/wba` socket server
4. The connected inline editor runtime re-registers providers with legends without restarting the adapter

Properties:
- No adapter restart — ext host stays hot, baton sequence untouched
- Multi-client safe — each client can receive the replay through `/wba`
- Idempotent — `registeredSemanticTokens` set guards against duplicates
- First step toward Option 3 architecture (adapter as stateful backend)

### Known limitations

- **Hover tooltip colors**: Hover code blocks use `colorize()` (TextMate tokenization), not semantic tokens. Parameter colors in hovers may be a slightly different shade than the editor's semantic token color (TextMate-resolved vs semantic-resolved for the same scope).
- **Python semantic tokens**: Pyright (open-source) does not register a semantic token provider. Only TypeScript/JavaScript get semantic tokens from the ext host. Python semantic tokens require Pylance (proprietary, unavailable for code-server). Python coloring is purely TextMate-based.
- **Palette patch timing**: `_patchSemanticTokenColorIndices()` must run after editor creation + tmRegistry initialization + setColorMap. Multiple call sites ensure at least one hits the right timing window.

### Background full-token projections

The retained WBA logical-document set also owns background full-document
semantic-token prewarming.

- Only real full-document semantic token providers participate. Range providers
  remain foreground, range-bound requests; WBA never fabricates ranges.
- Hydrated background documents are queued in logical/MRU order and computed
  with concurrency one. The queue pauses while a visible `openFile`
  transaction is in flight.
- The cache key includes WBA document version, content identity, language,
  SHA-256 text fingerprint, project generation, and full-provider generation.
- A foreground Monaco full-token request uses the existing
  `vscode.semanticTokens` path. When its text fingerprint matches, WBA returns
  the compact cached map without an extension-host provider round trip.
- The draft-safe foreground synchronization barrier remains in place, but a
  byte-identical full-text update changes only document metadata. It does not
  advance the WBA model version, emit `$acceptModelChanged`, or invalidate the
  prewarmed token map. A real text mutation performs all three.
- The editor keeps one stable semantic-token provider registration per language.
  Replayed selector snapshots are reconciled by provider handle, full providers
  win over range providers when both exist, and duplicate registrations are
  no-ops. Real provider or legend changes produce one microtask-coalesced,
  language-scoped invalidation; reconnect hydration finishes with one active
  language refresh instead of per-selector invalidation bursts.
- Real text mutation, logical close, workspace/session reset, or a full-provider
  change invalidates the complete entry. Range-provider changes do not invalidate
  it.
- Cached arrays are retained as `Uint32Array` with a 32 MiB whole-entry LRU
  budget. Entries are never truncated; eviction releases the corresponding
  extension-host semantic-token result ID.

## 24) Completions Pipeline (End-to-End)

### Overview

Completions flow from the frontend through the same WBA RPC pipeline as other editor language features. The user types → Monaco fires `provideCompletionItems` → the inline editor runtime serializes the request onto `/wba` → the adapter calls `$provideCompletionItems` on the ext host → results come back as a minified `ISuggestResultDto` → the adapter inflates the DTO → results propagate back to Monaco.

### Data flow

```
Monaco CompletionItemProvider.provideCompletionItems()
  → m_editor_app.ts / editor_workbench_runtime.ts
  → editor_wba_rpc_transport.ts: /wba RPC "vscode.completions"
  → server.mjs: route to wb.completions()
  → workbench_client.mjs: $provideCompletionItems(handle, resource, position, context, token)
  → ext host: language server computes completions
  ← ISuggestResultDto (minified wire format)
  ← workbench_client.mjs: _inflateCompletionItems() → Monaco suggestions
  ← server.mjs → /wba reply → Monaco widget
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

**Part 2 — Adapter (`workbench_client.mjs`)**:
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
| `m_editor_app.ts` | `provideCompletionItems`, `_flushMirrorDebounce()`, sends `text` param |
| `editor_wba_rpc_transport.ts` | direct `/wba` RPC transport |
| `editor_workbench_runtime.ts` | maps completion requests to WBA RPC |
| `server.mjs` | `vscode.completions` route — passes text to `wb.completions()` |
| `workbench_client.mjs` | `completions()` — pre-flight didChange, `$provideCompletionItems`, `_inflateCompletionItems()` |

### Inflation and range handling

`_inflateCompletionItems()` in `workbench_client.mjs`:
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

## 26) Monarch Palette Corruption Fix (Universal)

### Problem

Monaco has two independent tokenization systems:

| System   | Path | Token encoding |
|----------|------|---------------|
| TextMate | `vscode-textmate` registry → `tokenizeLine2()` | `Uint32Array` with foreground indices from the TextMate color map (~300 colors) |
| Monarch  | Regex rules → `tokenTheme.match(languageId, scopes)` | Packed metadata with foreground indices from tokenTheme's internal palette (~20 colors) |

When `setColorMap()` overrides the rendering palette with TextMate's color map, Monarch-only languages (Kotlin, TOML, Makefile, etc.) resolve their foreground indices against the wrong palette, producing incorrect colors.

### Root cause

`TokenTheme.match()` returns metadata containing foreground indices from its own small palette. After `setColorMap()`, the renderer uses the TextMate color map (which is much larger and has different index→color mappings). The Monarch indices now point to the wrong colors.

### Fix: `_colorIndexTranslation` in `TokenTheme`

**File**: `worktrees/vscode-te2-diff/src/vs/editor/common/languages/supports/tokenization.ts`

A translation array is added to `TokenTheme`:

```
_colorIndexTranslation: Uint32Array | null = null;
```

In `match()`, when `_colorIndexTranslation` is set, the foreground index is extracted from the metadata, looked up in the translation table, and repacked:

```
const fg = (metadata & 0x00FFFF80) >>> 15;
if (fg < this._colorIndexTranslation.length) {
    const mapped = this._colorIndexTranslation[fg];
    metadata = ((metadata & ~0x00FFFF80) | (mapped << 15)) >>> 0;
}
```

**MetadataConsts bit layout** (from `encodedTokenAttributes.ts`):
- `FOREGROUND_MASK`: `0x00FF8000` → bits 15–22
- `FOREGROUND_OFFSET`: 15

### Wiring

`_patchSemanticTokenColorIndices()` in `m_editor_app.ts` builds the translation table by matching colors from tokenTheme's small palette to their indices in the TextMate color map, then sets it directly on the tokenTheme object:

```js
theme.tokenTheme._colorIndexTranslation = indexTranslation;
theme.tokenTheme._cache.clear();
```

The cache must be cleared because previously cached metadata has stale foreground indices.

**Tree-shaking note**: The `setColorIndexTranslation()` method was tree-shaken from the Monaco build because it was only called through `as any` casts. The field `_colorIndexTranslation` and the `match()` logic survive because they execute in the hot path.

### Key files

| File | Role |
|------|------|
| `tokenization.ts` (patched source) | `_colorIndexTranslation` field + translation logic in `match()` |
| `standaloneThemeService.ts` (patched source) | `setColorMapOverride()` builds translation + forwards |
| `m_editor_app.ts` `_patchSemanticTokenColorIndices()` | App-layer: sets field directly on tokenTheme |
| `monaco.bootstrap.bundle.js` | Built bundle containing the fix (~line 164490) |

## 27) Dynamic Theme System

### Architecture overview

Themes are discovered from two sources:

1. **Vendored themes** — shipped in `monaco_editor/themes/vendored/{vendor}/`
2. **Extension themes** — discovered via `contributes.themes[]` in installed VSIX extensions

Both sources are merged by `GET /monaco_editor/available_themes` and returned as:

```json
{
  "id": "github-dark-default",
  "label": "GitHub Dark Default",
  "uiTheme": "vs-dark",
  "source": "vendored",
  "sourceLabel": "GitHub Theme (Bundled)",
  "serveUrl": "/api/app/code_te2/ui/monaco_editor/themes/vendored/github/github-dark-default.json"
}
```

### Vendored themes

Located at `monaco_editor/themes/vendored/github/`:
- `theme_index.json` — manifest mapping theme IDs to filenames
- 9 theme JSON files (GitHub Dark Default, GitHub Light, Dimmed, High Contrast, etc.)

### Extension `contributes.themes` parsing

`extension_registry.py` → `_parse_extension_package()` extracts `contributes.themes[]` entries from each extension's `package.json`:

```python
themes = pkg.get("contributes", {}).get("themes", [])
```

Each entry yields `{id, label, uiTheme, path}`. These appear in the `available_themes` response with `source: "extension"`.

### Frontend registry

`m_editor_app.ts`:
- `_ensureThemeRegistry()` — fetches `available_themes` once, builds a `Map<id, entry>`
- `_getVscodeThemeJsonUrl(themeId)` — looks up serve URL from registry; fallback to vendored path map
- `loadVscodeTextmateThemes()` — loads ALL themes from registry into `_jsonCache`, calls `defineTheme()` for each
- `resolveMonacoThemeId(themeKey)` (from `editor_theme_resolver_utils.js`) — normalizes theme key to Monaco-registered theme ID
- `applyMonacoTheme(themeKey)` — applies theme + lazy load + TextMate sync + palette patch + retokenization

### Theme submodal (UI)

| Element | Purpose |
|---------|---------|
| `#editor-themes-modal` (z-index 345) | Full theme browser, fe-modal pattern |
| `#editor-settings-theme-strip` | Clickable strip in settings modal → opens theme browser |

Sections: **Bundled** (vendored), **From Extensions** (installed).

> **Built-in Monaco themes disabled** — `vs`, `vs-dark`, `hc-black`, `hc-light` are hidden from the theme picker and their IDs redirect to the closest GitHub vendored theme. These built-in themes lack a `tokenColors` array, so after `setColorMap()` overrides the rendering palette for TextMate, semantic tokens resolve foreground indices against the wrong palette (producing black or invisible text). Only vscode-style themes with full `tokenColors` JSON are supported. This will be revisited when a proper `setColorMap(null)` → retokenize pipeline is implemented.

### Key files

| File | Role |
|------|------|
| `m_editor_app.ts` + `editor_theme_*_utils.js` | Theme registry, loading, conversion, and application |
| `editor_backend.py` | `GET /available_themes` endpoint, vendored theme serving |
| `extension_registry.py` | `contributes.themes[]` parsing |
| `main_page/frontend/` | Theme submodal open/close/refresh logic |
| `template.html` | `#editor-themes-modal` markup |
| `themes/vendored/github/theme_index.json` | Vendored theme manifest |

### Gotchas

- **Short hex colors**: Monaco's tokenization parser rejects 3/4-char CSS shorthand hex (`#fff`, `#0008`). Converter helpers in `editor_parse_utils.js` expand these to 6/8-char before passing to `defineTheme()`.
- **Built-in themes disabled**: `vs`, `vs-dark`, `hc-black`, `hc-light` are hidden from the picker. They lack `tokenColors` so semantic tokens resolve to wrong palette indices after `setColorMap()`. IDs redirect to closest GitHub vendored theme via `resolveMonacoThemeId()` (`editor_theme_resolver_utils.js`). See §28 for related retokenization details.

## 28) Theme-Switch Retokenization

### Problem

After `applyMonacoTheme()` calls `setTheme()` + `setColorMap()` + `_patchSemanticTokenColorIndices()`, the already-tokenized lines in the editor model still contain cached token data from the **old** theme. Colors only update after a full page reload.

### Fix

At the end of `applyMonacoTheme()`, after all theme/palette/translation updates are complete, force retokenization on every open model:

```js
var models = window.monaco.editor.getModels();
for (var mi = 0; mi < models.length; mi++) {
  if (models[mi] && typeof models[mi].resetTokenization === 'function') {
    models[mi].resetTokenization();
  }
}
```

`resetTokenization()` invalidates the model's line-level token cache, causing Monaco to re-run all tokenizers (TextMate `tokenizeLine2` and Monarch `match()`) against the updated color map and translation table.

### Execution order in `applyMonacoTheme()`

1. `loadVscodeTextmateThemes()` — ensure all themes defined
2. `resolveMonacoThemeId()` — normalize theme key
3. Lazy-load single theme if not cached
4. `monaco.editor.setTheme(resolvedId)` — activates theme, rebuilds `tokenTheme`
5. `_applyThemeToTextmateRegistry(tmActiveThemeJson)` — updates TextMate color map via `setColorMap()`
6. `_forceSemanticHighlighting()` — ensures semantic tokens enabled
7. `_patchSemanticTokenColorIndices()` — rebuilds `_colorIndexTranslation` on new tokenTheme + clears cache
8. **`resetTokenization()` on all models** — flushes stale line tokens, triggers full retokenization

---

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

The workbench adapter (`workbench_client.mjs`) replaces the real renderer.
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
| `workbench_client.mjs` (TE2) | Named `_rpcIds` lookups, config loader, hardcoded fallback defaults |
| `extension_registry.py` (TE2) | `ensure_rpc_config()` — version-gated extraction and caching |
| `workbench_adapter_shell_manager.py` (TE2) | Calls `ensure_rpc_config()` before adapter launch |
| `~/.config/code-server/te2_rpc_config.json` | Cached nid map (auto-generated, version-gated) |

## 31) Adapter Auto-Restart & Status Indicator

### Problem

When extensions are installed, uninstalled, toggled, or reconfigured, the workbench adapter (and sometimes code-server) must be restarted for changes to take effect. Previously this required a full page reload. There was also no persistent visual indicator showing whether the adapter was connected.

### Solution: auto-restart pipeline

Extension operations trigger automatic shell termination and inline editor remount:

| Operation | Shells killed | Handler |
|-----------|--------------|---------|
| Install / Uninstall | code-server + adapter | `_restart_code_server_and_adapter()` |
| Toggle / Configure / User Settings | adapter only | `_restart_adapter_only()` |
| Manual restart (UI menu) | adapter only | `handle_ext_restart_adapter()` |

### Restart flow

1. **Backend**: extension handler (e.g. `handle_ext_configure`) calls `_restart_adapter_only()`
2. **Backend**: `terminate_adapter_shell()` kills the Node process, clears pipe/reader/RPC state, cancels pending futures
3. **Backend**: emits `ext:adapter_restarting` to frontend via explorer WS
4. **Frontend**: save handler calls `_reloadEditorIframe()` (legacy name) which now remounts the inline editor runtime:
   - Resets `window.__adapterConnected = false`
   - Sets spinner to busy state
   - Reboots the inline editor host after 1.5 s delay (let shell terminate)
   - Re-invokes `ensureWorkbenchAdapterReady()` after 2 s (let the editor runtime reconnect)
5. **Inline editor runtime**: boots → emits `editor_readiness_check` → backend launches new adapter → baton completes → spinner goes green

The `ext:adapter_restarting` event handler is a safety-net backup. The primary reload is triggered directly by the save/install handlers in the host frontend module graph.

### 3-state status indicator

The spinner element (`#fe-lsp-spinner`) is always visible with three CSS states:

| State | CSS class | Visual | Meaning |
|-------|-----------|--------|---------|
| busy | `fe-lsp-status--busy` | Animated spinner | Adapter starting or diagnostics running |
| ok | `fe-lsp-status--ok` | Green check (✓) | Adapter connected |
| error | `fe-lsp-status--error` | Red X (✗) | Adapter not connected |

State is managed by `_feUpdateLspSpinner()` which reads:
- `window.__feLspSpinnerUi.busyShow` — true while an activity is in progress
- `window.__adapterConnected` — set to true by `_spinnerHide()` after baton completes

### Adapter context menu

Long-press (touch) or right-click (desktop) on the status indicator opens a dropdown (`#fe-adapter-dd`) with:
- **Reload Extension Adapter** — sends `ext:restart_adapter` to backend, triggers full restart flow

Uses the `fe-menubar` dropdown pattern (not native browser menus).

### Shell termination helpers

- `terminate_adapter_shell()` in `workbench_adapter_shell_manager.py`: kills adapter process, clears `_adapter_pipe`, `_pipe_reader_task`, `_rpc_pending` futures, resets `_adapter_ready`
- `terminate_code_server_shell()` in `code_server_shell_manager.py`: kills code-server process, resets `_code_server_ready` event

Both use the framework-shells `terminate` endpoint to kill the underlying shell.

### Key files

| File | Role |
|------|------|
| `workbench_adapter_shell_manager.py` | `terminate_adapter_shell()` — adapter teardown |
| `code_server_shell_manager.py` | `terminate_code_server_shell()` — code-server teardown |
| `explorer_ws.py` | `_restart_adapter_only()`, `_restart_code_server_and_adapter()`, restart handlers |
| `template.html` | 3-state CSS classes, `#fe-adapter-dd` dropdown, spinner default class |
| `main_page/frontend/` | Inline editor remount, LSP spinner, adapter dropdown, and host event handlers |

## 32) Touch Selection Extension (`monaco-touch-selection`)

Mobile touch handling (teardrops, selection handles, context menu) is provided by
a **vendored, patched fork** of the
[monaco-touch-selection](https://github.com/nicepkg/monaco-collection) library
(upstream v1.1.1 by _potmot_).  The fork lives in a local worktree, is built from
TypeScript source, and the UMD output is deployed into the editor's static vendor
directory.

### Overview

The extension hooks into a Monaco `ICodeEditor` and adds:

- **Teardrop cursor indicator** — a draggable handle below the cursor.
- **Selection handle bars** — left/right draggable handles around a selection range.
- **Touch context menu** — a floating toolbar with clipboard, selection, hover, and undo/redo tools.
- **Centered utility islands** — separate mobile tab and code-inspector toolbars centered by their combined width.
- **Drag-to-reveal** — while dragging a handle, the editor auto-scrolls to keep the cursor visible.
- **Touch offset** — during drag, the target position is shifted up by 1.5 line-heights so the user's finger doesn't occlude the text.
- **Rendered-column hit testing** — horizontal touch coordinates are resolved against Monaco's rendered column offsets, including tabs and variable-width glyph advances.

### TE2-specific patches (on top of upstream)

| Patch | What it does |
|-------|-------------|
| **Dynamic `EditorOption` lookup** | Resolves `fontSize` / `lineHeight` enum IDs at call-time via `globalThis.monaco`, not at UMD-load-time (avoids wrong fallback values in TE2's Monaco build) |
| **`bottomCursor` positioning fix** | Uses `top` + `marginTop` instead of `bottom` so the teardrop renders at the correct vertical offset |
| **Config-change listener** | Re-reads `fontSize` / `lineHeight` on `editor.onDidChangeConfiguration` so teardrop position updates after settings changes |
| **Touch offset correction** | During drag, targets `clientY + touchOffsetY - lineHeight * 1.5` for finger clearance |
| **Precise horizontal targeting** | Uses `getOffsetForColumn()` with a binary search bounded to the touched visual row, choosing the nearest rendered column without crossing Monaco wrap boundaries |
| **Fixed-rate drag sampling** | `touchmove` records only the latest touch; one 50 ms loop resolves rendered columns, performs edge scrolling, and writes changed Monaco positions without accumulating per-event work |
| **Touch menu activation** | Handle taps and completed handle drags open the menu islands automatically; desktop remains explicit right-click behavior |
| **Selection adjustment primitives** | Grow/shrink tools remain available to custom integrations, but the default mobile menu no longer mounts their island |
| **Select Word tool** | Built-in tool that selects the word at the cursor position |
| **Hover tool** | Built-in tool (🚁) that closes the menu and triggers `editor.action.showHover` at the cursor |

> **Critical timing note**: `EditorOption` enum lookup **must** happen inside
> `editorTouchSelectionHelp()` at call-time, not at module/UMD-load-time.
> `globalThis.monaco` is not yet available when the UMD script is first evaluated.
> Placing the lookup at module scope causes fallback values (52/67) to be used,
> which breaks teardrop positioning.

### Build process

```bash
# 1. Source lives in the local worktree
cd worktrees/monaco-touch-selection/

# 2. Compile TypeScript and build both JavaScript and CSS
npm run build
#    → dist/index.umd.cjs   (deployed file)
#    → dist/index.js         (ESM, not used)
#    → dist/style.css         (deployed file)

# 3. From the repository root, deploy the generated vendor assets
cp worktrees/monaco-touch-selection/dist/index.umd.cjs \
   app/apps/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js
cp worktrees/monaco-touch-selection/dist/style.css \
   app/apps/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.css
```

The patched CSS source is `worktrees/monaco-touch-selection/src/style.css`.
The files under the Code TE2 static vendor directory are deployment artifacts;
do not patch them independently from the worktree source.

### Gesture reference

| Gesture | Target | Action |
|---------|--------|--------|
| **Tap** | Editor surface | Set cursor position |
| **Double-tap** | Editor surface | Select word at tap position |
| **Tap** | Teardrop (cursor handle) | Open the touch-menu stack |
| **Drag** | Teardrop (cursor handle) | Reposition the cursor through the fixed-rate rendered-column sampler with calibrated 1.5-line finger clearance; open menus on release |
| **Drag** | Selection handle bar | Adjust the range boundary through the fixed-rate sampler; open menus on release |
| **Tap** | Line number gutter | Select entire line above the tapped line |
| **Tap then drag** | Line number gutter | Change line range selection |

### Touch menu tools

Tools appear in the context menu in the order listed below.

| # | Tool | Icon | Action | Menu after |
|---|------|------|--------|------------|
| 1 | **Copy** | 📋 (clipboard SVG) | Copy selection to clipboard | Stays open |
| 2 | **Cut** | ✂️ (scissors SVG) | Cut selection to clipboard | Stays open |
| 3 | **Paste** | 📥 (paste SVG) | Paste from clipboard at cursor | Stays open |
| 4 | **Undo** | ↩ (undo SVG) | Undo last edit | Stays open |
| 5 | **Redo** | ↪ (redo SVG) | Redo last edit | Stays open |
| 6 | **Select Word** | ⬚ (dashed box SVG) | Select the word at cursor position | Stays open |
| 7 | **Select All** | ↔ (expand arrows SVG) | Select all text in editor | Stays open |
| 8 | **Hover** | 🚁 (helicopter emoji) | Close menu, show hover info at cursor position | Closes |
| 9 | **Close** | ✕ (X SVG) | Dismiss the touch menu | Closes |

The mobile utility row keeps the tab-navigation and code-inspector controls in
separate islands, centered as one combined group. Grow/shrink selection tools
remain available to custom integrations but are not mounted by default.

### Initialization

The extension is loaded in `m_editor_app.ts` as a UMD global:

```js
// Called after editor DOM is ready (and on re-init after language switches)
window['monaco-touch-selection'].editorTouchSelectionHelp(editor);
```

No options object is passed — all tools (including Hover) are built into the
extension source.  The `tools` callback is available for external consumers who
need to add custom tools, but TE2 does not use it.

### Key files

| File | Role |
|------|------|
| `worktrees/monaco-touch-selection/src/index.ts` | TypeScript source — all patches, tools, and logic |
| `worktrees/monaco-touch-selection/src/style.css` | Patched touch-target and menu CSS source |
| `worktrees/monaco-touch-selection/dist/index.umd.cjs` | Build output (UMD) |
| `app/.../vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js` | Deployed vendored UMD (copy of build output) |
| `app/.../vendor/monaco-touch-selection/monaco-touch-selection.css` | Deployed CSS (copy of worktree build output) |
| `app/.../monaco_editor/m_editor_app.ts` | Initialization call (`editorTouchSelectionHelp(editor)`) |

## 33) Diagnostics Owner-Keyed Markers (Multi-Source Fix)

### Problem

Diagnostics from different extension-host sources (ESLint, TypeScript, etc.) were
being set on the Monaco model with a **single hardcoded owner** (`'vscode_api'`).
Because `monaco.editor.setModelMarkers(model, owner, markers)` is a
**replace-all-for-this-owner** operation, each `$changeMany` from a new source
would overwrite the previous source's markers.

Typical sequence:

1. ESLint `$changeMany` arrives → `setModelMarkers(model, 'vscode_api', [332 markers])` ✅
2. TypeScript `$changeMany` arrives 400ms later → `setModelMarkers(model, 'vscode_api', [16 markers])` ❌
3. Result: 332 ESLint markers gone, only 16 TypeScript markers remain.

This caused the "flash then disappear" symptom — ESLint squiggles briefly visible
then wiped out by the TypeScript push.

### Fix

Each diagnostic source now uses its **original owner string** (`eslint0`,
`typescript`, etc.) as the Monaco marker owner. Markers from different owners
coexist independently.

#### Frontend (`m_editor_app.ts`)

| Component | Before | After |
|-----------|--------|-------|
| `setModelMarkers` owner | Hardcoded `'vscode_api'` | `params.owner` from adapter (`eslint0`, `typescript`, …) |
| `_diagCache` | `Map(path → {markers})` | `Map(path → Map(owner → {markers}))` — preserves all owners |
| `_applyCachedDiagnosticsForActive` | Replays single cached entry | Iterates all cached owners, sets markers for each |
| `_clearDiagnosticsForSwitch` | Clears `'vscode_api'` only | Iterates `_diagKnownOwners` Set, clears each owner + legacy fallback |
| Toolbar counts | Counted from latest `setModelMarkers` call only | `_emitAggregatedDiagCounts()` reads `getModelMarkers({resource})` across all owners |

#### Backend (`diagnostics_bridge.py`)

| Component | Before | After |
|-----------|--------|-------|
| `_diag_cache` key | `abs_path` (single entry per file) | `(abs_path, owner)` tuple — both ESLint and TS entries coexist |
| `_pending_entry` | Single buffered entry (last-write-wins) | `_pending_entries` list, deduped by owner — all sources buffered |
| `send_cached_diagnostics_to_sid` | Sends one cached entry | Iterates all `(path, owner)` entries matching path |
| `set_consumer_ready` flush | Flushes one entry | Flushes all buffered entries for the expected path |

### Data flow

```
Extension Host ($changeMany owner=eslint0, markers=332)
  → workbench_client.mjs (preserves owner in event)
  → server.mjs emitTe2Event({ type: "diagnostics/update", owner: "eslint0", items: [...] })
  → diagnostics_bridge.py caches at key ("path", "eslint0"), forwards entry
  → m_editor_app.ts _applyDiagnosticsUpdate({ owner: "eslint0", items: [...] })
  → monaco.editor.setModelMarkers(model, "eslint0", [332 markers])

Extension Host ($changeMany owner=typescript, markers=16)
  → same pipeline, owner="typescript"
  → monaco.editor.setModelMarkers(model, "typescript", [16 markers])
  → both owner's markers coexist: getModelMarkers() returns 348 total
```

### File switch behavior

When the user switches files (`openPathFromBackend`):

1. `_clearDiagnosticsForSwitch()` iterates all known owners → `setModelMarkers(model, owner, [])` for each
2. Toolbar counts zeroed immediately
3. `_diagKnownOwners` reset to empty Set
4. Spinner/baton starts for the new file
5. New diagnostics arrive per-owner → markers accumulate correctly

### Key files

| File | Role |
|------|------|
| `m_editor_app.ts` | `_applyDiagnosticsUpdate()`, `_emitAggregatedDiagCounts()`, `_clearDiagnosticsForSwitch()`, `_applyCachedDiagnosticsForActive()` |
| `diagnostics_bridge.py` | `_process_diagnostics_update()`, `set_consumer_ready()`, `send_cached_diagnostics_to_sid()`, `_pending_entries` buffer |
| `server.mjs` | `diagnosticsFromChangeMany()` — extracts owner from `$changeMany` args, passes through in `diagnostics/update` event |

## 34) Multi-Provider Pipeline — Systemic Fix (Hover, Completions, Symbols, Semantic Tokens)

This section records the original multi-provider failure and its evolution.
The current frontend hot path is direct strict-MessagePack `/wba`, not
`editor_ws.py`. Provider registrations arrive as WBA events plus a reconnect
snapshot and are projected through public Monaco provider APIs.

The same generic bridge now covers hover, completions, document symbols, folding,
document colors, inlay hints, inline completions, semantic tokens, document
highlights, definitions, references, and implementations. Document highlights
are what supply cursor-position occurrence highlighting. The bridge is driven by
advertised provider selectors and contains no per-language routing cases.

### Problem: Single-provider selection (systemic)

`_findProviderHandle(type, languageId)` returned only the **first** matching handle for every provider type. Extensions routinely register **multiple** providers per language — e.g. `typescript-language-features` registers 3 completion providers for JavaScript (main completions, directive comment completions like `@ts-check`, and snippet/refactoring completions). Only the first one was ever called; the rest were silently dropped.

This affected **all** provider-based features: hover, completions, document symbols, semantic tokens, and semantic tokens range.

Example: For JSON hover, `vscode.npm` registers with `{"language":"json","pattern":"**/package.json"}` **before** `vscode.json-language-features` registers its unrestricted `{"language":"json"}` provider. So `pyrightconfig.json` always got npm's handle → ext host rejected it (pattern mismatch) → empty reply.

Example: For JS completions, the directive comment provider (`@ts-check`, `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`) was never reached because the main TS completion provider was always returned first.

### Fix: Parallel multi-provider calling (VS Code approach)

The provider registry matches the exact document tuple — language, scheme,
authority, and path — and returns **all** matching provider handles. Every
document-scoped provider method now fires its RPC to all matching handles
simultaneously and merges or selects results:

| Method | RPC | Merge Strategy |
|--------|-----|----------------|
| `hover()` | `$provideHover` | Concat non-empty contents, take first range |
| `completions()` | `$provideCompletionItems` | Concat items arrays, OR isIncomplete flags |
| `symbols()` | `$provideDocumentSymbols` | Concat symbol arrays |
| `semanticTokens()` | `$provideDocumentSemanticTokens` | Pick richest response (binary delta encoding prevents merging) |
| `semanticTokensRange()` | `$provideDocumentRangeSemanticTokens` | Pick richest response |
| `getSemanticTokensLegend()` | (local lookup) | First non-null legend |

```
completions(params)
  → findAllProviderHandlesForDocument("completions", document)
      → [handle_A, handle_B, handle_C]
  → Promise.all(handles.map(h → $provideCompletionItems(h, uri, position, context)))
  → merge: concat items, OR isIncomplete, keep first cacheId
  → return merged completions
```

Each method has a `_*Single()` helper (e.g. `_completionsSingle()`, `_hoverSingle()`, `_symbolsSingle()`, `_semanticTokensSingle()`) that preserves the old single-provider path for callers that pin a specific `providerHandle`.

Language-only matching is insufficient: extensions may register selectors with
only `scheme` and `pattern`. New document-scoped code must use
`findAllProviderHandlesForDocument()` (or the semantic-token full/range
equivalent), not `_findProviderHandle()` or `_findAllProviderHandles()`.

### Problem 2: Cold boot hover registration timing

On cold boot, hover providers registered for the **wrong language**. The sequence:

1. `createFileModel(content, 'json', path)` — Monaco doesn't know `json` as a language (rich language workers removed), model gets `plaintext`
2. `setTimeout(0)` → `installVscodeApiLanguageBridgeProviders()` → `_currentLanguageContext()` sees `plaintext` → registers hover for `plaintext` only
3. `applyLanguageToModel()` async chain → `ensureTextmateTokenization('json')` → registers `json` language, calls `setModelLanguage(model, 'json')` → but bridge already ran
4. User hovers on JSON → no `json` hover provider exists → request never fires

Python worked because Monaco recognizes `python` natively — model gets `python` at creation time, so the immediate bridge registration sees the correct language.

### Fix: Re-run bridge after async language application

Added `installVscodeApiLanguageBridgeProviders()` call in `applyLanguageToModel()`'s final `.then()` (after `setModelLanguage` succeeds post-TextMate install). The `registeredHover` set prevents duplicate registration — only new language IDs get providers.

### Problem 3: Extension `contributes` stripped by sanitization

`_sanitizeExtensionForInit()` stripped the `contributes` property from extension data (env var `TE2_EXT_INCLUDE_CONTRIB` defaulted OFF). Without `contributes`, JSON extension couldn't see `jsonValidation` contributions from other extensions → no schema associations → no hover content.

Fix: Flipped default to ON (`"1"`). The OOM bugs that originally motivated stripping are resolved.

### Problem 4: `$readFile` / `$stat` crash on `vscode://` URIs

JSON extension calls `workspace.fs.readFile('vscode://schemas/vscode-extensions')`. This goes to `MainThreadFileSystem.$readFile` (nid 48). The adapter's catch-all returned `encodeExtReplyOkEmpty` (void/type 7), but the caller expected a VSBuffer → `.buffer` on undefined → crash.

Fix: Added method-specific handlers for `$readFile` and `$stat` that return `encodeExtReplyError` (type 11). Extension catches the error gracefully and falls back to HTTP SchemaStore.

Helper functions added:
- `encodeExtReplyOkVSBuffer(req, buf)` — type 8 reply, for returning binary data
- `encodeExtReplyError(req, errObj)` — type 11 reply, for returning structured errors

### Problem 5: JSON language registration missing

After removing Monaco's rich language workers, `json` was no longer a known language ID. `createModel(content, 'json', uri)` silently fell back to `plaintext`.

Fix: Added guard in `ensureTextmateTokenization()` (~line 396 of `m_editor_app.ts`) that calls `monaco.languages.register({ id: lang })` if the language isn't already known. TextMate can then attach its tokenizer.

### Reply type reference

| Type | Name | Usage |
|------|------|-------|
| 5 | Ack | Fire-and-forget acknowledgment |
| 7 | ReplyOKEmpty | Method returned void/null |
| 8 | ReplyOKVSBuffer | Binary buffer response |
| 9 | ReplyOKJSON | JSON payload response |
| 10 | ReplyOKMixed | Mixed response |
| 11 | ReplyError | Structured error |
| 12 | ReplyErrorVSBuffer | Binary error |

### Cold boot sequence (hover perspective)

```
t+0ms    inline editor runtime connected
t+5ms    [editor:ssot] rx → currentPath = pyrightconfig.json
t+5ms    [workbench-flow] generation=1
t+50ms   open_file DEFERRED — waiting for baton
t+50ms   [VSIX Languages] list FAILS (vscode_api deprecated)
t+50ms   ensureTextmateTokenization(json) → registers json language ID
t+60ms   installVscodeApiLanguageBridgeProviders() → immediate=plaintext (model still plaintext)
         registers hover for plaintext
t+100ms  TextMate ready → loadGrammar(source.json) → install json tokenizer
         setModelLanguage(model, json)
         installVscodeApiLanguageBridgeProviders() → immediate=json (NOW correct)
         registers hover for json  ← THE FIX
t+4000ms readiness: adapter_launched ok
t+4100ms readiness: baton ok → replay open_file
t+4100ms EMIT editor_workbench_open_file
t+6000ms diagnostics arrive, symbols arrive
t+20s    user hovers → provideHover fires → editorWorkbenchCall('hover')
         → adapter hover() → _findAllProviderHandles → parallel $provideHover
         → merged result returned
```

### Key files

| File | Role |
|------|------|
| `monaco_editor/editor_language_bridge_providers.ts` | Generic event/snapshot-driven Monaco provider projection, including document highlights and navigation providers. |
| `monaco_editor/editor_wba_runtime_handlers.ts` | Consumes WBA provider-registration events. |
| `monaco_editor/editor_wba_rpc_transport.ts` | Maps editor bridge calls to direct WBA JSON-RPC methods. |
| `workbench_protocol_proxy/node_workbench_adapter/src/extensions/provider-registry.ts` | Tracks every matching extension-host provider and publishes registration state. |
| `workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/code-navigation.ts` | Multi-provider document highlights, definitions, references, implementations, and call hierarchy. |
| `workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts` | Dispatches the direct `vscode.*` WBA request surface. |

### Hover content projection

The WBA continues to aggregate every selector-matched hover provider in provider order. The editor frontend normalizes that merged `contents` array generically before returning it through Monaco's public hover-provider API:

- plain strings become Markdown `value` records;
- legacy `{ language, value }` marked-code records are recognized before generic Markdown and become fenced code blocks using the supplied language identifier;
- Code OSS `IMarkdownString` fields are allowlisted and type-checked, including trust, HTML/theme/alert flags, base URI, and extracted URI components;
- malformed entries and malformed optional metadata are dropped deterministically.

Before returning a non-empty hover, the frontend extracts every fenced-code language from the normalized Markdown, resolves each tag through Monaco's contributed language IDs and aliases, and awaits the existing WBA TextMate tokenizer for that language. This covers signatures whose fence language differs from the active document language—for example, a JavaScript provider returning a TypeScript signature—without adding a JavaScript, TypeScript, HTML, CSS, or other language-specific routing branch. Cancellation or a document-version change after grammar loading discards the stale hover.

## 35) Android / GeckoView IME and Monaco Text Input

### Problem

Android IME composition, especially Gboard, can fight Monaco's desktop-oriented textarea transaction model. Cursor position, composition ranges, and visible model content can diverge when composition text is applied through the browser path as if it were desktop input.

### Current architecture

There are two distinct layers:

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
   - The mobile Ctrl latch reuses the terminal helper's Gboard keycode-229
     conversion. Monaco's adapter replays the resulting control byte as one
     synthetic Ctrl chord while bypassing helper re-entry, allowing Monaco's
     normal keybinding service to resolve commands such as Ctrl+S.
   - Opening the mobile special-key row also reveals a translucent Save control
     beside the Ctrl trigger. It preserves editor focus and publishes the same
     `editor.host.save` action used by the Ctrl+S command.

### Key files

| File | Role |
|---|---|
| `android/.../FilteredGeckoView.kt` | GeckoView subclass, IC interception point. |
| `android/.../EditorInputFilter.kt` | InputConnection wrapper, composition stripping. |
| `android/.../UiIpcClient.kt` | Strict msgpack-v1 `/ui_ipc` native focus/blur consumer. |
| `android/.../MainActivity.kt` | Wires filter, IPC client, restartInput callback. |
| `monaco_editor/editor_mobile_ctrl_helper_utils.ts` | Adapts vendored Gboard Ctrl control bytes into Monaco keybinding chords. |
| `monaco_editor/editor_mobile_special_keys_utils.ts` | Owns the mobile special-key row and fallback Save overlay. |
| `worktrees/vscode-te2-diff/src/vs/editor/browser/config/editorConfiguration.ts` | Disables native `EditContext` on Android. |
| `worktrees/vscode-te2-diff/src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextState.ts` | Android detached textarea seed/prefix/suffix state. |
| `worktrees/vscode-te2-diff/src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextInput.ts` | Android coalesced input transaction path. |

### Publication path

Publication runs `editor-distro`, overlays scoped ESM/CSS into `app/static/vendor/monaco-editor-core/esm`, regenerates the Monaco bootstrap when needed, and rebuilds Code TE2 `static/dist/host.js`. Android native source is not part of the Monaco text transaction publication unless the native filter layer itself changes.

---

## 36) GeckoView Static Asset Bundling

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

## 38) Desktop Client Integration

The active Linux desktop client is the Electron shell under `desktop_client/electron/`. `desktop_client/ui.py` remains a GTK/WebKit behavioral reference, not the current runtime.

### Runtime shape

- A local `te2-desktop://shell/` renderer owns the desktop launcher, Settings, persistent header, asset version/toasts, zoom, app-scoped Quit, and window controls.
- Framework apps run in a separate `WebContentsView` with Node integration disabled and context isolation enabled.
- The app view uses the `persist:te2-framework` partition.
- Electron keeps Chromium's automatic native Ozone backend selection; Wayland sessions are not forced through X11.
- Development and packaged launch paths intentionally pass `--no-sandbox` because the client runs from a user-owned tree and Ubuntu AppArmor blocks the unprivileged namespace sandbox.

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
| `read_client_identity` | Read the stable Electron installation identity stored beneath `$TE2_CONFIG_HOME`. |
| `reset_client_identity` | Atomically replace that identity after Code TE2 has removed the old identity's reconstruction records. |
| `wait_for_app_prerequisites` | Await the first current Code TE2 Run Target projection after backend readiness; all other apps are a no-op. |
| `force_asset_update` | Run the desktop asset updater. |
| `register_run_target_surface` | Register exact-frame `devRuntime` instrumentation metadata; it does not create a proxy. |
| `release_run_target_surface` | Release exact-frame instrumentation metadata; it does not tear down a running shell's proxy. |
| `open_sidebar_menu` | Present one bounded OS-native Sidebar dock menu and return only the selected action id. |
| `place_sidebar_surface` | Create or reposition one persistent extension renderer over its DOM-owned embedded placeholder. |
| `detach_sidebar_surface` | Move a persistent extension renderer into an Electron-main-owned floating window, or reconstruct an ordinary URL surface there. |
| `focus_sidebar_surface` | Focus the exact detached surface presentation. |
| `close_sidebar_surface` | Close the exact detached presentation and request inline reattachment. |
| `reconcile_sidebar_surfaces` | Close native presentations absent from the current authoritative Sidebar ledger. |
| `refresh_sidebar_surface` | Explicitly reload the exact native Sidebar renderer. |

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

### Desktop shell behavior

- Native Quit validates the current `/app/<app_id>` URL, posts only that app's quit endpoint, and returns to the desktop launcher without terminating Electron.
- The native context menu contains only Copy and Paste and invokes the focused renderer's native commands directly.
- Offline framework state leaves the app view intact and exposes a native-header route back to the local launcher. Recovery clears that control without restarting Electron.
- Electron modal/dialog windows use the shared modal presenter and retain parent-modal ownership without global always-on-top behavior.

Validation owner docs live in `desktop_client/desktop_client.md` and `desktop_client/electron/README.md`.

---

## 39) WBA Logical Documents And Multi-File Extension Handling

Code TE2 now separates visible editor open from semantic working-set hydration. The browser still renders one active Monaco model, but WBA retains a bounded extension-host document set for active and background files so language servers can see more than the currently visible file.

Host file-open intent does not preflight a boot snapshot. The frontend may use its last projected project root only to form a tentative path, then sends the request directly to Python; the backend's canonical returned path drives visible-open acknowledgement and editor connection for the originating client. A failed host-state refresh preserves the last valid frontend projection. Lightweight `scope: hostState` refreshes are single-flight in the frontend, while complete backend boot snapshots share only their disk-heavy core assembly across concurrent clients and materialize each requesting client's exact editor SSOT off-loop before returning. Initial UI IPC connection does not trigger a duplicate resync; only a genuine reconnect requests fresh host state.

### Authority split

- `ProjectSidecar` recents provide the shared bounded admitted/open set.
- `open_state_backend.py` and bounded `ProjectSidecar.client_foregrounds` provide one reconnectable foreground per stable `clientInstanceId`; legacy `last_file` is migration seed only.
- Shared open-state projections carry membership only and never dispose or clear a client's Monaco model. Exact-client SSOT and file-open notifications own visible model creation and replacement.
- `ProjectSidecar.document_state_revision` plus its bounded 256-entry `document_revisions` map order path-scoped content state. Evicted paths fall back to the global watermark, so pruning cannot lower their next revision.
- Python owns sidecar-to-WBA projection in `logical_document_reconciler.py`.
- WBA owns extension-host document lifetime in `workbench_protocol_proxy/node_workbench_adapter/src/workspace/document-registry.ts`.
- WBA retains one shared logical document registry and extension host while projecting one synthetic editor facade per stable client under a reentrant request/command context fence. `windowId` remains metadata; a future Electron multi-window interface must allocate an explicit second client instead of inferring authority from a window.
- The direct WBA Socket.IO boundary authenticates and injects `clientInstanceId` plus metadata-only `windowId`. Request normalization must preserve both through `vscode.openFile` into `WorkbenchClient.openFile`; otherwise the client facade cannot acknowledge the active document, leaving hover and semantic-token requests blocked even though shared extension-host diagnostic pushes can still arrive.
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

### Document registry roles

WBA document registry roles:

| Role | Meaning |
|---|---|
| `active` | The current visible editor model and synthetic active editor facade. |
| `background` | Retained extension-host document without the active editor facade. |
| `provisional-background` | Temporary background state used while resolving/hydrating. |

A normal tab switch demotes the previous document and promotes the target without duplicate `addedDocuments`, avoiding LSP close/open churn. Workspace switches release all retained documents. Extension-host reset clears WBA-local registry state.

After active promotion, WBA publishes `document/activeChanged` over the existing framework-shell pipe so Python schedules latest-wins reconciliation. Draft changes, workspace-file changes, adapter-ready/reset, and project-switch facts also drive reconciliation. There is no timer, polling path, new socket, or Python editor-intelligence hop.

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

WBA treats an active same-path open with the same non-null generation as an
idempotent duplicate. It does not reread disk, replace text, clear dirty state,
advance the document version or active epoch, emit another active-document
event, or invalidate prewarmed semantic tokens. A newer generation remains a
real refresh and retains the draft-safe full-text synchronization path.

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

---

## 42) Android Cefrium Client

The isolated `:cefrium` Android application module evaluates Cefrium 0.7.0 while reusing the shared Android source and packaged assets. GeckoView in `android/app` remains the primary Android renderer.

### Module boundary

The Cefrium module is intentionally isolated:

- `:cefrium` owns its activity, layout, manifest, and loopback relay.
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

After each completed document load, an idempotent page policy wraps Monaco's exact `textarea.inputarea.android-ime-input` focus path and forces `preventScroll: true`. Code TE2 additionally marks the editor frame from the explicit native renderer query and applies a Cefrium-only 16 px font size to the Monaco Find/Replace textarea, preventing Chromium's small-input focus zoom without changing Gecko, desktop, or ordinary editor input styling. Do not replace either correction with a broad page-wide input workaround.

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
