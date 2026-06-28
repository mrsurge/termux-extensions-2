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
- Use a small Python sidecar for loose ends while the Rust-native
  implementation grows, especially console, MCP, and any Python-only service
  surfaces that are not yet worth native porting. Ferrous itself should remain
  on the PyO3-free native FWS contract.

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
  -> normalizes TE2/FWS environment
  -> cargo build/run or installed Rust binary
  -> rust-spike/rust Axum/socketioxide server
  -> Ferrous native FWS-compatible host/manager for proc launch first
  -> Rust-native FWS-compatible manager pieces over time
```

The Python wrapper remains intentionally small. It owns launch-time concerns:

- port/host selection
- app root env projection
- `FRAMEWORK_SHELLS_*` secret/runtime setup
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
- framework file services used by shared app UI, starting with file-picker
  browse and Git summary endpoints
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
- for manifests with `readiness_support: true`, app-worker launch must not let
  shellspec readiness timeout terminate the worker; the app lifecycle readiness
  endpoint is the authority after spawn
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

### Python Loose Ends

The first Rust replacement does not need to native-port every TE2 service.
A Python sidecar can bridge the surfaces that should remain live while the
server moves:

- TE2 console runtime, preserving the current framework-owned
  `/te2_console_ws/socket.io` mount and `/te2_console` namespace
- TE2 MCP runtime, preserving the current framework-owned `/te2_mcp` SSE and
  `/te2_mcp_http` streamable-HTTP mounts
- full TE2 MCP compatibility for ALS Codex consumers after core route parity is
  stable
- Python app service modules declared in manifests
- any app-framework behavior whose DTO/event boundary is not stable yet

## Rough Plan

### Phase 0: Scaffold And Launch Wrapper

Create an isolated `rust-spike/` path with:

- Python bootstrap under `rust-spike/app/`
- Rust workspace under `rust-spike/rust/`
- Axum server with socketioxide mounted
- FWS env/secret setup in the bootstrap
- pinned Git dependency on `mrsurge/ferrous-framework` at commit `015ab2f`
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

### Phase 2.5: Framework File Services

Prove framework-owned filesystem/Git service parity with the shared file picker
before porting heavier job semantics. Keep this code out of `main.rs`; service
DTOs and blocking business logic belong in ops modules, while transport modules
only adapt those DTOs to Axum now and to pipe codecs later:

- native fs ops DTOs and `fs_net_ops` route compatible with
  `app/static/js/file_picker.js`
- native Git ops DTOs and `git_net_ops` route compatible with the file-picker
  Git header
- native Rust `service.git` pipe providers for the Git DTO/method contract:
  snapshot, head blob, diff, stage/unstage/restore/commit, branch list/checkout
  /create, remote list/add, history, init, clone, pull, and push
- native bookmark ops DTOs and `bookmark_net_ops` routes compatible with
  `app/libs/bookmarks.py`
- keep long-running clone/pull/push progress/cancellation/job orchestration
  separate from the synchronous provider DTOs
- use this slice to define the Rust-owned fs/git service boundary before a
  later app-worker pipe/RPC transport replaces browser-to-framework calls
- first app-worker pipe proof: `app/apps/file_explorer` keeps its normal
  browser-facing HTTP route, but the `app-worker` shell itself renders as
  `backend: pipe`, still receives `${free_port}`/`TE_APP_WORKER_PORT`, still
  serves FastAPI, and also reserves stdin/stdout for framework JSON-RPC. Its
  backend `/list` route delegates `fs.listDirectory` through the Rust framework
  pipe-RPC bridge to that same live app-worker process; pipe absence or
  protocol failure is an explicit backend error, not a silent local fallback

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

### Later: App-Worker Pipe Service Protocol

After native Rust framework services exist, evaluate moving app workers to a
JSON-RPC pipe control plane for framework service calls. The target shape is
typed app-worker request/response plus ordered progress/event streams for
framework services such as browse, Git summary, clone/pull/push, readiness, and
settings. This should replace browser-to-framework service fetches and brittle
REST/SSE job polling where it improves ordering and ownership, while keeping WBA
language traffic, editor document sync, terminal byte streams, and other hot
paths on their direct transports.

This does not imply that browser-facing app workers become pure pipe processes.
The app-worker role can render as a pipe-backed shell while still owning HTTP
routes, Socket.IO routes, app-shell compatibility, and proxy-shell
compatibility. The first useful shape is `http+pipe`: keep the app worker's HTTP
surface for browser/runtime routes, then add a typed pipe lane on the same
process for blocking framework-service calls.

If an app-worker or service entrypoint does run in pipe mode, a `--pipe` CLI
flag or explicit transport env can still be useful as a process-hygiene signal:
reserve stdin/stdout for framed protocol data and send logs/debug output to
stderr. The important invariant is not the exact flag name; it is that protocol
fds are not polluted by stdout logging once a shell is treated as a pipe.

The cutover should be DTO-first and transport-second:

- define the request/response/progress DTO boundary while the app still uses
  existing HTTP endpoints
- make the app backend consume those DTOs internally before changing transport
- switch the transport adapter from HTTP/net to pipe only after the DTO boundary
  is already stable
- avoid hiding transport-specific fallback behavior inside the DTO layer

Proof order:

- start with a small app such as `app/apps/file_explorer` and prove a few simple
  fs/git/os operations over the pipe service lane
- keep `file_editor_cm6` preparing for the same DTO boundary in parallel, but do
  not make it the first pipe protocol proof
- once the small app proves ordering, framing, errors, and progress events,
  cut selected `file_editor_cm6` framework-service calls over to the same DTOs

The pipe layer must consume the same ops DTOs used by the Axum adapters instead
of defining a second transport-specific schema. The intended shape is:

- `*_ops.rs`: DTOs plus framework-service logic
- `net/*_net_ops.rs`: Axum query/body/status adapters only
- future `pipe/*_pipe_ops.rs`: pipe codec adapters over the same DTOs

## Progress Tracker

| Item | Status | Notes |
| --- | --- | --- |
| Create `rust-spike/app` Python bootstrap | Done | Build/run wrapper with FWS env setup and signal forwarding. |
| Create `rust-spike/rust` workspace | Done | Axum/socketioxide skeleton with a pinned native Ferrous git dependency. |
| Add planning/tracker document | Done | This document. |
| Port app registry DTOs | Done | Rust read model preserves manifest entrypoints, shellspec refs, services metadata, proxy shell, icons, `sidebar_state`, and registry errors. |
| Load builtin and user-local app roots | Done | First env app root is tagged `builtin`; second is tagged `user_local`. |
| Expose `/api/apps` and `/api/apps/catalog` from real registry data | Done | Registry payloads preserve `readiness_support`; catalog snapshots include running state and readiness data, including synthesized `starting` readiness for running readiness-capable backend apps without an explicit readiness callback yet. |
| Serve framework root `app/templates/index.html` | Done | Rust spike now serves the real framework root template at `/`, app shell at `/app/{app_id}`, plus `/static/...`, `/sw.js`, and the app-launcher compatibility assets it already exposed. The frontend/static compatibility surface now lives in `frontend_assets.rs` instead of `main.rs`. |
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
| Implement native `/api/browse` for shared file picker | Done | Rust spike now matches the Python framework browse response used by `app/static/js/file_picker.js`: root handling, hidden filtering, symlink metadata, directory-first sorting, and `{ok,data:{path,resolved_path,entries}}`. Sudo browse is intentionally not ported in this slice because the shared file picker does not request it. |
| Implement native `/api/git/summary` for shared file picker | Done | Rust spike now exposes the lightweight Python-compatible Git summary response used by the file-picker Git header through `git2`/libgit2, not a `git` subprocess path; clone/pull/push job semantics remain a separate later service. Validated with `cargo fmt --check`, `cargo check`, `cargo check --features ferrous-framework-native`, and `cargo test --features ferrous-framework-native`. |
| Split framework file services out of `main.rs` | Done | Fs, Git, bookmark, settings, and state DTOs/service logic now live in `framework_services/*_ops.rs`, Axum adapters live in `framework_services/net/*_net_ops.rs`, and `main.rs` only merges the framework-services router. Future `framework_services/pipe/*_pipe_ops.rs` adapters must reuse the ops DTOs instead of inventing transport-specific schemas. |
| Split frontend/static compatibility routes out of `main.rs` | Done | Framework root/app-shell templates, service worker version substitution, `/static/...`, `/apps/...`, `/api/extensions`, and `/extensions/apps/...` compatibility serving now live in `frontend_assets.rs`; `main.rs` only merges that router. |
| Restore Android editor asset OTA endpoints | Done | Rust spike now serves Python-compatible `GET /api/editor_version` and `GET /api/editor_assets_bundle`. Bundle contents are declared in `app/android_editor_assets_bundle.json`, built/cached by version through `android_assets.rs`, and validated by tests for generated zip entries plus required checked-in manifest sources. |
| Add packaged Rust bootstrap and build cache | Done | `te2-rust` now resolves the Rust spike bootstrap through the installed package/source checkout, packages the Rust source as setuptools data files, and uses a fingerprinted cached binary path by default. Explicit `--cargo-manifest`, `--server-bin`, and `--no-build-cache` preserve dev/override launch modes. Build-only no longer starts the console/MCP sidecar. |
| Split app lifecycle/readiness/events out of `main.rs` | Done | App registry reads, start/open/quit, readiness callbacks, `/api/apps/events`, `/ws/apps`, FWS running-app discovery, and FWS lifecycle fanout now live in `apps_lifecycle.rs`; `main.rs` only merges that router and proxy code imports `apps_lifecycle::running_app_for_id`. |
| Split app proxy surfaces out of `main.rs` | Done | Dynamic app-worker proxy, proxy-shell metadata/proxy/rewrite behavior, manifest `sio_service` route registration, SIO upstream resolution, and the File Editor agent CORS exception now live in `app_proxy.rs`; `main.rs` only merges the app-proxy router and lets it register manifest SIO routes. |
| Split runtime bridge proxy surfaces out of `main.rs` | Done | FWS dashboard/socket proxying and TE2 console/MCP sidecar proxying now live in `runtime_bridge.rs`; shared HTTP/WebSocket proxy primitives, upstream URL helpers, and header filtering live in `proxy_transport.rs`. |
| Implement native `/api/bookmarks` parity | Done | Rust spike now matches the Python `app/libs/bookmarks.py` contract and existing JSON store/template for `GET/POST/PUT /api/bookmarks`, `~/.cache/termux_extensions/file_explorer/bookmarks/bookmarks.json`, seed from `app/static/bookmarks.json`, and `$PREFIX` substitution. Writes use atomic replace plus a process-local lock. Validated with `cargo fmt --check`, `cargo check`, `cargo check --features ferrous-framework-native`, and `cargo test --features ferrous-framework-native`. |
| Bridge the FWS dashboard and peer socket through the spike | Done | Rust spike now starts a PyO3-free Ferrous native FWS host on an internal free port, proxies `/fws/...`, `/ws/fws...`, `/fws_ws/socket.io...`, and `/api/framework_shells...` through the spike surface, and keeps child peers pointed at the spike-facing URL. Validated previous Ferrous-hosted dashboard/socket behavior through port `18089`; native rebase validation is pending side-port dashboard smoke. |
| Preserve TE2 console and MCP framework mounts | Partial | Rust spike now proxies `/te2_console_ws/socket.io`, `/te2_mcp`, and `/te2_mcp_http` through an internal Python TE2-runtime sidecar so the existing framework-owned console and MCP services stay live on the spike surface. Native or tighter PyO3 ownership can follow later. |
| Retire the Flask IPC service into the Rust cutover path | Not started | Identify which `app/ipc` behaviors still matter, then either port them into the Rust framework server or intentionally replace them with a documented Rust-owned control surface. |
| Launch app workers through Ferrous/framework-shells `proc` | Partial | Rust spike now exposes explicit `/api/apps/{app_id}/start` and `/api/apps/{app_id}/open`, passes shellspec refs plus `ctx` into the PyO3-free Ferrous native manager for authoritative shellspec rendering and `${free_port}` allocation, and spawns through Ferrous using `proc` semantics. For manifest `readiness_support: true` app workers, Rust strips the rendered shellspec readiness probe before spawning so Ferrous cannot timeout/kill large apps during build/start; readiness remains app lifecycle endpoint-owned. Previous side-port validation covered `terminal` start through port `18089`; revalidation after the native rebase is pending. |
| Implement app quit through FWS shutdown-group semantics | Done | Rust spike now exposes `POST /api/apps/{app_id}/quit`, derives `root_pids` from FWS metadata, then posts the internal Ferrous native `/api/framework_shells/app/{app_id}/shutdown` action so quit follows FWS shutdown-group wiring while returning the normal app-route envelope. Previous validation covered `terminal` quit through port `18089`; revalidation after the native rebase is pending. |
| Retire checked-out `framework_shells` launch bridge | Superseded | The spike now pins the PyO3-free `mrsurge/ferrous-framework` crate directly and no longer sets Python-extension build environment for Ferrous. The Python sidecar still uses normal `PYTHONPATH` setup for TE2 console/MCP runtime mounts. |
| Implement framework shutdown sequencing through the FWS shutdown tree | Done | App-specific quit uses the committed native Ferrous app-group shutdown endpoint. Framework-wide KeyboardInterrupt/SIGTERM now calls the Ferrous native `shutdown_tree_blocking(Vec::new())` hook before Axum closes the public facade. |
| Implement app lifecycle/readiness store | Partial | Rust spike now exposes `GET/POST/PUT /api/apps/{app_id}/readiness` with an in-process readiness store keyed by `app_id`, seeds `starting` for readiness-support launches, accepts app-worker readiness callbacks, and emits live readiness/running snapshots after start/open/quit/readiness/reload mutations. Lifecycle route/DTO/event ownership now lives in `apps_lifecycle.rs`; restart/lock semantics remain later work. |
| Preserve framework-level stateful-app support | Low priority | Keep manifest `sidebar_state` and framework-owned restore/ledger semantics available for current sidebar consumers such as `file_editor_cm6`; remaining stateful-app loose ends can follow the primary app/proxy/runtime parity work. |
| Implement `/app/{app_id}` shell rendering | Partial | Rust spike now serves the framework `app_shell.html` wrapper for standard apps, rewrites the minimal template placeholders, supports `/api/state`, and the shell consumes `/ws/apps` readiness/running updates instead of repeating readiness polling. |
| Implement Rust settings app functions | Partial | Rust spike now implements `GET/POST /api/settings` through `framework_services/settings_ops.rs` plus `framework_services/net/settings_net_ops.rs` against the same `~/.cache/termux_extensions/settings.json` store as Python, plus `GET /api/android/config` with the stable `persistent_network_notification` projection used by Android. Broader settings app diagnostics/FWS controls remain separate surfaces. |
| Split `/api/state` into framework service ops/net modules | Done | Rust spike now serves `GET/POST/DELETE /api/state` through `framework_services/state_ops.rs` and `framework_services/net/state_net_ops.rs`, preserving query-key lookup, merge writes, delete counts, and the existing `~/.cache/termux_extensions/state_store.json` store. |
| Implement app events SSE/WebSocket | Done | Rust `/api/apps/events` now exposes SSE with an initial `apps_snapshot` and live registry/readiness events. `/ws/apps` is no longer snapshot-only; `apps_lifecycle.rs` owns both event transports and the FWS-derived running deltas. A side-port smoke verified SSE hydration and WebSocket readiness fanout after a readiness POST. The legacy Python `/api/apps/events` endpoint now follows the same shared event contract shape. |
| Bridge console runtime through Python sidecar or equivalent | Partial | Current slice restores the route and runtime contract through a bootstrap-managed Python sidecar; revisit only if tighter in-process ownership becomes necessary. |
| Bridge MCP runtime through Python sidecar or equivalent | Partial | Current slice restores `/te2_mcp` and `/te2_mcp_http` through the same Python sidecar so TE2 MCP can continue to drive console eval and framework tools. |
| Full TE2 MCP compatibility for ALS Codex consumers | Low priority | Route parity exists through the Python sidecar; full compatibility for the ALS Codex implementation can follow after core Rust framework behavior is stable. |
| Add Android GeckoView direct-console back door | Not started | Planned as a developer-only diagnostic escape hatch after the primary framework-owned console/MCP contract is stable. |
| Fix WBA/editor readiness race exposed by Rust proxy | Done | Editor subscribes to adapter-state before Socket.IO connect, and WBA `te2.resync` replays the `workspace/switched` ready baton for already-ready sessions. |
| Run `file_editor_cm6` as the primary canary | Partial | Current Rust runs fixed static asset parity, the WBA/editor readiness race, and app lifecycle event fanout for readiness/running state. Remaining canary work is broader app lifecycle, stateful-app, settings, shutdown edge cases, and MCP compatibility parity. |
| Define app-worker pipe/RPC framework-service protocol | Partial | File Explorer and Code TE2 now use the app-worker `backend: pipe` launch shape: the worker still receives `${free_port}`/`TE_APP_WORKER_PORT`, still serves FastAPI, and runs the JSONL pipe RPC loop on stdin/stdout. App backend service clients call the configured `app.libs.pipe_runtime` dispatcher directly to retrieve DTOs. Missing pipe runtime configuration, protocol errors, and service errors fail loudly; there is no silent local fallback. Live framework smoke is deferred until explicitly approved. |
| Implement Rust `service.git` DTO providers | Done | Rust framework services now expose the Git pipe-provider methods from the contract through `framework_services/pipe/git_pipe_ops.rs`, backed by shared `git2` logic in `framework_services/git_ops.rs`: `git.snapshot.get`, `git.headBlob`, `git.diff`, `git.stage`, `git.unstage`, `git.restore`, `git.commit`, `git.branchList`, `git.branchCheckout`, `git.branchCreate`, `git.remoteList`, `git.remoteAdd`, `git.history`, `git.init`, `git.clone`, `git.pull`, and `git.push`. DTO coverage includes `GitSnapshot`, `GitMutationResult`, `GitDiffResult`, `GitHeadBlobResult`, `GitBranchList`, `GitRemoteList`, and `GitHistoryResult`. This readies the Rust framework side only; app consumer cutover remains separate. Validated with `cargo fmt --check`, `cargo check --features ferrous-framework-native`, and `cargo test --features ferrous-framework-native`. |
| Broader `main.rs` decomposition | Done | `main.rs` is now process bootstrap, shared state construction/accessors, router composition, health, framework shutdown, config loading, and the shared JSON error helper. Framework services, frontend/static compatibility, app lifecycle, app proxying, runtime bridge proxying, and shared proxy transport are split into modules. |

## Open Questions

- Should normal spike launches bind `8089`, or should day-to-day side-by-side
  development default to a non-conflicting port with `8089` reserved for cutover
  smoke tests?
- The spike is now pinned to Ferrous commit `015ab2f`.
  If local iteration against the checkout becomes more important than pinning,
  decide whether to move back to a path dependency.
- Which Python app service modules are required for the first `file_editor_cm6`
  canary, and should they be bridged through the Python sidecar or re-expressed
  as Rust service hooks?
- Should `proxy_shell` rewrite behavior be ported natively in Rust first, or
  should wrapped apps use a transitional Python bridge while app-worker proxying
  is proven?
- Core console/MCP route parity is currently through the Python sidecar. What
  remaining semantics are required for full ALS Codex TE2 MCP compatibility
  before native tightening?
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
