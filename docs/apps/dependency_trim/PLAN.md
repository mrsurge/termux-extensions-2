# Explicit app boundaries and Python dependency reduction

## Objective and scope

Remove FastAPI/Pydantic from supported TE2 app-worker runtime paths, then replace
Python FastMCP/MCP transport where appropriate so the normal installation does
not regain Pydantic/cryptography transitively. Keep Python policy/orchestration
typed and independently testable; expose explicit ASGI/DTO/lifespan boundaries
that remain suitable for later mypyc compilation or native hosting.

Investigation, Terminal slice 1, File Editor's backend/frontend slices, shared
ASGI helper extraction/adoption, Archive Manager's backend/frontend slices and
Aria Downloader's backend slice (including stop/restart compatibility fixes) and
its frontend typing/minification slice are approved.
Later slices need concrete scope approval. No package uninstall, shared framework
restart, deployment, native build or changes in dependent repositories are
authorized by these app-backend slices.
The preceding editable-build/asset-cleanup work is checkpointed at `15c0b514`.

## Release sequencing

- **0.2.354:** remove FastAPI from supported framework/app-worker composition
  and coordinated dependency metadata. Preserve working Sidebar IPC transports
  during this release; do not combine the dependency migration with the pipe
  cutover. FastMCP/MCP's remaining Pydantic/cryptography closure is tracked
  separately and must not be described as eliminated merely by removing FastAPI.
- **0.2.355:** replace backend-to-backend Sidebar IPC socket calls with typed,
  framework-brokered pipe requests/intents and state updates. This is the final
  follow-up in this plan, after 0.2.354; no cutover implementation is authorized
  by recording the schedule. Preserve Sidebar behavior and app frontend sockets.

## Established reusable contracts

- `app/libs/te2_asgi/`: neutral typed body/error/method/redirect/no-op lifespan
  primitives, adopted by Terminal, File Editor and File Explorer. Each app retains
  its body/null/decoder policy and routes/DTOs/permissions/sockets; response sends
  stay outside dispatch-error handling. Contract: library README.md.
- `app/libs/app_worker_asgi.py`: explicit `TE2_ASGI_APP`, reserved loop probe,
  application-owned mounts/lifespan and paired worker lifecycle. Do not create
  another supervisor or HTTP server for an app.
- File Explorer `http_app.py` / `tab_service.py`: explicit routing, bounded body
  reads, typed handlers and Socket.IO composition. Starlette response primitives
  are reusable without a FastAPI application/schema engine.
- Code TE2: Rust serving/PyO3 domain is the architecture target, not something every
  small app must adopt immediately. Retained Python HTTP module is a parity fixture.
- Uvicorn remains useful. Direct ASGI exposes routing and lifecycle rather than
  hiding them behind introspection; typed DTO/domain functions stay independent
  of the transport and compilation choice.
- Preserve current HTTP/WebSocket/RPC paths, wrappers, status/error shapes,
  identity/credential checks, readiness and ownership. Static typing is not a
  substitute for cheap validation of unknown remote inputs, body limits, paths,
  shell IDs or mutations. Use small explicit checks/msgspec DTOs, not Pydantic.

## Source-backed target inventory

| Owner | Current work remaining | Migration seam |
| --- | --- | --- |
| Terminal | Backend explicit ASGI/msgspec migration and strict frontend live accepted | Preserve Node PTY/headless stream and MessagePack protocol; share neutral transport primitives in follow-up |
| File Editor | Backend typed explicit ASGI and strict TS frontend live accepted | Single generated `main.js` at existing asset URL, retained inline CSS |
| Archive Manager | Typed explicit-ASGI backend and strict TS/minified frontend validated synthetically; live acceptance pending | Shared ASGI, typed request boundary, fixed extraction admission; reconcile Create/Test UI/backend capability gaps separately |
| Aria Downloader | Typed explicit-ASGI backend functionally live accepted; strict TS/minified frontend synthetically validated, publication pending | Shared helpers; stop/refetch and restart via terminate/spawn; recurring 502 and socket/intents remain follow-ups |
| Settings | Strict TS/browser module, single minified existing main.js URL; framework-backed settings | Source/regressions complete; native publication/live acceptance pending; no Python settings authority |
| ALS-RS wrapper/template | Explicit typed ASGI compatibility stubs; actual ALS-RS shell launches native `als-rs` | Template/scaffold source migrated; existing installed wrappers are not silently rewritten |
| Generic app worker | Lazy `app_worker_fastapi.py` compatibility path | Retire after supported built-ins/templates migrate; explicitly decide external legacy-router policy |
| Runtime bridge | Starlette root mounting typed console Socket.IO and two retained FastMCP HTTP apps | Source/regressions complete; live activation pending, then native MCP replacement |

