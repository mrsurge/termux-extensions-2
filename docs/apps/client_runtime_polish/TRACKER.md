# Client Runtime Polish Tracker

Plan: [PLAN.md](PLAN.md). Baseline: published TE2 0.2.351.
Working branch: `feature/desktop-deb-packaging`; no new branch needed for planning.

## Planning

- [x] Record the three requested workstreams and initial source entry points.
- [x] Separate verified source observations from unconfirmed bug explanations.
- [x] Capture the original persistence proposal; superseded below after the
  reconciliation fix passed live acceptance.

## Color picker

- [ ] Trace normal-hover versus color-discovery/presentation flow end to end.
- [x] Investigate the document selector argument and existing provider waits.
- [ ] Capture cold/warm local/remote timings with bounded instrumentation.
- [x] Implement the evidenced generic fix; user reports live acceptance on all clients.

### First correction — provider selection

The frontend aggregated color provider sends no explicit provider handle for
presentations. WBA passed a language string to the document-aware registry,
which rejects it for missing languageId/path, then exhausted its five-second
discovery wait. Normal hover and document-color discovery already pass the full
document descriptor. Presentations now do likewise, preserving scheme/path
matching and all eligible providers without a language-specific workaround.

Rebuilt WBA output; five focused tests passed, including real-registry color
presentation dispatch for file and vscode-remote schemes with nonmatching
providers excluded and no discovery wait. Code TE2 typecheck and build passed.
The separate full WBA tsc invocation remains red on module resolution and other
errors outside this change; do not report it as passing.

User live acceptance: all clients passed. The initially reported consecutive-hover
delay was affected by a connection issue in the test environment, not a confirmed
failure of this correction. No numerical timing claims are made. Further timing
analysis and investigation of discovery's extra full-text didChange acknowledgement
are deferred unless fresh evidence warrants them. This correction changes only
the server-side WBA payload; no native asset publication is needed for the fix.

## Sidebar identity and preferences

### First correction — live membership is not durable preference authority

Source investigation found concurrent primary-view activation publishing each
individual view's snapshot as complete. Python could remove not-yet-created views,
then frontend reconciliation discarded their hidden/order settings. Persistent
contributed-view IDs are already deterministic; console IDs additionally contain
a separate window identity, so their length alone does not establish identity churn.

Implemented `membershipComplete` on WBA snapshots: activation progress upserts
immediately without pruning; completion permits live-membership removal. Session
reset remains non-authoritative. Frontend reconciliation retains order/mode for
absent persistent contributed views, but projects only live slots and clears stale
foreground/mention targets. Disposable panel/run-target removal is unchanged.
Storage migration, shortened IDs and expiry were subsequently cancelled by the
user; retain the existing client-local stores.

Validation: 26 focused JS tests and 12 Python tests passed; Code TE2 typecheck and
frontend/WBA build passed. User reports the correction working and live-accepted.
The agent did not restart the shared runtime, perform native OTA, edit Android,
bump versions or publish a release during implementation.

- [x] Trace and correct the source-backed preference-loss path.
- [x] Retain regression tests and record user live acceptance.
- [x] Close this workstream with existing client-local persistence retained.

Cancelled, not implemented: backend config migration, new boot projection,
compact-ID redesign, last-access tracking and 14-day expiry. Preserve asynchronous
Sidebar loading; no additional startup redesign without new evidence.

## Cefrium zoom

- [ ] Classify the live zoom gesture and affected browser surfaces/devices.
- [ ] Inspect pinned API and suppression lifecycle/recreation paths.
- [ ] Implement only the confirmed correction, if required.
- [ ] Build/bundle and live-test Motorola and Pixel with verified client assets.

## Cefrium CDP worker recovery and debugging documentation

- [x] Isolate missing diff computation to a paused worker using page-console probes.
- [x] Discover native CDP port, forward through ADB, and inspect the exact worker.
- [x] Confirm causality: targeted debugger resume restores the existing diff.
- [x] Correct inspector child-session routing separately from native monitors.
- [x] Pass three routing unit tests; build minified staging with current assets.
- [x] Install on Motorola; classic/module probes start and two diff hunks compute
  with DevTools connected. User reports live success.
