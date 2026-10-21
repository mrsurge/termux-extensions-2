# 0.2.356 maintenance tracker

## Current work order

1. Startup/HTTP initialization: user live accepted 2026-10-20, complete.
2. Framework-pipe/Sidebar intents (O1): next actual work.
3. Pipe concurrency and bounded DTO/PyO3 buffering (O2): follows intents.
4. Native debug/internal console-bridge retirement: deferred behind both.
5. Remaining O3–O8 investigations: later ordering by evidence/user choice.

Validation belongs within each work phase, never a replacement for actual work.

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
