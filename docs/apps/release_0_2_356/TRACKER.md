# 0.2.356 maintenance tracker

## Current work order

1. Startup/HTTP initialization: user live accepted 2026-10-20, complete.
2. Framework-pipe/Sidebar intents (O1): source checkpointed; grouped live gates remain.
   Code TE2's user-supplied Any audit is now approved/in progress before another build.
3. Pipe concurrency and bounded DTO/PyO3 buffering (O2): follows intents.
4. Native debug/internal console-bridge retirement: deferred behind both.
5. Remaining O3–O8 investigations: later ordering by evidence/user choice.

Validation belongs within each work phase, never a replacement for actual work.

## After the cutover — Code TE2 Any audit

- [x] Record user-provided root mypy_typecheck_errors.txt as the seed for the
  large strict/extra/all-Any-disallow typing pass. Preserve the report unchanged;
  it is currently untracked user work, not a generated file to remove.
- [x] Reconstruct the requested strict/extra/all-Any invocation against the new
  source with mypy 2.3.0/CPython 3.14.4; the original command/version are absent
  from the preserved report and cannot be claimed exactly reproduced. Initial
  baseline: 323 diagnostics/75 files, 297 outside tests and 26 in tests.
- [x] Investigate and obtain staged cleanup approval; prioritize typed callback,
  event/DTO, service and worker boundaries without Any/cast/suppression escapes.
- [x] First source slice: native FWS callbacks, namespace/editor/terminal transport,
  task lifecycle and lazy project/Git hooks. Eleven production modules pass
  stronger flags. Full check now reports 215 diagnostics/65 files: 189 outside
  tests, 26 in tests. Detailed command/scope: TYPING_AUDIT.md.
- [x] Grouped Python regressions: 163 tests and 15 subtests pass. Two stale
  prior-cutover project assertions now include the existing before_switch=None
  argument; production guards are unchanged. git diff --check and native-file
  rustfmt --check pass. No runtime/compilation/asset publication performed.
- [x] User separately approves fixing the discovered single-vs-list `skipSid`
  native delivery gap, with regression source but no rebuild/restart. Python
  adapters and native filter align; native test execution/activation remain open.
- [ ] Continue remaining DTO/event/state, build-helper and test-fixture groups;
  distinguish library-stub/unused-expression inference from actual dynamic DTOs.
- [ ] Validate with the agreed stronger mypy command, owner regressions and mypyc
  checks; document remaining external-stub seams instead of masking them.

User reports interpreted modules running well. No compiled activation, frontend
publication or original-report edits; typing work does not authorize build-policy
changes, commits or restarts. Native/mypyc compilation is intentionally deferred.

## Startup recovery

- [x] Read-only investigation and concrete frontend scope approved.
- [x] Keep existing wire method/DTO and backend installation authority.
- [x] Startup-specific 60-second deadline; explicit waiting/retry/stop recovery.
- [x] Remove initial-failure fallthrough into a duplicate prerequisite request.
- [x] Strict TS and host build pass; 12 boot tests and five targeted real
  transport/host tests pass. Fake-clock test keeps the actual snapshot request
  alive past eight seconds, accepts unchanged old-server MessagePack, then
  verifies expiry at 60 seconds. Small hostState-only reads retain eight seconds.
- [ ] Broader transport suite: four unrelated TextMate fixtures fail because
  their mock window lacks location.search (unchanged production TextMate path).
  Two initial boot fixture omissions of required spinnerSetStep were corrected;
  no production dependency was made optional to accommodate tests.
- [x] User reports live startup validation is complete and passes (2026-10-20).
  No further publication/reload or repeated acceptance is an outstanding gate for
  this accepted slice; exact activated-artifact provenance was not separately audited.

## Pre-IPC Electron DevTools affordance

- [x] User approves button beside Home, detached DevTools, persisted visibility
  default off, tests/build/docs. No WBA change or Electron restart requested.
- [x] Implement main-process action with alive-target and enabled guards;
  app view first, launcher fallback. Button between Home and Reload.
- [x] Persist Show DevTools button in existing desktop settings; reflect saves
  in the title bar immediately. Shared native Android settings hide/omit option.
