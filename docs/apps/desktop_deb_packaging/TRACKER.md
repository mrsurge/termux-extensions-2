# Desktop User Install And Termux Debian Packaging Tracker

Last updated: 2026-08-17

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: dependency cleanup | Complete, validated, and committed as `0c02c033` | Keep the audited Python runtime input; target locks belong to the selected distribution design |
| Phase 1: integrate current `main` | Complete and validated at merge `8ac75fbc` | Imported baseline is accepted; Phase 2 may proceed without reopening the merge |
| Phase 2A: desktop framework bookmarks | Planned from Android's bounded bookmark contract | Electron settings schema/store/UI and existing retarget integration |
| Phase 2B: launcher local framework | Planned | Electron process controller and launcher capability implementation |
| Phase 2C: remaining frontend polish | Intake placeholder only | Each concrete tweak requires separate named scope and approval |
| Phase 3: client-scoped foreground document | Architecture drafted; implementation not authorized | Shared membership/drafts/WBA remain authoritative; only client presentation is split |
| Phase 4: Linux desktop user install | Planned; blocked on client/runtime baseline acceptance and Python delivery decision | User-root installer implementation, local acceptance, and publication are distinct actions |
| Phase 5: Termux `.deb` | Planned; dependency mapping required first | Device-native package investigation precedes payload implementation |

## Confirmed source findings

