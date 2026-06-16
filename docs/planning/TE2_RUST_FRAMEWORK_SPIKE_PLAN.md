# TE2 Rust Framework Spike Plan

## Status

This is the tracker for the `rust-spike/` workstream. The spike is a sidecar
implementation path, not a cutover of the live Python framework yet.

Current scaffold:

- `rust-spike/app/bootstrap.py` is the Python build/run wrapper.
- `rust-spike/rust/` is the Rust workspace.
- `rust-spike/rust/crates/te2-rust-spike-server` is the first Axum/socketioxide
  server target.
- `rust-spike/rust/crates/te2-rust-spike-server/src/registry.rs` is the first
  Rust app-registry read model.
- `rust-spike/rust/crates/te2-rust-spike-server/src/runtime.rs` is the first
  read-only framework-shells metadata discovery path for running app workers.

## Guardrails

- Legacy generic `extensions` functionality is not a cutover target. The Rust
  port keeps the apps extension/functionality and app extension semantics, but
  `/api/extensions` is only a frontend compatibility shim that registers the
  app launcher extension.
- Comments in the Rust spike should mark semantic/system logic groups, not
  narrate every line. Use comments where they explain a boundary, phase, or
  non-obvious invariant; avoid dense comment spam.

## Goals

- Replace the main TE2 framework process with a Rust server built on Axum and
  socketioxide.
- Include the functionality currently owned by the apps extension. Other legacy
  extension systems should be deprecated instead of ported by default.
- Preserve dynamic app HTTP and WebSocket proxying for app workers on the TE2
  framework port, currently port `8089`.
- Preserve manifest-backed app registry behavior, including multiple app roots.
- Preserve app launch and shutdown through framework-shells `proc` semantics.
- Use PyO3 for loose ends while the Rust-native implementation grows,
  especially console, MCP, and any Python-only service surfaces that are not yet
  worth native porting.

## Primary Canary

`app/apps/file_editor_cm6` is the primary app consumer and canary for this port.
It exercises the important app-framework surfaces:

- manifest entrypoints: backend blueprint, frontend template, frontend script
- shellspec app-worker launch through framework-shells
- app service modules loaded from the manifest
- manifest-declared raw Socket.IO proxy routes via `sio_service.json`
- dynamic worker HTTP routes under `/api/app/file_editor_cm6/...`
- dynamic/raw Socket.IO aliases such as `/editor_ws/socket.io`,
  `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, `/terminal_ws/socket.io`,
  and `/wba_ws/socket.io`
- app assets served from registry-resolved app roots

Secondary fixtures should include small apps such as `terminal`,
`file_explorer`, and `als-rs`, but they must not replace `file_editor_cm6` as
this spike's compatibility target.

## Target State

### Runtime Shape

```text
python rust-spike/app/bootstrap.py
  -> normalizes TE2/FWS/PyO3 environment
  -> cargo build/run or installed Rust binary
  -> rust-spike/rust Axum/socketioxide server
  -> Ferrous/framework-shells bridge for proc launch first
  -> Rust-native FWS-compatible manager pieces over time
```

The Python wrapper remains intentionally small. It owns launch-time concerns:

- port/host selection
- app root env projection
- `FRAMEWORK_SHELLS_*` secret/runtime setup
- PyO3 interpreter selection through `PYO3_PYTHON`
- cargo build/run vs installed binary selection
- signal forwarding to the Rust child process

The Rust server owns framework behavior:

- app registry DTOs and manifest loading
- app lifecycle and readiness state
- app worker launch/quit/restart through framework-shells/Ferrous
- dynamic HTTP proxying to running app workers
- dynamic WebSocket proxying to running app workers
- manifest-declared raw Socket.IO route proxying
- app shell and asset serving
- app registry events over SSE/WebSocket

### App Registry Contract

The Rust registry must preserve the current Python apps extension contract before
cutover:

- app roots: builtin `app/apps` plus user local `~/.local/share/te2/apps`
- manifest identity: `id`, `name`, `description`, `version`, `enabled`
- entrypoints: `backend_blueprint`, `frontend_template`, `frontend_script`
- `shellspec.app_worker` or default `shellspec/app_worker.yaml#app-worker`
- app services metadata, even if Python service modules are handled through PyO3
  or a transitional bridge
- `proxy_shell` metadata and validation
- `sio_service` route declarations
- icon fields: `icon_src`, `icon_text`, `icon_emoji`
- `fullscreen`
- `sidebar_state`
- asset base URL and registry-resolved asset paths
- duplicate app-id detection and manifest error reporting

