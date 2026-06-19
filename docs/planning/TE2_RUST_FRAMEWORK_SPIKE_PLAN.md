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
- Retire the current Flask IPC service by folding any still-required framework
  control/process-registry behavior into the Rust server or an explicitly
  documented successor owned by the Rust cutover path.
- Preserve app/backend readiness semantics and stateful-app support as
  framework-level behavior during the cutover, even though stateful apps are
  currently consumed only by `file_editor_cm6`.
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
- signal forwarding to the Rust child process and graceful shutdown entry into
  the FWS shutdown tree

The Rust server owns framework behavior:

- app registry DTOs and manifest loading
- app lifecycle and readiness state
- app worker launch/quit/restart and framework shutdown sequencing through
  framework-shells/Ferrous shutdown-tree semantics
- dynamic HTTP proxying to running app workers
- dynamic WebSocket proxying to running app workers
- manifest-declared raw Socket.IO route proxying
- framework-owned TE2 runtime mounts at `/te2_console_ws/socket.io`,
  `/te2_mcp`, and `/te2_mcp_http`
- app shell and asset serving
- settings app functions, including transport keepalive notifications
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
- shutdown app groups through the FWS shutdown tree rather than maintaining a
  separate legacy active-shell tracker
- route CLI KeyboardInterrupt/SIGTERM shutdown through the FWS shutdown tree,
  including hosted MCP and console Socket.IO sidecar/runtime processes

### Stateful App Contract

The Rust cutover plan must preserve the current framework contract for
stateful apps, even though the current consumer is `file_editor_cm6`:

- manifest `sidebar_state` metadata remains part of the app contract
- stateful app launches keep their framework-owned ledger/restore semantics
- app/backend readiness remains separate from sidebar slot/window state
- the Rust framework must not collapse stateful-app behavior into generic app
  launch semantics just because the current consumer set is small

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

- TE2 console runtime, preserving the current framework-owned
  `/te2_console_ws/socket.io` mount and `/te2_console` namespace
- TE2 MCP runtime, preserving the current framework-owned `/te2_mcp` SSE and
  `/te2_mcp_http` streamable-HTTP mounts
- full TE2 MCP compatibility for ALS Codex consumers after core route parity is
  stable
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
- pinned Git dependency on `mrsurge/ferrous-framework` at commit
  `74bbe12e1f567cfd2556d159f6ba2e65c27331c6`
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
- app group and framework shutdown sequencing through the FWS shutdown tree
- CLI KeyboardInterrupt/SIGTERM hooks that enter the FWS shutdown tree for app
  workers, hosted MCP runtime, and console Socket.IO runtime
- running app adoption/listing from framework-shells metadata
- lifecycle/readiness state keyed by `app_id`
- app registry event projection for running/readiness changes
- retirement or replacement of the current Flask IPC service for any framework
  control/process-registry behavior that still matters after the cutover

### Phase 4: App Shell, Readiness, And Events

Port the app shell and app events once registry/runtime/proxy are concrete:

- `/app/{app_id}` app shell rendering
- app backend readiness POST/PUT/GET semantics
- framework-level stateful-app support needed by sidebar-ledger consumers
- settings app API/function parity in Rust, including transport keepalive
  notifications
- `/api/apps/events` SSE
- `/ws/apps` app catalog/running-state WebSocket
- launcher/catalog compatibility with current frontend expectations

### Phase 5: PyO3 Bridges For Runtime-Owned Services

Bridge rather than rewrite uncertain runtime surfaces:

- mount or proxy TE2 console through Python/PyO3 while preserving the current
  framework-owned `/te2_console_ws/socket.io` route and `/te2_console`
  namespace
- mount or proxy TE2 MCP through Python/PyO3 while preserving the current
  framework-owned `/te2_mcp` and `/te2_mcp_http` routes
- full TE2 MCP compatibility for the ALS Codex implementation after the primary
  MCP route/console-eval contract is stable
- support Python service modules declared by app manifests, or explicitly replace
  that mechanism with a documented Rust-native service interface