- [x] Strict Electron TypeScript, compile and 18 focused settings/DevTools tests pass.
- [x] Full Electron unit suite: 126 passed, zero failures/skips.
- [x] User live acceptance: “looking good”; requests checkpoint commit/push.

No version bump, editor/backend change, runtime restart or asset publication in
this affordance slice; native Electron relaunch is required, not editor OTA.

## Early language HTTP projection

- [x] User approves native route + backend projection + frontend early prefetch,
  with explicit 404 fallback to existing RPC. Release focus: drop-in optimizations.
- [x] Small no-store backend-owned status; no full snapshot/runtime start.
- [x] Begin HTTP before Explorer namespace; prepare intelligence before full
  snapshot, never seed partial UI preferences. Existing RPC remains supported.
- [x] Four HTTP tests cover unchanged projection, 404 caching per page, network/
  503/401/JSON/oversize errors and abort deadline with no implicit fallback.
- [x] 13 boot tests pass including real HTTP-before-Explorer/WBA-before-full-state
  ordering and 404 equivalent RPC fallback; no double WBA readiness on same mode.
- [x] Nine backend language tests pass including small projection isolation and
  unavailable error propagation. Strict mypy passes both changed Python files.
- [x] Three native HTTP/resource tests pass, including no-store success and
  503-not-404 backend failure. Cargo formatting passes. Validation compiled only
  test artifacts in the existing environment-selected Cargo cache; no activation.
- [x] Final strict TS and host build pass; 17 combined boot/HTTP tests and five
  targeted MessagePack/host transport checks pass. Existing module-type build
  warning remains visible. Authored-source whitespace check passes.
- [x] User reports the new initialization work passes live validation. This closes
  the live gate, not a claim of agent-collected timing or deployment hashes.

Branch: maintenance/0.2.356-startup-recovery. Existing .355 release-receipt edits
and unrelated untracked research_handoff.md/ty.toml preserved. No version bump,
runtime restart, mypyc/APK build, commit or publication requested. Native Cargo
test compilation is validation only and does not activate a production worker.

## Phases 2 and 3 — actual implementation workstreams

- [ ] Phase 2 / O1: source-backed framework-pipe/Sidebar IPC intent design,
  especially ALS <-> Code TE2; bounded implementation approval then delivery.
- [ ] Phase 3 / O2: source-backed concurrency, queue and DTO/PyO3-boundary design,
  bounded implementation approval then delivery.

Their testing/acceptance belongs within these phases; neither is implemented or
approved for blanket changes merely because the order is now recorded.

### O1 first slice — generic relay and backend app facts

- [x] User approves framework broker foundation and CWD/restore-state migration
  for Terminal/File Explorer/File Editor; ALS/mentions documented for next slice.
- [x] Extend the existing owned route/correlation registry with app.rpc.call and
  manifest service/version/caller/method policy. Framework derives source identity;
  target semantics remain app-owned, with no replay/socket fallback.
- [x] Code TE2 dispatches app.rpc.deliver on its existing bounded domain-loop
  adapter. Reuse CWD snapshot and Sidebar ledger/global projection owners.
  State publication requires an existing owned slot/token/URL and cannot activate
  clients, create slots or manufacture Sidebar registrations.
- [x] Replace the transient Python Sidebar socket helpers. Terminal/File Editor
  opt into existing HTTP-plus-pipe worker mode with outbound-only dispatch hooks;
  HTTP readiness, frontend sockets and terminal brokers remain unchanged.
- [x] Rust broker tests: 11 pass, including version/caller/method policy, opaque
  relay/correlation/error, pending limits, disconnect, timeout and late replies.
  Cargo formatting passes; target cache retained. This is test compilation only.
- [x] Final Python regression set: 195 pass across broker, app actions/ASGI,
  tabs, lifecycle, ordinary-worker and pipe tests. Isolated HTTP-plus-stdio worker
  proof passes: real HTTP action emits app.rpc.call, then consumes the correlated
  pipe reply. No live framework/ordinary app workers were restarted.