Each app owns its backend, shellspec and protocols. Share neutral ASGI/type/build
primitives, not another app's source. Convert browser source to strict TS with
one minified entrypoint and inline template CSS where applicable; do not refactor
Terminal's already-typed frontend unnecessarily.

## Console/MCP ownership and dependency evidence

Console data plane: `app/te2_console_runtime.py` uses Python Socket.IO at
`/te2_console_ws/socket.io`, not FastMCP. MCP console tools call its live in-process
functions through `Te2ConsoleClient`. The runtime bridge currently eagerly imports
and initializes MCP mounts alongside it. Do not import this live console module
in diagnostic probes: initialization resets transcript files.

User clarification: the console question concerned FastAPI, not FastMCP. Console
Socket.IO itself does not need FastAPI; its containing runtime-bridge application
does. Slice 4 removes that composition dependency without replacing console state.

TE2 MCP: `app/te2_mcp/server.py` declares 24 tools, two separately constructed
FastMCP servers: legacy SSE `/te2_mcp` and Streamable HTTP `/te2_mcp_http`.
Pydantic models also back console transcript projection. Tools include native
framework capabilities, Python FWS/log helpers, scaffold/validation, HTTP adapters
to framework endpoints, and direct console state—not uniformly native methods.
Inventory schemas and effects before migration; preserve tool names/results,
exact-worker targeting, timeout/no-retry semantics and explicit eval credentials.

Installed metadata/source checks show:

- FastAPI requires Pydantic, which requires native pydantic-core.
- FastMCP 3.4.7 requires fastmcp-slim[client,server]; slim retains Pydantic,
  pydantic-settings, Python MCP SDK and Authlib. Authlib/joserfc and the SDK's
  pyjwt[crypto] pull in cryptography. Switching to slim does not meet the goal.
- Baseline Framework-Shells 0.0.64 declared FastAPI. Upstream main now includes
  removal commit 4f033f22 via merge 583273b1: explicit typed Starlette ASGI,
  msgspec ingress and optional owned-loop uvloop selection. Local worktree and
  released dependency pins have not been updated by this investigation. Its
  single dashboard page remains event-hydrated; the maintainer owns this repo.
- ALS-RS itself is native; user confirms its FastAPI requirement is stale. Its
  adjacent source requirements still declare it, so pip installs it regardless.
  Legacy `als_deprecated` code exists; supported-runtime metadata must be separated
  from optional/retired legacy paths instead of inferring active use from imports.
- ALS `mcp_agent_pty_server.py` uses `mcp.server.fastmcp`, the Python SDK's FastMCP,
  not TE2's standalone `fastmcp` import. Thus removal of the standalone dependency
  alone does not remove the SDK's Pydantic/crypto graph. Coordinate a separate ALS
  MCP/KB migration or explicit packaging boundary; never disrupt the active harness.

These are local installed/source observations, not a newly resolved clean release
lock. Completion needs clean Android/Linux dependency-resolution proof, not merely
deleting lines in TE2 requirements.

## Rust MCP decision to qualify

