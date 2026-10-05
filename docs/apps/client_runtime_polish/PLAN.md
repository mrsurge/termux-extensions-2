# Client Runtime Polish After 0.2.351

## Scope

### Android keyboard support declaration

For Android editing, require Gboard version 18 or newer as the supported
keyboard baseline. Older Gboard versions may work, but are unsupported; do not
claim compatibility or add older-version workarounds to this release scope.
This is a documented support requirement, not a runtime keyboard/version gate.

README wording to include before release:

> Android editing requires Gboard 18 or newer for supported operation. Older
> Gboard versions may work, but are not supported.

### Editor/framework UI corrections before the next release

Inline diff gutter alignment is the current approved slice. Live inspection of
identical Python models found four missing alignment-zone heights, all on lines
with injected inlay hints. A temporary, restored line-height refresh removed the
mismatches: normal wrapping calculations work, but injected-text updates do not
invalidate the diff alignment. Keep the deliberately unwrapped narrow original
editor; fix lifecycle-owned injected-text listeners in the Monaco source fork,
coalescing updates after view-model processing. Test hint insertion/removal and
model replacement, then publish Monaco ESM, rebuild bootstrap and host, and OTA
the native client before acceptance. No runtime line-height workaround.

Source checkout: shallow single-branch `worktrees/vscode-te2-diff`, upstream
`mrsurge/vscode-te2-diff`, branch `te2/pinned-baseline-diff`, baseline `f2d5196`.
Build only `editor-distro`, not the VS Code application. Preserve accepted
native/mypyc checkpoint archives and monitor disk usage during dependency/build
setup. Fork edits remain a separate Git scope; no release/version/tag yet.

Disable automatic capitalization in shared dialog inputs and registered custom
surfaces, including surfaces moved into a dialog portal. Apply the same inherited
policy to Code TE2, framework pages and both native launcher/settings roots, so
names, commit text, URLs and settings retain the user's typed case.

By Changes must project staged status from the existing project Git snapshot:
show a staged badge/checkmark, distinguish additional unstaged edits, and update
retained headers on the existing status notification. No extra status request or
optimistic staging authority is needed. Validate dialog behavior, retained-row
staging transitions, typecheck and frontend builds; native acceptance requires
asset OTA. Release/branch switching follows remaining bug fixes and user direction.

Investigation-first maintenance work covering color-picker latency, persistent
Sidebar presentation, and Cefrium zoom suppression. Keep the existing working
branch for now; no release, version bump, or implementation is authorized by
this documentation pass. Track execution in TRACKER.md alongside this file.

## 1. Color picker latency

Compare normal hover with color decoration discovery, picker opening, and color
presentation updates on the same document and client. Measure cold activation
separately from warm interactions, locally and over a remote connection.

Trace Monaco scheduling and provider registration through the direct WBA lane,
document synchronization, selector matching, extension-host dispatch, and reply
application. Identify redundant round trips, full-document transfers, provider
waits, and serial work before selecting a fix. Preserve all matching providers,
cancellation, document revisions, and client identity; no CSS-only bypass.

Initial source leads, not a confirmed runtime diagnosis:

- WBA `extensions/intelligence/document-colors.ts` has a provider-discovery wait
  capped at five seconds and a document-sync cache.
- `provideColorPresentations` passes `languageId` to `documentColorHandles`,
  whose declared input is `ProviderDocument`. Trace caller-supplied handles and
  runtime matching to determine the actual effect.
- Compare against `extensions/intelligence/hover.ts` and the editor color-provider
  registration/transport path; do not infer latency from timeout limits alone.

Acceptance: warm picker opens without avoidable registration/synchronization
delays; color changes and format choices remain correct after edits, file
switches, reconnects, and multiple clients opening the same document.

## 2. Stable client identity and durable Sidebar preferences

### Accepted correction; additional upgrades cancelled

Assign one stable primary identity per native installation or browser profile.
Each device/client has its own identity; devices do not share one global ID.
Normal reload, worker/framework restart, reconnect, and native relay-port changes
must never rotate it. Explicit reset may rotate it. Secondary editors retain
their separate stable identities. Keep transient window/console/session identity
out of durable preference keys.

The reported loss was traced to destructive membership reconciliation, not missing
persistence. The correction is implemented and user live-accepted. Retain existing
IDs and client-owned storage: Electron's `desktop-state.json`, Android's private
`android_sidebar_presentation` store, and browser localStorage. Native records use
configured upstream identity rather than transient relay origin. No backend
preference-store migration or compact-ID redesign is needed for this workstream.

Keep the regression coverage: partial WBA activation snapshots must not prune
not-yet-ready views; persistent contributed-view hide/order preferences survive
temporary absence. Only live slots render and participate in routing. Disposable
panels and run targets keep their established removal semantics.

### Startup and storage

Preserve existing asynchronous Sidebar loading and avoid extra startup round trips.
Apply stored visibility before materializing extension views; extension activation
and resource loading must not hold either editor or Sidebar shell readiness.
Preserve exact-client routing, shared membership, and deliberate user reopen.

Cancel the proposed 14-day expiry, last-access bookkeeping, backend boot projection,
and related migration work. Preserve current storage bounds; add no housekeeping
polling. Reopen optimization or identity work only with new evidence of a problem.

Source starting points: frontend `client-identity.ts`, Sidebar
`presentation-state.ts`/`runtime.ts`, Electron `desktop-state-store.ts`, Android
`AndroidNativePageIdentity.kt`/`AndroidSidebarPresentationStore.kt`, backend
`client_presentation.py`, and the existing PreferencesStore/Sidebar ledger.

Status: user reports the fix working and live-accepted. Automated coverage includes
staggered activation, empty membership and retained preferences, with existing
native/browser storage tests retained. This does not claim every conceivable
multi-client/restart combination was manually tested.

## 3. Cefrium pinch-to-zoom suppression

Source currently calls `setPinchToZoomEnabled(false)` on several browser creation
paths. `Te2CefriumBrowserAccess.disablePageZoom` also disables Chromium multi-touch
and double-tap support and resets zoom. Determine whether the reported zoom is
page pinch, double-tap, input autozoom, or an editor-specific gesture.

Inspect the pinned Cefrium API and lifecycle before blaming an upstream change.
Trace suppression on primary/secondary browsers, navigation, renderer recreation,
and resume. Compare Pixel and Motorola and retain the existing Monaco input font
floor used against focus autozoom. Apply the smallest evidenced correction.

Acceptance: pinch and double-tap do not zoom primary/secondary editor or app
surfaces after cold launch, resume, navigation, or renderer recreation; scrolling,
selection, and keyboard behavior remain usable. Android implementation/build work
is a subsequent scope, not part of this documentation pass.

### Cefrium CDP-over-ADB investigation workflow

The operational runbook is now maintained in
`docs/apps/code_te2/CODE_TE2.md`, **Cefrium CDP-over-ADB investigation workflow**.
The incident observations and historical port examples below remain investigation
evidence, not current endpoint configuration.

Use this when the TE2 console can inspect the page but a Chromium worker or
renderer needs lower-level inspection. This complements the console, not a new
production transport. Do not restart the shared framework or reload the failing
page before capturing evidence.

1. Discover the exact device with `adb devices -l` and the exact live frontend
   and native console worker IDs with `te2 console list-workers`.
2. Evaluate this JSON request in the **native Cefrium console worker**, not the
   JavaScript main-page worker:
   `{"jsonrpc":"2.0","method":"android.devTools.state.get","params":{}}`.
   Read `bridgePort`, `controlConnected`, `activeTargetId`, and inspector readiness.
   Ports and target/session IDs are runtime values; rediscover after restarts.
3. Forward only that device's loopback CDP port through ADB:
   `adb -s "$DEVICE" forward tcp:0 tcp:"$DEVICE_CDP_PORT"`.
   Record the allocated local port as `LOCAL_PORT`. Inspect
   `http://127.0.0.1:$LOCAL_PORT/json/list` and `/json/version`.
   Select the target by its current type, URL and parent relationship, not its
   display label alone. Keep CDP local; do not expose its unauthenticated control
   interface on a public listener.
4. Connect a WebSocket client to the discovered `webSocketDebuggerUrl`. The
   investigation used the repo venv's Python `websockets` package. Use bounded
   timeouts and correlate replies by request ID; unsolicited events may arrive
   first. `/devtools/browser` and `/devtools/page/<target-id>` were available on
   this build; prefer discovery over constructing URLs from remembered IDs.
5. Inspect before mutating. The empty-diff investigation first established:
   distinct live original/modified models, a received baseline, a null diff
   result, `isDiffUpToDate=false`, and the worker's initialization reply pending.
   Temporary classic/module Blob workers also failed to post a trivial startup
   message. Probe workers were terminated and Blob URLs revoked afterward.
6. With explicit approval, issue a narrowly scoped diagnostic intervention.
   Here, a direct connection to the **exact Monaco worker** received
   `{"id":1,"method":"Runtime.runIfWaitingForDebugger"}`. Its successful
   response immediately restored two diff hunks and `upToDate=true`, without
   navigation, model replacement or another baseline fetch. This command resumes
   execution; it is not read-only and must not become a blanket startup workaround.
7. Close probe sockets and remove only the forwarding created for this session:
   `adb -s "$DEVICE" forward --remove tcp:"$LOCAL_PORT"`.
   Never use `--remove-all`, which may disrupt other debugging sessions.

Historical example only: local port 43335 forwarded device port 37873. Neither
is a stable endpoint. The installed patched APK later reported device port 38983.

Confirmed cause: the embedded DevTools frontend requests auto-attachment with
`waitForDebuggerOnStart=true`. TE2's bridge consumed inspector child-target events
as native monitor events and dropped child-session replies, preventing DevTools
from completing worker initialization/resumption. Route the inspector's complete
flattened session subtree before native monitor dispatch, preserve child session
IDs, and prune detached descendants. Do not mix native monitoring and inspector
ownership or simply disable the debugger wait to hide the routing defect.

For unexpected renderer reloads, correlate device time, `logcat -b crash`, recent
main/system logs, `dumpsys activity exit-info <package>`, and page navigation timing.
Main-process survival does not rule out renderer failure. A later “isolated not
needed” exit may be cleanup, not the initiating cause. Toast records may retain
only package/token/timestamps, not text. The literal “Browser renderer restarted”
is emitted by TE2's renderer-termination callback, but does not identify why the
renderer terminated. Do not attribute a current incident to an older tombstone.

### Durable debugging guidance

- The workflow now lives in CODE_TE2.md's **Cefrium CDP-over-ADB investigation
  workflow**, including discovery, bounded request/reply handling, approval
  boundaries, cleanup and native/page-console/CDP ownership. `.repo_memory.md`
  retains a short access sequence and the critical child-session routing guard.
- Locate the canonical repo-owned developer-instruction (devins) source before
  editing it. Add the same discovery-first escalation path there, not a stale
  injected copy or a hard-coded device/port/target example as configuration.
- Validate the documented sequence on a fresh connection, including teardown.
  Keep crash/reload causality explicitly unresolved until current evidence proves it.

## 4. Reuse verified Rust artifacts across package releases

### Preliminary source findings

- `setup.py` already accepts `TE2_RELEASE_SERVER_BIN` and copies that binary into
  a Linux wheel without compiling it. Its schema-1 provenance records the current
  package version, release commit/tag, platform and binary SHA-256, but does not
  distinguish the native artifact's original build from the packaging release.
- `app/release_runtime/__init__.py` validates package/provenance version equality,
  architecture, glibc floor and digest. Preserve those checks; reuse is not a
  reason to weaken installed-package validation or allow implicit Cargo fallback.
