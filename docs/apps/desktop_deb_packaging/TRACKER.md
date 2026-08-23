# Unified Linux And Termux Release Installer Tracker

Last updated: 2026-08-23

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: dependency cleanup | Complete, validated, and committed as `0c02c033` | Keep the audited Python runtime input; target locks belong to the selected distribution design |
| Phase 1: integrate current `main` | Complete and validated at merge `8ac75fbc` | Imported baseline is accepted; Phase 2 may proceed without reopening the merge |
| Phase 2A: desktop framework bookmarks | Complete; automated and live retarget acceptance passed | Existing Electron retarget transaction remains the only connection authority |
| Phase 2B: launcher local framework | Implemented; automated validation and live source-mode acceptance passed | Bootstrap stdio lifecycle control plus Electron-owned process controller; TCP remains the data plane |
| Phase 2C: remaining frontend polish | Intake placeholder only | Each concrete tweak requires separate named scope and approval |
| Phase 3: client-scoped foreground document | Source implementation complete and automated checks passing; live client matrix remains | Stable `clientInstanceId` is foreground authority; `windowId` is metadata, and native presentation stays outside backend document authority |
| Phase 3B: Electron `Open in a Second Window` | Source implementation and automated checks complete; live Electron acceptance remains | One explicit secondary client, backend-owned foreground, Electron-owned per-project presentation; Android/browser unchanged |
| Phase 3C: mobile `Open in a Second Window` drawer | Lifecycle correction and synchronized asset/APK validation complete; live client matrix remains | Exact-null remains empty; tab is occupancy-driven; Collapse minimizes the outer drawer and Close is page-session presentation only |
| Phase 3D: Cefrium IME-dismissal focus release | Core live interaction accepted repeatedly; auxiliary false-positive matrix remains | Event-driven API-30 IME animation transition; Cefrium-only and no polling/viewport inference |
| Phase 4A: source/Git desktop bootstrap | Implemented and validated from a clean wheel | Python entrypoints build one fingerprinted Electron runtime and receipt-owned XDG integration; prebuilt release archives remain separate |
| Phase 4: unified installer and Linux target | Planned; architecture selected, implementation separately gated | Installer construction, Linux acceptance, and release publication are distinct actions |
| Phase 5: Termux target mode | Planned; dependency mapping required first | Reuses the Phase 4 installer transaction; device-native dependency investigation precedes target-archive acceptance |

## Confirmed source findings