| Finding | Evidence | Status |
|---|---|---|
| Current Electron publication is an unpacked x64 directory | `desktop_client/electron/package.mjs` calls `@electron/packager` and writes a local wrapper only | Confirmed |
| No complete Linux installer exists | Electron packaging produces an unpacked application only; no user-root transaction, private venv, desktop entry, receipt, or updater exists | Confirmed |
| The Python dependency list is mostly direct runtime surface | Packaged source directly imports FastAPI, Starlette, Uvicorn, HTTPX, msgspec, AnyIO, FastMCP, Framework-Shells, libarchive-c, socketio, and PyYAML | Confirmed |
| `sse-starlette` was held directly by an unmounted router | The dead `app.libs.jobs.jobs_bp` import/router was removed while the job core and handlers remain | Pruned; still transitive through MCP |
| Framework-Shells is reproducibly pinned | `requirements.txt` uses exact validated 0.0.63 commit `0bf3269cd69a000015b0ac484a04004b8dc564d1` | Complete |
| User dependency installation has explicit owners | Python packaging, existing app bootstraps, and target package metadata cover the supported paths | Repository construction scripts are not user setup entrypoints |
| Global Code Server is unsupported | Code TE2 resolves only its consent-gated private managed runtime | Confirmed |
| Packaged framework can avoid target Cargo | The current bootstrap accepts `--server-bin` | Confirmed |
| Framework readiness has an identity-bearing endpoint | Rust serves `/api/health` with app/version/instance/listener metadata | Confirmed |
| Desktop settings support one target | `DesktopShellSettings` contains one host/port pair and zoom | Confirmed |
| Retarget cleanup already exists | `saveConnection` stops Run Target listeners, reconnects UI IPC, clears instrumentation, retargets the relay, and closes the app view | Confirmed; must be reused |
| Launcher supports frontend extensions | `desktop_client/android_shell/extensions/registry.js` mounts launcher extensions | Confirmed presentation seam |
| Electron has no local framework process controller | Electron main owns client/runtime relays but does not spawn or retain a TE2 framework child | Confirmed missing capability |
| Electron dominates compressed desktop payload size | Current unpacked directory is about 317 MiB; measured xz stream is about 86.6 MiB, zstd about 102.5 MiB, and gzip about 120.3 MiB | Confirmed |
| Cargo intermediates are not runtime payload | The bootstrap accepts a final server path; only the validated release executable is required on packaged targets | Confirmed |
| Uvicorn's native `standard` extras are not required by the current design | Isolated HTTP and WebSocket runtime-bridge smoke passed with explicit `websockets` and without `uvloop` or `httptools` | Pruned and validated |
| The TE2 wheel is not a small package increment | Isolated wheel is 85,830,112 bytes because it contains the framework and built-in app asset payload | Confirmed; invalidates the earlier 90--110 MiB self-contained estimate |
| `sse-starlette` remains transitive | TE2 no longer declares or imports it directly, but FastMCP/MCP still resolves it | Confirmed; ownership cleanup without installed-byte reduction |
| Remote `main` materially changes the upcoming edit seams | At investigation time this branch was one commit ahead and nine behind `f00ba916`; `3a1e542a` changes boot/open/UI IPC/editor/WBA projection paths and the delta includes Run Profile/native-client fixes | Confirmed; merge gate must precede client/editor implementation |
| Android bookmarks are separate from the active endpoint | Remote `main` stores up to 16 named native host/port bookmarks; choosing one fills fields and Save performs the actual retarget | Confirmed reference contract for desktop |
| Global `last_file` still locks connected editors together | Editor open records sidecar `last_file`, broadcasts `editor:open` to `code_te2`, and boot/file tabs/Explorer derive foreground from shared open state | Confirmed target for Phase 3 |
| Shared-document prerequisites already exist | Stable client/window ids, client-local tab order, path-keyed draft mirrors, and WBA retained logical documents already exist | Confirmed reusable seams |
| One WBA extension host has one Code OSS active editor pointer | WBA retains shared documents but currently exposes one synthetic active-editor facade | Confirmed constraint; client facades must converge focus/command context honestly |
| npm has one runtime owner | Code TE2, WBA, and shared browser artifacts are already bundled/vendored, while the Electron distribution is built before packaging | Declare npm as a package requirement solely for the standalone Terminal's private first-use bootstrap; elsewhere it is development tooling |
| Standalone Terminal first use retains its current bootstrap | Its separate locked runtime runs `npm ci`; `node-pty` 1.1.0 uses a native install script and has no Linux prebuild in the current payload | Linux prerequisites or Termux package dependencies supply Node/npm; the bootstrap installs the modules with target-native build support validated per distribution |
| Terminal runtime state is per-user canonical TE2 data | Current Python resolves `$TE2_DATA_HOME/node_runtime/terminal/<fingerprint>`, normally beneath `~/.local/share/te2`, with a lock, atomic staging, marker, package checks, and ABI-aware reuse | Linux apt prerequisites or Termux package dependencies supply Node/npm; existing Python remains the only private-module installer and validator |
| Installed dependencies have only explicit admission paths | pip/private venv, an existing owned app bootstrap, the Linux prerequisite transaction, or Termux package metadata | Remove unowned dependencies and their unsupported capability instead of adding helper installers |
| External capability binaries still have exact owners | `aria2c` backs Aria Downloader and `watchexec` backs the Code TE2 polling watcher | Linux prerequisites or Termux package metadata owns them, or the installed capability is removed |
| `dtach` has no TE2 owner | Code TE2's terminal shellspec uses Framework-Shells `backend: pty`; only stale comments referred to dtach | Removed from the supported dependency surface |
| Termux-LM no longer exists | There is no `app/apps/termux_lm`; only stale documentation remained | Documentation pruned |
| Cefrium `0.7.0` is no longer published by its configured Maven repository | Upstream metadata exposes `0.7.1`; both the Gradle plugin and SDK now pin that release | Corrected and validated; `0.7.1` also carries the required iframe WebSocket/scheduling-latency fix |

## Architecture decisions

- [x] Linux install identity is `te2-desktop` and initially targets `amd64`.
- [x] Linux owns a private venv, prebuilt release Rust server, and Electron
  payload beneath the canonical TE2 user data root.
- [x] Linux installs user-local `te2`/`te2-desktop` wrappers, desktop entry,
  icon, version receipt, and atomic current-release pointer.
- [x] Termux package is separate, framework/CLI-only, and initially targets
  Termux `aarch64`.
- [x] Termux uses the shared Python environment, preferring Termux repository
  packages over locally rebuilt pip packages.
- [x] Termux dependency/package discovery is a hard gate before payload design.
- [x] Source/editable and Git/pip installs may build Rust through the canonical
  external cache; installed distribution payloads never carry Cargo intermediates.
- [x] Every installed component comes from one synchronized immutable tag.
- [x] Tagged release assets include a TE2 wheel, GNU/Linux server,
  Bionic/Android server, Electron Linux x64 payload, and checksums.