- keep the Android GeckoView direct-console back door as a separate developer
  diagnostic lane after the primary framework console/MCP contract is stable

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
| Create `rust-spike/rust` workspace | Done | Axum/socketioxide skeleton with a pinned Ferrous git dependency. |
| Add planning/tracker document | Done | This document. |
| Port app registry DTOs | Done | Rust read model preserves manifest entrypoints, shellspec refs, services metadata, proxy shell, icons, `sidebar_state`, and registry errors. |
| Load builtin and user-local app roots | Done | First env app root is tagged `builtin`; second is tagged `user_local`. |
| Expose `/api/apps` and `/api/apps/catalog` from real registry data | Done | Registry payloads preserve `readiness_support`; catalog snapshots include running state and readiness data, including synthesized `starting` readiness for running readiness-capable backend apps without an explicit readiness callback yet. |
| Serve framework root `app/templates/index.html` | Done | Rust spike now serves the real framework root template at `/`, plus `/static/...`, `/sw.js`, and the app-launcher compatibility assets it already exposed. Settings endpoints are intentionally out of this MVP slice. |
| Serve registry-resolved app assets | Done | `/apps/by-id/{app_id}/{...}` and legacy `/apps/{app_dir}/{...}` resolve arbitrary nested builtin app assets through registry/root containment checks without path escape. |
| Fake apps extension registration for frontend compatibility | Done | `/api/extensions` returns only the `apps` extension; `/extensions/apps/...` serves only app-launcher assets. Other generic extension semantics are intentionally not ported. |
| Add semantic-commenting rule to spike tracker | Done | Comments should label semantic/system logic groups without line-by-line narration. |
| Adopt/list running app workers from FWS metadata | Partial | Rust server now does read-only discovery from FWS metadata and filters live `app-worker` records with `TE_APP_WORKER_PORT`; launch/adoption mutation remains Phase 3. |
| Implement dynamic HTTP app proxy | Done | `/api/app/{app_id}/{subpath}` proxies to the discovered running app worker without auto-starting the app. |
| Implement `/ws/apps` launcher live state | Done | Sends the initial `apps_snapshot`, then fanouts live compatible `catalog_snapshot`, `app_running_changed`, and `app_readiness_changed` messages from the Rust app lifecycle broadcaster. |
| Implement dynamic WebSocket app proxy | Done | `/ws/app/{app_id}/{route}` bridges to `/ws/{route}` on discovered running app workers without auto-starting apps. |
| Implement manifest `sio_service` proxy routes | Done | Rust parses manifest/file `sio_service` declarations at startup, registers public paths and aliases, and proxies HTTP polling plus websocket upgrades to app-worker or static upstream targets. |
| Validate `file_editor_cm6` Socket.IO aliases | Done | App-worker aliases `/editor_ws/socket.io`, `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, and `/terminal_ws/socket.io` returned Engine.IO polling handshakes; `/editor_ws/socket.io` websocket returned an Engine.IO open frame; `/wba_ws/socket.io` websocket proxied to the static WBA upstream. WBA polling returns upstream `Transport unknown`, matching direct `127.0.0.1:18181` behavior. |
| Implement `proxy_shell` route/rewrite parity | Done | Rust spike now exposes `/api/apps/{app_id}/proxy_shell`, proxies `/api/app/{app_id}/proxy` and `/api/app/{app_id}/proxy/{rest}` for HTTP and websocket traffic, preserves `/socket.io` -> `/socket.io/` normalization, and rewrites ALS HTML/static roots through the proxy prefix. Validated `als-rs` root load, health, Engine.IO polling, and websocket upgrade through port `18089`. |
| Bridge the FWS dashboard and peer socket through the spike | Done | Rust spike now starts a Ferrous-hosted FWS runtime on an internal free port, proxies `/fws/...`, `/ws/fws...`, and `/fws_ws/socket.io...` through the spike surface, and keeps child peers pointed at the spike-facing URL. Validated `/fws/`, Engine.IO polling at `/fws_ws/socket.io`, and a Socket.IO `/fws` connection through port `18089`. |
| Preserve TE2 console and MCP framework mounts | Partial | Rust spike now proxies `/te2_console_ws/socket.io`, `/te2_mcp`, and `/te2_mcp_http` through an internal Python TE2-runtime sidecar so the existing framework-owned console and MCP services stay live on the spike surface. Native or tighter PyO3 ownership can follow later. |
| Retire the Flask IPC service into the Rust cutover path | Not started | Identify which `app/ipc` behaviors still matter, then either port them into the Rust framework server or intentionally replace them with a documented Rust-owned control surface. |
| Launch app workers through Ferrous/framework-shells `proc` | Partial | Rust spike now exposes explicit `/api/apps/{app_id}/start` and `/api/apps/{app_id}/open`, passes shellspec refs plus `ctx` into Ferrous for authoritative shellspec rendering and `${free_port}` allocation, and spawns through Ferrous using `proc` semantics. Validated `terminal` start through port `18089`; the launched worker inherited `TE_FRAMEWORK_URL=http://127.0.0.1:18089` and `FRAMEWORK_SHELLS_FWS_SOCKETIO_URL=http://127.0.0.1:18089`, reached readiness `ready`, and served backend routes after startup. |
| Implement app quit through FWS shutdown-group semantics | Done | Rust spike now exposes `POST /api/apps/{app_id}/quit`, derives `root_pids` from FWS metadata, then posts the internal Ferrous-hosted `/fws/action/app/{app_id}/shutdown` action with `x-fws-ajax: 1` so quit follows the same FWS shutdown-group wiring as the current framework/app shell. Validated `terminal` quit returned `200` with `root_pids`, a second quit returned `404`, readiness fell back to `stopped`, and the app disappeared from `/api/apps/running`. |
| Prefer checked-out `framework_shells` for PyO3 Ferrous launches | Done | `rust-spike/app/bootstrap.py` now prepends `worktrees/framework-shells` to `PYTHONPATH` so the spike imports the proc-capable `framework_shells.ferrous_framework` surface instead of the older site-packages copy. |
| Implement framework shutdown sequencing through the FWS shutdown tree | Done | Explicit app quit routes through the FWS shutdown-group action. CLI KeyboardInterrupt/SIGTERM now lets Rust call the Ferrous host `shutdown_tree_blocking` hook before Axum exits, and the bootstrap keeps the hosted console/MCP runtime bridge alive until Rust completes. Isolated side-port smoke launched `terminal`, sent SIGINT, logged a successful Ferrous shutdown-tree result, and left the worker PID dead; the scratch metadata record kept a stale `running` status, which runtime discovery already filters by PID liveness. |
| Implement app lifecycle/readiness store | Partial | Rust spike now exposes `GET/POST/PUT /api/apps/{app_id}/readiness` with an in-process readiness store keyed by `app_id`, seeds `starting` for readiness-support launches, accepts app-worker readiness callbacks, and emits live readiness/running snapshots after start/open/quit/readiness/reload mutations. Restart/lock semantics remain later work. |
| Preserve framework-level stateful-app support | Low priority | Keep manifest `sidebar_state` and framework-owned restore/ledger semantics available for current sidebar consumers such as `file_editor_cm6`; remaining stateful-app loose ends can follow the primary app/proxy/runtime parity work. |
| Implement `/app/{app_id}` shell rendering | Partial | Rust spike now serves the framework `app_shell.html` wrapper for standard apps, rewrites the minimal template placeholders, supports `/api/state`, and the shell consumes `/ws/apps` readiness/running updates instead of repeating readiness polling. |
| Implement Rust settings app functions | Partial | Rust spike now implements `GET/POST /api/settings` against the same `~/.cache/termux_extensions/settings.json` store as Python, plus `GET /api/android/config` with the stable `persistent_network_notification` projection used by Android. Broader settings app diagnostics/FWS controls remain separate surfaces. |
| Implement app events SSE/WebSocket | Done | Rust `/api/apps/events` now exposes SSE with an initial `apps_snapshot` and live registry/readiness events. `/ws/apps` is no longer snapshot-only; a side-port smoke verified SSE hydration and WebSocket readiness fanout after a readiness POST. The legacy Python `/api/apps/events` endpoint now follows the same shared event contract shape with initial snapshot, catalog snapshots, readiness/registry events, and FWS-derived running deltas. |
| Bridge console runtime through PyO3 or equivalent | Partial | Current slice restores the route and runtime contract through a bootstrap-managed Python sidecar; revisit only if tighter in-process ownership becomes necessary. |
| Bridge MCP runtime through PyO3 or equivalent | Partial | Current slice restores `/te2_mcp` and `/te2_mcp_http` through the same Python sidecar so TE2 MCP can continue to drive console eval and framework tools. |
| Full TE2 MCP compatibility for ALS Codex consumers | Low priority | Route parity exists through the Python sidecar; full compatibility for the ALS Codex implementation can follow after core Rust framework behavior is stable. |
| Add Android GeckoView direct-console back door | Not started | Planned as a developer-only diagnostic escape hatch after the primary framework-owned console/MCP contract is stable. |
| Fix WBA/editor readiness race exposed by Rust proxy | Done | Editor subscribes to adapter-state before Socket.IO connect, and WBA `te2.resync` replays the `workspace/switched` ready baton for already-ready sessions. |
| Run `file_editor_cm6` as the primary canary | Partial | Current Rust runs fixed static asset parity, the WBA/editor readiness race, and app lifecycle event fanout for readiness/running state. Remaining canary work is broader app lifecycle, stateful-app, settings, shutdown edge cases, and MCP compatibility parity. |