- `release/linux-wheel/build-inside-container.sh` currently invokes Cargo before
  wheel assembly. The orchestrator in `scripts/build_linux_release_wheel.py` needs
  a verified reuse path, not merely a cache that still enters the compile step.
- `release/termux/build_release.py::_validate_server_build_info` requires the
  server's embedded version to equal the new TE2 package version. This is an
  explicit blocker to cross-version reuse and must become a check against the
  independently declared native artifact identity, not be removed.
- Rust `--build-info` reports Cargo version, architecture/OS and compiled features.
  It does not currently supply the complete build-input provenance needed here.
- Bootstrap's `_rust_source_fingerprint` hashes workspace path, profile, features,
  platform/machine, Cargo manifests/lock and Rust files. It is a local build-cache
  key, not a portable release artifact key: paths differ between builders, and
  toolchain, build environment and non-Rust embedded inputs need an explicit audit.

### Intended direction, pending implementation investigation

There are two publication tracks, distinct from native-version ancestry:

- **Python distribution plus install script is the main release vehicle.** It
  carries Python/runtime code, repackaged TS/frontend assets, the Electron
  installation/build path and the selected native artifacts (inside the Linux
  wheel or through the existing Termux release packaging). A point release must
  not require Rust compilation or an Android build solely to advance its version.
- **Android APKs are independently published native clients.** Existing compatible
  APKs can receive frontend assets through OTA. Rebuild/publish APKs when native
  changes, bridge/security requirements or compatibility constraints require it,
  or deliberately to refresh the bundled first-install experience. An APK build
  is not a mandatory companion to every Python/frontend point release.

Record package version, asset version, APK native version/bundled asset version,
and native Rust identity separately. An old APK after OTA legitimately has newer
installed assets than its original bundle. Do not relabel old APK bytes or imply
they contain the new assets. An OTA failure must retain a coherent previous asset
set; incompatible native bridges require an APK upgrade rather than serving an
unsupported bundle. Define compatibility independently of literal version equality.

The release manifest/install script must resolve the newest compatible Android
artifact even when a new wheel-only GH release contains no new APK. Specify
whether it references the previous immutable asset or republishes identical bytes
with their original identity; audit current latest/download assumptions before
choosing. Release notes should explicitly distinguish rebuilt, reused and omitted
artifacts. Existing desktop installs likewise need the normal asset/build update
path; a new wheel alone does not prove an already running Electron client updated.

Separate TE2 distribution/release identity from native artifact identity. A new
frontend/Python release can package the exact previous Linux and Termux binaries
when all relevant native build inputs and compatibility contracts still match.
Keep the binary's original version, source commit, checksum and build provenance;
never label an old binary as built from the new packaging commit.

Define a portable, complete native-input manifest/hash: Rust sources and local
dependencies, Cargo manifests/lock, build scripts and embedded/generated inputs,
feature set, target triple, profile, compiler/linker/toolchain, build flags and
relevant environment, builder image/sysroot and minimum libc/Android API. Audit
Python/native pipe and FWS compatibility separately: unchanged Rust alone does
not establish that a changed Python runtime is compatible.

Selected versioning scheme: release families use the original native release
version as their prefix. For example, a native build shipped as `0.2.352` retains
that Rust version, fingerprint and checksum; subsequent frontend/Python/package
releases reusing it are `0.2.352.1`, `0.2.352.2`, and so on. The next native build
starts a new family, for example `0.2.353`. These numbers are illustrative, not
authorization to bump the current release.

The four-component revision belongs to wheel/package and GitHub release identity,
not Cargo's embedded version. Android's numeric versionCode increases for newly
published APKs independently; their metadata identifies the bundled asset revision,
while OTA-installed asset identity is tracked separately.
Audit Python version ordering, installer/version regexes, asset comparisons and
Android/Electron metadata consumers before implementation. Preserve native build
provenance separately. The family prefix communicates ancestry but never replaces
input/compatibility verification. A frontend bump must not edit Cargo's version
or otherwise invalidate native reuse. A forced native rebuild starts a new family.

Release selection should explicitly report reuse versus rebuild per target.
Retrieve immutable prior release artifacts with verified checksums/provenance;
reject missing, tampered, incompatible or incompletely described candidates.
Old artifacts without enough evidence require a rebuild, not guessed equivalence.
Retain a deliberate force-rebuild path. Reuse existing FWS/ALS wheels only under
their own dependency/ABI contracts; this does not authorize republishing them.

### Implementation and acceptance slices

1. Audit all version coupling, embedded inputs and Linux/Termux installer checks;
   specify the selected release-family numbering in the proposed provenance
   schema and define compatibility rules before pipeline changes.
2. Generate and publish reusable native manifests/artifacts in normal builds.
3. Add verified reuse selection to wheel, Termux archive and GH release assembly.
4. Test a frontend-only release with Cargo unavailable: native bytes/checksums stay
   identical while wheel metadata and bundled frontend advance. Test changed
   source/lock/features/toolchain/target, incompatible protocol, tampered artifacts
   and absent provenance to prove invalid reuse is rejected.
5. Validate fresh install and upgrade on remote Debian and real Termux, including
   app workers, WBA and terminal. Validate an existing APK receiving compatible
   new assets by OTA, rejection of incompatible assets, offline/failed OTA, and
   fresh Android installation from a wheel-only release's declared APK reference.
   Validate desktop upgrade/materialization as well. Newly built APKs must bundle
   the intended fresh assets; Rust reuse does not eliminate frontend packaging.

This phase authorizes no builds, version bumps, uploads or pipeline edits yet.

## 5. Code TE2 mypyc feasibility and Pixel performance

Goal: retain Python source and existing worker/lifecycle contracts while testing
ahead-of-time compilation of selected typed modules. mypyc is the primary
candidate; this is not a Python rewrite or a whole-worker executable conversion.
Strict annotations and the FastAPI/Pydantic removal provide useful groundwork,
but passing existing type checks does not establish mypyc compatibility or speedup.

### Recorded exploratory baseline (2026-09-27)

Single warmed-start samples, not controlled medians or proof of JIT benefit:

| Phase | Desktop JIT on | Desktop JIT off | Pixel Termux |
|---|---:|---:|---:|
| Backend import | 309.939 ms | 314.101 ms | 3324.084 ms |
| Trace origin to listener ready | 556.329 ms | 556.271 ms | 5081.925 ms |
| Serving hook | 14.909 ms | 12.973 ms | 179.174 ms |
| WBA connection | 2256.074 ms | 2301.749 ms | 3225.843 ms |
| Initial intelligence startup | 3299.247 ms | 3370.050 ms | 9734.401 ms |

Desktop used Python 3.14.4 in `.jitenv`, verified inside the live worker through
runtime-debug eval: JIT available in both runs, enabled true/false respectively.
Pixel used Termux Python 3.14.6, PID 26602, JIT unavailable/disabled, shell
`frs_1790551612289_23198_5_5`. User performed warm-up launches first. Phases overlap;
do not sum them. Pixel source was then at `488682c4`, desktop at `3e7debd3`, so
these cross-device samples are orientation, not source-matched acceptance.
The old `.315jit` environment actually selected non-JIT Python 3.14.6 free-threaded;
exclude it from JIT on/off comparisons. Always inspect the running worker rather
than trusting environment names or `PYTHON_JIT` alone.

### Ordered experiment and approval gates

1. Synchronize the Pixel editable checkout `~/mrselect6` to the desktop's committed
   source and mirror this plan/tracker. Preserve device edits and its untracked
   `apply_patch.py`; never merge back into the observability branch to do this.
   No framework restart, dependency installation or compilation in this slice.
2. Derive a safe import-profiling entrypoint from current source. Confirm imports
   cannot start another framework/services or mutate live project state before
   executing isolated import timing. Separate own modules, third-party imports,
   and module-level initialization; retain inclusive/self timings. Ask before
   restarting the worker for a fresh source-matched startup baseline.
3. Audit a small cohesive, expensive module group for mypyc: supported Python/ABI,
   typed operations, decorators, dynamic attributes, inheritance, introspection,
   async behavior, extension types, and compiled/interpreted boundaries. Report
   blockers and select the group before adding compiler dependencies.
4. Obtain approval for an isolated build/install experiment. Keep `.py` authoritative,
   preserve import names, and avoid replacing the editable install or live worker.
   Prove loaded module origins point to the compiled artifacts; validate Termux
   toolchain/runtime compatibility rather than assuming Linux wheels work on Android.
5. On the Pixel, alternate repeated interpreted/compiled warmed runs under the
   same interpreter, source, dependencies, project, extensions and instrumentation.
   Record medians/range, CPU and memory, import/listener timing and representative
   Python-owned projection/dispatch operations. Check functional parity and errors.
   Separate warm filesystem caches from warm long-lived process execution.
6. Expand compilation only with measured benefit. Wheel/ABI packaging, source/editable
   fallback policy and Linux comparison are later approved work, separate from Rust
   artifact reuse. No compiler choice promises a fixed desktop/mobile speed ratio.

Do not use unrestricted `window.__te2SearchBenchmark.runGenericSuite()` for this
experiment until its reported desktop lockup is understood. Audit MessagePack
framing/serialization and stage boundaries; the observed unbounded case limits,
per-occurrence full-line copies and decoder retry behavior are leads, not proven
causes. Any reproduction must be separately approved and tightly bounded.

### Isolated import probe (2026-09-27)

Approved development harness: `scripts/profile_code_te2_import.py`. Uses fresh
child interpreters with `-X importtime`, JIT off, temporary HOME/TE2/XDG roots,
no lifecycle invocation, and an audit guard rejecting network/process launches
and writes outside scratch. This protects against accidental effects, not hostile
code. Eight local guard tests passed. Pixel source was `3e7debd3` plus this harness.
Three samples completed successfully without restarting the live worker:

| Sample | Import wall | Process CPU |
|---|---:|---:|
| 1 | 3273.990 ms | 2316.780 ms |
| 2 | 1984.642 ms | 1915.422 ms |
| 3 | 1979.153 ms | 1895.637 ms |

Pixel artifacts: `.codex-scratch/mypyc-import-baseline/{0,1,2}.{stdout,imports}`.
Scratch state is removed after each sample. These use empty isolated state and
instrumentation; they are not live-worker startup measurements. Bytecode writes
are disabled (existing valid bytecode can still be read), so stale/missing pyc
source compilation can repeat. Filesystem cache, device load and guard overhead
remain confounders. Do not infer mypyc speedup from these numbers.

Third sample cumulative subtrees: socketio_gateway 1498.916 ms, socketio
466.037 ms, terminal_backend 302.089 ms, explorer_runtime 217.123 ms. These are
nested, import-order dependent, and must not be added. Largest first-party self
times included git_service 47.884 ms, sidebar_window_state 45.017 ms,
history_service 39.613 ms, terminal_backend 35.463 ms and explorer_runtime
34.171 ms. No single own module accounts for the multi-second cost.

Initial audit: keep main.py interpreted (app_worker explicitly loads its source
path). Imports instantiate HistoryStore/PreferencesStore and may write migrations;
never profile against live state. A pilot shortlist is runner_profiles (30.605 ms
self, typed frozen dataclasses and validation) and Git/history DTO adapters
(dataclasses plus pipe boundaries). Before selecting, audit callers, dataclass
reflection/serialization and tests. Sidebar normalization is function-heavy but
uses broad object dictionaries and a persistence-sensitive surface; not the first
automatic choice. The measured import ranking is not a runtime CPU profile.

