# Dependency reduction tracker

Release targets: **0.2.354 — FastAPI removal**; **0.2.355 — backend Sidebar IPC
framework-pipe cutover**. Recording these targets is not implementation or release
authorization. FastMCP/Pydantic/cryptography dependency closure remains separately
tracked; current Sidebar transport stays intact for 0.2.354.

- [x] Scope approved: investigate FastAPI/FastMCP, console/MCP ownership and alternatives.
- [x] Inventory supported app entrypoints/ASGI contracts and frontend typing state.
- [x] Trace Pydantic/cryptography dependency paths in installed metadata.
- [x] Distinguish ALS-RS native runtime from stale FastAPI requirement.
- [x] Include maintainer-owned Framework-Shells in coordinated ASGI migration plan.
- [x] Identify ALS Python SDK MCP/KB server as separate transitive dependency owner.
- [x] Compare Rust MCP candidates and legacy SSE transport caveat.
- [x] Record renamed-wheel alternatives and deferred shared-library/pipe ideas.
- [x] Approve first concrete implementation slice.
- [x] Terminal migration/type/lifecycle/transport regressions.
- [x] Terminal live acceptance after approved app-worker restart.
- [x] Record optional uvloop as the next bounded follow-up: upstream 0.23.0,
  Termux distribution uvloop-te2 0.23.0.post1, same uvloop import/API.
- [x] Audit Python loop owners and approve concrete optional-uvloop integration.
- [ ] Verify published Android wheel tags/CPython 3.14 import and loop creation;
  define mutually exclusive target dependency/private-runtime packaging.
- [x] Implement present/absent/disabled selection and worker/thread/lifecycle
  regressions without changing Rust/Node networking.
- [ ] Verify real uvloop transport/FD/subprocess parity on desktop/Termux.
- [ ] Separately activate and compare desktop/Pixel behavior and timings.
- [ ] Other app/frontend/template migrations.
  - [x] Settings strict TypeScript, existing-URL minified ESM, validated HTTP/host DTOs.
  - [x] Proxy-wrapper template/scaffold and ALS compatibility stub use explicit ASGI.
  - [x] Settings/stub regressions: 6 frontend tests, 50 Python tests; TypeScript,
    new helper/stub ty checks and diff whitespace validation pass.
  - [ ] Settings native asset publication and user live acceptance.
  - [x] File Editor backend scope approved; explicit ASGI/strict types implemented.
  - [x] File Editor isolated backend/worker regression tests.
  - [x] File Editor backend live acceptance after app-worker restart.
  - [x] File Editor frontend strict TypeScript/minification and regression tests.
  - [x] File Editor frontend native asset publication/live acceptance (user reported working).
  - [x] Schedule shared neutral ASGI primitives after File Editor frontend and
    before remaining backend migrations.
  - [x] Extract/adopt shared ASGI body/error/method/lifespan helpers with parity
    tests; retain app-owned routing/DTOs/policy and existing worker integration.
  - [x] Shared ASGI adoption live acceptance (user reports all working).
  - [x] Archive Manager startup traceback diagnosed and approved venv repair verified.
  - [x] Archive Manager four-route explicit ASGI/strict typing and extraction job_type fix.
  - [x] Archive Manager real archive/job/HTTP regression validation.
  - [ ] Archive Manager backend live acceptance after ordinary worker relaunch.
  - [x] Archive frontend strict TypeScript/minified build and synthetic regressions.
  - [ ] Archive frontend native asset publication/live acceptance.
  - [ ] Separately approve/reconcile Create/Add/Test capability gaps.
  - [x] Record Archive Manager intent-system/File Explorer/Code TE2 archive-menu direction.
  - [ ] Audit/design and approve archive open/background extraction broker contracts.
  - [ ] Replace File Explorer archive cross-app HTTP/navigation and dead expand fallback.
  - [ ] Add minimal Archive Manager Sidebar archive query state and eligible
    archive-only Code TE2 Explorer actions through backend-owned intent services.
  - [ ] Archive intent/job/menu standalone/embedded/multi-client/no-replay tests
    and separately activated live acceptance.
  - [x] Aria Downloader backend scope and two shell-action compatibility fixes approved.
  - [x] Aria ten-route explicit ASGI/strict types and isolated RPC/shell regressions.
  - [x] Aria ordinary-worker functional live acceptance (user reports working).
  - [ ] Diagnose recurring Aria 502 responses; functional acceptance is not error-free acceptance.
  - [x] Diagnose pending child record and fix explicit Start/Restart launch gating.
  - [x] Aria child-start fix live acceptance after user worker refresh.
  - [x] Record Aria intent-system and shell-ownership follow-up direction.
  - [ ] Audit/approve Aria intent callers, broker contracts and shell-owner cutover.
  - [x] Aria frontend strict TS/minified bundle and synthetic regressions.
  - [x] Aria frontend functional live acceptance (user reports fine).
  - [ ] Investigate Aria stale-shell invalidation alongside deferred 502 diagnosis.
  - [x] Record typed JSON-RPC/event-driven socket frontend follow-up.
  - [ ] Audit/approve Aria socket DTOs, backend observation and event/reconnect contracts.
  - [ ] Implement/validate socket frontend, then separately activate/publish and retire legacy polling.
