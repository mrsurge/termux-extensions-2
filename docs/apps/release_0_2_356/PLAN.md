# 0.2.356 maintenance plan

## Release direction

User defines this release primarily as drop-in optimizations. Preserve established
contracts/behavior, avoid new runtime dependencies, and measure improvements
without claiming source-only validation proves live latency gains. Additional
user-provided optimization items will be integrated here, not in a competing plan.

## Actual work order — corrected by user 2026-10-20

Validation is a gate within implementation work, not a standalone phase. User
confirms the startup work has passed live validation; do not ask them to repeat
it or leave it as the next work item.

1. Startup recovery / early HTTP initialization — implemented and live accepted.
2. Framework-pipe intent and Sidebar IPC consolidation (O1), especially ALS <->
   Code TE2. This is the next actual workstream: source audit/design, then bounded
   implementation approval and delivery, with its tests/acceptance in that phase.
3. Pipe concurrency and bounded in-process DTO/PyO3 queuing (O2), likewise with
   its own evidence/implementation/acceptance gates.
4. Native-client debug access and internal console-bridge retirement — deferred
   until after those two actual work phases, NOT immediately after validation.
5. Remaining O3–O8 routing/codec/shared-library/local-transport experiments, ordered
   by later evidence and user choice rather than treating all as one approved cutover.

This corrects the agent's earlier placement of console work as Phase 2. Workstream
ordering does not itself approve implementation of the recorded investigations.

## Pre-IPC inspection affordance — Electron DevTools

User approves an immediate small Electron-only affordance before the next major
workstream: title-bar DevTools button between Home and Reload, toggling a detached
DevTools window for the displayed app (launcher when no app is open). Existing
local DesktopShellSettings persists showDevToolsButton, default false, without a
schema/version bump. Desktop Settings exposes Show DevTools button; shared shell
capability hides/omits it on native Android/Electromux hosts. Main process gates
the action and rejects absent/destroyed targets; no page-provided target ID or eval.

Tests/typecheck/build are in scope; no Electron restart, APK build, runtime restart,
OTA or commit is authorized. Rebuilt Electron relaunch is required for activation;
ordinary editor asset OTA cannot update the native main/toolbar implementation.
This does not advance Phase 4 console-bridge retirement.

## Additional .356 repair — Aria Downloader (recorded for later)

User reports Aria Downloader is pretty broken and requests repair in this release.
On explicit steering, record for later: do not displace the next IPC work or begin
investigation now. Concrete priority among later tasks remains to be selected.

When resumed, inspect current app source and exact current runtime/shell logs,
then propose a bounded repair plan. Historical recurring 502/stale-shell/lifecycle
issues in ../dependency_trim/PLAN.md and TRACKER.md are leads, not proof of the
current failure. Reuse the app-owned ASGI/typed frontend, jobs and framework-shell
ownership; distinguish compatibility repair from the broader socket/intent redesign.
Do not replay download submissions or restart/kill shells as a diagnostic shortcut.
Runtime transitions, mutations, implementation and live acceptance need their own
concrete scope. No Aria inspection, code change or restart is approved by this entry.

## Phase 1 — slow-connection startup recovery

Initial approved frontend slice preserves ui.host.bootSnapshot.get and its
existing response shape, including compatibility with older servers. The later
approved HTTP slice below supersedes its frontend-only activation boundary.

The boot snapshot includes project/editor/Explorer/run-profile state and managed
Code Server disk assessment. Its previous eight-second emitted-request deadline
included transport buffering, backend work and response delivery. Initial failure
previously continued with null state and triggered a second full snapshot during
prerequisite preparation, ultimately failing before editor mount.

Use a startup-specific 60-second request budget; show waiting state and offer
explicit Retry/Stop Loading after failure. Retry only the state read, never project
launch, installation, mode change or other mutations. Do not continue unknown
startup state or infer installation absence. Preserve fresh-negative revalidation
and known-compatible fast path. Disconnect still rejects requests; no automatic
replay or generic RPC timeout change. Polling/WebSocket behavior remains intact.