### Isolated runner_profiles pilot (2026-09-27)

User approved the scratch build and behavior/import comparison. Pixel already
had mypy/mypyc 2.3.0, setuptools 84.0.0, Clang 21.1.8, Python headers and librt
0.13.0 native artifacts. No dependency installation was needed. Target Python is
3.14.6, normal GIL build, SOABI `cpython-314-aarch64-linux-android`.

Mypy rejected a repeated `config` annotation in `_config_object`; removing only
that repeated annotation was sufficient for the pilot compilation. Source remains
authoritative. `scripts/pilot_runner_profiles_mypyc.py` copies just the module and
package marker, compiles with mypyc `opt_level=3`, creates valid interpreted pyc,
and alternates fresh-process samples. No extension is placed in the editable
installation. Pixel artifacts/logs: `.codex-scratch/mypyc-runner-pilot-1/`.
Canonical module names and actual `.so` origins are checked in the samples.

| Import condition | Python median (range) | Native median (range) |
|---|---:|---:|
| Dependencies not explicitly preloaded | 29.222 ms (24.551–30.835) | 29.392 ms (23.275–31.767) |
| Module dependencies preloaded | 11.279 ms (9.658–11.864) | 11.081 ms (9.496–11.599) |

Twelve samples per variant/condition, JIT off, alternating order. The harness
already imports some common stdlib modules, so the first row is not an entirely
cold interpreter or full worker startup. No meaningful import improvement is
demonstrated by this module. Native build/load workflow is demonstrated; broader
performance benefit remains unproven.

Both variants passed focused checks for parsing, invalid values, frozen fields,
dataclass equality/asdict/replace, path matching, scratch config persistence,
warning updates and exception attributes. This is not the full integration suite.
Internal `_profiles_from_config` mock count was 1 interpreted and 0 compiled:
early binding bypasses module-attribute mocks. Preserve behavioral tests and
explicitly classify white-box tests; do not silently weaken correctness gates.

The earlier full import probe had disabled pyc writes. Read-only inventory found
91 timestamp-valid, 120 stale and 5 missing caches across Code TE2 source (including
unimported modules). The pilot fixes this confounder only in its scratch baseline;
do not compare its numbers directly to the older full-worker import trace.

### Joint Git/history pilot (2026-09-27)

Approved group: `git_service`, `history_service`, `pipe_runtime`, `pipe_protocol`,
and `messagepack_stream` (2,236 source lines). All five passed the targeted mypy
audit. A single mypyc invocation generated one shared native library plus five
canonical module wrappers; source concatenation is unnecessary.

Pixel scratch attempts under `.codex-scratch/mypyc-git-history-group-{1,2,3}`
exposed three compatibility boundaries in the installed mypyc 2.3.0:

- Native `RuntimeError` inheritance failed compilation. Scratch only: mark
  `PipeRuntimeError` as `native_class=False`.
- Async generators are unsupported. Scratch only: retain the unchanged
  `history_session` async-contextmanager lifecycle in an interpreted helper.
- The resulting build succeeded, but the real MessagePack request/response
  boundary failed correctness checks. Compiled `PipeEnvelope.__annotations__`
  exposes optional fields such as `id: str | None` as `type`; msgspec consequently
  rejects a string ID with `Expected type, got str`. The interpreted checks pass.
  Evidence: `compiled.checks.log` and direct annotation/`msgspec.structs.fields`
  inspection of the scratch `.so`.

No group timing comparison was run after this correctness failure. No live
module was replaced, dependency installed, or worker restarted. These adaptations
are harness-generated scratch changes, not production protocol changes.

The approved revised pilot leaves `pipe_protocol` interpreted and jointly compiles
the other four modules. Pixel artifacts: `.codex-scratch/mypyc-git-history-group-4`.
Explicit origin checks confirm four native wrappers and the Python schema. Both
variants passed the history open/page/files/notification/close lifecycle and six
existing MessagePack pipe tests. A subsequent expanded check also passed the Git
branch-list round trip through the same encoded pipe boundary. This is focused
parity, not the full worker integration suite.

Twelve alternating fresh-process imports per variant/condition, JIT off, valid
interpreted bytecode:

| Condition | Interpreted median (range), ms | Mixed native median (range), ms |
| --- | --- | --- |
| Dependencies not explicitly preloaded | 173.488 (166.019–179.241) | 167.062 (160.363–177.092) |
| Dependencies preloaded | 41.859 (35.254–47.258) | 35.756 (30.710–38.631) |

Absolute median reduction is approximately 6 ms in both conditions. Ranges overlap;
this is a modest exploratory signal, not evidence of a material whole-worker
startup win. Joint compilation works without flattening source, but Python
dependency import and initialization still remain. The exception and async
generator scratch adapters remain necessary for this candidate/toolchain.

Next gate: profile remaining initialization costs, including the persistence
boundary below, before selecting a larger compilation group or production
refactor. Whole-worker comparison still needs equivalent valid bytecode/state/
dependencies and separate approval. Do not extrapolate cumulative import times
or promise gains from compilation.

### Portable file storage, codec and DTO boundary

Planning scope only; implementation requires a concrete approved slice. Current
Code TE2 preferences, project/draft/history sidecars, extension registry, themes,
intelligence settings and run-profile JSON paths predominantly use standard-library
`json`. msgspec currently serves MessagePack transport/envelope validation and
some runtime-debug JSON paths. This does not establish JSON decoding as the
startup bottleneck, nor does replacing transports alone eliminate msgspec usage.

Introduce one reusable persistence implementation with three responsibilities:

1. **File storage:** read bytes, enforce store-appropriate size bounds, map
   filesystem errors, and perform atomic writes. Shared implementation does not
   mean a global queue: unrelated files must not serialize behind one another.
   Retain existing same-store write ordering and concurrency guarantees.
2. **Codec/schema:** decode bytes to validated DTOs and encode DTOs to bytes,
   initially evaluating `msgspec.json`. Keep codec-specific APIs behind this
   boundary; domain consumers must not depend on msgspec-specific methods.
3. **Domain stores:** retain defaults, migrations, revisions, draft safety and
   authoritative state ownership. A generic reader must not take over policy.
   Where migrations accept older shapes, preserve that admission path before
   validating the current DTO; strict decoding must not silently discard data.

DTOs provide an explicit replaceable contract, not a mandatory extra full-document
copy. A later Rust/PyO3 implementation could own storage, decoding and structural
validation while exposing equivalent Python-facing values. Python business rules
stay with the stores. msgspec.Struct runtime annotation requirements discovered
in the mypyc pilot must remain isolated and covered by compatibility tests.

Measurement and rollout gates:

- Measure read, decode, validation/migration, and construction/application
  separately, as well as end-to-end worker startup and dependency import costs.
  If fused typed decoding prevents separating decode and validation, report the
  combined stage honestly rather than double-counting or inventing timings.
- Compare existing text-read/`json.loads` with bytes-read/msgspec on identical
  representative scratch fixtures, source, bytecode and device conditions.
  Include actual document sizes and repeated runs; a decoder microbenchmark
  alone does not prove startup savings. Do not benchmark writes on live state.
- Start with the extension registry plus one smaller preference store. Cover
  substantial reads and defaults/migrations/atomic writes before expanding.
- Preserve on-disk formats, human-readable output where required, unknown-field
  behavior, empty/missing/corrupt-file handling and error contracts. Audit JSON
  semantics and deterministic/hash-sensitive serialization rather than doing a
  mechanical global replacement.
- Validate round trips, migrations, rejected input, interrupted-write safety and
  store concurrency; require parity before comparing performance. Any format,
  size-limit or recovery-policy change needs separate explicit justification.
- Adopt or expand only after reviewing measured benefit and refactor cost. No
  runtime changes, dependency removal, or live-worker restart are authorized by
  recording this design.

### Persistence probe findings (2026-09-27)

`scripts/profile_persistence_boundary.py` copies explicit input files into a new
private scratch root, redirects HOME/TE2/XDG roots and reuses the import probe's
audit guard to reject network/process actions and writes outside scratch. Input
files are capped at 16 MiB for this development probe only, not as a production
admission-policy change. No worker lifecycle is started. The Pixel worker was
already stopped by the user; the probe does not require or restart it.

Source audit: PreferencesStore always rereads disk, initializes/migrates defaults,
uses an instance lock and fixed sibling temporary file, and reads the separate
IntelligenceStateStore (which has a file lock). Registry reads return an empty
registry on several read/decode failures, retain unknown fields, may migrate old
user settings, and must propagate migration-write failures. Registry writes use
a unique sibling temporary file plus atomic replace. These are different policies
to preserve at the common storage/codec boundary, not flatten into one fallback.

Pixel `.codex-scratch/persistence-probe-2/` has three independent child runs with
30 samples per stage, alternating stage order and JIT disabled. Fixtures contain
23,487-byte preferences, 775,037-byte registry, and 131-byte intelligence state.
Outputs record sizes/timings, never document contents; copied fixtures remain
private scratch data and must not be committed. First exploratory run is under
`persistence-probe-1`; the second adds untyped decoding and like-for-like compact
encoding. Observed ranges of per-run medians in milliseconds:

| Operation | Preferences | Registry |
| --- | --- | --- |
| Standard-library decode from preloaded text | 0.148–0.159 | 5.324–5.648 |
| msgspec decode to `dict[str, object]` | 0.173–0.184 | 6.867–7.196 |
| msgspec untyped decode | 0.170–0.183 | 6.959–7.239 |
| Existing text read + standard-library decode | 0.226–0.268 | 7.147–7.511 |
| Byte read + msgspec object decode | 0.217–0.243 | 8.427–9.104 |
| Existing warmed domain-store load | 0.866–1.127 | 7.549–8.241 |
| Standard-library compact UTF-8 encoding | 0.146–0.161 | 11.155–11.770 |
| msgspec compact encoding | 0.074–0.081 | 3.150–3.338 |

All fixture decode equality and encode round-trip assertions passed. Preferences
construction took 1.428–1.553 ms; first registry load 6.747–7.844 ms. These are
isolated copied current-state loads, not legacy-migration benchmarks or total
worker startup. Filesystem caches are warm, reads include audit-guard overhead,
and imports were ordered/shared: module import timings are not standalone costs.
Compact encoding is not permission to change pretty-printed persisted output.

Conclusion: no evidence that decoding these files once explains seconds of
startup, and msgspec decoding did not improve this registry workload. Encoding
is faster in this bounded comparison. The portable boundary remains useful for
maintainability, but performance justification needs startup call counts and
aggregate costs, plus representative migration/validation measurements. Do not
replace production persistence or claim a full typed DTO pilot from these tests;
`dict[str, object]` validates only the top-level mapping shape. Next investigate
repeated loads and remaining module initialization before expanding compilation
or implementing the persistence refactor.

### Repeated-load and import-phase attribution (2026-09-27)

The persistence probe's `--startup` mode now profiles a guarded import of
`app.apps.code_te2.main` with copied preference/intelligence/registry fixtures.
It retains bounded call counts, caller locations and inclusive/self timings, not
frame locals or document contents. Artifacts are Pixel
`.codex-scratch/persistence-startup-{1,2}/`, three processes per run. No lifecycle
hook, browser connection, WBA launch or worker restart occurs. History/project
state is not copied, so this is not a full live-project startup reproduction.

All first-run import profiles have one PreferencesStore construction, one
`_read_from_disk`, one intelligence `_read`, two standard-library JSON loads, and
zero registry loads. JSON decoding totals 0.234–0.447 ms; preference construction
including initialization is 1.709–3.116 ms. Do not sum nested cumulative timings.
Repeated JSON reads do not explain this import-only phase.