- [ ] Framework-Shells coordinated migration and updated release metadata.
  - [x] Verify upstream FastAPI removal 4f033f22 merged to main at 583273b1.
- [x] Runtime bridge/console typed ASGI source migration and isolated regressions.
  - [x] User restarted framework and reports console working after transition.
  - [ ] Live MCP transport acceptance (synthetic initialize/lifespan tests pass).
- [ ] Rust MCP POC and transport/client/schema acceptance.
- [ ] ALS dependency/MCP work separately scoped and validated.
- [ ] Coordinated ALS/FWS optional uvloop and target dependency follow-up
  (after the three implementation slices above).
  - [x] Record ALS Python FWS adapter stdio/embedded loop call sites and coordinated
    TE2/ALS/FWS target dependency and native-wheel publication requirements.
  - [ ] Approve/implement ALS optional uvloop at owned loop boundaries and regressions.
  - [ ] Audit Android marker values/private Linux runtime and select mutually
    exclusive uvloop-te2 Android versus upstream uvloop Linux dependencies.
  - [ ] Audit FWS native artifact inventory and Android/Linux wheel tags/content.
  - [ ] Fresh target installs and live Python/Ferrous/ALS adapter parity acceptance.
- [ ] Final dependency/release sequence (after all source/dependency work).
  - [ ] Select new FWS release version, build/validate Linux x86-64 and Android
    aarch64 wheels; explicitly approve/publish PyPI artifacts and update pins.
  - [ ] Clean target dependency-resolution and installed release acceptance.
  - [ ] Strengthen archive-binding smoke checks to verify file_reader, not only import.
- [x] Record versioned release sequencing and final framework-pipe follow-up.
- [ ] 0.2.355: approve concrete Sidebar IPC pipe-cutover implementation scope.
- [ ] 0.2.355: broker project-directory lookup and Sidebar restore-state updates.
- [ ] 0.2.355: audit consumers, prove exact-client/restoration/disconnect parity,
  then retire obsolete backend Sidebar IPC socket clients/paths.

Investigation evidence: read-only source/installed metadata inspection only. No runtime imports,
package uninstall/install, framework/app/harness restart, Rust builds or dependency
changes were performed. Local TE2 installed metadata is older than checkout source;
requirements/source and release metadata remain authority for later resolution.
No nested-repository source was edited. Earlier uncommitted source/asset/build
work and unrelated user files remain preserved. No performance/size win is claimed
before measurement. Web references and compatibility details are in PLAN.md.

## Aria Downloader frontend slice

### Settings and proxy-wrapper stub slice — 2026-10-13

Approved source-only slice completed. Settings source is src/main.ts/contracts.ts;
single minified main.js remains the public mount (6.5 KiB), CSS stays inline.
Unknown settings fields survive save merges; host-state token restoration and
persistent-network toggle restoration/save are tested. Shell text renders via
textContent instead of interpolated HTML; action IDs are URL-encoded.
Framework settings/shell/extension authority and existing request lanes remain.

Proxy template/scaffold and ALS wrapper stub export TE2_ASGI_APP using neutral
app.libs.te2_asgi.status.StatusASGI. GET root, 404, 405/Allow, denied WebSocket,
lifespan and generated display-name escaping have regression coverage. Scaffold's
broader legacy Any annotations are unchanged; this slice types the generated stub.
ALS shellspec still launches its native Rust server; this does not move its real
serving into Python. No installed user templates/wrappers were overwritten.