## Open Questions

- Should normal spike launches bind `8089`, or should day-to-day side-by-side
  development default to a non-conflicting port with `8089` reserved for cutover
  smoke tests?
- The spike is now pinned to Ferrous commit `74bbe12e1f567cfd2556d159f6ba2e65c27331c6`.
  If local iteration against the checkout becomes more important than pinning,
  decide whether to move back to a path dependency.
- Which Python app service modules are required for the first `file_editor_cm6`
  canary, and should they be bridged through PyO3 or re-expressed as Rust
  service hooks?
- Should `proxy_shell` rewrite behavior be ported natively in Rust first, or
  should wrapped apps use a transitional Python bridge while app-worker proxying
  is proven?
- Core console/MCP route parity is currently through the Python sidecar. What
  remaining semantics are required for full ALS Codex TE2 MCP compatibility
  before native/PyO3 tightening?
- What exact settings app functions and keepalive notification contract must be
  native before cutover?
- Which stateful-app loose ends are required before replacing the Python
  framework beyond manifest, ledger, and readiness preservation?
- What should the Android GeckoView direct-console back door authenticate with,
  and how should it stay explicitly developer-only instead of becoming a second
  general-purpose runtime control plane?

## Guardrails

- Do not restart the shared Python framework server during spike development
  without explicit approval.
- Do not treat placeholder endpoints as compatibility-complete behavior.
- Do not remove or weaken app manifest semantics to make the Rust port easier.
- Do not make `als-rs` the primary canary for framework proxy behavior;
  `file_editor_cm6` is the primary consumer.
- Source and runtime behavior win over this planning document when they disagree.