- [x] Release binaries live in release assets rather than Git history.
- [x] The Bionic/Android server asset is a Termux package input and does not
  imply Android APK embedding.
- [ ] Select Linux Python delivery after measuring an exact-tag networked Git
  bootstrap against a self-contained tagged-wheel payload.
- [x] The thin exact-tag bootstrap is the current size-oriented candidate after
  measuring the 85.8 MB TE2 wheel; the self-contained form remains the offline
  alternative.
- [x] A networked Linux user install has explicit failure/recovery behavior and
  atomically preserves the prior valid release.
- [x] Neither distribution bundles managed Code Server.
- [x] Repository scripts may construct development/release artifacts, including
  the installer and Termux `.deb`, but are absent from ordinary installed
  payloads. They appear for users only in cloned/editable checkouts.
- [x] Linux apt prerequisites and Termux package dependencies are separately
  validated and recorded.
- [x] Desktop bookmarks remain separate from the active host/port connection,
  matching Android's load-then-Save behavior.
- [x] The existing relay/UI IPC retarget transaction remains connection
  authority.
- [x] Local framework launch is explicit, loopback-only, and Electron-main
  owned.
- [x] Electron stops only a framework child it spawned and retained.
- [x] Finish independent Phase 0 cleanup before integrating `main`.
- [x] Integrate and validate the approved current `main` baseline before any
  desktop/client/editor source changes or distribution construction.
- [x] Keep one shared project, shared document membership, shared drafts/writes,
  and one WBA logical document registry.
- [x] Split only foreground editor presentation by stable client plus live
  window identity in the first Phase 3 slice.
- [x] Treat backend client-active persistence as a bounded reconnect projection,
  not a new cross-client active-file authority.
- [x] Preserve one extension host initially; project the most recently focused
  or command-originating client into Code OSS's singular `activeTextEditor`.
- [x] Do not claim same-file CRDT/OT collaboration as part of foreground-state
  separation.

## Phase 0 checklist — dependencies

- [x] Generate the packaged-source direct-import inventory.
- [x] Record one owner/reason for every direct Python dependency.
- [x] Separate the live job core from the unmounted `jobs_bp` HTTP/SSE routes.
- [x] Remove the dead job routes without restoring `/api/jobs` elsewhere.
- [x] Remove TE2's direct `sse-starlette` requirement after source and
  isolated-wheel checks; retain awareness that MCP still pulls it transitively.
- [x] Replace `uvicorn[standard]` with `uvicorn` plus explicit `websockets` and
  validate runtime-bridge/app-worker WebSocket behavior.
- [x] Pin Framework-Shells 0.0.63 to exact validated commit
  `0bf3269cd69a000015b0ac484a04004b8dc564d1`.
- [x] Keep the audited direct Python runtime list as Phase 0 input; generate the
  platform/transitive Linux wheelhouse lock after Phase 4 selects its delivery
  mode and interpreter baseline.
- [x] Split external core runtime, first-use bootstrap, source-build, and
  optional capability ownership in supported documentation.
- [x] Remove unsupported external dependency installation paths and retain only
  explicitly owned package/bootstrap boundaries.
- [x] Audit Node/npm and native build tools against terminal runtime bootstrap.
- [x] Audit libarchive, Git, dtach, aria2, watchexec, curl/wget, and OpenSSL
  against current built-in app behavior.
- [x] Build the TE2 wheel in isolation and record its 85,830,112-byte size.
- [x] Run CLI, runtime-bridge, app-worker, archive-job, and terminal protocol
  smoke tests from the isolated install.
- [x] Update README/dependency documentation to distinguish source development,
  Linux runtime, Linux build, Termux runtime, and Termux build inputs.
- [x] Remove stale Termux-LM setup and architecture documentation after source
  confirms that app no longer exists.

## Phase 1 checklist — integrate current `main`

- [x] Commit the validated Phase 0 dependency-boundary cleanup.
- [x] Refresh remote `main` without changing the working branch and record both
  exact heads.
- [x] Inspect all commits/files since the current feature base, especially Run
  Profile, framework projection, Code TE2 open/WBA, Electron, and Android
  changes.