### App Runtime Contract

The Rust runtime must preserve these Python behaviors before cutover:

- start an app only from explicit start/open flows, not from every proxy request
- launch app workers through framework-shells `proc` with app subgroups
- preserve `TE_APP_ID`, `TE_APP_WORKER_PORT`, `TE_FRAMEWORK_URL`, and
  app-specific shell env overrides
- list/adopt running app workers from framework-shells records
- identify app workers through subgroups or `app-worker:<app_id>` labels
- register lifecycle state and semantic readiness by `app_id`
- shutdown app groups through framework-shells group shutdown semantics

### Proxy Contract

The Rust proxy layer must preserve these paths and semantics:

- `/api/app/{app_id}/{subpath:path}` HTTP proxy to the running app worker port
- `/ws/app/{app_id}/{route:path}` WebSocket proxy to the running app worker port
- manifest-declared Socket.IO service proxy routes from `sio_service.json`
- raw Engine.IO passthrough where upstream Socket.IO namespaces remain owned by
  the upstream service
- compatibility aliases declared by each app, especially the `file_editor_cm6`
  aliases listed above
- `proxy_shell` HTTP/WebSocket behavior and rewrite rules for standalone wrapped
  apps such as `als-rs`

### PyO3 Loose Ends

The first Rust replacement does not need to native-port every TE2 service.
PyO3 can bridge the surfaces that should remain live while the server moves:

- TE2 console runtime
- TE2 MCP runtime
- Python app service modules declared in manifests
- framework-shells bridge behavior until Ferrous owns enough native FWS runtime
- any app-framework behavior whose DTO/event boundary is not stable yet

## Rough Plan

### Phase 0: Scaffold And Launch Wrapper

Create an isolated `rust-spike/` path with:

- Python bootstrap under `rust-spike/app/`
- Rust workspace under `rust-spike/rust/`
- Axum server with socketioxide mounted
- FWS env/secret setup in the bootstrap
- path dependency to `worktrees/framework-shells/.external/ferrous-framework`
- placeholder app endpoints so routing shape is visible immediately

### Phase 1: Registry And Manifest DTOs

Port the app registry read model first:

- load builtin and user-local app roots
- parse manifests into typed Rust DTOs
- expose `/api/apps` and `/api/apps/catalog`
- serve registry-resolved app assets
- report manifest/duplicate errors without panics
- preserve `sidebar_state`, `proxy_shell`, and `sio_service` fields as typed
  payloads

### Phase 2: Dynamic Proxy And Socket.IO Route Proxy

Implement the proxy layer before deeper lifecycle work:

- HTTP proxy for `/api/app/{app_id}/{subpath:path}`
- app-launcher compatibility shim for `/api/extensions` and
  `/extensions/apps/...`
- read-only running app discovery from framework-shells metadata so proxy
  routing does not require the Python apps extension in-process state