| Finding | Evidence | Status |
|---|---|---|
| Current Electron publication is an unpacked x64 directory | `desktop_client/electron/package.mjs` calls `@electron/packager` and writes a local wrapper only | Confirmed |
| No complete unified installer exists | Electron packaging produces an unpacked application only; no cross-target detection, archive acquisition/verification, user-root transaction, receipt, or updater exists | Confirmed |
| The Python dependency list is mostly direct runtime surface | Packaged source directly imports FastAPI, Starlette, Uvicorn, HTTPX, msgspec, AnyIO, FastMCP, Framework-Shells, libarchive-c, socketio, and PyYAML | Confirmed |
| `sse-starlette` was held directly by an unmounted router | The dead `app.libs.jobs.jobs_bp` import/router was removed while the job core and handlers remain | Pruned; still transitive through MCP |
| Framework-Shells is reproducibly pinned | `requirements.txt` uses exact validated 0.0.63 commit `0bf3269cd69a000015b0ac484a04004b8dc564d1` | Complete |
| User dependency installation has explicit owners | Linux private-venv inputs, existing app bootstraps, and installer target manifests cover the supported paths | Repository construction scripts are not user setup entrypoints |
| Global Code Server is unsupported | Code TE2 resolves only its consent-gated private managed runtime | Confirmed |
| Packaged framework can avoid target Cargo | The current bootstrap accepts `--server-bin` | Confirmed |
| Framework readiness has an identity-bearing endpoint | Rust serves `/api/health` with app/version/instance/listener metadata | Confirmed |
| Desktop settings support one target | `DesktopShellSettings` contains one host/port pair and zoom | Confirmed |
| Retarget cleanup already exists | `saveConnection` stops Run Target listeners, reconnects UI IPC, clears instrumentation, retargets the relay, and closes the app view | Confirmed; must be reused |
| Launcher supports frontend extensions | `desktop_client/android_shell/extensions/registry.js` mounts launcher extensions | Confirmed presentation seam |
| Electron originally had no local framework process controller | Electron main owned client/runtime relays but did not spawn or retain a TE2 framework child | Implemented in Phase 2B through the exact bootstrap entrypoint |
| Electron dominates compressed desktop payload size | Current unpacked directory is about 317 MiB; measured xz stream is about 86.6 MiB, zstd about 102.5 MiB, and gzip about 120.3 MiB | Confirmed |
| Cargo intermediates are not runtime payload | The bootstrap accepts a final server path; only the validated release executable is required on packaged targets | Confirmed |
| Uvicorn's native `standard` extras are not required by the current design | Isolated HTTP and WebSocket runtime-bridge smoke passed with explicit `websockets` and without `uvloop` or `httptools` | Pruned and validated |
| The TE2 wheel is not a small package increment | Isolated wheel is 85,830,112 bytes because it contains the framework and built-in app asset payload | Confirmed; invalidates the earlier 90--110 MiB self-contained estimate |
| `sse-starlette` remains transitive | TE2 no longer declares or imports it directly, but FastMCP/MCP still resolves it | Confirmed; ownership cleanup without installed-byte reduction |
| Remote `main` materially changes the upcoming edit seams | At investigation time this branch was one commit ahead and nine behind `f00ba916`; `3a1e542a` changes boot/open/UI IPC/editor/WBA projection paths and the delta includes Run Profile/native-client fixes | Confirmed; merge gate must precede client/editor implementation |
| Android bookmarks are separate from the active endpoint | Remote `main` stores up to 16 named native host/port bookmarks; choosing one fills fields and Save performs the actual retarget | Confirmed reference contract for desktop |
| Global `last_file` locked connected editors together | Editor opens formerly wrote sidecar `last_file`, broadcast `editor:open` to `code_te2`, and derived every foreground from shared open state | Replaced in the first Phase 3 slice by bounded per-client foreground projections; `last_file` is migration seed only |
| Shared-document prerequisites already exist | Stable client/window ids, client-local tab order, path-keyed draft mirrors, and WBA retained logical documents already exist | Confirmed reusable seams |
| One WBA extension host has one Code OSS active editor pointer | WBA retains shared documents but currently exposes one synthetic active-editor facade | Confirmed constraint; client facades must converge focus/command context honestly |
| The server already supports a second editor foreground | `ProjectSidecar.client_foregrounds` is a bounded project-scoped map keyed by stable `clientInstanceId` | No new shared `secondWindow` state is required |
| Electron presentation is already native-owned | Sidebar order/mode persists beneath `$TE2_CONFIG_HOME`, while file-tab order is browser-local and project-keyed | Generalize native desktop presentation for the secondary editor; do not add geometry to ProjectSidecar |
| The current Electron identity store owns only one client | `desktop-client-identity.json` contains one stable `clientInstanceId` | Phase 3B must allocate and persist a second complete client identity deliberately |
| Code TE2 renderer state is singleton-shaped | Socket identity, Monaco host globals, DOM ids, and main-page boot are scoped to one renderer | The secondary editor requires its own renderer and reduced boot mode, not duplicated DOM or CSS hiding |
| Mobile can reuse the backend second-client contract without Electron native placement | `ProjectSidecar.client_foregrounds` is client-keyed, while the bottom drawer already owns a retained constrained portrait surface | Use a separate retained iframe/client in the drawer; do not mount another Monaco in the primary document realm |
| Android relay origin cannot persist an auxiliary identity | GeckoView and Cefrium load through a random process-local loopback relay and already obtain primary identity from application-private native storage | Extend both native identity bridges with one paired auxiliary id; never use relay-origin local storage as Android identity authority |
| Problems drawer duplicates Explorer diagnostics | Both consume `explorer.diagnostics.detail`; Explorer retains detail, derives badges while closed, and renders the same problems component in its diagnostics tab | Remove the duplicate drawer DOM/controller while preserving Explorer diagnostics and diagnostics export data |
| Explorer file-card actions already have a typed RPC boundary | Card actions originate in `src/explorer/tree/menu-controller.ts` and extension actions use `/rpc/explorer` | Add a validated file-only second-window intent through Explorer backend and exact-client UI IPC; do not call another frontend lane directly |
| Cefrium has editor focus intent but no keyboard-visibility authority | UI IPC toggles the native input filter and Cefrium can evaluate page JavaScript, but current code does not observe `WindowInsets.Type.ime()` | Use an API-30 visible-to-hidden native transition to signal one exact-page Monaco blur; do not infer from viewport resize |
| npm has two explicit installed-code owners | Code TE2, WBA, and shared browser artifacts are already bundled/vendored; source/Git Electron and standalone Terminal use separate locked bootstraps | Final Linux archives prebuild Electron; source installs may opt into `te2 desktop install`, while Terminal retains its private first-use modules |
| Standalone Terminal first use retains its current bootstrap | Its separate locked runtime runs `npm ci`; `node-pty` 1.1.0 uses a native install script and has no Linux prebuild in the current payload | Target prerequisite manifests supply Node/npm; the bootstrap installs the modules with target-native build support validated per installer mode |
| Terminal runtime state is per-user canonical TE2 data | Current Python resolves `$TE2_DATA_HOME/node_runtime/terminal/<fingerprint>`, normally beneath `~/.local/share/te2`, with a lock, atomic staging, marker, package checks, and ABI-aware reuse | The selected installer target manifest supplies Node/npm; existing Python remains the only private-module installer and validator |
| Installed dependencies have only explicit admission paths | Linux private venv, an existing owned app bootstrap, or the unified installer's validated target prerequisite transaction | Remove unowned dependencies and their unsupported capability instead of adding helper installers |
| External capability binaries still have exact owners | `aria2c` backs Aria Downloader and `watchexec` backs the Code TE2 polling watcher | The selected target manifest owns them, or the installed capability is removed |
| `dtach` has no TE2 owner | Code TE2's terminal shellspec uses Framework-Shells `backend: pty`; only stale comments referred to dtach | Removed from the supported dependency surface |
| Termux-LM no longer exists | There is no `app/apps/termux_lm`; only stale documentation remained | Documentation pruned |
| Cefrium `0.7.0` is no longer published by its configured Maven repository | Upstream metadata exposes `0.7.1`; both the Gradle plugin and SDK now pin that release | Corrected and validated; `0.7.1` also carries the required iframe WebSocket/scheduling-latency fix |