Validate strict TypeScript, host build, boot and transport regressions. Source
validation is not client activation: native clients need separate asset publication
and reload. User reports the live startup validation passes (2026-10-20).

## Early language HTTP projection — approved 2026-10-20

GET /api/app/code_te2/startup/language (native route /startup/language) reuses
the existing Rust HTTP -> PyO3 domain submit bridge. It returns only ui_prefs with
webWorkersEnabled and code_server from existing authoritative preference/disk
assessment owners, no full project snapshot, identity allocation, installation,
runtime start or preference mutation. HTTP response is no-store; backend failure
is 503, not 404. No new server/transport/library or fallback Python HTTP worker.

Frontend prefetch begins before Explorer namespace initialization. After any
explicit project-launch handling, use its status to prepare the language backend
and start WBA readiness asynchronously before requesting full host state. Document
mount remains independent of WBA readiness. Full project/editor snapshot is still
required: this is not elimination of all startup round trips. Do not seed the
small projection as complete UI preferences; later full preferences supersede a
changed mode. Fresh negative installation facts are rechecked before consent.

Only HTTP 404 selects unchanged RPC behavior, retained only for this page lifetime;
user explicitly requires missing endpoints not to kill older-server startup.
503/permission/network/timeout/malformed-200 are errors with explicit read retry,
never capability absence, inferred installation absence or transport fallback.
Bound response to 32 KiB decoded bytes, 60-second abort covers body delivery too.
New server retains old RPC for older clients. Old clients retain their old timeout;
compatibility does not retroactively optimize them.

Validate strict Python/TS, existing backend tests, native HTTP response tests,
404/error/deadline tests and actual boot ordering. Matching Rust worker plus
Python/mypyc activation and client assets are required for live optimized path;
updated assets against an old worker exercise the 404/RPC lane instead. Native
tests do not activate a worker. No runtime restart, APK build, version bump,
commit or asset publication is authorized in this slice.

## Follow-up evidence

If needed, measure connection setup, emitted request/response and backend snapshot
timing to evaluate the additive HTTP endpoint and further startup scheduling changes.
Transport congestion is plausible, not established by the source inspection.

## Phase 4 — native-client debugging and internal bridge retirement (deferred)

User explicitly defers implementation until after framework-pipe intents (Phase 2)
and concurrency/queuing (Phase 3). This is not the next work item, approved edits
or an active acceptance gate.
User's later direction supersedes warn/error-only filtering as the primary plan:
remove first-party framework apps from the console bridge once native debugging
is ready, and reserve the bridge for user/developer app instrumentation.

### Source-backed findings

- app/static/js/te2_console_bridge.js and Code TE2's separate copy at
  app/apps/code_te2/main_page/frontend/console_bridge.js patch log/info/debug/warn/
  error. _emitLog maps every argument through JSON serialization and forwards it
  as console:log whenever connected, with no verbosity gate. Some calls can
  therefore copy/transfer large legacy debug structures.
- app/te2_console_runtime.py on_console_log accepts registered-worker records,
  appends them and broadcasts to drawers, without filtering by log level. A
  server-only filter cannot recover the serialization/uplink cost already paid.
- framework/bootstrap/bootstrap.py uses the canonical --runtime-debug flag and
  TE2_RUNTIME_DEBUG environment. Framework app_bootstrap already includes
  runtime_debug; app/templates/app_shell.html consumes it for startup timing.
- console:registered is an existing backend-to-bridge reply suitable for an
  additive verbosity policy without a new handshake or frontend query argument.
  Registration/evaluation traffic is separate from console:log and must survive.
- ALS has its own bridge and vendored frontend snapshot under app/apps/als_rs/
  vendor/frontend/static/js/console_bridge.js. It needs separately approved
  upstream changes/snapshot publication, not a manual generated-vendor patch.
  Native/Node console producers need inventory before claiming blanket coverage.

### Intended direction — requires investigation and approval when resumed