- WebSocket proxy for `/ws/app/{app_id}/{route:path}`
- manifest-driven raw Socket.IO proxy registration
- `file_editor_cm6` alias validation for `/editor_ws/socket.io`,
  `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, `/terminal_ws/socket.io`,
  and `/wba_ws/socket.io`
- proxy-shell route and rewrite parity for wrapped standalone apps

### Phase 3: Framework-Shells Proc Launch

Wire app lifecycle to framework-shells/Ferrous:

- app-worker launch from shellspec through the Ferrous bridge
- app group shutdown by app id
- running app adoption/listing from framework-shells metadata
- lifecycle/readiness state keyed by `app_id`
- app registry event projection for running/readiness changes

### Phase 4: App Shell, Readiness, And Events

Port the app shell and app events once registry/runtime/proxy are concrete:

- `/app/{app_id}` app shell rendering
- app backend readiness POST/PUT/GET semantics
- `/api/apps/events` SSE
- `/ws/apps` app catalog/running-state WebSocket
- launcher/catalog compatibility with current frontend expectations

### Phase 5: PyO3 Bridges For Runtime-Owned Services

Bridge rather than rewrite uncertain runtime surfaces:

- mount or proxy TE2 console through Python/PyO3
- mount or proxy TE2 MCP through Python/PyO3
- support Python service modules declared by app manifests, or explicitly replace
  that mechanism with a documented Rust-native service interface

### Phase 6: Cutover Readiness

Only consider cutover after:

- `file_editor_cm6` runs through the Rust framework path
- app worker start/open/quit/restart matches Python behavior
- `file_editor_cm6` editor/explorer/ui-ipc/sidebar-ipc/terminal Socket.IO lanes
  connect through manifest route aliases
- app readiness placeholders behave the same as the current framework
- `terminal`, `file_explorer`, and `als-rs` pass smoke checks
- rollback remains simple: use the current Python framework entrypoint

## Progress Tracker

| Item | Status | Notes |
| --- | --- | --- |
| Create `rust-spike/app` Python bootstrap | Done | Build/run wrapper with FWS env setup and signal forwarding. |
| Create `rust-spike/rust` workspace | Done | Axum/socketioxide skeleton with Ferrous path dependency. |
| Add planning/tracker document | Done | This document. |
| Port app registry DTOs | Done | Rust read model preserves manifest entrypoints, shellspec refs, services metadata, proxy shell, icons, `sidebar_state`, and registry errors. |
| Load builtin and user-local app roots | Done | First env app root is tagged `builtin`; second is tagged `user_local`. |
| Expose `/api/apps` and `/api/apps/catalog` from real registry data | Done | Running/readiness state is still placeholder/empty until lifecycle work. |
| Serve registry-resolved app assets | Done | `/apps/by-id/{app_id}/{*filename}` resolves through the registry and prevents path escape. |
| Fake apps extension registration for frontend compatibility | Done | `/api/extensions` returns only the `apps` extension; `/extensions/apps/...` serves only app-launcher assets. Other generic extension semantics are intentionally not ported. |
| Add semantic-commenting rule to spike tracker | Done | Comments should label semantic/system logic groups without line-by-line narration. |
| Adopt/list running app workers from FWS metadata | Partial | Rust server now does read-only discovery from FWS metadata and filters live `app-worker` records with `TE_APP_WORKER_PORT`; launch/adoption mutation remains Phase 3. |
| Implement dynamic HTTP app proxy | Done | `/api/app/{app_id}/{subpath}` proxies to the discovered running app worker without auto-starting the app. |
| Implement `/ws/apps` launcher snapshot | Partial | Sends initial app catalog/running snapshot for the existing app launcher frontend; live event fanout remains Phase 4. |
| Implement dynamic WebSocket app proxy | Not started | Phase 2. |
| Implement manifest `sio_service` proxy routes | Not started | Phase 2. |
| Validate `file_editor_cm6` Socket.IO aliases | Not started | Phase 2. |
| Implement `proxy_shell` route/rewrite parity | Not started | Phase 2. |
| Launch app workers through Ferrous/framework-shells `proc` | Not started | Phase 3. |
| Implement app group shutdown | Not started | Phase 3. |
| Implement app lifecycle/readiness store | Not started | Phase 3/4. |
| Implement `/app/{app_id}` shell rendering | Not started | Phase 4. |
| Implement app events SSE/WebSocket | Not started | Phase 4. |
| Bridge console runtime through PyO3 or equivalent | Not started | Phase 5. |
| Bridge MCP runtime through PyO3 or equivalent | Not started | Phase 5. |
| Run `file_editor_cm6` as the primary canary | Not started | Phase 6. |

## Open Questions

- Should normal spike launches bind `8089`, or should day-to-day side-by-side
  development default to a non-conflicting port with `8089` reserved for cutover
  smoke tests?
- Should the Ferrous dependency remain a path dependency to
  `worktrees/framework-shells/.external/ferrous-framework`, or should this repo
  also carry a root-level submodule pointer for the spike?
- Which Python app service modules are required for the first `file_editor_cm6`
  canary, and should they be bridged through PyO3 or re-expressed as Rust
  service hooks?
- Should `proxy_shell` rewrite behavior be ported natively in Rust first, or
  should wrapped apps use a transitional Python bridge while app-worker proxying
  is proven?
- What is the first acceptable compatibility line for TE2 console and MCP: full
  mount parity, HTTP bridge, or PyO3 in-process call boundary?

## Guardrails

- Do not restart the shared Python framework server during spike development
  without explicit approval.
- Do not treat placeholder endpoints as compatibility-complete behavior.
- Do not remove or weaken app manifest semantics to make the Rust port easier.
- Do not make `als-rs` the primary canary for framework proxy behavior;
  `file_editor_cm6` is the primary consumer.
- Source and runtime behavior win over this planning document when they disagree.