- [x] Record the investigation sequence, cleanup and evidence limits in PLAN.md.
- [ ] Publish the reusable runbook in CODE_TE2.md and link it from repo memory.
- [ ] Locate/update canonical developer instructions (devins) with that workflow.
- [ ] Validate the published runbook from fresh endpoint discovery through cleanup.
- [ ] Diagnose the separate unexpected renderer/page reload. Current incident:
  page navigation reports reload at device time 2026-09-26 22:27:36; toast records
  surround it, but no retained current termination status or crash cause is proven.

## Release artifact reuse

- [x] Preliminary source inspection of Linux wheel injection, runtime provenance,
  native build info, bootstrap fingerprints and Termux version coupling.
- [x] Record proposed separate package/native identities and fail-closed reuse.
- [x] Define wheel/install-script-first publication and independent optional APK
  releases, with separately tracked native, bundled and OTA asset identities.
- [ ] Audit complete native inputs, protocol compatibility and version consumers.
- [x] Select release-family numbering: native `0.2.352`, reuse releases
  `0.2.352.1`, `.2`, then a new native family such as `0.2.353`.
- [ ] Audit version consumers and define provenance migration for that scheme.
- [ ] Define native/asset compatibility and APK resolution for wheel-only releases;
  audit latest/download links and existing Electron upgrade/materialization.
- [ ] Publish portable native artifact manifests and add verified reuse selection.
- [ ] Prove frontend-only packaging needs no Cargo; cover invalid reuse tests.
- [ ] Validate reused binaries through Debian/Termux fresh install and upgrade.
- [ ] Validate old-APK OTA, incompatible/failed OTA handling and fresh APK discovery
  when the newest release publishes only updated Python/frontend artifacts.

## mypyc / Pixel performance

- [x] Capture exploratory desktop JIT on/off and warmed Pixel startup timings;
  verify JIT state inside each live worker, not just its launch environment.
- [x] Record source/interpreter differences and the limits of those comparisons.
- [x] Synchronize Pixel editable source to `3e7debd3` and mirror the plan/tracker;
  preserve `apply_patch.py` and leave the running worker untouched.
- [x] Identify and approve an isolated guarded import profiling entrypoint.
- [x] Collect three source-matched isolated import samples on Pixel; record
  instrumentation, empty-state and bytecode-cache caveats separately from live startup.
- [x] Audit and select runner_profiles as the single-module workflow pilot.
- [x] Obtain approval and build the isolated native pilot using existing Pixel tools;
  no dependency install or replacement of the live editable installation.
- [x] Compare 12 imports per variant/condition with valid interpreted bytecode;
  focused behavior checks pass, no meaningful import-speed improvement found.
- [x] Select/audit the five-module Git/history/pipe group and obtain build approval.
- [x] Build the group in Pixel scratch; record exception/async-generator adapters
  and the runtime msgspec annotation failure. Correctness gate failed; no group
  timing claim or live deployment.
- [x] Approve/test a revised boundary keeping runtime-inspected schemas interpreted;
  four compiled modules pass focused Git/history/pipe checks.
- [x] Measure the revised group with 12 imports per variant/condition: about 6 ms
  median reduction, overlapping ranges; no whole-worker speedup claim.
- [ ] Run broader integration parity and whole-import/startup measurements for that group.
- [ ] Decide whether measured benefit warrants expansion and wheel integration.
- [ ] Investigate search benchmark lockup separately; no unrestricted rerun.

## Portable persistence boundary

- [x] Record shared byte storage, replaceable codec/schema and DTO contracts;
  domain stores retain migrations and state authority. Planning only.
- [ ] Inventory JSON file consumers and existing format, corruption, concurrency
  and hash-sensitive serialization contracts.
- [x] Audit registry/preferences read/write/recovery contracts and their separate
  intelligence-state dependency; broader consumer inventory remains pending.
- [x] Add bounded isolated persistence probe; compare actual Pixel fixture JSON/
  msgspec stages and current store loads across three fresh processes.
- [x] Verify fixture decoder parity and encode round trips; ten local probe/guard
  tests pass. Registry decoding was not faster; no live files changed or restart.
- [ ] Count repeated persistence loads during full startup and measure aggregate
  initialization/migration costs; single-file timings do not explain the delay.
- [x] Count guarded backend-import reads: preferences/intelligence once each,
  registry zero; JSON decoding under 1 ms. Later client/lifecycle phases excluded.