Source does show later repetitions: `_build_boot_snapshot_core` reads preferences
for UI state and `_build_host_state_payload` reads them again within the same
snapshot. Each `get_preferences` also reads intelligence state. TextMate catalog
and grammar-body requests each call `_extension_entries` and reload the registry;
extension theme paths have their own registry reads. These are verified call
paths, not measured client-startup frequencies. Consider operation-scoped snapshot
reuse with preserved revision/authority semantics, not a global stale cache.

The second profile reports approximately 1.373–1.378 seconds instrumented import
wall time. Largest self-time category is `builtins.compile`: 829 calls totaling
386.56–395.22 ms, followed by marshal loads (~96–99 ms) and exec (~84–87 ms).
Compilation includes generated Python as well as source imports; do not label
all of it stale bytecode without caller attribution. The probe suppresses pyc
writes and prior audits found stale caches, so these are diagnostic profiles,
not cache-normalized baseline timings or production speedup estimates.

Next gates: distinguish source compilation from generated-code initialization,
then obtain explicit scope for lifecycle/client-boot read-count instrumentation
if needed. Full startup persistence totals remain unmeasured. A production
snapshot-reuse change requires its own approved implementation/parity slice.

### Bytecode versus generated compilation (2026-09-27)

The probe now attributes explicit `builtins.compile` calls through cProfile and
records compile-audit filenames/counts without source contents. Its
`--startup --warm-bytecode` option seeds a private `sys.pycache_prefix` within
each scratch state root, then measures a new process using those caches without
writing more bytecode. The seed is not a timing baseline: it compiles the entire
import set into an initially empty prefix. Normal repo/system caches remain
untouched. The audit guard permits descriptor writes only for stdout/stderr or
descriptors resolving inside scratch; focused descriptor tests pass.

Pixel evidence:

- `.codex-scratch/persistence-compile-existing-1`: three processes each compiled
  88 real source files, all in the TE2 repo, at 415.406–431.063 ms aggregate
  explicit-compile self time. Header checks of those exact files found 88 stale
  timestamp-based pyc files, not missing caches or site-package compilation.
- `.codex-scratch/persistence-bytecode-2`: three measured processes compiled
  zero source files. Remaining explicit compile callers were `attrs._make`
  (50 calls, 18.536–19.888 ms) and `annotationlib.__forward_code__` (691 calls,
  16.909–19.337 ms). These are generated-code initialization, not file JSON.
- Compile audit events also include implicit compilation (e.g. string execution):
  934 generated-filename events remain with warm bytecode. Audit counts must not
  be equated with the 741 explicit builtin compile calls or their timings.
- Instrumented wall times were 1.611–1.675 s with existing caches and
  1.013–1.147 s with scratch-seeded caches. These sequential exploratory runs
  include cProfile/audit overhead, different cache paths and device variability;
  do not advertise the wall-time delta as a controlled production speedup.

Conclusion: most explicit compilation cost previously observed was the probe
recompiling stale repo bytecode under `-B`. Cache normalization must precede any
further mypyc/native-versus-Python startup comparison. This does not establish
that the live worker has bytecode writes disabled; an ordinary writable startup
may refresh its caches. Do not delete caches as a remedy or change the live
installation without approval. Next use cache-normalized profiles to attribute
remaining dependency/module initialization and separately measure later
lifecycle/client-boot work as needed. Twelve local probe/guard tests pass.

## 6. First-document readiness and native editor-services workstream

This workstream lives on `feature/code-te2-native-services`, branched from
`3e7debd3` after that committed snapshot was fast-forwarded into upstream main.
Existing profiling/planning changes remain uncommitted; branch creation did not
publish them. This section supersedes the earlier optional-only native-shell
proposal: the intended target is a Rust-owned worker shell with Python domain
services, delivered through separately approved, measured implementation slices.

### Coherent end goal: native perimeter, compiled Python domain core

The objective is not a wholesale Python-to-Rust rewrite or an assumption that
Python networking is slow. Rust absorbs the dependency-heavy I/O perimeter so
the remaining local Python domain graph becomes a compact, typed, cohesive
mypyc compilation target. Preserve Python ownership of application state,
policy, orchestration, project/document authority and domain decisions.

Proceed in this order:

1. Complete the worker-local Rust/PyO3 boundaries for network, framework/WBA
   pipes, filesystem/serialization and process/FD integration where owned by
   this worker. Reuse existing framework/Ferrous services, not duplicate them.
2. Remove displaced external Python imports only after their remaining users
   have migrated. Verify the actual startup import graph and first-document
   readiness on Linux and Termux; lazy loading is not dependency elimination.
3. Compile the remaining connected local domain graph with mypyc, preferring
   a cohesive compilation unit where supported. Expand from the existing pilot
   evidence; strict ty/basedpyright annotations are preparation, not proof of
   mypyc compatibility. Keep runtime annotation-dependent schemas isolated until
   deliberately replaced; preserve an interpreted correctness reference.
4. Retire msgspec only after the Rust conversion and coherent mypyc stage have
   established tested replacements for its remaining codec, Struct and runtime
   validation responsibilities. Compilation alone does not supply those checks.
   External requests and persisted data must remain validated in both compiled
   and interpreted execution. Optional interpreted validation may retain msgspec
   only if the compiled production path no longer imports or requires it.

Keep msgspec wherever it currently performs useful work; removing it is a late
gate, not a prerequisite or a competing immediate optimization project. The
accepted codec checkpoint `72e0b13b` remains the baseline. It decodes into an
intermediate rmpv value tree then constructs Python objects through PyO3;
avoiding that tree is a possible later optimization, not a reason to reverse
the current migration. No opaque-payload experiment is scheduled now.

Acceptance requires domain/protocol parity and user live verification, measured
startup/import and steady-state costs (including native/interpreter loading and
boundary allocations), and eventual Linux/Termux wheel/ABI validation. Do not
equate passing tests, a smaller import graph or Rust ownership with a proven
speedup. Main build/release integration remains separately gated.

### Desktop mypyc whole-startup-graph preflight (2026-09-29)

This is an isolated build probe, **not** the native worker's build or a runtime
cutover. The regular-CPython `.jitenv` uses Python 3.14.4; mypy/mypyc 2.3.0 and
setuptools 84.0.0 were installed into that local, ignored build environment.
No source package, live worker or Pixel installation was replaced.

An audit-guarded import of `native_worker`, `intelligence_bootstrap`, `main` and
`socketio_gateway` reached 159 local `app.apps.code_te2` / `app.libs` modules.
After package initializers and the runtime-annotation-sensitive `pipe_protocol`
schema were left interpreted, the first joint mypyc candidate contained 147
source modules. This inventory is import-order and startup-mode dependent, not
the full set of modules reachable through later features.

- Mypyc's type pass found 16 diagnostics across eight local modules: exception
  binding scope, `None` return values used as results, narrowed role/notification
  types, reused variables across mutually exclusive run-profile branches,
  callable arity, and an `object` indexed as a map. These need source-backed
  corrections and behavior tests; strict `ty` acceptance alone is not mypyc
  acceptance. An untyped-function note in `editor_backend.py` also caused the
  mypyc invocation to exit, although direct mypy checking of the reduced group
  reported no errors.
- Once those modules were left interpreted, code generation exposed builtin
  `RuntimeError` subclass limitations in `code_server_bootstrap` and
  `pipe_runtime`, unsupported async generators in `intelligence_bootstrap` and
  `history_service`, and coroutine variable-deletion failures across host,
  socket, shell and sidebar modules. The approved older Git/history pilot already
  showed `native_class=False` and an interpreted async-generator helper as
  possible *scratch* adaptations; do not silently apply them to production.
- With 26 candidates left interpreted (including the protocol schema), 122
  modules compiled in one shared library and 122 canonical wrappers. A fresh
  interpreted import passed, but the compiled import failed: mypyc exposed
  `DraftIndexSidecar._instances: ClassVar[dict[...]] = {}` to `dataclasses` as a
  mutable field. Compile success is therefore **not** runtime parity. The
  `ProjectSidecar` ClassVar cache has the same source pattern but was already
  excluded for a type diagnostic; both need explicit parity checks.

No incompatible **external** import was observed in this preflight. Keep a
separate list if one appears: name the external module, the local importers,
whether it remains interpreted, and the choice between retaining it and a
native DTO boundary. Do not replace an external import merely because it exists.

The approved direction is to adapt the startup graph while retaining explicit
interpreted islands for constructs that mypyc cannot currently preserve. Do
not equate compilation with a runnable worker or a speedup. The reproducible
developer recipe is `scripts/probe_code_te2_mypyc.py`; output stays in an
isolated, ignored directory and is not installed into Code TE2 or a wheel.

The follow-up did not stop at the 122-module pilot. A 140-module shared build
passed mypyc and C compilation but failed on
an `object`-annotated shell DTO during import. A 135-module build with the
dataclass-exception contracts interpreted moved the import forward and exposed
the same issue in a `TypedDict` field. A minimal independent probe established
that `OpaqueValue: TypeAlias = object` preserves the Python type while avoiding
that mypyc 2.3.0 runtime lookup failure; the affected DTO fields now use the
alias. The next compiled import reached a `@runtime_checkable` Protocol that
mypyc generated as a non-Protocol class, so that module is interpreted in the
current probe. Dataclass ClassVar caches, async generators, the protocol schema,
and frozen dataclass exceptions also remain interpreted islands; these are
local compiler-shape limitations, not incompatible external imports. Passing
only C compilation does not satisfy this gate. The shared build must import and
exercise the actual worker domain before Pixel validation or a runtime cutover.

The next 135-module single-group build **did** load all 135 canonical compiled
wrappers in an audit-isolated desktop process; the interpreted baseline loaded
the same 135 from source. This proves the local typing/C/link/import procedure,
not runtime parity or a benchmark. A compiled-overlay unit run passed 83 and
failed 29 tests; a further Explorer/history run passed 48 and failed 15. Most
failures use `unittest.mock` to rebind Python globals or pass fake objects where
mypyc early binding/native slots require concrete compiled classes. One genuine
compiled behavior mismatch assigned `asyncio.gather`'s runtime list to a
tuple-inferred `_`; source now just awaits it. The final 135-module artifact
was rebuilt with that fix, passed both audit-isolated import checks (135/135
compiled origins), and passed 23 focused compiled-overlay tests, including the
FWS observer case that caught the mismatch. Before runtime opt-in, run broader
domain parity that does not rely on monkeypatching compiled call targets, then
exercise an isolated native worker. Keep dynamic integration adapters interpreted or expose
explicit structural injection seams where needed; do not weaken production
types solely to satisfy a mock. Pixel compile/ABI proof follows the desktop
build, while live worker replacement remains a separate approval gate.

The Pixel/Termux regular-CPython 3.14.6 probe completed the same 135-module
shared mypyc build and imported all 135 canonical compiled wrappers. Two
transitive mypyc type diagnostics required narrow source corrections: do not
assign the `None` result of the Git reset refresh helper, and explicitly
construct the `Literal["file", "dir"]` name-search DTO field after checking its
wire value. An installed third-party `scripts` package initially shadowed the
repo's namespace directory; the probe now imports its sibling audit helper
directly. Single isolated import checks measured 875 ms interpreted and 270 ms
compiled on that Pixel run. These are **not** full worker startup, parity or
repeatable benchmark results; no active worker was restarted or switched.