## Architecture decisions

- [x] Linux install identity is `te2-desktop` and initially targets `amd64`.
- [x] Linux owns a private venv, prebuilt release Rust server, and Electron
  payload beneath the canonical TE2 user data root.
- [x] Linux installs user-local `te2`/`te2-desktop` wrappers, desktop entry,
  icon, version receipt, and atomic current-release pointer.
- [x] One public `install-te2` entrypoint owns both apt-based glibc Linux and
  Termux installation; there is no separate Termux `.deb` authority.
- [x] Detection checks Termux first, then requires Linux + glibc + `apt-get` for
  the initial desktop target; unsupported libc, package managers,
  architectures, and platforms fail explicitly.
- [x] Termux mode is framework/CLI-only and initially targets `aarch64`.
- [x] Termux uses its shared Python interpreter and preferred repository
  dependencies without a venv, while TE2's own Python tree remains versioned
  under the canonical user-owned release root.
- [x] Termux dependency/package discovery is a hard gate before payload design.
- [x] Source/editable and Git/pip installs may build Rust through the canonical
  external cache; installed distribution payloads never carry Cargo intermediates.
- [x] Every installed component comes from one synchronized immutable tag.
- [x] Tagged release assets are `install-te2`, target-specific `.tar.gz`
  archives for Linux x86_64 and Termux aarch64, and `SHA256SUMS`; each archive
  carries its own versioned manifest and exact target payload.
- [x] Tar/gzip preserves executable modes and symlinks without another
  decompressor prerequisite; ZIP is not a publication format.
- [x] Payload acquisition order is explicit `--payload`, matching adjacent
  archive, then immutable release download. Every path uses the same checksum
  and internal-manifest validation.
- [x] Release binaries live in release assets rather than Git history.
- [x] The Bionic/Android server asset is a Termux archive input and does not
  imply Android APK embedding.
- [x] Installed releases use immutable archives with the version-matched TE2
  wheel and locked target Python inputs; the thin exact-tag Git bootstrap is
  superseded.
- [x] Online and local-payload installs share explicit failure/recovery behavior
  and atomically preserve the prior valid release.
- [x] Neither target archive bundles managed Code Server.
- [x] Repository scripts may construct the public installer and release
  archives, but are absent from ordinary installed payloads. They appear for
  users only in cloned/editable checkouts.
- [x] Linux and Termux apt prerequisite manifests are separately validated and
  recorded behind the shared installer transaction.
- [x] Desktop bookmarks remain separate from the active host/port connection,
  matching Android's load-then-Save behavior.
- [x] The existing relay/UI IPC retarget transaction remains connection
  authority.
- [x] Local framework launch is explicit and Electron-main owned; loopback is
  the default and non-loopback exposure requires configured broadcast selectors.
- [x] Electron stops only a framework child it spawned and retained.
- [x] Finish independent Phase 0 cleanup before integrating `main`.
- [x] Integrate and validate the approved current `main` baseline before any
  desktop/client/editor source changes or distribution construction.
- [x] Keep one shared project, shared document membership, shared drafts/writes,
  and one WBA logical document registry.
- [x] Split foreground editor presentation only by stable client in the first
  Phase 3 slice; retain live window identity as metadata rather than authority.
- [x] Treat backend client-active persistence as a bounded reconnect projection,
  not a new cross-client active-file authority.
- [x] Preserve one extension host initially; project the most recently focused
  or command-originating client into Code OSS's singular `activeTextEditor`.
- [x] Do not claim same-file CRDT/OT collaboration as part of foreground-state
  separation.
- [x] Treat Electron's second editor as an explicit second stable client, not a
  `windowId` promotion or a second backend document authority.
- [x] Keep the secondary canonical file in the existing project/client
  foreground map and keep placement/geometry in Electron native config.
- [x] Key secondary presentation by configured upstream framework origin plus
  canonical project path; never key it by the random loopback relay origin.
- [x] Keep Browser, GeckoView, and Cefrium single-surface and unchanged during
  the Electron-only second-window phase.
- [x] Extend the second-client model in a later explicit mobile phase rather
  than retroactively mixing Android/browser presentation into Phase 3B.
- [x] Gate mobile second-editor capability from native/mobile client identity,
  never from a narrow desktop viewport alone.
- [x] Keep the mobile auxiliary Monaco in a separate retained iframe/document
  realm and reuse the ordinary exact-client Editor/UI IPC/WBA lanes.
- [x] Replace the redundant Problems drawer presentation with the mobile second
  editor while retaining Explorer diagnostics as the project-wide UI.
- [x] Route Explorer second-window actions through `/rpc/explorer`, backend
  path validation, and exact-client host notification.
- [x] Treat Cefrium IME dismissal as an event-driven native insets transition
  followed by frontend focus release; do not poll or alter Gecko recovery.

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

- [x] Add typed/versioned desktop bookmark fields without replacing active
  `frameworkHost`/`frameworkPort`.