Validation: 6 Node tests, 50 Python tests, Settings tsc/build, changed ASGI ty and
git diff --check. No OTA, runtime restart, APK build, commit or push in this slice.
Current framework-backed extension catalog behavior is preserved, not redesigned.

Approved via blocking input: strict TypeScript conversion, typed unknown ingress,
single minified module, app-owned regression tests, packaging exclusions and docs.
`src/main.ts`/`contracts.ts` own source; existing manifest-mapped `main.js` is the
generated output. The authored inline-CSS template and existing app.js compatibility
re-export remain unchanged. Backend, HTTP polling/control behavior, current native
controls/layout, shell ownership and intent/socket modernization are not changed.

Validation: strict typecheck/build and seven Node frontend regressions pass;
177 isolated Python app/ASGI/worker/bootstrap regressions also pass (one existing
Starlette/httpx deprecation warning); diff checks are clean.
Bundle approximately 23.0 KiB. Tests execute compiled source using DOM/API/host/timer
fixtures: downloads/status/shell validation, malformed saved/picker/browse payloads,
initial rendering, shell/bulk control requests, directory preference and add
options, visibility refresh/no mutation replay, polling cleanup, visible 502
errors and existing asset mapping. User reports the frontend fine after testing;
recurring 502 and stale-shell invalidation remain unresolved follow-ups. No
agent-performed OTA/publication is claimed. No framework/worker restart, APK,
mypyc, Cargo or backend/dependency-runtime changes were performed.
Build/activation contract: `app/apps/aria_downloader/FRONTEND.md`.

## Aria Downloader backend slice

User approved ten-route backend-only ASGI/strict typing migration, then explicitly
approved two existing shell-action compatibility repairs found during inspection.
`main.py` now exports `TE2_ASGI_APP` from app-owned `http_app.py`; shared neutral
helpers own bounded JSON-object ingress, methods, errors, redirects and trivial
lifespan. App-owned RPC validation/response projection and shell policy remain in
typed handlers. Sync aria2 urllib RPC is offloaded, async manager calls retain
their lane, and existing worker serving/readiness owns activation.

Installed manager/source evidence: terminate_shell returns None and restart_shell
is absent. Stop/Kill now refetch records; Restart terminates/spawns with saved
command/cwd/label/autostart/environment and updates the tracked ID. Newly spawned
records save environment; legacy/adopted state without it cannot recover historic
overrides. No new manager API, retry, live shell change or cross-app source reuse.

Validation: strict ty and diff checks pass; 175 isolated Python regressions pass
(40 Aria tests plus shared ASGI, worker/bootstrap/loop, Archive and File Explorer).
Tests exercise RPC shapes/projection/errors, command validation, bounded malformed
and disconnected ingress, method/query/redirect behavior, all shell routes,
actual terminate-return contract and restart config retention with a fake manager.
One existing Starlette/httpx deprecation warning remains. No real aria2 call,
shell mutation, shared framework/worker restart, frontend/OTA/APK, dependency
metadata or native build occurred. User later reports functional live acceptance;
recurring 502 responses remain an outstanding diagnostic, not a resolved issue.
Source/build/activation contract: `app/apps/aria_downloader/README.md`.

Follow-up live inspection: app-worker records 37_37/38_38 show clean startup;
legacy child `fs_1791906211_b7d85322` is pending, no PID/output, autostart false.
Frontend Start sends an empty payload; the backend default false was incorrectly
used as manager launch admission. User approved forcing immediate Start/Restart
while preserving the saved field. Two added regressions cover omitted/false flags
and restart from such state. No live record/process was changed by the agent.
Final validation after the launch-gating fix: 177 isolated regressions pass
(42 Aria tests); strict ty and diff checks remain clean.
Aria intent modernization and legacy shell ownership remain planned, not implemented.
User performed the worker refresh and reports the service working after the fix,
with recurring 502 Bad Gateway responses still visible. Typed JSON-RPC socket
requests and backend-owned event projections are added to the plan; no socket
conversion or additional runtime transition is performed in this checkpoint.

## Optional uvloop integration

### Runtime bridge/console ASGI slice — 2026-10-13