The approved runtime experiment now uses `CODE_TE2_MYPYC_DIR` and the
`.codex-scratch/mypyc-active` overlay selected by the experimental shellspec.
The 134-module desktop group passes 20/20 isolated native-worker tests. Only
`pipe_dto` was additionally excluded: compiled msgspec Struct annotations caused
valid pipe reply IDs to fail validation. Ordinary msgspec consumers stay compiled.
Distinct exception locals repair the compiled editor RPC error path; History
and terminal logic are retained in the compiled group. Source-resource symlinks
in the developer overlay preserve shellspec/theme/WBA lookup beside compiled
modules. This is not release artifact packaging. Pixel builds the same group;
live restarts remain user-owned and no startup speedup is claimed yet.
The matching Pixel build subsequently loaded all 134 compiled modules and
passed the same 20 isolated native-worker tests (51.22 seconds). Both local
and Pixel shellspecs now select their tested overlay; neither live worker
was restarted by the agent. Full user live acceptance remains pending.

Local live testing exposed further mypyc `asyncio.gather` runtime shape checks:
Explorer directory bootstrap and the combined host snapshot unpacked a list as
an annotated tuple, while reader cleanup assigned an unused gather result and
failed before releasing its native token. Preserve concurrent tasks, await the
group without assigning its result, then read typed task results as needed.
The follow-up local 134-module build passes 21 tests, including bootstrap
publications and cancellation/release. Those new checks fail on the prior
artifact. CPython 3.14 can still report the expected closed-reader exception
from a cancelled shield waiter even after cleanup retrieves it; release must
complete regardless. The local active overlay selects `mypyc-domain-gather-fix-1`.
Desktop live acceptance was reported after the gather correction: no observed
worker or WBA failures. The user approved transferring this correction to the
Pixel next. Device compilation and isolated validation precede changing its
active overlay; the live restart remains user-owned. The Pixel correction
subsequently built all 134 modules and passed all 21 isolated tests (24.89 s).
Its active overlay now selects `mypyc-domain-gather-fix-1`; the previous build
is retained. Pixel live acceptance passed. User-observed timings were approximately
1 s HTTP ready, 2 s page loaded, and 2.5 s model loaded; these are separate
milestones, not controlled benchmark samples. Desktop acceptance also passed.

#### Retain and package the accepted compiled worker

Preserve both the independent Rust `code-te2-worker` executable and its matching
134-module mypyc shared library/wrappers plus manifest. Checkpoint archives live
under `.release/mypyc-checkpoint-20260929/` for Linux x86_64 CPython 3.14 and
Termux aarch64 CPython 3.14; retain the device copy too. These are development
evidence, not distributable wheels: resource symlinks and absolute manifest paths
must be replaced by packaged resources/relative provenance before release.

Archive SHA-256:
- `linux-x86_64-cp314.tar.gz`: `6699c95f4f20354db04181c4c0a0c6e65476231fe7447a3a8bcb94c7a49fa524`
- `termux-aarch64-cp314.tar.gz`: `9a2d07f0e8817ce33ca2a53b74ca964623a166ebe2401c6d512cd2919490633f`

Next packaging work must integrate these artifacts into both Linux and Termux
wheel assembly and the installer workflow. Validate Python ABI/platform, native
worker/library compatibility, source fingerprints and checksums; carry interpreted
islands and msgspec dependencies. Installed workers must not depend on scratch
paths or silently fall back to compilation. Exercise clean installs and upgrades
on the existing Linux and Android acceptance targets before publication. No
wheel/release is produced by this checkpoint.

#### Developer mypyc cached build workflow

Source-backed finding (2026-10-02): the old probe required new C/object/library
directories for every invocation. Approximately 1.5 GB of legacy experiment
directories accumulated under `.codex-scratch/mypyc*`; the protected release
checkpoint adds 26 MB. After the overhaul, the user explicitly approved removing
legacy scratch iterations: old build/probe/inventory/test directories were removed,
recovering approximately 1.3 GB. The mapped active `mypyc-sidebar-reveal`, new cache/
snapshots and protected release checkpoint remain.

The new workflow retains one mutable build generation per checkout/toolchain/ABI/
compiled-module membership, with a dedicated 512 MB ccache when available. Ordinary
source edits reuse that generation. Setuptools rebuilds a changed shared extension
as a whole; ccache avoids rerunning compilation for unchanged translation units.
One shared compilation unit and early-bound internal calls are retained. Without
ccache, unchanged builds still skip up-to-date extensions, but changed extensions
pay the uncached compilation cost. Generated shared-header changes can invalidate
much or all of the group; no universal small-edit timing promise is made.

Build output becomes a new validated snapshot containing only libraries, manifest,
log and provenance (resource symlinks remain source-owned). It never changes an
active worker. Explicit `activate` verifies ABI/checksums and preserves a previous
target; `prune` defaults to a dry run and only recognizes new managed snapshots,
keeping newest two plus active/previous. Legacy directories, release checkpoints
and toolchain cache generations are not deleted. Refer to the native worker README
for commands and running-worker caveats. This is still developer workflow only,
not the wheel integration described above.

Validation: isolated two-module shared-group benchmark measured clean/no-change/
single-function edit at 12.179/2.238/3.358 seconds. The changed build reused 17
compiler results and had one miss; imports verified the new return value and the
unchanged module. These numbers prove the cache mechanism, not whole-worker
startup performance. Full 135-module cache population took 538.16 seconds on this
run; the unchanged cached rebuild took 35.11 seconds and compiled no C translation
units. Both snapshots passed all 135 compiled imports; the first snapshot also
passed 21 isolated native-worker/reader tests. Each runtime snapshot occupies
32 MB, versus roughly 155 MB for an old combined C/object/library iteration.
Thirteen workflow safety tests pass; the opt-in real compiler fixture passed too.
Both workflow scripts pass Mypy. Current live worker selection remains untouched.

#### Cefrium diff failure with CDP enabled — follow-up

User reports an editor soft-crash-like stall during diff loading, limited to
Cefrium with CDP enabled. Suspected recurrence: debugger auto-attachment pauses
Monaco diff workers before execution. This is **not yet confirmed** for the new
incident. Reuse the existing ADB/CDP runbook: inspect exact page/worker targets,
flattened child sessions, waiting-for-debugger state and resume delivery; compare
CDP on/off and confirm whether targeted resume restores the same diff without
reload. Keep native monitor and DevTools ownership separate. Do not change the
diff pipeline or disable debugging based solely on the symptom.

### Priority A: document and syntax readiness

Optimize time to the correct document rendered with its selected theme and syntax,
not merely a bound HTTP listener. Record distinct milestones for backend import,
listener readiness, authenticated editor snapshot, theme/grammar readiness,
model attachment/first highlighted paint, and later WBA intelligence availability.
Do not add overlapping durations or confuse backend timing with browser paint.
Use valid bytecode and a production-wheel baseline as well as editable profiling;
stale editable caches are not a claimed production-wheel defect.

Inventory imports and lifecycle dependencies before deferral. Identify the minimal
critical set for project/client identity, document/draft projection, preferences,
theme/TextMate grammar and reconnect correctness. WBA semantic tokens, diagnostics
and hovers have a separate readiness milestone; preserve early intelligence
overlap rather than serializing it after paint unnecessarily.

Evaluate asynchronous, demand-driven initialization of the entire terminal and
run-profile stacks, including transitive imports. Moving work into an async
function is insufficient if eager imports still load the dependency tree or the
function blocks the event loop. Keep lightweight route/handler declarations where
needed, and let actual demand await one owned initialization task. No polling,
arbitrary startup delays, duplicate initialization, or swallowed initialization
errors. Define cancellation, retry and shutdown behavior explicitly.

- **Terminal:** the drawer's Pyte/Python terminal stack and standalone Node PTY
  app are different owners. Audit FWS/raw-log/projection dependencies; do not
  assume Pyte is a bottleneck or replace it merely to move I/O. Opening a
  non-terminal drawer must not initialize a terminal or create a PTY. Restore
  existing sessions correctly, and preserve sequence/checkpoint/resize semantics.
- **Run profiles:** separate editor-critical configuration/facts from launch and
  process-management machinery. Running profiles and proxy route reconciliation
  may be needed before a restored sidebar/app can navigate. Do not defer that
  prerequisite behind paint or a click if it would strand an already-running app.
  First explicit run must await initialization without losing the user's request.
- **Acceptance:** test primary/secondary editors, remote/mobile clients, reconnect,
  background/resume, no terminal/profile use, first use, and restoration of active
  sessions/profiles. Compare both first-document latency and deferred first-use
  latency so improvements are not hidden regressions elsewhere.

Priority A can produce useful independent changes; it does not require completing
the native-shell migration, and does not authorize that migration implicitly.

#### First deferral slice: terminal parser

Source audit confirms that terminal shell creation is already demand-driven
through Framework-Shells and `terminal.yaml#terminal`. However, gateway assembly
eagerly imported Pyte through the screen-projection module. The approved first
slice moves only the parser implementation into `terminal_pyte.py` and constructs
the initial screen off-loop on first projection demand. Registry locking keeps
concurrent first requests single-publication; failed/cancelled construction does
not publish state and later demand can retry. A cancelled construction thread may
finish its in-memory object but owns no shell or file handle.

Terminal lifecycle/log subscriptions, PTY control, checkpoint/reset/resize logic
and the bounded registry remain in their existing owners. Other WBA/watcher
callers still import Framework-Shells; this slice does not remove that dependency.
It also does not defer the full terminal backend or change the standalone Node
terminal. Automated import/concurrency/projection checks precede live acceptance;
no first-paint speedup is claimed without a fresh measurement.

### Priority B: portable I/O and native worker shell

The [native handoff design](NATIVE_WORKER_HANDOFF.md) specifies proposed thread
ownership, independent reply delivery, value conversion, prototype admission
budgets, cancellation and shutdown gates. These are design targets, not current
runtime guarantees. The next concrete extraction is codec-independent structural
pipe DTO imports; a native harness then needs separate implementation approval.

The source-backed [pipe boundary inventory](PIPE_BOUNDARY_INVENTORY.md) separates
framework envelopes, WBA control records and PTY traffic. It records Ferrous's
binary-safe API and the unresolved cross-process ownership gate. The next proposed
slice is a transport-neutral framework-pipe interface with the existing Python
implementation and parity tests, before any Rust/PyO3 worker implementation.

The first approved persistence extraction introduces `persistence_io.py` for
preferences, persisted registry and intelligence state: byte reads/atomic writes
are separate from UTF-8/JSON conversion, while stores keep their policy and DTO
construction. Preserve stdlib JSON byte formatting and corruption behavior in
this slice; do not substitute msgspec based on the earlier decoding measurements.
Hash-sensitive registry JSON remains unchanged. Tests cover format parity,
replacement failure/cleanup, no caching, migrations and existing lock behavior.
Run-profile inspection found launch imports and URL readiness HTTP already lazy;
the startup FWS bridge restores active routes/terminal facts and must stay eager.
No broader run-profile deferral is justified by that audit alone.

Keep an explicit transport-neutral Python editor-services API. Rust owns I/O and
structural DTO conversion; Python retains document/project authority, drafts,
preferences policy, migrations and orchestration. Avoid introducing new transport
dependencies into domain services. Intended implementation order:

1. Build the shared disk storage/codec/DTO creation-consumption boundary described
   in §5, first registry/preferences, preserving formats and store policies.
2. Map framework pipe FD ownership, framing, requests/replies, notifications,
   dispatch, backpressure, cancellation and lifecycle. Map WBA control and FWS
   process control separately; they are not interchangeable DTO contracts.