- [x] Strict mypy passes five broker/service/CWD files. Broader check additionally
  reports two unchanged baseline issues: terminal/backend.py dict.pop(None) type
  and File Editor's FileEditorError implicit re-export. Not new broker failures;
  no unrelated typing cleanup was included. Existing inactive-presentation test
  expectation now follows accepted document-open admission, with no behavior change.
- [x] Source-backed contract/limits and following ALS/mention acceptance semantics
  recorded in ../sidebar_app_intents/APP_RPC.md and CODE_TE2.md; repo memory synced.
- [x] User reports interpreted Code TE2 source and updated framework are working
  (2026-10-21), and requests checkpoint then ALS cutover. This records reported
  acceptance, not an agent audit of artifact provenance or compiled activation.
- [ ] New ordinary
  app workers, followed by CWD/new-tab, navigation/restore, cross-client state and
  closed-slot live acceptance. No host rebuild, OTA/APK, ALS cutover or shared
  framework restart authorized/performed in this slice.
- [ ] Next separately scoped ALS slice: readiness pipe dispatch/correlation,
  exact presentation/conversation proof and owner acceptance receipts; retain
  existing mention content policy and no uncertain insertion replay.

### ALS cutover investigation / plan recording — 2026-10-21

- [x] User chooses investigation before runtime activation, then approves recording
  the complete plan, explicitly retaining standalone socket integration with no
  socket fallback in framework pipe mode. No ALS implementation/restart approved.
- [x] Read sibling ALS AGENTS.md in full; source survey covers framework_pipe,
  lib/state/http startup, sidebar_ipc, ui_rpc, authenticated MCP IPC and UI client.
  Preserve sibling untracked dist/ and TE2 research_handoff.md/ty.toml.
- [x] Record full operation/event inventory, including project actions, CWD/focus,
  state publication, agent-review and three MCP draft methods—not only file opens
  and mentions. Existing frontend sockets and semantic owners remain in charge.
- [x] Record source-backed seams: readiness-only pipe needs async dispatch and
  request correlation; project open/create lack file-open's caller proof; socket
  peer checks cannot be replaced with fake registrations; control byte/deadline
  defaults need qualification for full draft/review and consent-bound operations.
- [x] User requires no new any/Any types: concrete DTOs, validated unknown/object
  ingress, no assertions/suppressions masking untyped boundaries. Existing broader
  typing laundry list remains separate unless a touched boundary requires repair.
- [x] Implementation stages, tests, mixed-version/standalone policy and activation
  gates documented in ../sidebar_app_intents/APP_RPC.md. No new test/build claims
  or acceptance inferred from this read-only investigation/planning pass.
- [x] Concrete Stage A edit/validation approval, then ALS bounded pipe foundation.
- [x] Qualify bulk/control limits and consent deadlines; approve Stage B semantic
  cutover with parity tests and any necessary caller-proof frontend changes.
- [ ] Joint ALS activation/publication and grouped live validation when connected
  model is ready. TE2 interpreted/new-framework acceptance is recorded above;
  ALS semantic pipe routing is implemented at source, not installed/live accepted.

### ALS Stage A — bidirectional pipe foundation

- [x] User approves typed envelopes/errors, bounded intake/dispatch/writer,
  request correlation, AppState startup wiring and isolated tests/docs. No new
  dependencies/any types, semantic exports, installation/restart, commit or push.
- [x] ALS framework_pipe is split into controller, protocol DTOs and runtime.
  Existing --stdio client is installed before build_router starts its CWD task;
  CWD and other Sidebar operations intentionally retain their existing lane.
- [x] Reader matches reply ID/correlation/opId while admitted async handlers may
  await reverse calls. Typed delivery/source validation, one-time handler binding,
  ten-second control-handler deadline and retained opId/project metadata.
- [x] Bound 16 pending outbound / 16 queued-running inbound calls; 64 KiB control
  params checked before queueing; incoming work reserves a 2 MiB encoded budget.
  Writer is 32 queued frames plus one write, sharing a 2 MiB budget. Output frames
  and serialized received control replies are capped at 1 MiB. These are not bulk
  draft/consent-operation budgets for Stage B.