- [x] Store at most 16 bookmarks with trimmed names up to 64 characters.
- [x] Use case-insensitive bookmark names for native upsert/delete identity.
- [x] Reuse desktop host/port validation for hostname, IPv4, and bracketed IPv6
  inputs.
- [x] Recover safely from malformed stored bookmark data and write atomically.
- [x] Add bounded Electron native get/upsert/delete request contracts.
- [x] Add Bookmark Current, load, and remove controls to desktop Settings.
- [x] Make bookmark selection fill fields only; require Save to connect.
- [x] Keep Save routed through the existing `saveConnection` transaction.
- [x] Validate relay, UI IPC, Run Target, app-view, and asset behavior after
  repeated bookmark load plus local/remote Save operations.

### Phase 2A automated evidence

- Phase 2A desktop settings schema v1 persists the active endpoint, zoom, and
  at most 16 validated bookmarks in the existing atomic
  `desktop-shell.json` record. Phase 2B keeps local launch policy out of that
  connection authority.
- Malformed records recover entry-by-entry; bookmark upsert/delete uses trimmed,
  case-insensitive names and preserves list position on replacement.
- Hostname, IPv4, bracketed IPv6, HTTPS, credential rejection, invalid-port,
  name-bound, capacity, malformed-read, and atomic-write tests pass.
- Electron TypeScript validation passes; all 71 Electron tests pass; the
  unbundled Electron source compile and both modified launcher JavaScript syntax
  checks pass.
- No framework restart, Electron launch, version bump, commit, push, or Android
  change was performed for this implementation slice.
- User live acceptance confirmed bookmark load/Save retarget behavior before
  Phase 2B implementation began; Phase 2A was committed and pushed as
  `0efc731c`.

## Phase 2B checklist — local framework launcher

- [x] Add a launcher extension for local framework state/actions.
- [x] Add the tested exact absolute `TE2_DESKTOP_TE2_EXECUTABLE` override for
  source smoke.
- [x] Add the separate versioned
  `$TE2_CONFIG_HOME/desktop-local-framework.json` launch contract.
- [x] Keep an unmanaged source install file-free until Settings Save; prefill
  its command through Electron-main PATH detection.
- [x] Validate and atomically persist command, optional venv, broadcast array,
  port, and bounded environment overrides with private file permissions.
- [x] Activate a configured venv through `VIRTUAL_ENV` plus a prepended
  `<venv>/bin` PATH.
- [x] Add bounded Settings rows for broadcast selectors and environment values.
- [x] Project command detection/source and venv readiness/load state to the
  launcher.
- [x] Add native request contracts for capability, state, start, stop, and Use
  Local.
- [x] Implement an Electron-main `LocalFrameworkController`.
- [x] Keep loopback access and use the configured local port; add external
  exposure only through explicit `broadcast[]` selectors.
- [x] Recognize an existing TE2 process through `/api/health` without claiming
  its ownership.
- [x] Reject a non-TE2 port collision without choosing a hidden random port.
- [x] Spawn only the exact packaged/source-configured TE2 executable.
- [x] Add bootstrap `--stdio-control`: stdin NDJSON requests, inherited FD 3
  NDJSON responses/events, unchanged stdout/stderr, and shutdown on owner EOF.
- [x] Keep protocol v1 allowlisted to shutdown; reject arbitrary command
  execution while retaining a versioned extension seam.
- [x] Use bounded startup readiness and retarget only after success.
- [x] Publish process state event-wise to the launcher.
- [x] Retain the exact owned child handle.
- [x] Stop an owned framework through the stdio shutdown request, then bounded
  process-group SIGTERM/SIGKILL fallback.
- [x] Never terminate an externally owned TE2 process.
- [x] Keep the local launch port in the separate local-framework config rather
  than duplicating it in desktop connection settings.
- [ ] Validate start, stop, unexpected exit, startup failure, target switching,
  Electron exit, and relaunch.
- [x] Validate the complete source-mode flow through the exact-executable
  override before packaging begins.

### Phase 2B automated evidence

- Bootstrap parser/protocol/integrated shutdown/owner-EOF tests pass: 27
  bootstrap tests.
- Electron controller/config tests cover override/config/PATH command
  resolution, private atomic persistence, malformed-config recovery, venv and
  environment precedence, broadcast arguments, TE2/free/collision health
  classification, external ownership, owned start/select/stop, unexpected
  exit, and Electron-exit EOF.
- Electron TypeScript validation passes; all 87 Electron tests pass; the
  unbundled Electron source compile and launcher JavaScript syntax checks pass.
- The live shared framework was not restarted or terminated during automated
  validation. User live acceptance confirmed the source-mode launch/config
  flow on 2026-08-18; the complete manual failure/lifecycle matrix remains open.

## Phase 2C checklist — remaining desktop/frontend polish

- [ ] Collect the exact user-requested tweaks before source edits.
- [ ] Give each tweak a bounded source/test/live-validation scope.
- [ ] Complete and accept the approved tweaks before freezing the desktop
  package payload.

## Phase 3 checklist — client-scoped foreground document

- [x] Define shared document membership independently from legacy global
  `last_file` foreground state.
- [x] Add a bounded project/client active-file reconnect projection with a
  one-time legacy `last_file` seed.
