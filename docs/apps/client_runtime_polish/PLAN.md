# Client Runtime Polish After 0.2.351

## Scope

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

### Follow-up: durable debugging guidance

- Promote the verified workflow into CODE_TE2.md's Cefrium/debugging section,
  with discovery commands, bounded request/reply handling, approval boundaries,
  cleanup, and the distinction between native console, page console and CDP.
- Add a short pointer and critical invariants to `.repo_memory.md`; retain the
  existing CDP child-session ownership note rather than duplicating the runbook.
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
Keep application MessagePack bytes opaque across the bridge where possible,
decode once, and preserve the current binary-event wire format. Application
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

## Execution and publication

Investigate in the order above, recording findings before implementation. Treat
Sidebar persistence as a lifecycle/state change despite its small visible UI.
Run focused tests and required frontend/type/build checks for each actual change.
For native live tests, explicitly OTA the freshly built frontend or bundle it
into the APK and verify its asset version; reload alone cannot update assets.
Synchronize versions and bundle assets when client/backend contracts require it.
Do not publish a release or merge as part of this maintenance planning pass.