Expose native-client runtime discovery/inspection/evaluation through socket and
MCP tooling. Cefrium uses its CDP debugging facilities. User identifies Gecko's
similar interface as CHI; record that terminology without assuming wire/API parity
with Chromium CDP. Qualify actual pinned-client bindings, target capabilities and
protocol versions during investigation. A common tool-facing API may use distinct
native adapters; do not claim Gecko is CDP-compatible without verification.

Keep on-device internal client logging and native runtime access, rather than
automatically serializing/streaming all framework app console calls into the
application console bridge. Discover/log/evaluate internal main pages, iframes and
detached views through exact native targets and execution contexts. Avoid streaming
every native console event as a substitute that recreates the same bandwidth cost;
qualify bounded on-demand logs, subscriptions and runtime-debug controls.

Once replacement inspection/eval is proven, remove framework-app bridge imports,
initialization, worker registrations and automatic console forwarding at their
actual source entrypoints. Preserve local console behavior. Inventory ALS and all
built-in apps, wrapper templates, shared/native/Node producers and secondary
surfaces before claiming broad retirement. ALS changes require independent source
scope and a regenerated vendored snapshot, not direct vendor editing. Electron
and generic-browser internal-tool behavior need an explicit decision; do not
silently remove their only inspection path or retain an undocumented fallback.

Leave the agnostic console bridge, developer embedding API, worker discovery,
console drawer, eval/control and tooling available for user/third-party apps that
explicitly embed it. Removing first-party registrations must not delete the
developer instrumentation channel or break user wrappers. Any optional filtering
for that retained channel is a separately evaluated feature, not a replacement for
this requested internal-client migration.

### Access, compatibility and migration gates

- Map existing CDP-over-ADB/native control tooling first; distinguish device-local
  debugging from a remote framework/MCP session reaching that device. A remote
  framework cannot assume it can dial the client's loopback debugger. Qualify an
  authenticated, capability-scoped client-owned connection for socket/MCP routing.
- Native debug endpoints stay loopback/controlled; no public debugger exposure,
  raw arbitrary-target forwarding or query-string authority. Preserve explicit
  debug/eval consent/admission and don't equate logging verbosity with access.
- Bind every request to client/window/native target/context incarnation; preserve
  IDs, timeouts, cancellation, detach/reconnect invalidation, cleanup and no eval
  retry. Main-page/Sidebar identity is not automatically a native debugger target.
- Inventory older APK/renderer/server combinations and define supported behavior
  before cutover. Lack of native debug support must be explicit; no implicit
  bridge reinjection into first-party apps to conceal a missing prerequisite.
- Test native target discovery, precise eval/log access, context lifecycle and
  remote routing, then prove internal console bridge traffic is absent while
  developer-embedded apps retain registration, logs and eval/control.
- Use disposable TE2 roots for runtime-bridge tests (console imports can truncate
  transcripts). Native source changes require separately approved APK/client build
  and publication; backend transitions need separate approval. No implementation,
  new debug transport, bridge removal or runtime restart is authorized now.

## Optimization workstream details (O1–O9; scheduled above, O9 unprioritized)

The following are requested investigation/proof-of-concept candidates, not blanket
implementation approval, accepted performance claims or release blockers. Keep
the completed Code Server initialization acceptance separate. Several items extend
beyond drop-in optimization into architecture: qualify those seams before making
them production dependencies. No experiments, dependencies, cross-repo changes
or protocol cutovers are authorized by recording this list.

### O1. Framework-pipe intents and Sidebar IPC consolidation

Investigate broad framework-pipe IPC/intents adoption for robust backend messaging,
including ALS <-> Code TE2 mentions, file opens, project switches and relevant
Sidebar state operations. Reuse existing broker/intent owners rather than create a
second bus. Reconcile the earlier deferred Sidebar IPC work in
../dependency_trim/PLAN.md and ../sidebar_app_intents/PLAN.md with actual source;
old .355 scheduling is historical, not a claim that the cutover shipped.