- [x] Carry stable `clientInstanceId` plus metadata-only `windowId` through
  Editor, Explorer, WBA, and relevant UI IPC connection registration.
- [x] Add exact client rooms and route materialized editor opens only to
  the source room.
- [x] Keep document membership, drafts, decorations, diagnostics, Git, and save
  facts shared.
- [x] Split boot snapshot payloads into shared membership and client foreground.
- [x] Derive file-tab active styling/reveal from client state while retaining
  shared membership and client-local order.
- [x] Route Explorer active highlighting, toolbar active-file actions, Run,
  jump/focus, open completion, and extension navigation to the source client.
- [x] Replace WBA's one browser-editor facade with client-keyed facades while
  retaining one shared logical document registry and one extension host.
- [x] Project the request/command-originating facade into Code OSS's singular
  active editor before focus-sensitive extension work.
- [x] Add monotonic draft/document revision fencing without claiming CRDT/OT
  same-file collaboration.
- [x] Keep save path/model/base-hash/client identity explicit and validated.
- [x] Prove with deterministic backend tests that simultaneous clients can open
  different files without losing membership or stealing foreground.
- [x] Prove shared open, draft, save, close, and project-switch projections
  remain deterministic.
- [x] Prove reconnect/full restart restores only that client's foreground.
- [ ] Run the same live matrix in Browser, Electron, GeckoView, and Cefrium.

### Phase 3 automated evidence

- Python identity, open-state, logical-document, and extension-navigation tests
  pass, including simultaneous two-client opens and one-time legacy seeding.
- WBA Socket.IO rejects missing/malformed identity, accepts the canonical
  snake-case query, and routes extension navigation through the exact client.
- WBA open-dispatch regression coverage proves the socket-authenticated
  `clientInstanceId` and metadata-only `windowId` survive `vscode.openFile`
  normalization into the client-keyed facade. Live Gecko validation confirmed
  BasedPyright hover content and advancing semantic-token result IDs after the
  repaired acknowledgement while shared diagnostics remained available.
- Code TE2 Socket.IO transport/open-flow/editor-state tests pass with canonical
  identity injection and no disconnected foreground replay.
- Electron multi-window remains an explicit later interface. Existing Electron
  windows share one stable client foreground; `windowId` is not promoted into
  state authority.
- Durable revision tests cover draft-to-draft-to-clean ordering, bounded-map
  eviction, paired mirror/cache revisions, stale frontend rejection, and stable
  client self-mirror suppression.
- Full restart and project-switch tests restore independent foreground paths for
  the same stable clients without reviving global `last_file` authority.
- The complete Code TE2 suites pass: 234 Python tests and 217 Node tests, plus
  TypeScript typecheck, bundle regeneration, and Python bytecode compilation.

## Phase 3B checklist — Electron `Open in a Second Window`

- [x] Complete source-backed ownership and feasibility investigation.
- [x] Define one explicit secondary editor client with a stable independent
  `clientInstanceId`.
- [x] Keep canonical secondary foreground in existing
  `ProjectSidecar.client_foregrounds`; do not add shared window geometry or
  presentation mode.
- [x] Define an Electron-owned, versioned desktop presentation schema that
  retains Sidebar state and adds bounded per-framework/per-project secondary
  editor records.
- [x] Define presentation modes as `closed`, `docked`, `collapsed`, and
  `detached`, with bounded dock size and native detached-window geometry.
- [x] Define Close as presentation-only while retaining warm backend foreground;
  reserve foreground clearing for an explicit reset/remove action.
- [x] Define Android and browser behavior as unchanged: no native broker, no
  presentation-store read, and no extra shared boot-snapshot key.
- [x] Implement and test the generalized Electron presentation store, stable
  secondary identity, reset transaction, atomic persistence, bounds clamping,
  and framework/project key normalization.
- [x] Implement the exact-view Electron broker and one-entry secondary editor
  native surface registry.
- [x] Implement retained docked/collapsed placement plus detached/attached
  native-window placement.
- [x] Place the docked/collapsed native view from a Code TE2-owned grid slot
  below the shared toolbar and between the primary editor and Sidebar; retain
  the full-sized primary app view instead of splitting it in Electron main.
- [x] Preserve the injected Code TE2 stylesheet/font nodes when the reduced
  renderer removes primary visual surfaces, keeping Monaco breadcrumb and flex
  sizing intact.
- [x] Add a docked-only primary/secondary drag boundary, hide the sibling native
  view during the pointer transaction, and persist the final bounded dock width
  through the existing Electron per-project presentation record.
- [x] Implement the reduced secondary Code TE2 renderer boot and compact
  filename/action/window header without a background tab strip.
- [x] Implement primary-page `Open in a Second Window` orchestration through
  Electron main, followed by the secondary renderer's own authenticated open.
- [x] Add an Electron-only file-tab right-click/Context Menu action that opens
  the clicked admitted path in the secondary client without moving the primary
  foreground.
- [x] Permit the reduced renderer to pass the existing Code TE2 app-readiness
  prerequisite while retaining the primary-only placement and open controls.
- [x] Reuse existing Editor, UI IPC, draft, revision, WBA, and
  extension-command lanes without adding an Electron-only document transport.
- [x] Implement cold boot, framework retarget, project switch, renderer crash,
  Close/reopen, identity reset, and invalid/off-screen geometry.
