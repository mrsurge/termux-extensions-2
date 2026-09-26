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

## Execution and publication

Investigate in the order above, recording findings before implementation. Treat
Sidebar persistence as a lifecycle/state change despite its small visible UI.
Run focused tests and required frontend/type/build checks for each actual change.
For native live tests, explicitly OTA the freshly built frontend or bundle it
into the APK and verify its asset version; reload alone cannot update assets.
Synchronize versions and bundle assets when client/backend contracts require it.
Do not publish a release or merge as part of this maintenance planning pass.