- [x] Obtain explicit approval for the exact merge target.
- [x] Merge `main` into this feature branch without rebase/history rewrite.
- [x] Preserve the dependency-pruning commit and resolve source/generated
  overlap from current source authority.
- [x] Run framework Python/Rust tests appropriate to the imported delta.
- [x] Run Code TE2 typecheck/tests/build.
- [x] Run Electron typecheck/tests/build.
- [x] Run affected GeckoView/Cefrium unit and APK build validation after the
  required free-space check.
- [x] Record merge commit and acceptance evidence before Phase 2 begins.

### Phase 1 acceptance evidence

- Feature head before integration: `0c02c0332d03a1c78180335bb22415ecada22cb4`.
- Approved `origin/main` target: `f00ba916d5b405c776ea94a2f8a9e041be58ba99`.
- Non-rebase merge commit: `8ac75fbca6ef114e4f8bf3a0187d642aa2db8bf8`.
- Python: 223 tests passed.
- Rust: formatting check passed; 74 server tests passed and 4 benchmark tests
  remained intentionally ignored.
- Code TE2: typecheck passed, all 209 Node tests passed, and the production
  browser/WBA bundles rebuilt successfully.
- Electron: typecheck passed, all 67 tests passed, and the unbundled source
  compile succeeded.
- Android free-space guard passed at 7.14 GiB. Gecko debug unit tests and APK
  assembly succeeded. Cefrium debug unit tests and APK assembly succeeded after
  correcting its SDK/plugin pin from unavailable `0.7.0` to required `0.7.1`.
  The resulting debug APK SHA-256 values were
  `27ea46c43df175df803b4fc1044fe71afc2d3b1d9a518c6d5236a2a8bad7a85c`
  for Gecko and
  `49e8e6d77c0a2a7af25e9c59334c9a7765326a0e0805b170bbc4c3b197da22cc`
  for Cefrium.
- No framework restart, APK install, publication, version bump, or push was
  performed as part of integration.

## Phase 2A checklist — desktop framework bookmarks

- [ ] Add typed/versioned desktop bookmark fields without replacing active
  `frameworkHost`/`frameworkPort`.
- [ ] Store at most 16 bookmarks with trimmed names up to 64 characters.
- [ ] Use case-insensitive bookmark names for native upsert/delete identity.
- [ ] Reuse desktop host/port validation for hostname, IPv4, and bracketed IPv6
  inputs.
- [ ] Recover safely from malformed stored bookmark data and write atomically.
- [ ] Add bounded Electron native get/upsert/delete request contracts.
- [ ] Add Bookmark Current, load, and remove controls to desktop Settings.
- [ ] Make bookmark selection fill fields only; require Save to connect.
- [ ] Keep Save routed through the existing `saveConnection` transaction.
- [ ] Validate relay, UI IPC, Run Target, app-view, and asset behavior after
  repeated bookmark load plus local/remote Save operations.

## Phase 2B checklist — local framework launcher

- [ ] Add a launcher extension for local framework state/actions.
- [ ] Add a tested `TE2_DESKTOP_*` exact-executable override for source smoke.
- [ ] Add native request contracts for capability, state, start, and stop.
- [ ] Implement an Electron-main `LocalFrameworkController`.
- [ ] Keep local bind host loopback-only and use the configured local port.
- [ ] Recognize an existing TE2 process through `/api/health` without claiming
  its ownership.
- [ ] Reject a non-TE2 port collision without choosing a hidden random port.
- [ ] Spawn only the exact packaged/source-configured TE2 executable.
- [ ] Use bounded startup readiness and retarget only after success.
- [ ] Publish process state event-wise to the launcher.
- [ ] Retain the exact owned child handle.
- [ ] Stop owned framework through SIGTERM and its existing shutdown sequence.
- [ ] Never terminate an externally owned TE2 process.
- [ ] Validate start, stop, unexpected exit, startup failure, target switching,
  Electron exit, and relaunch.
- [ ] Validate the complete source-mode flow through the exact-executable
  override before packaging begins.

## Phase 2C checklist — remaining desktop/frontend polish

- [ ] Collect the exact user-requested tweaks before source edits.
- [ ] Give each tweak a bounded source/test/live-validation scope.
- [ ] Complete and accept the approved tweaks before freezing the desktop
  package payload.