- [x] Add deterministic automated coverage for the unified state transaction,
  distinct client identities, project-key normalization, exact-client editor
  action relays, preload allowlists, and the existing multi-client shared-state
  contracts.
- [ ] Run live Electron acceptance for different-file and same-file workflows,
  all four placement modes, restart, project switch, retarget, and renderer
  reconstruction.
- [ ] Confirm Browser, GeckoView, and Cefrium payloads and behavior are
  unchanged.

## Phase 3C checklist — mobile `Open in a Second Window` drawer

- [x] Complete source-backed feasibility and ownership investigation.
- [x] Define non-desktop client capability independently from the responsive
  layout breakpoint.
- [x] Define one stable paired auxiliary client identity for ordinary mobile
  browser, GeckoView, and Cefrium providers.
- [x] Keep the canonical auxiliary foreground in existing
  `ProjectSidecar.client_foregrounds` and presentation out of shared backend
  state.
- [x] Select one retained iframe/document realm in the bottom drawer rather
  than a second Monaco instance in the primary document.
- [x] Select the existing Problems drawer slot for replacement while retaining
  Explorer diagnostics detail, badges, navigation, mentions, and export.
- [x] Define file-tab and Explorer card-menu open intent without moving the
  invoking primary foreground.
- [x] Implement and test role-aware browser/GeckoView/Cefrium identity pairs
  and atomic identity reset.
- [x] Extract the portable reduced-editor core without regressing Electron's
  native secondary renderer.
- [x] Remove the duplicate Problems drawer DOM/controller and preserve all
  Explorer diagnostics consumers.
- [x] Implement the eligible-mobile Second Window drawer tab, retained iframe,
  close/reopen behavior, and breakpoint reconciliation.
- [x] Add typed Explorer RPC validation plus exact-client UI IPC routing for
  file-card `Open in a Second Window`.
- [x] Generalize file-tab opening to Electron and eligible mobile capability
  providers while hiding it from unsupported desktop browsers.
- [x] Keep an explicit null auxiliary foreground authoritative instead of
  reviving the shared/primary current path.
- [x] Hide the Second Window tab while the exact auxiliary foreground is empty
  and reveal it only after a correlated open succeeds.
- [x] Preserve the populated tab and retained renderer when the reduced mobile
  header collapses the outer drawer; keep Close as page-session dismissal.
- [x] Reuse the exact-client diagnostics count/Next Issue contract in the
  portable reduced header and expose a populated-only mobile reopen shortcut.
- [x] Assign GeckoView/Cefrium debug and staging builds one repository-owned
  development certificate while leaving release signing separate.
- [ ] Validate same/different-file drafts, WBA features, project switch,
  reconnect, restart, orientation, identity reset, and two-client isolation.
- [x] Rebuild Code TE2 at synchronized version `0.2.334`, publish the canonical
  Android asset seed, and assemble signed GeckoView/Cefrium debug APKs.
- [ ] Complete GeckoView/Cefrium live acceptance separately. The `0.2.334`
  Cefrium debug APK is installed on both connected devices.

Automated evidence recorded on 2026-08-22:

- Code TE2 TypeScript validation passed, all 237 Node tests passed, and the
  canonical `node build.mjs` bundle completed.
- The focused Python UI IPC and Explorer second-window suite passed all five
  tests, including exact-client routing and symlink-escape rejection.
- The canonical `0.2.333` Android asset seed was published after the frontend
  build. Its bundled `host.js` is byte-identical to the source output and the
  same hash/version was verified inside all four APKs.
- GeckoView and Cefrium unit-test tasks plus debug and staging APK assemblies
  completed with more than 7 GiB free. Every APK uses the stable repository
  development certificate; Gradle reports both release variants with no
  development signing config. No APK was installed and the shared framework
  was not restarted.

## Phase 3D checklist — Cefrium IME-dismissal focus release

- [x] Confirm the current ownership split: UI IPC reports editor focus intent,
  while native Android must observe actual IME visibility.
- [x] Select API-30 `WindowInsets.Type.ime()` animation `onPrepare`/`onStart`
  visible-to-hidden transition as the dismissal signal; retain `onEnd` final
  reconciliation and reject polling/viewport-resize heuristics.
- [x] Define lifecycle, focus-owner, navigation, and programmatic-transition
  fences for a genuine manual dismissal.
- [x] Keep GeckoView's explicit keyboard recovery behavior unchanged.
- [x] Implement and unit-test the Cefrium native IME transition reducer.
- [x] Dispatch one exact-page dismissal event and add an idempotent Monaco focus
  transfer to the real File toolbar button, with one next-animation-frame
  reconciliation and lifecycle disposal.
- [x] Keep Cefrium UI IPC focus/blur state-only; remove native
  `restartInput`/`showSoftInput`, focus sinks, and acknowledgement queries.
- [x] Extend the existing exact-textarea `preventScroll` page policy into
  existing and future same-origin iframe realms without touching cross-origin
  frames.
- [x] Validate repeated dismiss-scroll-refocus typing on a live Cefrium device.
- [ ] Validate navigation, background, dialogs, drawer, rotation, and
  editor-switch false-positive cases.
- [x] Run Cefrium unit/debug builds, shared Code TE2 checks, and unchanged Gecko
  comparison coverage.