Approved source-only migration: runtime_bridge.build_app creates Starlette with
the existing /api/health JSON response and console/SSE/Streamable HTTP mounts.
Explicit MCP child lifespans retain startup order and reverse shutdown/failure
cleanup. HEAD health remains 405 to match the prior FastAPI route behavior.
Console callbacks use typed object/payload and namespace/server protocols; unknown
Socket.IO/JSON ingress is narrowed at the boundary. Arbitrary nested eval/log
values remain opaque object data. Namespaces, rooms, polling/WebSocket serving,
replay limits, log serialization, registration, timeout/cancel and late-result
behavior are retained. A malformed non-string reqId no longer causes dictionary
lookup failure. MCP models/FastMCP/Pydantic intentionally remain for the next slice.

Validation: 54 Python tests pass, including five isolated bridge probes plus six
existing eval cases within one probe; actual Engine.IO polling, MCP Streamable
HTTP initialize/session creation, lifespan startup failure cleanup and typed
admission tested. ty and basedpyright pass on changed bridge/console modules.
Console imports truncate their configured transcript: all runtime probes import
in disposable subprocess cache/config/data roots, never the live console root.
No active runtime restart, OTA, package install, native build, commit or push.

User subsequently restarted the runtime and reports console working good; console
live acceptance recorded. MCP live acceptance is not inferred from console success.

User approved source-only integration/tests. Shared `asyncio_runtime` selects
`uvloop.new_event_loop` when installed, ordinary asyncio if absent or disabled
with `TE2_DISABLE_UVLOOP=1`; nested dependency/ABI import failures propagate.
Ordinary worker and console bridge use explicit Runner ownership around existing
Uvicorn serve/lifecycle; native domain thread uses the same factory and reports
creation failure through its readiness future. Rust/Node transports are untouched.
Local uvloop is absent: selection tests use a factory double, not real uvloop.
Validation: 31 isolated selection/runner/worker/bootstrap regressions pass.
Changed helper/native-domain/bridge pass strict ty; the existing worker module
has two pre-existing ty warnings (redundant cast and asynccontextmanager return
annotation), with no new diagnostic. `git diff --check` is clean.
No package install, dependency declarations, build, restart or deployment occurred.
Real Android wheel/ABI, transport and performance acceptance remain open.

## Archive Manager frontend slice

Approved through blocking user input: strict TypeScript conversion, single
minified bundle, isolated tests and documentation, preserving current URLs and
behavior. `src/main.ts` now owns the app; `src/contracts.ts` validates listings,
bookmarks, restored state, picker results and jobs as unknown ingress. Global
HTTP envelopes are unwrapped separately from the already-unwrapped app-shell API.
The build writes directly to existing `main.js`, retaining the shared external
jobs helper and authored inline-CSS template. Development node_modules is
excluded from Python package discovery/data.

Validation: strict frontend typecheck/build, seven app-owned Node regressions,
and 119 isolated Python Archive/ASGI/helper/worker/File Explorer regressions pass.
One existing Starlette/httpx deprecation warning remains. Generated bundle is
approximately 22.9 KiB. Tests execute compiled source against DOM/host/job
fixtures for query opening, state normalization, selection/extraction admission,
notifications, directory navigation, Show hidden persistence, malformed DTOs,
failed-admission no-retry behavior and the retained asset mapping.

No backend, Android source, APK, native Cargo/mypyc, shared runtime transition or
client OTA publication occurred. Live backend/frontend acceptance remains open.
Create/Add/Test gaps and archive pipe-intent integration remain separately scoped;
this typing slice does not silently implement or claim those capabilities.
Build/publication contract: `app/apps/archive_manager/FRONTEND.md`.

## Terminal slice 1

Checkpoint `15c0b514` was pushed before implementation. Console clarification is
recorded in PLAN: Socket.IO is independent of FastAPI, but its runtime-bridge host
still uses it; that composition is slice 4.

Terminal backend now exports `TE2_ASGI_APP`, with app-owned HTTP, raw WebSocket
and `/socket.io` routing in `http_app.py`. Four msgspec request shapes replace
Pydantic and are shared by HTTP and lifecycle admission. Domain handlers and
Node broker/frame/checkpoint machinery remain unchanged. HTTP bodies are bounded
to 1 MiB; malformed/disconnected requests do not reach mutations. Readiness and
worker-service startup remain in the existing generic worker hooks, not ASGI boot.