3. Prototype a separate FWS-managed Rust worker shell loading Python services
   through PyO3. Rust handles pipe/HTTP/Socket.IO and MessagePack encode/decode;
   PyO3 exchanges validated service values, not a second serialized message.
4. Replace Python network, filesystem and descriptor responsibilities by boundary,
   passing parity tests before removing imports/dependencies. Audit hidden callers
   and transitive imports; do not delete necessary modules merely by category.

Inspect Ferrous Framework's existing Rust process/pipe facilities for reuse in
WBA control and FWS integration before inventing a competing process manager.
Whether Python framework-shells remains required is an inventory result, not an
assumption. WBA application DTOs retain their own identities and semantics; its
direct browser-to-JS intelligence socket remains outside this Python migration.
Terminal parsing/projection may remain Python while its I/O moves to the shell;
that decision is independent of lazy loading and requires its own parity scope.

Primary motivation is mobile worker startup/module-loading cost, specifically
the Python Socket.IO/Engine.IO dependency tree. Python networking is not an
established bottleneck, and replacing Uvicorn is not a performance objective.
The initial native slice uses Hyper directly alongside Socketioxide; Axum remains
an option if richer HTTP routing becomes necessary. Transport throughput or scheduling
improvements are secondary possible benefits, not the justification for this work.
This complements mypyc for our own modules; neither route replaces measurement.

For the native transport slice, investigate a Socketioxide/PyO3 adapter. Current editor/Explorer
RPC envelopes and codec boundary are promising seams. Rust could own connections,
Engine.IO framing/upgrades/heartbeats, rooms, acknowledgements and bounded queues;
Python retains domain validation, client/project authority and service dispatch.
The accepted codec slice decodes application MessagePack in Rust and passes
structural values through PyO3; preserve the current binary-event wire format.
Opaque payload delivery is an alternative, not the current workstream. Application
`msgpack-v1` is not Socket.IO's alternative MessagePack packet parser.

The implemented branch target is a worker-local Hyper/Socketioxide native shell calling
Python editor services through PyO3, owning HTTP resource routes as well as socket
transport. This reverses control at the service boundary without requiring Python
to live inside the shared framework process. The existing framework proxy and
FWS-owned worker isolation must remain. The intended host is a Rust executable
embedding Python; a Python-loaded native adapter may be a bounded intermediate
prototype, not a silent change of target. Interpreter discovery and ABI packaging
still need release validation. Native extraction can validate transport metadata/envelopes but
must not steal Python's document/project authority or duplicate business rules.

The same candidate boundary can include the framework MessagePack pipe and file
storage/serialization above. Rust would decode/validate wire payloads once and
pass Python objects or typed service values through PyO3; PyO3 itself is not a
MessagePack codec. Preserve external MessagePack contracts without adding a
second internal serialization round trip. Removing msgspec requires inventorying
all codec and Struct consumers, including persistence if adopted; eliminating
Python transport import trees is the hypothesis, not an established speedup.

This is not extraction of an Axum app from the former ASGI export. The branch
uses explicit native resource routing and `native_worker.py` lifecycle/dispatch;
Code TE2 no longer exports `TE2_ASGI_APP`. Other app-worker ASGI contracts remain.
Real isolated Linux tests precede Pixel live validation; remaining Python client
dependencies and release packaging must not be mistaken for completed migration.
Embedding Python directly in te2-server is a separate, higher-risk alternative:
it changes crash isolation, independent worker restart, interpreter dependency
loading and framework lifecycle. Do not do so implicitly to remove a proxy hop.

Investigation/acceptance gates:

1. Measure the removable Socket.IO/Engine.IO import subtree and full worker startup
   under matched bytecode-cache/state conditions. Identify dependencies still
   required elsewhere; subtree timing is not automatically recoverable savings.
   Measure transport CPU/queue latency separately as a regression baseline, not
   an assumed bottleneck. Inventory sessions, rooms, acknowledgements, binary
   payloads, auth and polling upgrades across browser, Electron and Android.
2. Specify a small connect/disconnect/request/notification/start/stop service
   boundary with exact client/project/generation identities. Preserve separate
   RPC lanes, reconnect snapshots and no stale traffic replay.
3. Specify Tokio/asyncio ownership, bounded crossing queues, cancellation,
   disconnect cleanup, ordering and shutdown. Never run arbitrary Python handlers
   on Tokio threads or hold interpreter access while waiting on native I/O.
4. Audit remaining Socket.IO imports including run_profile_fws_bridge.AsyncClient;
   server replacement alone does not eliminate that dependency/import cost.
   WBA's direct JS transport is out of scope.
5. Obtain separate approval for one-lane prototype, then prove transport parity,
   overload behavior, worker restart and measured benefit on Linux and Termux.
   Evaluate PyO3/CPython ABI, mypyc coexistence and release artifact reuse.
   A mixed prototype that still imports python-socketio cannot demonstrate its
   removal benefit. Final startup acceptance must verify those imports are absent
   and compare total startup including native-library/interpreter initialization.
6. Review each native-shell milestone against parity/startup evidence before
   widening it. A narrow adapter may be an intermediate stage, not a reason to
   bypass the intended worker isolation or Python domain-service boundary.
   Python code does not become compiled/faster merely because Rust invokes it.

## 7. Overlap installed frontend preparation with worker startup

Warm-worker follow-up (2026-09-30): the source manifest opted into
`frontend_preparation`, but Rust's explicit app/catalog projections omitted it.
Live Gecko received readiness in under a second yet never imported the layout
preparer, so early reveal was disabled and full initialization retained the splash.
Project the existing strict boolean into both payloads; cover enabled, disabled,
missing and non-boolean values and ready/running catalog variants. Preserve pipe
readiness for cold workers. For ready workers, only local layout preparation
remains before reveal; Monaco/content/intelligence/sidebar hydration is not a
splash gate. Build the updated framework, with no agent restart of the shared
runtime; user restart and Gecko/Cefrium live acceptance remain separate.

Approved direction (2026-09-29): optimize client-owned installed/OTA assets, not
network bundle delivery. Electron, GeckoView and Cefrium should prepare the same
page behind an independent splash while the worker starts. Browser delivery stays
supported without becoming the optimization target.

Source findings: app_shell waits for lifecycle readiness before loading the app
template/module; its placeholder replaces the app container. Code TE2 initially
has no responsive class, so Explorer starts offscreen before desktop grid rules
make it visible. Saved widths follow responsive classification. Explorer setup
mixes local chrome creation with RPC connection. Initial sidebar preferences are
applied during snapshot seeding and again after editor mounting.

Implementation sequence:
1. Add an explicit opt-in preparation contract. Use the existing lifecycle stream
   to start local template/module preparation when catalog metadata arrives;
   backend activation still awaits pipe-authoritative readiness and native route
   prerequisites. Other apps retain their existing gate.
2. Separate the splash from app content. Prepare measurable, inert DOM, responsive
   classes and saved dimensions without transitions or backend connections.
   Do not use display:none for the prepared editor surface.
3. Settle authoritative panel geometry before Monaco construction. Avoid repeated
   preference application and intermediate drawer/secondary/sidebar resize work.
   Do not introduce a second persistence authority or hide legitimate user state.
4. Reveal the prepared page when worker/native readiness clears; document content
   may finish afterward. Preserve theme/grammar/model barriers and independent
   WBA/extension readiness. Extension content must not gate first document display.
5. Cover readiness-before/after-preparation, failure/stopped states, duplicate
   lifecycle snapshots, non-opt-in apps and primary/secondary boot. Typecheck and
   build frontend, then explicitly OTA clients before user live acceptance.

No new readiness polling/socket/eval transport, backend authority in frontend,
shared-runtime restart, APK build or release publication is implied. Measure
preparation/readiness/model milestones and resize counts; no speedup is claimed
from source inspection alone. Implement in coherent checkpoints rather than
discarding the existing startup contract wholesale.

Foundation implementation: the shell readiness overlay owns separate DOM,
leaving app content measurable and inert during preparation. Transition suppression
lasts through initialization. Code TE2 applies
responsive classification and saved widths before its first asynchronous identity
wait; responsive setup is idempotent across the separate preparer and host bundles
using DOM markers rather than module-local state.

Preparation slice: `frontend_preparation: true` in the manifest opts into early
template mounting and host modulepreload after the lifecycle catalog arrives.
The local template declares `data-te2-prepare-module`; this imports a tiny pure
layout module from the already native-local `/static/js/` tree. CSS completion
precedes geometry reads. No app RPC or document model is created in this phase.
Repeated catalog snapshots share one preparation promise; failure closes the
startup lifecycle stream and aborts outstanding template/style work. Backend
activation and full host execution still await readiness and native routes.
Older templates without a preparer remain supported by the host initializer;
non-opt-in apps keep readiness-first loading. No new transport or native asset
mapping is added.

Reveal slice: the host boot runtime returns its actual promise rather than
fire-and-forget. Locally prepared apps now reveal immediately after worker/native
readiness and page preparation, before host import/initialization. Content loads
visibly; initialization remains awaited for error handling. Finished preparation
prevents consent-dialog cleanup from re-covering the page. User live acceptance
passed on desktop and mobile, with observed total load times around 2 seconds
and 3 seconds respectively (not controlled benchmarks). For other apps,
`managesStartupReveal` retains the shell overlay
through initialization and a layout frame. Code Server consent/error dialogs
use the optional shell interaction hook to yield and restore the overlay; older
shells/apps preserve their previous behavior. Mount failures propagate to the
shell error surface. Pending initial live SSOT projection participates in Monaco
boot completion after grammar/model attachment, without waiting for WBA.
Missing initial UI preferences settle before mount; duplicate post-mount sidebar
preference replay is removed. Deferred sidebar extension hydration is unchanged.
Live panel/secondary resize measurement and full host import-side-effect audit
remain outstanding; no isolated performance improvement is claimed.

## Execution and publication

Investigate in the order above, recording findings before implementation. Treat
Sidebar persistence as a lifecycle/state change despite its small visible UI.
Run focused tests and required frontend/type/build checks for each actual change.
For native live tests, explicitly OTA the freshly built frontend or bundle it
into the APK and verify its asset version; reload alone cannot update assets.
Synchronize versions and bundle assets when client/backend contracts require it.
Do not publish a release or merge as part of this maintenance planning pass.

## Code TE2 native artifact installation contract

### Linux-first packaging handoff (2026-10-04)

Work continues on `feature/desktop-deb-packaging`, fast-forwarded to the accepted
native-services snapshot. Build and validate a complete Linux wheel first, then
reuse its artifact contract for Android/Termux. Do not publish/tag/merge main as
part of the implementation checkpoints.

#### Private Code TE2 runtime boundary (current approved direction)

The native ABI baseline remains ordinary GIL-enabled CPython 3.14, but it is
**Code TE2's runtime**, not a new requirement for every Python hosting TE2.
This supersedes the host-3.14 installer/minimum proposal below.

- Linux wheels bundle a private 3.14 runtime: shared libpython, matching stdlib,
  required native stdlib libraries, remaining third-party dependencies,
  interpreted application islands/resources and the matching mypyc group.
  Use package-relative loader paths and isolated PyConfig; do not ingest the
  host's PYTHONPATH, user site, venv site-packages or arbitrary system Python.
- Termux initially uses the explicitly resolved regular system Python 3.14
  with matching Bionic artifacts. No redundant runtime and no arbitrary venv
  preference. A Termux minor-version upgrade requires matching artifacts or a
  separately approved private-runtime design.
- Desktop binary releases always use the private runtime, even when the host
  Python happens to match. Source/editable builds retain explicit ABI selection.
  Missing/corrupt payloads never trigger Cargo or interpreted fallback.