- [x] Dedicated stdout writer acknowledges readiness after write/flush. EOF/error/
  close releases pending calls/admission and clears handler capture cycles; late
  replies are ignored. Required output failure closes; oversized result can emit
  a small error without reexecuting its handler. Completed tasks are drained.
- [x] ALS full Rust library suite: 172 pass, including 17 framework-pipe tests.
  No any/Any/dyn Any or new suppressions in changed Rust source; generic payload
  Value remains transport-only. Compiler warnings remain visible: existing
  embedded-python-adapter cfg plus dormant Stage A API/metadata dead-code warnings
  until semantic binding, not a claim of a warning-free production build.
- [x] Existing bootstrap regressions: 14 pass. TE2 wrapper pipe-readiness contract:
  one passes. Source packaging/fingerprinting already recurses into new .rs modules;
  no new package/build path was introduced. Scoped rustfmt/diff checks pass.
- [x] Final fresh debug native binary stdio regression after all source edits:
  six tests/two subtests pass using the exact Cargo output selected through
  ALS_TEST_SERVER_BIN. Readiness/HTTP serving, EOF, malformed input, unsupported
  request, occupied listener, SIGTERM and standalone behavior pass. With bootstrap
  and TE2 wrapper checks, 21 Python tests pass. No installed/active runtime changed.
- [x] User approves Stage B across TE2/ALS: existing operation owners, exact
  client/conversation routing, project caller proof, bounded bulk/deadline policies
  and regression builds. Installation, runtime restarts, pushes and new dependencies
  are excluded. Checkpoint: TE2 99ca2547; ALS 976a7a4, local only.
- [x] Stage B semantic owner wiring implemented at source; joint activation and
  live acceptance remain separate. Approved source work is not live traffic proof.

### ALS Stage B — receiver-policy prerequisite

- [x] Add generic receiver-declared, per-method request/reply/deadline limits;
  defaults stay 64 KiB/1 MiB/15 seconds. Validated ceilings are 8 MiB and 180
  seconds; unknown/undeclared policy keys and caller overrides reject.
- [x] Bound aggregate admitted serialized request/reply allowances to 32 MiB
  on each source and target route, retaining 16 outstanding calls and existing
  writer/frame limits. No waiting byte queue or mutation retry is introduced.
- [x] Final Rust broker suite: 15 tests pass, including unchanged defaults,
  method-scoped policy/caller-override denial, invalid bounds, shared byte
  saturation/release, self-calls, target-rejection rollback and complete UTF-8
  envelope sizing without content truncation. Scoped rustfmt/diff checks pass.
- [x] Qualify default versus full-model shapes: draft state carries content,
  diff and optional disk text; review can contain several source models. Selected
  8 MiB request/reply profiles and 60-second broker waits replace inadequate
  control budgets. UTF-8 fixtures above 1 MiB remain intact; oversized whole
  operations reject before delivery where known. This is synthetic qualification,
  not proof every possible project fits. Physical 32 MiB pipe framing is unchanged.
- [x] Bind actual TE2/ALS semantic owners and replace framework-mode socket
  traffic. Preserve standalone Socket.IO and no fallback/replay in pipe mode.

### ALS Stage B — semantic cutover source and validation

- [x] ALS chooses its backend transport from explicit --stdio, including CWD,
  state, file/edit/project, review and the existing three MCP draft operations.
  Closed pipes never construct a Sidebar socket. Startup CWD hydration follows
  the actual readiness write/flush, and failed listener binds emit no app calls.
- [x] Bind inbound mention/CWD/project/focus/review to existing AppState and UI
  owners. Require framework-derived Code TE2 source and explicit conversation
  for mentions; receipts expose owner operation/queued state, not render ACKs.
  Shutdown closes admission/reverse waiters before adapter/domain shutdown.
- [x] TE2 dispatches actual owners without fabricated SIDs; project caller proof
  is rechecked after switch-lock waits. ALS UI/backend preserve that same proof.
  Project UI/native/broker waits align at 190/185/180 seconds. Unknown outcomes
  never trigger retries. Minimal project facts omit unrelated boot snapshots.
- [x] Managed route inspection distinguishes absent apps from starting/stale
  routes. Reverse review excludes its originating app. Pipe mentions use exact
  client/slot/incarnation/conversation and never fall through to socket emission
  on timeout. Projection failures remain best-effort, not mutation retries.