Preferred candidate: official [rmcp](https://github.com/modelcontextprotocol/rust-sdk),
which uses Tokio and has Streamable HTTP server support. Choose a pinned compatible
release/MSRV and compile an independent protocol sample before adopting it.
Current upstream intentionally omits legacy two-endpoint HTTP+SSE, not SSE
responses within Streamable HTTP. Source verification of adjacent ALS proves
current Codex/Copilot TE2 contracts both use /te2_mcp_http (Copilot type=http).
The old /te2_mcp builder is in als_deprecated; user-configured external SSE
servers remain possible. Legacy transport is not a blocker for those two current
integrations. User direction: if native qualification succeeds, record a release-
time option to disable legacy transport without evicting its implementation; do
not disable it now or silently rewrite saved external MCP configurations.

The name FastMCP is ambiguous across unrelated Rust crates. In particular
[fastmcp-rust](https://github.com/Dicklesworthstone/fastmcp_rust) explicitly requires
asupersync, excludes Tokio adapters and pins nightly Rust; it is not an automatic
drop-in for TE2's Tokio/Axum server. Compare protocol/transport/toolchain fit before
selecting a crate by its name. rs-fast-mcp adds an Actix HTTP stack whose audited
SSE reply flow differs from the required legacy transport; fastmcp-rs 0.2.0 uses
a custom command envelope despite Tokio/Axum. The chosen isolated sample pins
rmcp 3.5.1 (declared MSRV 1.88; local Rust 1.95). Its independent Cargo workspace
does not change the production framework dependency graph.

Native MCP can invoke framework services directly. Console eval/list must reach
the existing exact live relay until that relay is migrated; it cannot read a
separate shadow registry in another process. A typed, narrowly scoped bridge is
acceptable; moving console networking/state is a distinct follow-up decision.

POC source: framework/mcp_probe, with locked dependencies, loopback/free-port
binding, synthetic-only tools, 64 KiB ingress and bounded waits. Snapshot
fixtures/python_tools.json captures all 24 Python discovery descriptors through
scripts/capture_te2_mcp_schema.py using isolated cache/config/data roots. It is
not full tool implementation/schema parity. Seven real transport tests include
the installed Python MCP client, requests/errors, state isolation/deletion,
Streamable HTTP GET SSE disconnect and cancellation with zero active wait
handlers. Qualification uses protocol 2025-11-25, not every protocol/client.

Remaining concrete compatibility checks: rmcp DELETE returns 202 while the
installed Python SDK logs a termination warning expecting 200; malformed JSON
returns 415. Qualify SDK update or narrowly scoped integration normalization,
not blanket retries. Initialization may return SSE with JSON preference enabled,
and cancelled requests may close without a JSON-RPC result. Native owner mapping,
24-tool result/schema parity, exact console relay access, framework proxy/headers,
real Codex/Copilot acceptance and Android compilation remain adoption gates.
No framework integration, restart, live tool calls, legacy-disable or publication
is authorized by the independent probe.

Follow-up source completed after checkpoint b928ad5e: isolated http_compat.rs
maps successful DELETE 202→200 and rejected JSON syntax/EOF to 400/-32700,
without rewriting true media errors/notification 202 or retrying dispatch.
Eight loopback tests pass and the Python SDK teardown warning is gone. Valid
requests are decoded only by rmcp; rejection classification uses retained bounded
bytes. Full HTTP/error/result parity is still pending. TOOL_OWNERS.md maps all
24 handlers; notably console live state and Code TE2 Sidebar preferences require
their actual owner hooks, not a shadow registry or bridge-local worker stores.

First native port slice: optional non-default native-mcp feature compiles a dormant
adapter for app reload/start/open inside the te2-server crate. HTTP start/reload
now delegate shared start_app_data/reload_apps_data; existing open_app_data is
reused. AppState is the real framework owner, with no HTTP self-call/new manager.
Production routes remain Python-backed. Fixture tests verify one dispatch, input
validation before mutation, unchanged ok/data envelope, no retry and exact three
discovery schemas including _meta. Schema capture now uses wire aliases. Existing
lifecycle regressions/default build pass; real launches, cancellation of issued
mutations, client acceptance and remaining 21 tools await later approval.

## Ordered implementation slices and validation gates

**Optional uvloop follow-up:** shared factory/startup integration is implemented.
The newly added ALS uvloop, target dependencies and FWS wheel work is deferred
until after runtime bridge/console, Rust MCP and ALS dependency/MCP cleanup.
Final dependency resolution, wheel builds/validation and publication follow all
source/dependency work. This is the user-corrected ordering.

1. Terminal explicit ASGI + msgspec/dataclass request boundary, existing strict
   frontend checks; isolated HTTP/WebSocket/lifecycle/stream regressions. No Node
   broker rewrite, transport change, runtime restart or other-app source reuse.
2. File Editor, Archive and Aria owner-scoped route/typing/browser slices; Settings
   frontend and proxy-shell scaffold stubs. Preserve download/stream/error behavior.
   File Editor backend is the first sub-slice: four explicit ASGI routes and typed
   request/domain functions, preserving home guards, sidebar state and readiness.
   CM6 frontend TypeScript/minification follows separately; no UI source/bundle
   changes are needed to test its backend cutover.
   After File Editor frontend, extract shared typed ASGI primitives before the
   remaining backend migrations: bounded JSON/body reads, structured error
   responses, method/redirect helpers and trivial lifespan handling under
   `app/libs/te2_asgi/` (or the existing neutral ASGI library boundary). Reuse
   `app_worker_asgi.py` for worker lifecycle/probe integration, not a second
   supervisor. Adopt the helpers in Terminal, File Editor and File Explorer
   with transport/error/limit/streaming parity tests, then use them for Archive,
   Aria and later composition. Routes, DTOs, permissions and domain policy stay
   app-owned; no FastAPI-style introspection, another app's imports or global
   readiness/transport authority. Keep response-start/streaming failures from
   emitting a second response and preserve each app's body/optional-body policy.
   This extraction is implemented and synthetically validated; matching ordinary
   app-worker activation/live acceptance is tracked separately. Archive/Aria
   should consume the helpers rather than repeat transport boilerplate.
   Archive Manager backend now consumes them; its startup package collision
   (`libarchive` vs declared `libarchive-c`) was repaired in the approved venv.
   Before frontend acceptance, decide separately how to reconcile its Create/Add/
   Test controls with missing `/archives/create` and `/archives/test` handlers.
   No new archive capabilities are authorized by the four-route backend migration.
   Follow the Archive Manager intent-integration section below when restoring
   File Explorer archival actions and adding archive-only Code TE2 menus; the
   frontend typing slice must not preserve broken cross-app HTTP/navigation paths.
3. Framework-Shells standalone/Ferrous host explicit ASGI composition and its
   dependency metadata; independent repository approval/tests/release pin updates.
   Dashboard hydration remains Socket.IO; preserve retained public API consumers.
   Upstream implementation is complete; retain downstream compatibility checks
   here, but defer the newly added uvloop work to step 7 and publication to step 8.
4. Runtime bridge explicit ASGI and typed console DTOs; keep current MCP mounts
   temporarily. Update obsolete Python-server assertions to current ownership.
5. Rust MCP POC: initialization, tools/list/call, schema parity, errors, sessions,
   disconnect/cancellation, legacy SSE gate and Streamable HTTP client acceptance.
   Then migrate framework tools, adapt console tools without duplicate state.
6. ALS coordinated stale-requirement cleanup and MCP/KB plan; independently scoped
   implementation/release work. Maintain exact harness/tool contracts.
7. Coordinated ALS/FWS optional uvloop, Android/Linux dependency selection and
   FWS native artifact/tag audit. Run after steps 4–6. Existing optional-loop
   integration remains implemented; no new loop behavior is removed or reverted.
8. Final dependency/release sequence: remove obsolete compatibility/dependency
   declarations only after all supported
   consumers migrate. Prove install closures lack unwanted Pydantic/cryptography
   on Linux and Termux; build/installed-wheel/native asset/device acceptance follows.
   Installer/runtime archive smoke checks must verify the declared binding's
   `libarchive.file_reader` API, not merely that `import libarchive` succeeds;
   an unrelated distribution can shadow that namespace even with satisfied metadata.
   Select the new FWS version, build/validate Linux x86-64 and Android aarch64
   wheels, publish after explicit approval and adopt downstream pins. Perform
   final clean installs and release validation against the completed dependency
   set; packaging/publication is last, not a prerequisite to source migration.

## Optional uvloop integration — next steps

User supplies `uvloop-te2==0.23.0.post1`, a Pixel-built Android aarch64 rebuild of
upstream `uvloop==0.23.0`, with the same `import uvloop` namespace and APIs.
Publication is pending/user-reported, not yet verified by this workstream. It is
an alternative distribution of the same module, not an additional runtime to
install alongside upstream uvloop. Desktop uses upstream uvloop; Termux uses the
Android rebuild after checking its wheel tags and interpreter ABI.

1. Audit loop creation at ordinary app-worker/Uvicorn startup, the console/MCP
   runtime bridge, and Code TE2's PyO3-hosted Python domain thread. Verify actual
   owning call sites, including interpreted and mypyc paths, before choosing a
   neutral shared loop factory. An import alone does not select the active loop.
2. Enable uvloop at those Python-owned creation boundaries when installed; use
   explicit runner/loop-factory hooks where supported rather than relying on a
   process-global policy to reach every thread. Keep ordinary asyncio when the
   optional module is absent; provide a diagnostic/explicit disable seam for
   comparison. Do not mask ABI/import corruption as a successful uvloop launch.
3. Verify the published Android artifact really imports and creates a loop on
   CPython 3.14/Termux aarch64. Select distribution metadata/installer and release
   runtime inclusion deliberately: Android platform tagging and private Linux
   Python packaging must be validated, not assumed from architecture alone.
   Avoid accidental Termux source compilation or installing both distributions.
4. Test present/absent/disabled selection, background-thread loop ownership,
   clean shutdown/cancellation, subprocess/FD readers, Socket.IO and raw terminal
   WebSocket parity. Check the PyO3/mypyc domain as well as ordinary workers.
   Keep Rust Hyper/Socketioxide/Tokio and Node PTY transport unchanged.
5. With separately approved activation, measure comparable startup and async
   steady-state behavior on desktop and Pixel; report observed improvements,
   not promised ones. uvloop is not a replacement for import-graph optimization.

The user subsequently approved shared factory/source integration and isolated
tests. `app/libs/asyncio_runtime.py` uses an explicit asyncio Runner for ordinary
workers and the runtime bridge, avoiding Uvicorn-version-dependent global loop
policies; Code TE2's native domain creates its loop with the same factory in its
own thread. `TE2_DISABLE_UVLOOP=1` forces ordinary asyncio. Only absence of the
top-level uvloop module falls back automatically; a broken installed module fails
visibly, and native domain startup reports factory failure immediately. No
dependency install, requirements change, worker/framework restart, wheel
publication or new native build is performed. Compiled Code TE2 activation needs
a matching mypyc snapshot; this source edit alone does not update that runtime.


## Aria Downloader follow-up — startup and intent modernization

Live inspection after the backend migration found a legacy pending `fs_…` aria2
record with no PID/output: frontend Start submits `{}`, backend defaulted the
saved autostart field to false and passed it to manager spawn, which creates only
a record when false. The approved minor repair makes explicit Start/Restart
launch immediately (`autostart=True`), retaining the compatibility state field
without inventing automatic restoration. Verify after ordinary worker restart.

User has now refreshed the ordinary worker and reports working service behavior,
but recurring 502 Bad Gateway responses remain. Investigate exact failing route,
framework proxy vs Aria's aria2-RPC 502 envelope, readiness timing, RPC endpoint/
credentials and overlapping polling before attributing a cause. Working service
behavior is not proof that those failures are fixed.
The user also reports trouble invalidating stale tracked shells. Investigate
record liveness/ownership, tracked-ID cleanup and frontend refresh ordering
together with the service-control follow-up; do not mark this resolved by the
typing/build conversion or silently remove existing user shell records.

### Typed JSON-RPC socket frontend — planned follow-up

Replace browser-driven HTTP polling with an app-owned, strictly typed JSON-RPC
socket boundary and event-driven frontend projections. This is planning only:

- Inventory existing status/download/settings/shell HTTP operations and map them
  to typed request/result/error DTOs and methods without changing domain policy.
  Use the existing app socket/codec patterns, msgspec at Python wire boundaries,
  and strict TypeScript validation of unknown browser input; qualify the concrete
  socket lane/codec and approve it before implementation.
- Backend owns aria2 observation, task/service state and event publication.
  Investigate aria2 notifications plus any necessary bounded backend refresh;
  do not equate event-driven browser updates with eliminating all backend polling.
  Publish changed snapshots/events rather than running separate polls per client.
- Initial connection/reconnect receives authoritative state; events update clients
  thereafter. Fence stale/disconnected work, bound queues and correlate requests.
  Never replay add/control/spawn/restart mutations or retry uncertain outcomes.
- Keep cross-app framework-pipe intents distinct from this frontend socket lane.
  Preserve standalone/Sidebar identity, jobs/service state and current commands.
- Add HTTP/socket parity, event ordering/reconnect/multi-client/error tests and
  strict TS/single minified bundle; approve worker activation and OTA separately.
  Remove obsolete browser polling/HTTP routes only after auditing all callers.

Intent integration is a separate follow-up, like Archive Manager's below:

- Inventory current/download callers and intended add/open launch payloads;
  Aria currently consumes no launch query intents and has no pipe delivery hook.
- Design own-frontend → own-backend → framework-pipe broker → Aria-owned command
  admission, with exact client/presentation context for embedded navigation.
  Avoid cross-app private HTTP calls and frontend round-trip command brokerage.
- Distinguish opening/prefilling Aria from submitting a download. Query strings
  may seed standalone/Sidebar view state; restoration/reconnect cannot replay an
  add/start mutation. Validate URI/options/destination at the owning backend.
- Audit legacy local Python shell-manager vs current framework-owned execution,
  then define a separately approved manager/shellspec cutover. The minor startup
  fix does not change shell ownership or authorize removing pending records.
- Coordinate typed frontend/minification, existing polling/service controls,
  standalone/embedded/restoration and no-duplicate-download tests before live
  activation. Concrete intent/caller scope remains to be approved.

## Archive Manager intent integration — planned follow-up

### Desired behavior and state

Re-implement the existing File Explorer archival integration through the app
intent system and expose corresponding **archive-specific** actions in Code TE2's
Explorer context menus. Keep Archive Manager minimally stateful/stateless: no new
tab/session registry or durable sidecar is required. Sidebar launch/restoration
needs only the current archive query (`archive=...`), with an optional `internal`
member/directory seed when needed. Host/client/presentation query identity remains
separate from that minimal view state; one Sidebar presentation must not select
another's archive from shared host history.

- In embedded File Explorer, Open archive opens Archive Manager in a Sidebar tab,
  preserving the editor/current project instead of navigating the whole host away.
- In standalone File Explorer, retain a normal full-page Archive Manager launch
  with the same minimal query seed. Query strings remain the launch/view contract;
  they are not mutation commands, authentication or durable backend authority.
- Restore whole-archive/background extraction in File Explorer and support
  selected-member extraction from Archive Manager through the same backend job
  admission. Opening a view and starting extraction are distinct intents; opening
  or restoring a Sidebar view never implicitly submits an extraction job.
- Code TE2 Explorer exposes Open in Archive Manager and applicable extraction
  actions **only for archives**. Archive member/directory actions are offered only
  when meaningful for that captured archive context. Do not add archival menus
  indiscriminately to ordinary files/directories or expose unsupported operations.

### Current seams to replace

`app/apps/file_explorer/src/open_actions.ts` currently POSTs cross-app HTTP to
`/api/app/archive_manager/archives/launch`, reads an app_url and navigates. Its
non-job extraction fallback calls nonexistent `/archives/expand`. The primary
path in `src/main.ts` already submits `extract_archive` jobs, but both paths need
a coherent backend-owned admission/result contract, not competing submissions.
Archive Manager's manifest has no Sidebar state/intent contract yet; its frontend
retains broad host state and Create/Add/Test controls whose create/test backend
handlers are missing. Preserve working helpers where applicable, investigate
worker/pipe readiness and launch behavior, and replace these legacy seams rather
than bolting on another direct request/query URL flow.

### Ownership and transport contract

Use the existing framework broker and app-owned backend hooks:

```text
File Explorer / Code TE2 Explorer frontend
  -> own backend lane
  -> typed archive intent/service request
  -> framework pipe broker
  -> owning archive/job backend
  -> job result or exact-client Sidebar launch/projection
```

Code TE2 Explorer uses its authenticated Explorer context; embedded File Explorer
supplies its validated exact client/host/presentation identity. The framework
derives caller app ownership from the pipe and resolves the target through
allowlisted contracts, not an arbitrary URL, private socket or frontend-selected
worker. Reuse existing lifecycle/query and Sidebar ledger builders. If Archive
Manager needs inbound pipe handling, first establish its ordinary worker pipe
hook/manifest/readiness contract; do not infer support from its HTTP listener.

Archive/path/member/destination validation and job admission belong to backend
services. Confirm extraction destination/overwrite/destructive choices with the
normal app-owned dialogs. Validate archive existence/support, applicable project
and home/permission constraints, source/navigation supersession and member traversal
boundaries. Return a typed job record/ID immediately; background work/progress,
completion, cancellation and errors remain owned by existing job machinery and
must survive closing the Archive Manager view where supported. Never retry an
uncertain submission through another fallback; no job creation on query replay,
client reconnect or sidebar restoration.

### Implementation/acceptance gates

1. Audit existing archive/job capabilities, launch/manifest/pipe hooks and menu
   eligibility; specify typed open/extract payloads and results. Reconcile the
   already-recorded missing Create/Add/Test capabilities separately; do not
   pretend old README or frontend controls establish working backend support.
2. Approve and implement shared backend archive services/broker routing, minimal
   Sidebar launch/restore query state, then File Explorer integration and targeted
   Code TE2 Explorer context-menu handlers. Keep Archive Manager frontend typed
   and bundled under its existing public entrypoint contract.
3. Test standalone vs embedded launch, archive-only menu eligibility, exact-client
   and multiple-presentation isolation, whole vs selected extraction, job progress/
   cancel/failure, traversal/destination guards and no replay/duplicate admission.
   Validate worker lifecycle and assets separately, then obtain live acceptance.

This is a recorded integration direction, not implementation/restart/release
permission. It uses the already-established intent broker; it does not pull the
separate **0.2.355** backend Sidebar IPC transport cutover into the **0.2.354**
FastAPI-removal work. No release assignment for this added integration is implied.

## Packaging alternatives and deferred architecture

Renaming distributions to fastapi-te2/fastmcp-te2/pydantic-te2 does not make pip
treat them as satisfying upstream requirements with original names. It requires
coordinated metadata forks and ongoing API/security maintenance, and does not
remove imports. For an interim build-only problem, ordinary matching native wheels
under original names in the controlled GitHub wheelhouse are preferable; verify
every runtime dependency rather than fork the entire stack. Architectural removal
and avoiding Android compilation are related but distinct goals.

A shared Rust source crate can centralize DTO/framing/network primitives, but is
normally linked into each executable. Actual binary deduplication requires a
stable C-ABI cdylib/opaque-handle boundary or another deployment design; generic
Tokio/Axum types and Rust dylibs are not a free stable runtime ABI. Measure artifact
contributions before deciding this is worth loader/ABI/package complexity.

Framework-owned worker Socket.IO namespaces routed over the existing pipe are
plausible, but require client/SID/namespace ownership, readiness, room routing,
bounded backpressure, cancellation, disconnection and mutation-replay contracts.
This is deferred transport architecture, not part of removing FastAPI/FastMCP.

## Coordinated ALS/FWS uvloop and native-wheel follow-up — 2026-10-13

Scheduling: optional ALS loop and target dependency implementation follows the
runtime bridge, Rust MCP and ALS cleanup slices. Native wheel builds, publication
and final installed release acceptance happen last, after all source/dependency
work. The steps below are detailed work items, not permission to execute them early.

User direction: add optional uvloop selection to ALS as well, and ensure TE2,
ALS and FWS select uvloop-te2==0.23.0.post1 on supported Android aarch64 and
upstream uvloop==0.23.0 on Linux x86-64. These are alternative distributions
of the same import namespace; do not co-install them. This checkpoint records
the plan only, not source implementation, dependency installation or publication.

1. Adopt upstream FWS removal (main merge 583273b1; implementation 4f033f22).
   Its version remains 0.0.64; determine a new publishable version before release
   and then update exact downstream pins. Do not mistake the existing 0.0.64
   installed wheel for the new source. New mounting APIs are create_fws_application
   and mount_fws_http_api; fastapi_router is only an import-location shim, whose
   Starlette router cannot be consumed as a FastAPI APIRouter. Preserve host
   lifespan, Socket.IO/peer identity, stdio and native manager behavior.
2. ALS optional-loop source audit: agent_log_server_rs/adapters/extension_adapter.py
   main currently uses asyncio.run(amain()); embedded_adapter.py constructs
   asyncio.new_event_loop() for its thread-owned facade. Confirm active process
   versus embedded mode, create/install the loop in its owning thread, and handle
   factory failure without blocked readiness or leaked coroutines. Preserve
   stdio observability/separation from Rust harnesses, framing, cancellation and
   subprocess/FD semantics. Keep Rust/Tokio untouched. Adopt absent/disabled/
   present loop tests and propagate installed ABI/nested-import failures; decide
   the ALS disable flag in the concrete implementation approval.
3. Target dependency metadata: verify actual Android/Termux interpreter marker
   values, Python ABI and supported architectures before writing PEP 508 markers.
   If markers cannot distinguish Termux safely, use the established target
   wheel/installer lane rather than letting both distributions resolve. Verify
   TE2's private Linux Python/domain payload separately from installer Python.
   Published uvloop-te2 availability does not automatically install or activate it.
4. FWS native packaging audit: upstream top-level setup.py is setuptools with
   custom native builds and wheel tags, including Android detection using
   sysconfig platform/MULTIARCH. Audit any nested maturin/Cargo builders and list
   every expected artifact (PTY broker, pipe pump, UDS/native clients as applicable).
   Validate built wheel contents, executable permissions, tags, architecture,
   ABI/imports and actual native execution. Unknown-platform handling is not
   evidence that the Android wheel is complete or PyPI-selectable.
5. Build/test Linux x86-64 and Android aarch64 FWS wheels, reuse retained matching
   artifacts where verified, and publish both under one distribution/version
   with distinct platform tags after explicit release approval. Check existing
   PyPI files first; user suspects Android wheel is not yet published. Respect
   PyPI immutability and size limits; choose release version before any upload.
6. Resolve fresh TE2/ALS/FWS installs for each target: assert exactly one uvloop
   distribution, no FWS FastAPI/Pydantic closure, and preserve separately tracked
   ALS/TE2 MCP dependencies. ALS requirements still contain stale FastAPI plus
   explicit Pydantic/FastMCP; coordinate removal separately, not by uninstalling
   dependencies used by the live harness. Test loop/Socket.IO/FD/subprocess and
   Python/Ferrous parity on Debian and Termux after separately approved activation.

Source inspection only: ALS checkout unchanged (untracked dist/scratch preserved),
FWS source inspected remotely without pull/checkout/install, no wheels built or
published. This work replaces the planned FWS implementation rewrite with
upstream adoption/compatibility and release gates.

## Final follow-up — 0.2.355 Sidebar IPC framework-pipe cutover

Replace the remaining backend-to-backend Sidebar IPC Socket.IO clients with the
existing framework pipe broker pattern, extending `app.intent.dispatch` or its
appropriate typed service contract rather than creating another transport.

```text
frontend query-string presentation identity
  -> app's own frontend/backend lane
  -> app backend: typed framework-pipe request/state update
  -> framework broker: validate and route to the owning app/service
  -> target backend hook/state owner
  -> exact-client notification/projection
```

The query string supplies context, not authorization or durable authority.
Validate app/client/host/presentation identity against live ownership before
dispatch. The framework brokers cross-app traffic; project directory and other
editor-owned decisions still belong to Code TE2's backend, not a global framework
"active project" or a frontend relay that repeats the request.

Cover the remaining `sidebar.cwd.get` project-directory lookup and
`sidebar.window.state.update` restore-state publication in Terminal, File
Explorer and File Editor, then audit other supported Sidebar IPC consumers before
retiring the shared socket helper and any now-unused backend lane. Preserve
session/tab/shell restoration, dead-session reset, multiple clients and multiple
presentations, foreground targeting and hidden-view behavior.

Use existing typed MessagePack pipe framing, correlation, readiness and ownership
contracts. Define bounded timeouts/backpressure, cancellation/disconnection,
clear unavailable-target errors and no replay of uncertain mutations. Prove
broker/owner validation and restoration parity with synthetic tests plus
standalone/sidebar and multi-client live acceptance before removing old paths.

This retires the **backend-to-backend Sidebar IPC transport**, not the Sidebar
feature, nor app-owned frontend HTTP/WebSocket/Socket.IO lanes or terminal streams.
Moving all frontend Socket.IO namespaces into the framework remains a separate
deferred architecture decision. Do not reopen the 0.2.354 release for this work.