- Preserve the host interpreter identity separately for run-profile launcher
  execution and Node-wheel discovery. Current source uses sys.executable for
  both; private embedding must not silently change those child/runtime choices.
- Restore the original host minimum (>=3.12) only after host-side compatibility
  checks. Wheel tags describe the host-facing ABI, not merely embedded cp314
  libraries; a platform-only tag requires proof those libraries are private.
  Keep CPython 3.14 ABI/provenance in the component manifest regardless of tag.
- Use uv-managed shared Python in the build environment, not as a mandatory
  end-user desktop installer dependency. Validate on the SSH target's ordinary
  Debian Python 3.13.5 venv, leaving a candidate for user acceptance.

Implementation gates: (1) explicit private manifest/loader/bootstrap selection
and contamination rejection; (2) complete source/dependency/runtime materialization,
relative ELF linkage and wheel-driver integration; (3) post-repair checksum/tag
audit and clean SSH install/live acceptance. Startup inventory alone is not a
complete closure: include lazy feature imports and run-profile launcher needs.
Do not claim the first contract slice is a self-contained shipping wheel.

Private-boundary contract checkpoint: runtime schema 2 identifies bundled home,
interpreter, source root and extension suffix; the host resolver validates the
embedded ordinary 3.14 identity rather than comparing it with the host Python.
Schema 1 remains the earlier same-ABI validation format, not a private payload.
Bootstrap passes private paths/isolation and preserves
`CODE_TE2_HOST_PYTHON_EXECUTABLE` separately. Run-profile launchers and Node-wheel
discovery use that host identity. The Rust worker disables environment/site
initialization and admits only private stdlib/dynload/site-packages plus the
declared application source and selected compiled overlay. Source builds keep
their existing interpreter selection; no active runtime was restarted.

Validation: 63 focused packaging/bootstrap tests, 23 real native-worker tests
(including hostile Python home/path/user-site/venv contamination), 52
discovery/run-profile tests plus 7 subtests, three-module Mypy, release Cargo
build and formatting pass. Private manifest tests use synthetic files; they
do not establish ELF linkage or a complete stdlib/dependency closure. No new
wheel or SSH candidate has been installed. The materializer/wheel driver still
produces the initial same-ABI format, and wheel tags/package minimum are not
yet widened; private payload construction and final integration are next.

Assembly integration checkpoint (in progress): the materializer now accepts
paired private CPython prefix/runtime-only dependency inputs, dereferences only
contained interpreter links, rejects dependency site customization, and includes
lazy Code TE2/helper source in the existing domain library/resource tree. The
wheel driver builds both Cargo workspaces and mypyc, sets relative loader paths,
repairs ELF dependencies, refreshes inner hashes/outer RECORD, and audits all
final ELF glibc/linkage. Host-independent `py3-none` platform tag selection is
limited to schema-2 bundled payloads. Sidebar catalog data uses the separately
resolved installed framework root without importing its site-packages.

The original host minimum >=3.12 is restored: 35 host-facing sources pass 3.12
grammar checks and Debian 3.13.5 imports bootstrap/resolver. Clean installation
and host dependency resolution remain acceptance gates, not proven by parsing.
158 focused tests plus 7 subtests, Mypy and shell syntax checks pass.

Remote build exposed two prerequisites previously hidden by the server-only
pipeline: Engineioxide requires Rust 1.94 (builder raised from 1.93), and the
independent worker needs OpenSSL development headers/pkg-config. Preserve Cargo
caches during retry. User approved both synchronizing this server to package
0.2.352 and adding explicit `serverVersion` provenance; the final validator
checks that component version rather than assuming every future package bump
requires a new Rust version. Reuse still requires unchanged-input/provenance
checks; this field alone does not authorize arbitrary older server binaries.

Remote validation context: `/root/.cache/te2-release-build/private-wheel-source`,
mutable work/cache in sibling `private-wheel-work`, outputs in
`private-wheel-output`, logs `private-wheel-image.log` and
`private-wheel-build.log`. Candidate release label is `validation-private-0.2.352`
and publication eligibility is false. No tag, wheel upload, Android build or
shared-runtime restart. Completed wheel and retained user SSH install are still
pending; do not mark live acceptance from these synthetic tests.

Completed Linux candidate checkpoint: both Rust workspaces and the 136-module
mypyc group build in the corrected manylinux container (domain build 319.19s).
The validation-only wheel is approximately 119 MiB and contains private ordinary
CPython 3.14.6. PEP 517 setup source-path resolution, nested dependency RECORD
preservation, standalone ABI-stub loader normalization and private-library repair
are covered in the build path. Auditwheel repair excludes only bundled libpython:
its extension-oriented default would remove the embedding link. Retain the raw
`auditwheel show` report (which defaults to `linux_x86_64` for embedded libpython),
but require structured Auditwheel policy analysis with that independently
verified bundled library excluded. Overall policy is `manylinux_2_28_x86_64`,
with no remaining external/blacklisted libraries at that policy; every ELF and
the exact worker-to-bundled-libpython resolution are separately audited.

Clean Debian install-only acceptance passes on host Python 3.13.5: bootstrap
selects the installed server/worker and private Python 3.14.6 imports all 136
compiled modules. Pip-generated adjacent source caches are tolerated only for
inventoried `.py` files; the private worker disables writes and uses an absent
reserved bytecode prefix, preventing cache consumption. A real poisoned-cache
native test passes. Local validation: 122 focused tests plus 7 subtests, 23 native
tests, 30 installer/release tests plus 4 subtests, Mypy and formatting checks.
The bootstrap suite explicitly unsets the inherited `CODE_TE2_WORKER_BIN` test
environment; otherwise two fixture assertions see the shared harness selection.

Retained user candidate on `mrsurge@100.74.145.70`:
`~/.cache/te2-release-acceptance/private-code-te2-0.2.352/candidate/venv`.
`candidate/acceptance-result.json` and sibling `install.log` record install/import
proof. The framework was **not started** by this install-only acceptance; user
live acceptance remains pending. Remote mypyc cache is retained separately in
`private-wheel-work/code-te2-mypyc-cache`, outside disposable source staging.
This dirty-source candidate is not publication eligible; no upload/tag/merge/APK.

WBA acceptance correction: the first candidate's Python-only import probe missed
83 tracked vendored Node files under `build/`. The general intermediate filter
had stripped `engine.io/build`, `engine.io-parser/build` and related published
runtime output. Declared vendor roots now copy their complete runtime tree
(including `node_modules`, `build` and `target`), while ordinary resource roots
retain intermediate exclusions and all copies retain symlink/VCS/cache guards.
Synthetic nested-build and real Socket.IO tree checksum comparisons pass.

Installed acceptance now imports both Socket.IO and the actual WBA server
entrypoint using the candidate's Node runtime, binding only an ephemeral
loopback port and exiting immediately after import. It never connects to the
shared framework or a real Code Server. The probe reproduces the old candidate's
exact missing-engine.io error and passes on the repackaged candidate with Node
24.16.0. Existing Rust/mypyc artifacts were reused; no compilation was needed.
156 focused tests plus 11 subtests and materializer Mypy pass. Retained latest
venv is `~/.cache/te2-release-acceptance/private-code-te2-0.2.352/candidate-wba-fixed/venv`;
its `acceptance-result.json` includes `wbaImportProbe`, and sibling
`install-wba-fixed.log` records the clean install. The previous candidate/runtime
was untouched; the new framework remains stopped pending user live acceptance.

#### Compiled intelligence restart crash gate

User install/uninstall testing rejected the WBA-fixed candidate: two worker
segfaults map to the mypyc `_ensure_workbench_adapter_shell` launch-context
dictionary, one in `CPyDict_Build` and one in its temporary decref cleanup.
The local source worker logged the same `closed intelligence reader` shutdown
exception but recovered; its live `CODE_TE2_MYPYC_DIR` was empty and process maps
contained system libpython, not the packaged compiled group.

`scripts/probe_code_te2_launch_context.py` compiles the actual launcher dictionary
expressions with mypyc 2.3.0/opt-level 3 into an isolated fixture. It starts no
framework/WBA and installs no extensions. The embedded-await negative control
segfaults with ordinary desktop CPython 3.14.4; moving the cache lookup outside
both launch dictionaries passes 10,000 iterations each, including repeated GC.
This isolates a compiler/suspension-path defect independently of the private
interpreter, although it does not establish the compiler's exact ownership bug.
The normal Linux wheel build now runs the positive compiled probe. The AST
regression forbids suspension inside both launch contexts. Release-toolchain
CPython 3.14.6 reproduced the negative control and passed the positive 10,000
iterations per launcher. All 136 modules rebuilt/import-validated in 300.12s
at `/root/.cache/te2-release-build/private-wheel-work/code-te2-domain-restart-fixed`.
The separate wheel passed ELF/hash/platform validation and is installed at
`~/.cache/te2-release-acceptance/private-code-te2-0.2.352/candidate-restart-fixed/venv`.
Wheel SHA-256: `72d6c4df305a45a132bfa90461f3b089cccc59b4cbfe646a5d6899aaef8fc832`.
Install-only acceptance passed: host 3.13.5 selects the bundled runtime; private
3.14.6 imports all 136 compiled modules; candidate Node 24.16.0 imports Socket.IO
and the actual WBA entrypoint. Evidence is `candidate-restart-fixed/acceptance-result.json`
and sibling `install-restart-fixed.log`. Install-only automation left it stopped;
the user then launched it and confirmed live acceptance on 2026-10-04, including
the extension install/uninstall restart fix. The reader-shutdown exception
is a separate cleanup follow-up, not claimed fixed or proven causal.

Local evidence: `.codex-scratch/launch-context-negative-20261004/stress.log`
and `.codex-scratch/launch-context-positive-20261004/stress.log`.
Remote build outputs must retain the rejected candidate and old domain; never
replace a loaded shared object in a running runtime or restart the shared server.

#### Historical host-3.14 proposal (superseded)

Use ordinary GIL-enabled CPython 3.14 as the sole initial native release target
on Linux and Termux. Raise package metadata to `requires-python = ">=3.14"`
during implementation; drop the proposed 3.13 build/acceptance matrix rather
than maintaining two Python minor versions. Support for 3.15 is deferred until
there is a practical need, not automatically promised by the metadata minimum.
`cp314` worker/domain wheels are not compatible with `cp315` or free-threaded
`cp314t`; each future ABI needs matching artifacts and acceptance.

On desktop Linux, use uv-managed Python 3.14 and explicitly create/select the
TE2 3.14 venv even if a newer interpreter is installed. Do not replace Debian's
`/usr/bin/python3` or modify the distro Python environment. Install the managed
interpreter for the test user on the SSH acceptance host; its existing system
3.13.5 is no longer the candidate runtime. Termux retains its native Python/apt
installation path, not desktop uv binaries. Prior device evidence already
records ordinary Termux CPython 3.14; revalidate against the final artifact set.

Next gate: inspect/prove the manylinux builder's **3.14** embedding/linkage and
the uv-managed target's stdlib/venv resolution, then complete container assembly
and post-auditwheel validation. The earlier 3.13 static-libpython discovery is
historical evidence only; do not assume it establishes the 3.14 configuration.
This documentation change does not install uv/Python, change package metadata,
build binaries or start/restart any runtime.