- [x] Preserve full mention paths and reject excessive identity lengths instead
  of truncating IDs. Frontend sockets, terminal streams and native mappings remain.
- [x] Final focused Python suite: 157 pass, including the minimal-project-notice
  regression. Strict mypy passes seven
  production modules without new Any/cast/suppression escapes.
- [x] ALS full Rust library suite: 178 pass, including explicit-pipe CWD/status,
  closed-pipe no-socket behavior, actual bound composer/draft ownership, source
  denial, UTF-8 bulk receipts and pre-enqueue request/limit rejection.
- [x] ALS npm typecheck (including lint) and frontend build pass; 21 frontend
  file/project routing and project-control tests pass. No native-client reload.
- [x] Fresh isolated ALS debug binary: 20 native-stdio/bootstrap Python tests
  and two subtests pass, including readiness-first CWD, no framework HTTP/socket
  calls in stdio mode, EOF/corruption, listener failure, SIGTERM and standalone.
  Final post-shutdown-fence rebuild/recheck also passes the same 20 tests/two
  subtests. No installed runtime was used or replaced.
- [x] User approves local checkpoints and provenance-pinned ALS frontend snapshot
  refresh, without push/install/restart/OTA/version bump.
- [x] ALS checkpoint 3cc5e9f, then refresh the provenance-pinned frontend snapshot:
  149 resources verified with source/served hashes and --check. No dirty-source
  bypass, source maps in the snapshot, runtime publication or asset URL change.
  Ten ALS/native asset-mapping tests pass after updating their stale expected
  snapshot metadata from the previously vendored .138 to current ALS .139;
  no package version was bumped by this work.
- [ ] Approve matching framework/domain/ALS installation and exact worker refresh,
  plus native-client asset publication/reload. No active runtime changed so far.
- [ ] Grouped user live acceptance: multiple clients/conversations, in/out-of-root
  file opens, project switches/consent, mentions, review/MCP drafts and standalone.

2026-10-21: user reports Code TE2 running interpreted and working well; prioritize
the typing audit before another build. Agent performs no runtime transition.

Current changes are source-only. No version bump, installation, shared restart,
OTA/APK publication or push was performed. Existing compiler cfg/dead-code
warnings remain visible, without suppression. Preserve unrelated reports/dist.

## Phase 4 — native debug / internal bridge retirement (documentation only)

- [x] User approves read-only investigation; confirms implementation is NOT now.
  Initial placement immediately after startup was superseded: user requires two
  actual work phases first (intents, then concurrency/queuing).
- [x] Confirm both TE2 bridge copies serialize all hooked log levels; central
  console appends/broadcasts them. Find backend runtime_debug bootstrap metadata
  and existing console:registered reply as potential policy channel.
- [x] User supersedes filtering-only direction: first-party framework apps leave
  console bridge; native on-device debugging/logging serves internal tools.
  Bridge remains available for developer/user apps. User requests PLAN ONLY now.
- [x] Record Cefrium CDP and user-identified Gecko CHI interface; actual protocol/
  bindings/parity remain unverified until the deferred investigation.
- [ ] Inventory existing native debug APIs and socket/MCP pathways; qualify
  authenticated remote-client access and exact target/context lifecycle.
- [ ] Define Electron/generic-browser and older APK/server compatibility before
  removing any first-party bridge registration. No implicit reinjection fallback.
- [ ] Inventory all framework/ALS/native/Node producers and imports; scope ALS
  upstream source/snapshot updates independently, preserve developer wrappers.
- [ ] Approve concrete implementation/cutover when this phase is resumed.
- [ ] Prove native discovery/eval/on-demand logs, disconnect/detach fences and
  bounded transfer, then remove first-party bridge wiring at source.
- [ ] Prove developer bridge discovery/log/eval remains working and internal
  automatic bridge traffic is absent; approve builds/publication/live acceptance.

Earlier warn/error filtering and registration-policy findings remain investigation
history, not the current implementation plan. No console/native code changed.

## Optimization agenda intake (O1–O8; schedule above)