## Phase 3 checklist — client-scoped foreground document

- [ ] Define shared document membership independently from legacy global
  `last_file` foreground state.
- [ ] Add a bounded project/client active-file reconnect projection with a
  one-time legacy `last_file` seed.
- [ ] Carry `clientInstanceId` and `windowId` through Editor, Explorer, and
  relevant UI IPC connection registration.
- [ ] Add exact presentation rooms and route materialized editor opens only to
  the source room.
- [ ] Keep document membership, drafts, decorations, diagnostics, Git, and save
  facts shared.
- [ ] Split boot snapshot payloads into shared membership and client foreground.
- [ ] Derive file-tab active styling/reveal from client state while retaining
  shared membership and client-local order.
- [ ] Route Explorer active highlighting, toolbar active-file actions, Run,
  jump/focus, open completion, and extension navigation to the source client.
- [ ] Replace WBA's one browser-editor facade with client-keyed facades while
  retaining one shared logical document registry and one extension host.
- [ ] Project the focusing/command-originating facade into Code OSS's singular
  active editor before focus-sensitive extension work.
- [ ] Add monotonic draft/document revision fencing without claiming CRDT/OT
  same-file collaboration.
- [ ] Keep save path/model/base-hash/client identity explicit and validated.
- [ ] Prove two clients can work on different files without foreground theft.
- [ ] Prove shared open, draft, save, close, and project-switch projections
  remain deterministic.
- [ ] Prove reconnect/full restart restores only that client's foreground.
- [ ] Run the same live matrix in Browser, Electron, GeckoView, and Cefrium.

## Phase 4 checklist — Linux desktop user install

- [ ] Add ignored distribution staging/output roots and a deterministic
  installer/release builder under repository construction tooling.
- [ ] Add deterministic version and `x64` -> `amd64` mapping.
- [ ] Enforce the 3 GiB pre-build free-space check.
- [ ] Produce the tagged TE2 wheel, GNU/Linux Rust server, Electron archive,
  and checksums.
- [ ] Keep Cargo target/cache and Electron intermediate output outside distribution
  staging; copy only the validated final payloads.
- [ ] Prototype an exact immutable Git-tag private-venv bootstrap.
- [ ] Prototype a self-contained tagged-wheel/dependency private-venv payload.
- [ ] Measure compressed size, clean install time, offline reinstall, failure
  recovery, and upgrade behavior for both prototypes.
- [ ] Record and approve the final Linux Python-delivery mode.
- [ ] Generate the deterministic platform/interpreter-specific constraints or
  wheelhouse lock for the selected Python-delivery mode.
- [ ] Add the versioned `$TE2_DATA_HOME` install root, release receipt, atomic
  current pointer, and rollback-safe private-venv update transaction.
- [ ] Add user-local `te2` and `te2-desktop` wrappers plus the XDG desktop entry
  and icon.
- [ ] Validate a narrow apt prerequisite transaction for system Python/venv,
  Node/npm, SSL/runtime libraries, and platform `libarchive`; apt must not own
  the TE2 application payload.
- [ ] Validate the Terminal bootstrap from a clean user install, including
  first launch, target-native `node-pty`, canonical data-root placement,
  fingerprint reuse, marker validation, and repair.
- [ ] Add and validate the `.desktop` entry and installed icon.
- [ ] Wire the user-installed TE2 executable into the Phase 2 local controller.
- [ ] Validate the complete local-framework flow from the installed `.desktop`
  entry.
- [ ] Audit release checksums, receipt ownership, permissions, wrappers, XDG
  files, and installed payload paths.
- [ ] Clean-install on the accepted Linux baseline.
- [ ] Validate `te2 --help` and `/api/health` from the installed distribution.
- [ ] Validate desktop launch, app launch, assets, and normal shutdown.
- [ ] Upgrade atomically from the prior release and preserve ordinary XDG/TE2
  user state.
- [ ] Uninstall and prove only receipt-owned application files disappear.

## Phase 5 checklist — Termux `.deb`

- [ ] Capture current Termux architecture, Python version, prefix, and repository
  configuration from a target device.