Validation: 95 Python tests passed across Terminal transport/lifecycle/Node-runtime and worker ASGI
regressions plus new explicit-boundary tests; strict `ty` on changed Terminal
modules; frontend typecheck/build and 24 Node tests passed. The new tests cover
HTTP dispatch/envelopes, DTO defaults/invalid input, body limits/disconnect,
slash/query handling, domain errors, real Engine.IO WebSocket handshake, raw
MessagePack codec rejection and connection cleanup. TestClient emits one upstream
httpx deprecation warning. Source-owned imports are checked independently of
Framework-Shells' still-scheduled dependency migration.

User reports the Terminal slice working live; acceptance recorded before its
checkpoint commit. No agent-initiated runtime transition was performed.

## File Editor frontend slice

User approved typed CM6/host/API conversion, one minified module and isolated
tests through the blocking input tool. `src/main.ts`/`contracts.ts` are source;
`main.js` is generated directly at the already manifest-mapped public URL. This
avoids an extra adapter/dist import and asset request. Existing CM6 vendor,
shared preferences/save guard and inline template CSS remain unchanged. Unknown
read/picker/host-state payloads are validated; no explicit/implicit `any` is added
to authored TypeScript. CM6 npm packages are development types only; app-local
node_modules is excluded from package discovery/data like Terminal's.

Validation: frontend typecheck/build and five app-owned Node regressions pass.
86 Python app/worker/intent/package-policy regressions also pass. Generated
`main.js` is approximately 12.1 KiB; the build retains the existing asset mapping.
Tests exercise actual compiled frontend with isolated CM6/DOM fixtures: URL-file
opening, exact Sidebar state publication, restored-slot draft isolation, all five
preferences, Discard resume, failed-save retention/cancel and successful Save
resume. The asset test checks existing bundle mapping and external shared imports.
The brittle old CM6 generated-source substring test was replaced by these tests.
Shared preference/navigation/app-shell tests pass (five); the full shared test
file still contains an unrelated pre-existing File Explorer test that slices its
now-adapter `main.js` and fails with `Unexpected identifier 'controllers'`.
Its app/source was not changed in this scope; tracked for test modernization.

No backend, Android source, APK, native Cargo/mypyc, shared framework restart or
client OTA changes were performed by the agent. User reports the frontend working
live; acceptance recorded before checkpoint commit. Build success alone still
does not prove client activation. Build/ownership guide:
app/apps/file_editor/FRONTEND.md.

No dependency declarations, Node workers, other apps, Android source or shared
runtime were changed/restarted by the agent. This backend
slice does not require Code TE2 mypyc or a native Cargo rebuild. Installed global
dependencies remain until the other consumers and nested repos are migrated.

## File Editor backend slice

Terminal live acceptance was checkpointed in `ae2b02ba`. User approved this
backend-only sub-slice using the blocking input tool; frontend modernization
remains separate. `app/apps/file_editor/main.py` now exports `TE2_ASGI_APP`,
composed in app-owned `http_app.py`. The four routes retain status/read/write
envelopes, home-directory and symlink resolution checks, exact sidebar state
publication and the existing serving hook. Domain functions are annotated with
`dict[str, object]`, not `Any`. Write admission uses a msgspec shape, and bodies
have a 32 MiB ingress bound including JSON escaping overhead; read responses
retain their previous size behavior. App-owned errors preserve structured detail
without FastAPI or an unsafe type cast into Starlette's string-only exception.

Validation: 72 Python tests passed covering File Editor, File Explorer intents,
Terminal ASGI and generic worker ASGI/loading contracts. Changed File Editor
modules pass `ty`; `git diff --check` is clean. New regressions cover Unicode and
empty writes, invalid UTF-8 reads, missing files, home/symlink escape rejection,
sidebar identities/state, invalid bodies, body bounds/disconnect, slash/query
routing and no FastAPI/Pydantic app-owned imports. One upstream TestClient/httpx
deprecation warning remains. No shared runtime/app restart, dependency metadata,
frontend build/OTA, Android, nested repository or native build changes occurred.
User reports the File Editor backend working live; acceptance recorded before
checkpoint commit. No agent-initiated runtime transition was performed.

## Shared ASGI helper slice