Automated/publication evidence recorded on 2026-08-22:

- Code TE2 typecheck and all 232 Node tests passed before the canonical bundle.
- The canonical `0.2.334` Android asset seed contains 205 files and was
  published only after `host.js` was rebuilt.
- Cefrium and Gecko debug unit tests and APK assemblies passed under JDK 21.
- Cefrium debug `versionCode=20334` / `1.0.7-r0.2.334-cefrium` installed
  successfully on both connected devices. Manual IME/zoom/pill/shortcut
  interaction acceptance remains intentionally unchecked.

Corrective implementation evidence recorded on 2026-08-23:

- The first DOM-only focus-sink implementation was replaced because it left
  Cefrium's Chromium surface as Android's focused view. Version `0.2.335` uses
  a one-shot event-driven DOM-blur/native-focus handshake instead.
- Code TE2 typecheck, the focused Gecko/Cefrium keyboard Node tests, and
  Cefrium plus Gecko comparison unit tests pass. The canonical 205-file
  `0.2.335` Android asset seed contains the byte-identical rebuilt `host.js`.
- Cefrium debug assembly passed and `versionCode=20335` /
  `1.0.7-r0.2.335-cefrium` installed successfully on both connected devices.
  Live dismiss-scroll-refocus acceptance remains intentionally unchecked.
- Live traces on `0.2.336` proved two independent races: delayed exact-client
  UI IPC focus could call native `restartInput`/`showSoftInput`, and an
  `onEnd`-only dismissal arrived after Chromium had queued one final IME show.
  UI IPC is now state-only; `onPrepare` captures the start state and `onStart`
  dispatches a genuine hide before the first animated frame, with `onEnd` only
  reconciling final visibility.
- Code TE2 typecheck, the focused next-frame browser regression test, Cefrium
  reducer/unit tests, the canonical 205-file `0.2.336` asset bundle, Cefrium
  debug assembly, and Gecko comparison unit/debug assembly passed.
  `1.0.7-r0.2.336-cefrium` was installed on the connected Motorola and repeated
  dismiss-scroll-refocus acceptance passed without the prior double-dismiss
  animation jank.

## Phase 4 checklist — unified installer and Linux target

- [x] Package the bounded Electron production source and its exact shared inputs
  in source/editable/Git Python installs without generated or profiler output.
- [x] Add `te2 desktop install|repair|status|uninstall|launch` and the
  `te2-desktop` entrypoint.
- [x] Fingerprint and lock the source bootstrap, retain npm/Electron downloads
  under `$TE2_CACHE_HOME`, discard intermediates, and atomically activate only
  a validated runtime beneath `$TE2_DATA_HOME`.
- [x] Install receipt-owned user-local wrapper/XDG files, refuse unowned
  collisions, and preserve modified files during uninstall.
- [x] Validate a clean 41 MiB wheel, isolated wheel install, installed-wheel
  Electron build, fingerprint reuse, 90 Electron tests, packaged launch, 22
  focused Python tests, and strict Python type checking.
- [ ] Replace the source-build bridge with a prebuilt Electron payload in the
  final Linux target archive; do not run npm during archive installation.

- [ ] Add ignored release staging/output roots and one deterministic builder
  under repository construction tooling.
- [ ] Produce `install-te2`, target manifests, target `.tar.gz` archives, and
  `SHA256SUMS` from one synchronized immutable tag.
- [ ] Add deterministic version, platform, libc, package-manager, and
  architecture detection with Termux evaluated before generic Linux.
- [ ] Map Linux `x86_64`/Electron `x64` consistently and reject unsupported
  targets explicitly.
- [ ] Enforce the 3 GiB pre-build free-space check.
- [ ] Keep Cargo/Electron caches and intermediate output outside release staging.
- [ ] Produce the Linux archive with the TE2 wheel and locked Python inputs,
  GNU/Linux Rust server, Electron payload, XDG files, and internal manifest.
- [ ] Implement acquisition precedence: `--payload`, adjacent matching archive,
  then immutable release download.
- [ ] Verify `SHA256SUMS` plus the internal version/target/content manifest
  before activation.
- [ ] Generate deterministic Linux interpreter constraints/wheel inputs.
- [ ] Add the versioned `$TE2_DATA_HOME` release root, receipt, atomic current
  pointer, and rollback-safe update transaction.
- [ ] Add user-local `te2` and `te2-desktop` wrappers plus the XDG desktop entry
  and icon.
- [ ] Validate the narrow apt prerequisite transaction for system Python/venv,
  Node/npm, SSL/runtime libraries, and `libarchive`; apt must not own TE2 files.
- [ ] Validate the Terminal bootstrap from a clean user install, including
  target-native `node-pty`, canonical data-root placement, fingerprint reuse,
  marker validation, and repair.
- [ ] Wire the installed command/venv into the Phase 2 local controller and
  validate the complete `.desktop` local-framework flow.
- [ ] Validate online, adjacent, and explicit offline payload modes.
- [ ] Validate checksum/manifest rejection, interrupted staging, atomic upgrade,
  rollback, and receipt-owned removal.
- [ ] Clean-install on the accepted Debian/Ubuntu baseline and validate CLI,
  `/api/health`, desktop/app launch, assets, and normal shutdown.