- [x] Trace duplicate preference reads in one boot snapshot and independent
  registry reads in TextMate/theme paths; runtime frequencies remain unmeasured.
- [x] Attribute compilation: 88 stale repo pyc files cause 415–431 ms explicit
  source compilation in the guarded probe; scratch-seeded caches remove it.
  Generated attrs/annotation compilation remains (~35–39 ms). No live-cache edits.
- [ ] Use cache-normalized profiles for subsequent dependency/module attribution;
  verify live bytecode policy separately before claiming a production issue.
- [ ] Measure read/decode/validation-migration/construction stages and total startup
  on representative scratch data; distinguish import overhead from file parsing.
- [ ] Approve an extension-registry plus preference-store pilot comparing the
  existing JSON path with msgspec, without changing on-disk contracts.
- [ ] Validate DTO/codec independence, round trips, migrations, error behavior,
  atomic writes and concurrency before performance acceptance.
- [ ] Review evidence before broader rollout or Rust/PyO3 replacement.

## First-document readiness

- [x] Establish `feature/code-te2-native-services`; committed snapshot `3e7debd3`
  is on main. Uncommitted investigation work was preserved, not published.
- [x] Prioritize document/theme/syntax readiness separately from listener and WBA
  readiness; record terminal/run-profile deferral as a distinct workstream.
- [ ] Map the critical import/lifecycle graph and capture first-highlighted-paint
  plus intelligence timings with valid caches and installed-wheel baselines.
- [ ] Audit terminal-stack lazy loading, including Pyte, FWS and restored sessions;
  preserve no-PTY behavior for non-terminal drawer use.
- [x] Audit gateway -> terminal backend -> Pyte import and existing lazy shellspec
  launch. Retain FWS process ownership; WBA/watcher eager imports remain.
- [x] Implement approved parser-only deferral with off-loop initial construction,
  single publication, propagated failure and retry; no frontend/runtime restart.
- [x] Validate 48 terminal/projection/transport/lifecycle and profiling-guard tests,
  including isolated gateway import, concurrent first use and cancelled first use.
  Both changed production modules pass basedpyright; diff whitespace check passes.
- [ ] Live-validate deferred terminal first use and restoration; measure startup
  and first-use cost before claiming a speedup.
- [ ] Audit run-profile lazy loading while retaining required active-profile/proxy
  reconciliation before restored surfaces navigate.
- [ ] Approve a concrete deferral slice with single-flight/error/shutdown semantics.
- [ ] Validate first paint, deferred first use, primary/secondary clients, remote
  reconnect and active terminal/profile restoration without polling.

## Native transport / editor services

- [x] Record Socketioxide/PyO3 and worker-local Axum shell as optional objectives
  after mypyc; superseded by the intended staged native-worker direction below.
- [x] Record the intended disk DTO -> pipe inventory -> native worker shell ->
  dependency removal sequence. Documentation approval is not blanket code approval.
- [ ] Specify and implement the approved disk DTO boundary before broad I/O migration.
- [ ] Inventory framework pipe and WBA control FD/framing/ownership separately.
- [ ] Inspect Ferrous Rust reuse and remaining Python framework-shells callers;
  distinguish process-control contracts from WBA application DTOs.
- [x] Clarify startup/import reduction as the objective; Axum complements
  Socketioxide, not a presumed Uvicorn/networking bottleneck.
- [x] Record optional pipe/file codec ownership in Rust and direct PyO3 value
  handoff; external MessagePack remains, and dependency removal needs a full audit.
- [ ] Measure removable Socket.IO import costs and inventory all remaining uses;
  keep transport hot-path measurements as a separate regression baseline.
- [ ] Specify transport-neutral service, lifecycle and bounded async bridge contracts.
- [ ] Audit HTTP/resource extraction and remaining Python client dependencies.
- [ ] Approve and validate a one-lane native prototype on Linux and Termux.
- [ ] Verify Python Socket.IO imports are actually eliminated before claiming
  startup savings; include native initialization costs in the comparison.
- [ ] Review native-worker milestones against parity/startup evidence before
  expanding; retain Python authority and separate-worker crash isolation.

## Completion

- [ ] Update architectural documentation/memory for verified contract changes.
- [ ] Record automated checks and user live acceptance separately.
- [ ] Commit/push/merge or release only under the corresponding user instruction.