Preserve shared Sidebar membership versus exact-client/presentation foreground,
admission, reconnect/registration lifetime and durable backend authority. Define
capability/version compatibility and independently updated ALS/TE2 deployment
before retiring socket clients. Do not replace app frontend sockets merely because
backend-to-backend intents move to the pipe.

### O2. Pipe concurrency and in-process Code TE2 DTO buffering

Investigate multiprocessing/multithreading and in-process queues around pipe I/O
and the Code TE2 PyO3 boundary: reduce pipe backpressure, keep intake moving and
move appropriate work behind bounded in-process scheduling. Identify the actual
reader/writer, executor, GIL and handler bottlenecks before choosing a mechanism.
Queues need byte/count budgets, fairness, cancellation and overload behavior; moving
backpressure into unbounded RAM is not a fix. Preserve per-owner/document ordering,
required delivery versus disposable progress, and no uncertain mutation replay.

Keep a schema/serialization boundary where appropriate; buffering is not permission
to move arbitrary Python objects into Rust as already-decoded DTOs. Relate evidence
to existing search queue/coalescing fixes and ALS extension-adapter DTO hypothesis,
without assuming that an unproven cross-repo hypothesis establishes this bottleneck.

### O3. Framework-pipe socket routing

Explore transparent socket routing through pipe DTO envelopes, skipping a network
proxy hop where useful. First map current frontend -> framework -> worker socket
ownership and compare actual hop costs. Define connection/namespace identity,
binary framing, admission, ordering, flow control, close/cancel/reconnect semantics
and slow-consumer isolation. Compare against the current proxy before committing;
do not assume encapsulating a stream saves bytes or CPU. Keep this routing proposal
distinct from O1 semantic intents and O8 WBA raw-socket experimentation.

### O4. FlatBuffers / Cap'n Proto pipe protocol and codec

Compare schema-based codecs for smaller/more efficient pipe transfers, including
Cap'n Proto packed streams. Use representative initialization/CRUD and sustained
traffic, measuring actual framed bytes, encode/decode/allocation CPU, peak memory,
latency and compatibility cost against current MessagePack. Schema evolution,
framing/limits, unknown fields, validation and mixed-peer behavior are gates.
Packed representation and zero-copy claims must be qualified separately for the
actual bindings and buffer lifetimes. No codec replacement based on size estimates.

### O5. Shared Rust libraries and direct operations

Investigate a shared framework/editor operations crate and separately evaluate
runtime shared-library packaging/linking to reduce duplicated binaries/build work.
A shared source crate is not proof of smaller shipped binaries. Compare actual
wheel/APK/native sizes and clean/incremental build times, with Linux private Python
and Termux ABI/loader/toolchain constraints included.

Explore direct Code TE2 *ops-library calls using the same typed structures used
before pipe enveloping, reducing appropriate pipe routes without cloning operation
implementations. Framework-owned state/authorization/scheduling must not become
two independent owners merely because both binaries link a library. Decide which
stateless operations can be shared directly versus operations that must still
reach the authoritative framework owner. Earlier shared-library deferral in
../release_0_2_354/PLAN.md is background, not new implementation approval.

### O6. Desktop/mobile localhost transport mode