Initially recorded while user tested initialization (now accepted). PLAN.md O1–O8 owns
scope, relationships and gates; unchecked entries below mean investigations are
not done, not failed acceptance or approval to implement all items.

- [x] Preserve the user's complete optimization agenda in this release plan.
- [ ] O1: Framework-pipe intents / Sidebar IPC consolidation, especially
  ALS <-> Code TE2; reconcile earlier deferred work and exact-client ownership.
- [ ] O2: Pipe multiprocessing/multithreading, bounded in-process queuing and
  Code TE2 DTO/PyO3 handoff; identify actual backpressure and ordering needs.
- [ ] O3: Transparent socket routing through pipe DTO envelopes, avoiding
  network proxy hops where measurements justify it.
- [ ] O4: FlatBuffers / Cap'n Proto pipe codec comparison and compatibility proof.
- [ ] O5: Shared Rust source/runtime libraries, binary/build savings and direct
  pre-envelope *ops DTO reuse without duplicating framework authority.
- [ ] O6: Selected critical localhost streams over Node IPC on desktop/mobile,
  with explicit local capability and preserved remote paths; WBA candidate.
- [ ] O7: Frontend Cap'n Proto packed-stream proof over Socket.IO binary frames;
  initialization/CRUD first candidate, WBA/schema suitability still undecided.
- [ ] O8: WBA raw-socket/internal-client-ID experiment, ALS history pattern
  comparison, and separately measured MessagePack/compression trade-offs.
- [x] O9 intake: trace early provider registration/resync traffic, distinct from
  TextMate/Markdown. Full replay broadcasts and full snapshot hydration are both
  present. Source evidence and correctness gates recorded in PLAN.md.
- [ ] O9: approve/implement document-relevant, per-client provider publication
  with lazy hydration and bounded replay/snapshot behavior; preserve full registry.
  User explicitly defers WBA work when moving to Sidebar/intent work; not next.
- [ ] Choose next bounded investigation and obtain implementation approval only
  after source-backed design/evidence; no codec/library/transport cutover yet.

No new builds, dependency changes, cross-repo edits, runtime transitions, commits
or publication performed by this documentation-only intake.

## Additional repair — Aria Downloader (later)

- [x] User reports app is pretty broken; record repair for .356.
- [x] User explicitly selects record for later, not immediate investigation.
  IPC remains next; later placement is not yet chosen.
- [ ] Resume with current-source/runtime triage and a concrete repair plan;
  historical 502/stale-shell issues are leads only.
- [ ] Approve and implement bounded fixes, regression tests and live acceptance.

No Aria source/log investigation, restart or download/shell mutation performed.

## Sidebar/intent intake — after accepted checkpoint

Current source inventory (not a completed migration):

- Terminal backend: sidebar.cwd.get and sidebar.window.state.update; own transient
  Socket.IO client with register/call/disconnect in backend.py.
- File Explorer backend: same operations through app.libs.sidebar_rpc; durable
  tab/path/splash projection remains app-owned.
- File Editor backend: sidebar.window.state.update through app.libs.sidebar_rpc;
  file identity/validation remains app-owned.
- ALS Rust backend: sidebar_ipc.rs includes file open/edit, agent-edit publish/
  clear, project lookup/open/create and CWD/other integration; audit full surface
  before defining cutover scope. Source is sibling repo, no edits there yet.
- Code TE2 owns /sidebar_ipc; its host frontend also uses that namespace for
  registration/presentation/control. Preserve these frontend lanes separately
  from backend-to-backend transport retirement.
- Native Electron uses UI IPC (/ui_ipc), not a native /sidebar_ipc client.

No direct backend Sidebar IPC caller found in current Archive Manager/Aria source
survey. This is built-in source inventory, not a scan of user-installed apps.
Existing production framework app-intent pipe already handles selected document/
app/project/terminal intents; expand existing owners, not a new bus.

User authorizes checkpoint/push of accepted startup/DevTools work and planning/
release receipts. Preserve research_handoff.md and ty.toml unstaged. WBA remains
unchanged/deferred. Next: deepen the Sidebar/pipeline contract audit and propose
bounded implementation; no migration implementation or shared restart yet.