User approved `app/libs/te2_asgi` extraction/adoption in Terminal, File Editor and
File Explorer through the blocking input tool. Neutral helpers replace duplicated
body/header limits, JSON-object parsing, structured errors, method/redirect and
trivial lifespan machinery. App routes/DTOs/path and identity validation stay
local; Node brokers, terminal streams, tab lifecycle, sidebar calls and generic
worker readiness/lifespan integration remain unchanged.

Preserved differences: Terminal optional sidebar body is None for empty/null;
File Explorer's two sidebar HTTP bodies default to an empty object but reject
JSON null; File Editor requires an object with its existing 32 MiB limit (the
other apps retain 1 MiB). File Explorer explicitly retains stdlib JSON decoder
semantics, including encoding/numeric handling. Sending a response remains
outside shared dispatch-error resolution; a streaming error cannot emit a second
status/header block or retry its handler.

Initial validation: 132 helper/adopted-app/worker tests passed, including stream
failure after response start for all three adopted apps, cumulative body limits,
disconnect before mutation, mount-root/query redirects, structured detail/headers,
decoder parity and no app/schema-framework imports in the neutral library.
Changed library/app boundaries pass `ty` and `git diff --check`. One upstream
TestClient/httpx deprecation warning remains. Broader regressions recorded below.

Broader validation: 220 Python tests passed across helpers, all three apps,
generic worker loading/lifecycle, Terminal Node/stream/lifecycle, File Explorer
tabs/terminal/raw stream/isolation and app intents. No performance claim or live
acceptance is inferred from these results.

No frontend build/publication, APK/Android source, mypyc/Cargo build, dependency
declarations or shared runtime restart was performed by the agent. User reports
all adopted apps working live; acceptance recorded before checkpoint commit. Technical
contract: app/libs/te2_asgi/README.md.

## Archive Manager backend slice

Read-only inspection of the latest exited Archive Manager shell
`frs_1791882135714_1037449_34_34` (exit 1) confirmed startup import failure:
`cannot import name 'file_reader' from 'libarchive'`. Import chain was backend →
archiver_service → archiver. Installed metadata showed `libarchive` 0.4.7 and
`libarchive-c` 5.3 sharing the same namespace; the former had overwritten
`libarchive/__init__.py`. User approved removing the conflicting distribution and
force-reinstalling declared `libarchive-c==5.3` with no dependency changes.
An isolated import then confirmed only libarchive-c provides the namespace,
file_reader is callable and Archive Manager imports/ping succeed. No framework
restart or automatic app relaunch was performed; this was an environment collision,
not a reason to alter the supported binding or dependency version.

User separately approved backend migration, strict request/domain boundaries,
the extraction job_type correction and isolated tests. The backend exports
TE2_ASGI_APP through app-owned http_app.py, using neutral te2_asgi primitives,
1 MiB JSON ingress and typed msgspec command shapes. Its four route paths and
success/error envelopes remain; existing sync filesystem/archive/job operations
run via asyncio.to_thread as FastAPI previously offloaded them. Serving/readiness
remains in the existing ordinary worker hook. Extraction admission now passes
job_type="extract_archive" to JobManager, not the nonexistent type keyword.

Validation: 119 Python tests passed across Archive Manager, shared ASGI, generic
worker loading/lifecycle and File Explorer HTTP. Real ZIP fixtures cover archive
listing/internal/hidden paths and selected-file extraction. Other regressions
cover filesystem order, launch URL/guards, job signature/envelope, malformed
commands, limits/disconnect, off-event-loop scheduling and no FastAPI/Pydantic
app-owned imports. Changed modules pass ty and git diff --check; one upstream
TestClient/httpx warning remains. Test/import TE2 roots were isolated under scratch
so no live job-state file or shared execution queue was mutated.

Source audit also found pre-existing UI calls to unimplemented archives/create
and archives/test endpoints. The stale README advertised those plus archives/expand
and unimplemented extraction options. Documentation now states the four real
capabilities; restoring new capabilities needs a separately approved slice, not
silent implementation during this migration. Frontend source/assets, Android,
native builds, Code TE2 mypyc, release requirements and shared runtime are unchanged.
Technical contract: app/apps/archive_manager/README.md. Live backend acceptance
is pending a user-controlled ordinary Archive Manager relaunch.