- [ ] Resolve every cleaned direct/transitive Python dependency to a preferred
  Termux package when available.
- [ ] Validate actual import versions supplied by those packages.
- [ ] Identify Python packages still requiring TE2-owned payload files.
- [ ] Prove those files do not collide with another Termux package.
- [ ] Freeze the accepted package/dependency mapping in machine-readable form.
- [ ] Build remaining Python payloads natively for the Termux ABI.
- [ ] Produce and checksum the tagged `aarch64-linux-android` server.
- [ ] Validate that Bionic server on the target Termux device.
- [ ] Add `$PREFIX/bin/te2` and the package-owned server path.
- [ ] Generate the Termux control metadata with accurate `Depends`.
- [ ] Declare the Termux Node.js/npm packages needed by the standalone
  Terminal's private first-use runtime bootstrap; do not install global npm
  application packages.
- [ ] Preserve the existing Python Terminal bootstrap and
  `$TE2_DATA_HOME/node_runtime/terminal` as the only private runtime authority.
- [ ] Reject paths outside `$PREFIX`, hard links, invalid symlinks, and invalid
  shebangs.
- [ ] Prove `postinst` performs no networked pip operation.
- [ ] Clean-install and validate imports, CLI, `/api/health`, and app workers.
- [ ] Validate Terminal's Node runtime bootstrap.
- [ ] Validate the separate managed Code Server opt-in flow.
- [ ] Validate upgrade and uninstall ownership behavior.

## Deferred work

- [ ] Linux arm64 Electron package.
- [ ] Package signing and APT repository publication.
- [ ] Automatic package updates.
- [ ] Background/system service installation for a local framework.
- [ ] Android packaging or launcher changes.
- [ ] HTTPS/client-certificate management.
- [ ] Bundling managed Code Server.
- [ ] Client-local tab hiding independent from shared document close.
- [ ] CRDT/OT same-file collaborative editing.
- [ ] Separate WBA/extension-host process per client.

## Acceptance log

| Date | Scope | Evidence | Result |
|---|---|---|---|
| 2026-08-15 | Planning investigation | Current requirements/imports, platform dependency lists, Python package/bootstrap, Rust health route, Electron packager/settings/retarget, and launcher extension registry inspected | Plan shape confirmed; implementation pending |
| 2026-08-17 | Packaging-shape refinement | Direct dependency ownership, Electron compression measurements, install-mode split, prebuilt GNU/Linux and Bionic server matrix, and Cargo staging boundary recorded | Release-asset architecture captured; Linux Python-delivery prototype remains an explicit decision gate |
| 2026-08-17 | Phase 0 first pruning slice | Dead jobs router removed; direct requirements tightened; Framework-Shells pinned; global Code Server prerequisites removed; isolated wheel/CLI/import/HTTP/WebSocket, 217 repository tests, and 31 framework tests passed | Validated; external runtime/build manifest split remains |
| 2026-08-17 | Pre-package client architecture refinement | Remote `main` `f00ba916`, Android bookmark store/UI, desktop settings/retarget, sidecar open state, client identity, file tabs, Editor RPC rooms, draft mirror/save, Explorer projection, and WBA document registry inspected | Merge gate, desktop bookmarks, and client-scoped foreground phase added; no merge or implementation performed |
| 2026-08-17 | Phase 0 external dependency cleanup | Pruned obsolete installation metadata and documentation for the absent Termux-LM app, documented core/bootstrap/build/distribution ownership, corrected Code TE2 PTY comments, and passed targeted plus the full repository test suite | Phase 0 complete and validated; commit pending |
| 2026-08-17 | Terminal installation bootstrap contract | Confirmed the existing canonical TE2 data root, ABI/lock fingerprint, marker, lock, atomic install, validation, and repair behavior; 6 Terminal runtime tests plus the dependency contract test passed | System package prerequisites supply Node/npm; existing Python owns first-use module install and all later validation/repair; no new helper |
| 2026-08-17 | Linux installation architecture refinement | Compared system-owned Debian layout with the existing canonical TE2/XDG user roots and Termux's user-owned prefix model | Linux moves to a versioned home-directory install with private venv and narrow apt prerequisites; Termux retains its separate `.deb` |