## Phase 5 checklist — Termux target mode

- [ ] Capture current Termux architecture, Python version, prefix, and repository
  configuration from a target device.
- [ ] Resolve every cleaned direct/transitive Python and native dependency to a
  preferred Termux apt package when available.
- [ ] Validate actual import versions supplied by those packages.
- [ ] Identify Python inputs still requiring target-built release payloads.
- [ ] Freeze the accepted apt/import mapping in the Termux target manifest.
- [ ] Build remaining Python payloads for the Termux ABI.
- [ ] Produce and checksum the tagged `aarch64-linux-android` server.
- [ ] Produce `te2-<version>-termux-aarch64.tar.gz` with no Electron assets.
- [ ] Validate the Bionic server and complete archive on the target device.
- [ ] Reuse the common checksum, staging, receipt, current-pointer, rollback,
  and removal transaction.
- [ ] Install prerequisites with apt directly and without `sudo`.
- [ ] Keep TE2's Python tree versioned beneath `$TE2_DATA_HOME`; do not write
  TE2 into shared `site-packages` or create a Termux venv.
- [ ] Add receipt-owned `$PREFIX/bin/te2` resolving the current Python tree and
  exact server.
- [ ] Preserve the existing Terminal bootstrap and
  `$TE2_DATA_HOME/node_runtime/terminal` as the only private runtime authority.
- [ ] Reject release-root escapes, shared-prefix collisions, hard links, invalid
  symlinks, and invalid shebangs.
- [ ] Prove activation performs no networked pip resolution after archive
  verification.
- [ ] Validate download and offline payload installs, imports, CLI,
  `/api/health`, app workers, Terminal bootstrap, and managed Code Server opt-in.
- [ ] Validate atomic upgrade, rollback, and receipt-owned uninstall behavior.

## Deferred work

- [ ] Linux arm64 Electron package.
- [ ] Artifact signing and automatic installer-channel publication.
- [ ] Automatic package updates.
- [ ] Non-apt glibc distributions and musl targets.
- [ ] Background/system service installation for a local framework.
- [ ] Android packaging or launcher changes.
- [ ] HTTPS/client-certificate management.
- [ ] Bundling managed Code Server.
- [ ] General client-local tab hiding independent from shared document close;
  Phase 3B's reduced secondary surface intentionally omits a tab strip without
  changing shared membership.
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
| 2026-08-17 | Linux installation architecture refinement | Compared system-owned Debian layout with the existing canonical TE2/XDG user roots and Termux's user-owned prefix model | Linux user-root/private-venv decision retained; separate Termux `.deb` conclusion superseded by the 2026-08-18 unified-installer decision |
| 2026-08-18 | Phase 2B source-mode local framework | Automated bootstrap/controller/config/type/build validation plus user live validation of the Electron launcher configuration and local-framework flow | Passed; exact-executable source-mode acceptance complete, with the broader manual failure/lifecycle matrix still open |
| 2026-08-18 | Unified installer architecture | Revisited the split Linux-installer/Termux-DEB design after client/runtime phases stabilized | One autodetecting installer now owns both targets; immutable tar/gzip target archives, manifests, checksums, offline payload selection, Linux private venv, and Termux shared-interpreter/release-tree behavior replace the former split authorities |
| 2026-08-18 | Electron second editor planning | Inspected project/client foreground persistence, Electron identity and Sidebar presentation stores, project-keyed file-tab order, renderer-global socket identity, and native detached-surface placement | Phase 3B records one explicit secondary client, backend-owned foreground, Electron-owned per-framework/per-project placement, reduced renderer boot, and unchanged Android/browser behavior |
| 2026-08-18 | Electron second editor implementation | Electron 90-test suite, Electron and Code TE2 typechecks/builds, Code TE2 220-test suite, targeted Python relay test, basedpyright, selected-tab context-menu regression, and embedded-grid structural checks | Source implementation passed automated validation; secondary app-shell readiness and Code TE2-owned in-grid placement replace the failed first live shape; live placement, restart, project-switch, retarget, and shared-edit acceptance remain open |
| 2026-08-18 | Electron second editor sizing correction | Source inspection identified wholesale app-container clearing as removal of the injected template CSS/font assets; both typechecks, targeted host tests, and the Electron 90-test suite passed after selective cleanup and persisted dock resizing | Reduced Monaco chrome retains canonical sizing; docked editor width is directly resizable without adding frontend presentation authority; live acceptance remains open |
| 2026-08-22 | Source/Git Electron bootstrap | Clean wheel content audit and isolated install, installed-wheel source build, cached fingerprint reuse, packaged Wayland launch, Electron typecheck plus 90 tests, 22 focused Python tests, and basedpyright | Passed; source installs can explicitly build/register Electron without embedding its 317 MiB runtime, while release archives remain prebuilt |
| 2026-08-22 | Mobile second editor and Cefrium IME planning | Inspected Electron's reduced secondary renderer and identity broker, mobile drawer/Problems duplication, Explorer card-menu lane, Android native identity bridges, UI IPC focus intent, and Cefrium page-evaluation seam | Approved Phase 3C uses a paired exact client in a retained bottom-drawer iframe; later Phase 3D uses event-driven native IME dismissal to release Monaco focus |