The clean installation/live acceptance target is `ssh mrsurge@100.74.145.70`.
Read-only discovery found Debian Python 3.13.5, Docker and about 167 GiB free;
no shared libpython was found in the standard system library directory. This
machine is primarily the acceptance target, not a mandatory remote builder.
Prefer local builds while storage permits (the user reports about 15 GiB local
headroom); optionally use the existing SSH builder path if local space becomes
tight. No remote cleanup, broad process termination or framework restart is
implicitly authorized. Keep an installed candidate available for the user's
live acceptance; do not equate import/CLI smoke tests with working app acceptance.

Original Linux implementation order (apply the private-runtime amendment above):

1. Portable matched-set metadata and fail-closed resolver. Record independent
   Rust/domain source identities, CPython minor/SOABI/free-threaded status,
   architecture/libc, linked libpython and checksums. Replace checkout-absolute
   module inventory with relative paths and materialize resources as regular
   packaged files, not developer links. Resolve executable/domain once through
   bootstrap and pass both to the raw-worker shellspec. Retain explicit source
   build/activation and existing cache roots.
2. Extend existing Linux wheel construction (setup.py, pinned builder, archive
   validator), not a parallel user installer. Include framework server plus
   `app/release_runtime/code_te2/` worker/domain/resources. Emit exact CPython/ABI
   wheel tags rather than `py3-none`. Start clean-target coverage with ordinary
   CPython 3.14 on both builder and uv-managed acceptance venv. The local 3.14
   probe demonstrates the payload contract, not manylinux portability.
   Prove shared-libpython resolution, interpreter stdlib/venv selection and
   OpenSSL/native dependencies under the declared manylinux floor before
   choosing final bundling/rpath policy. Never depend on build-host /opt paths.
   Preserve unchanged-Rust reuse and verify final post-auditwheel payload hashes.
3. Install a candidate in a fresh SSH venv without source checkout, scratch
   selectors, Cargo or compiler assistance for Code TE2. Validate framework
   launch, pipe readiness, compiled imports, resources, WBA, document/diff flows,
   Sidebar apps and terminal ownership; retain the existing standalone Terminal
   first-use node-pty build prerequisite. Leave the install for user acceptance.

Android/APK assembly, Termux wheel adaptation and publication are later gates.
Android will reuse portable artifact metadata/layout, not Linux ELF binaries,
libc tags or CPython ABI assumptions. The current server-only wheel pipeline and
scratch-selected domain cannot be presented as an integrated native release.

Investigation evidence: setup.py packages only the server; bootstrap rejects
missing binary-release worker payloads; the shellspec selects mypyc-active in
scratch; mypyc resource links and absolute inventory need release materialization.
The current local worker links libpython3.14.so.1.0, libssl.so.3 and libcrypto.so.3.

First implementation checkpoint: `app/release_runtime/code_te2.py` validates a
portable Linux worker/domain file set (relative contained paths, regular files,
checksums, exact Python/libpython metadata, architecture and separate component
fingerprints). Portable domain manifest schema 2 records module source paths
relative to the package; the import hook retains schema-1 developer snapshots.
Binary-release bootstrap selects the verified pair and exports both paths;
the actual shellspec now consumes `CODE_TE2_MYPYC_DIR` from bootstrap rather than
overwriting it with a scratch path. Editable startup retains its existing explicit
active-snapshot selector and honors an explicit domain environment value.

Validation: 47 targeted release-runtime/native-bootstrap/editable-build tests
pass, plus Mypy on the new resolver and modified overlay. Fixture shared objects
test metadata/selection only; they are not an ELF, compiled-import or wheel proof.
No full compiled-group rebuild, Rust build, worker/framework restart, remote
install, artifact materialization or release publication was performed. Wheel
assembly still needs real materialized resources, a production manifest producer,
ABI-specific tags and libpython/stdlib/venv loader validation. The resolver's
libpython field checks declared identity, not shared-library loader availability.

Second implementation checkpoint: `scripts/materialize_code_te2_runtime.py`
consumes the existing validated developer snapshot, verifies its manifest/library
checksums and source digest against the selected checkout, and publishes a new
regular-file payload atomically. It converts absolute source inventory to schema
2, requires module wrappers plus the common mypyc group, and copies the seven
existing resource roots without developer links, nested symlinks, node_modules,
Python caches or Cargo/build intermediates. It never activates/restarts a worker.
Interpreted islands continue to come from the matching installed app package.

`setup.py` now requires `TE2_RELEASE_CODE_TE2_RUNTIME` alongside the server for
binary-release assembly, validates package-version/ABI identity, copies the
complete payload and emits exact CPython/ABI tags. Source builds remove any stale
native payload. The existing container driver still needs native compilation,
materialization and post-auditwheel rehash wiring before it can produce a wheel;
this checkpoint does not make the old server-only driver release-ready.

Validation: 57 focused tests pass and Mypy passes for the materializer/resolver/
overlay. The actual accepted local CPython 3.14 snapshot materialized to a 64 MiB
probe under `.release/linux-native-payload-probe-cp314`; the existing isolated
import validator loaded all 136 compiled startup modules, with none missing.
Its Rust fingerprint is the executable digest for this local packaging probe,
not a final production build-input identity. This is not an audited Linux wheel or
clean-install proof. No active runtime selection or shared framework changed.
Local and remote unprivileged Docker access are denied, and noninteractive sudo
requires authentication on both hosts. Existing root SSH access to the remote
does reach Docker and its retained manylinux builder images; no permission or
group changes are required. The remote remains the retained-install acceptance
target as well as the available container builder.

Read-only builder discovery: its ordinary CPython 3.13.15 reports SOABI
`cpython-313-x86_64-linux-gnu`, `Py_ENABLE_SHARED=0` and only `libpython3.13.a`
under `/opt/_internal/cpython-3.13.15/lib`. Do not assume auditwheel can bundle
a shared libpython from this image. The next gate must prove an explicit
embedding/linkage policy (including CPython symbol export and the installed
interpreter's stdlib/site-packages), then distinguish that worker linkage
provenance from the target interpreter ABI. The initial resolver compares
declared libpython identity exactly; it is not yet a cross-static/shared loader
policy. The remote system interpreter is 3.13.5, not the builder's patch version.

3.14 embedding checkpoint (after `aa38164d`): the manylinux image's own CPython
3.14.7 is also static-only. The user approved shared uv-managed 3.14 in the
builder/test-user environment instead. Builder source now pins uv 0.11.26 and
ordinary CPython 3.14.6, uses the manylinux GCC toolchain, and asserts shared/GIL
configuration in a dedicated builder venv (uv's managed base is externally
managed and is not modified). Package metadata now declares `>=3.14`; installer provisioning
and full wheel driver integration remain pending.

Installed uv and ordinary 3.14.6 for the SSH test user without modifying system
Python or shell startup. Its SOABI is `cpython-314-x86_64-linux-gnu`, and
`Py_ENABLE_SHARED=1` with `libpython3.14.so.1.0`. A standalone C `PyConfig`
embedding probe under `~/.cache/te2-release-acceptance/python314-embedding`
selected a fresh venv, reported correct prefix/base-prefix/executable and imported
math, SSL, SQLite and zlib. Its absolute-rpath diagnostic executable is not a
shipping artifact or final manylinux-loader proof.

Bootstrap now sends the invoking interpreter's base-prefix/executable through
worker-specific environment values. The worker uses `PyConfig` before the first
Python attachment and releases the initial GIL for PyO3; terminal children do not
inherit a newly set global PYTHONHOME. Standalone diagnostics retain the existing
VIRTUAL_ENV adapter only when no explicit interpreter pair is supplied.
Cargo check/release build pass; 22 isolated real-worker tests and 57 focused
packaging/bootstrap tests pass. The active shared framework was not restarted.
The corrected remote builder image `te2-linux-wheel:python314-probe` builds
successfully and its shared/GIL interpreter assertions pass. This validates
toolchain-image provisioning, not the still-incomplete wheel driver. The same
C embedding probe passes inside that image with its builder venv; versioned
GLIBC requirements in the selected libpython reach 2.17 (below the 2.28 floor).
This checks libpython alone, not every final worker/extension/native dependency.
Private library placement/relative loader paths, final wheel assembly,
post-auditwheel hashes, installer selection and retained user acceptance remain
uncompleted gates.


Approved direction (source executable/bootstrap slice implemented; matched-set
and wheel assembly still pending): publish the independent
Code TE2 executable and matching mypyc domain as a validated artifact set, not
runtime dependencies on Cargo `target/release` or `.codex-scratch`.

- Editable/source installs publish under the existing
  `$TE2_CACHE_HOME/code_te2/build` (normally `~/.cache/te2/code_te2/build`).
  Separate compiler/Cargo intermediates from immutable runtime sets; select only
  a validated set atomically.
- Binary wheels own `app/release_runtime/code_te2/`, containing
  `bin/code-te2-worker`, domain libraries/manifest, interpreted islands and
  required resources. Resolve package-relative paths; no developer symlinks or
  absolute build-machine paths.
- Launcher/bootstrap resolves concrete worker/domain paths once for the shellspec.
  Preserve the independent executable and pipe readiness; do not fold the worker
  into the framework server.
- Validate CPython minor/ABI (including regular/free-threaded), architecture,
  libc, linked libpython and component checksums/provenance. Existing `py3-none`
  framework wheel tagging is insufficient for ABI-specific mypyc extensions.
- Preserve separate Rust/domain fingerprints, reusing unchanged Rust artifacts
  across Python/frontend changes; a matched-set manifest records both.
- Missing/incompatible binary-install artifacts fail clearly without Cargo or
  interpreted fallback. Source build/publication remains explicit until the
  implementation slice defines startup policy.

Implementation gates:

1. Source-cache publication, artifact-set resolver and shellspec handoff. Test
   overridden roots, missing/invalid artifacts, ABI mismatch, atomic selection
   and unchanged-Rust reuse.
2. Desktop/Termux wheel resources, provenance and ABI/platform tagging, including
   interpreted islands and resource materialization without developer links.
3. Clean desktop SSH and Motorola/Pixel install acceptance without checkout or
   build-tool life support, then integrate the release workflow.

Source bootstrap implementation: `app/native_worker_builds.json` declares Code
TE2's independent manifest/binary/ABI/env key. Normal startup and `--build-only`
build/reuse and atomically publish its raw executable under
`TE2_CACHE_HOME/code_te2/build/bin/<fingerprint>/<profile>/`, with separate retained
Cargo intermediates. The shellspec uses the resolved `CODE_TE2_WORKER_BIN` directly;
no wrapper enters the worker pipe. `--force-build` applies to workers and
`--print-command` does not build. Source wheels include the registry and worker
Cargo source; binary installs fail instead of silently building missing workers.
Mypyc still requires explicit build/activation; the existing selected overlay is
not automatically compiled or republished by framework bootstrap.

Source-launch handoff correction: render shellspecs with inherited server env,
then Ferrous's authoritative child overlay, then app launch overrides. The overlay
alone omitted the bootstrap-selected executable and caused the reported spawn
failure on both desktop and Pixel. Regression coverage uses the actual Code TE2
shellspec; full spawn cause chains are logged. Local launcher tests pass; live
desktop/Pixel acceptance remains pending a user-controlled framework rebuild and
restart. No runtime was restarted during this fix.

Release gate: prepare server and configured worker binaries before wheel assembly,
then package the ABI-matched compiled domain, interpreted islands, resources and
component provenance. Implement the appropriate CPython/platform tags and package
resolver before attempting the next release rodeo; current `py3-none` server-only
wheel machinery is insufficient. Validate desktop/Termux clean installs after
that packaging slice. No wheel publication or runtime restart occurred here.
Full contract:
`framework/native_editor_worker/README.md`, Planned installed artifact placement.