For selected mission-critical local streams (WBA is the user's example), explore
Node IPC instead of WebSockets/namespaces in Electron and applicable mobile hosts.
Qualify available Node/native bridges and secure renderer access in each client;
do not assume every mobile renderer has Node or localhost proves same-device
ownership (remote servers are transparently proxied as loopback).

Local selection needs explicit verified runtime/endpoint capability. Preserve the
remote transport, exact-client isolation, session/generation fencing and stream
semantics. Compare the IPC path to the existing implementation before expanding
scope. This is selected-stream experimentation, not removal of all sockets.

### O7. Frontend Cap'n Proto packed-stream experiment

User specifically requests a frontend packed-stream proof, using Socket.IO binary
frames where appropriate. Start with bounded initialization/CRUD DTOs as a candidate
corpus; WBA suitability remains open because extension-produced data is varied.
Inventory browser/TS bindings, bundle/runtime requirements and schema coverage;
measure payload, CPU, allocations, decode stalls and client compatibility against
current MessagePack. Typed envelope/control data and opaque extension payloads
may need different treatment. Do not assume every extension object fits a fixed
schema or that opaque JSON requires replacing the complete transport.

### O8. WBA raw-socket and compression experiment

Explore raw sockets with internal client/session IDs, drawing on ALS conversation
history identity patterns where applicable. First inspect those actual patterns;
do not import another app's backend or equate conversation identity with a WBA
connection. Preserve registration, exact-client routing, request correlation,
timeouts, provider/document generations, disconnect invalidation and no replay.

Evaluate compression plus MessagePack (and optional candidate codec) using real
WBA payload distributions: tiny event streams, large responses, local/remote
latency and CPU on Termux. Compression remains an open trade-off, not an enabled
default. Keep socket transport, serialization and compression experiments separate
so results can identify which change helps. No raw-socket rewrite is approved yet.

### O9. Document-relevant WBA provider publication (separate pass)

User observes early provider/references events for typescriptreact with resync=true
and asks to defer irrelevant language data until files are opened. Read-only
source tracing confirms these are language-feature provider registrations, not
TextMate grammar bodies or a Markdown grammar dependency transfer.

Current owners/evidence:

- extensions/provider-registry.ts buildResyncEvents enumerates retained providers
  and emits individual kind/handle/language registrations across their selectors.
  Normal registration also produces per-language events; filtering resync alone
  would leave live registration traffic untouched.
- client/workbench-client.ts resync replays those events via onEvent, along with
  workspace readiness, diagnostics and webviews. Keep those different event owners
  separate; provider optimization must not discard readiness or diagnostics.
- server/event-bridge.ts emits te2.event through wsBroadcastNotification; the
  editor-socket.ts sender broadcasts events without clientInstanceId to all editor
  sockets. Thus a client's resync replay can also reach already connected clients.
- monaco_editor/m_editor_app.ts requests te2.resync on WBA connection and later
  adapter.providers with empty params for full provider-snapshot hydration.
  Investigate overlap rather than claiming either path can simply be removed.

Intended direction to investigate/approve: retain the complete authoritative WBA
registry, but publish a document-relevant projection per client/presentation, lazily
adding matching capabilities on open/model language change/reconnect. Reuse known
document lifecycle where possible instead of adding a per-provider round trip.
Scope replay to its requester and consider bounded snapshot batching/deduplication.
New clients/servers must negotiate or retain the legacy behavior explicitly.

Do not filter solely by filename extension or one globally active language: account
for full document selectors (language/scheme/pattern), wildcard providers, embedded
languages, multiple open documents/clients and provider retirement/generation.
Actual semantic-token legends are a separate per-provider decoding requirement
when that provider applies; language catalog/configuration metadata and TextMate
catalogs serve other consumers and are not automatically this optimization target.
Measure event count/bytes and initialization/model-switch correctness before a
cutover. This source survey/proposal does not approve WBA implementation yet.
User explicitly defers this work when requesting the accepted checkpoint and
moving to Sidebar/intent work; do not start O9 as the next slice.

### Common decision gates and investigation order

1. Phase 1 startup is user live accepted. Begin Phase 2 O1 source/contracts audit
   next, then obtain its concrete implementation approval.
2. Phase 3 O2 follows O1; native console work is Phase 4 after both, not a
   follow-up validation phase. Each has tests and live acceptance within it.
3. Use O1 contracts and O2 queue evidence to inform later O3/O6/O8 prototypes;
   O4/O7 codec proofs and O5 library audit can be evaluated independently.
4. For each candidate, present a bounded implementation/rollback plan and obtain
   approval. Preserve current transport until parity/compatibility is established.
5. Keep separate measurements for startup round trips, sustained throughput,
   tail latency, memory, compressed bytes and build/package cost. No unsupported
   performance claim, automatic speed-based transport selection or mutation retry.

This is a provisional dependency-aware investigation order, not a promise to ship
all eight items in .356. User can reprioritize as the optimization list develops.
