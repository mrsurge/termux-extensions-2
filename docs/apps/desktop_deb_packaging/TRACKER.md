# Desktop And Termux Debian Packaging Tracker

Last updated: 2026-08-17

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: dependency cleanup | First pruning slice implemented and validated; external runtime/build split remains | Remove only proven-dead dependencies/routes and approved stale platform installs |
| Phase 1: Linux desktop `.deb` | Planned; Python delivery prototype decision pending | Linux package implementation, local install testing, and publication are distinct actions |
| Phase 2: Termux `.deb` | Planned; dependency mapping required first | Device-native package investigation precedes payload implementation |
| Phase 3A: saved remote targets | Planned | Settings schema/UI/retarget implementation |
| Phase 3B: launcher local framework | Planned | Electron process controller and launcher capability implementation |

## Confirmed source findings

| Finding | Evidence | Status |
|---|---|---|
| Current Electron publication is an unpacked x64 directory | `desktop_client/electron/package.mjs` calls `@electron/packager` and writes a local wrapper only | Confirmed |
| No Debian packaging exists | No active control, maintainer, `.desktop`, or `dpkg-deb` source exists | Confirmed |
| The Python dependency list is mostly direct runtime surface | Packaged source directly imports FastAPI, Starlette, Uvicorn, HTTPX, msgspec, AnyIO, FastMCP, Framework-Shells, libarchive-c, socketio, and PyYAML | Confirmed |
| `sse-starlette` was held directly by an unmounted router | The dead `app.libs.jobs.jobs_bp` import/router was removed while the job core and handlers remain | Pruned; still transitive through MCP |
| Framework-Shells is reproducibly pinned | `requirements.txt` uses exact validated 0.0.63 commit `0bf3269cd69a000015b0ac484a04004b8dc564d1` | Complete |
| Global Code Server platform prerequisites were stale | Ubuntu npm and Termux TUR lists no longer install it; Code TE2 resolves only its private managed runtime | Pruned |
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

## Architecture decisions

- [x] Linux package is `te2-desktop` and initially targets Debian `amd64`.
- [x] Linux owns a private venv and a prebuilt release Rust server.
- [x] Linux installs `te2`, `te2-desktop`, a desktop entry, and an icon.
- [x] Termux package is separate, framework/CLI-only, and initially targets
  Termux `aarch64`.
- [x] Termux uses the shared Python environment, preferring Termux repository
  packages over locally rebuilt pip packages.
- [x] Termux dependency/package discovery is a hard gate before payload design.
- [x] Source/editable and Git/pip installs may build Rust through the canonical
  external cache; Debian packages never carry Cargo intermediates.
- [x] Every packaged component comes from one synchronized immutable tag.
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
- [x] A networked install must have explicit failure/recovery behavior and must
  not become an unexamined generic `postinst` side effect.
- [x] Neither package bundles managed Code Server.
- [x] The desktop settings model stores normalized remote endpoint profiles.
- [x] The existing relay/UI IPC retarget transaction remains connection
  authority.
- [x] Local framework launch is explicit, loopback-only, and Electron-main
  owned.
- [x] Electron stops only a framework child it spawned and retained.

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
- [ ] Define deterministic Linux wheelhouse constraints/lock input.
- [ ] Split external runtime dependencies from build-only dependencies.
- [x] Remove global Code Server from Ubuntu npm requirements.
- [x] Remove global Code Server from Termux TUR requirements.
- [ ] Audit Node/npm and native build tools against terminal runtime bootstrap.
- [ ] Audit libarchive, Git, dtach, aria2, watchexec, curl/wget, and OpenSSL
  against current built-in app behavior.
- [x] Build the TE2 wheel in isolation and record its 85,830,112-byte size.
- [x] Run CLI, runtime-bridge, app-worker, archive-job, and terminal protocol
  smoke tests from the isolated install.
- [ ] Update README/dependency documentation to distinguish source development,
  Linux runtime, Linux build, Termux runtime, and Termux build inputs.

## Phase 1 checklist — Linux desktop `.deb`

- [ ] Add ignored package staging/output roots.
- [ ] Add deterministic version and `x64` -> `amd64` mapping.
- [ ] Enforce the 3 GiB pre-build free-space check.
- [ ] Produce the tagged TE2 wheel, GNU/Linux Rust server, Electron archive,
  and checksums.
- [ ] Keep Cargo target/cache and Electron intermediate output outside package
  staging; copy only the validated final payloads.
- [ ] Prototype an exact immutable Git-tag private-venv bootstrap.
- [ ] Prototype a self-contained tagged-wheel/dependency private-venv payload.
- [ ] Measure compressed size, clean install time, offline reinstall, failure
  recovery, and upgrade behavior for both prototypes.
- [ ] Record and approve the final Linux Python-delivery mode.
- [ ] Add `/usr/bin/te2` and `/usr/bin/te2-desktop` wrappers.
- [ ] Add atomic private-venv install/upgrade handling for the selected payload
  mode.
- [ ] Add Debian control/removal scripts without user-state deletion.
- [ ] Add and validate the `.desktop` entry and installed icon.
- [ ] Inspect package metadata and payload paths with `dpkg-deb`.
- [ ] Clean-install on the accepted Linux baseline.
- [ ] Validate `te2 --help` and `/api/health` from the package.
- [ ] Validate desktop launch, app launch, assets, and normal shutdown.
- [ ] Upgrade from the prior package and preserve XDG/TE2 user state.
- [ ] Remove the package and prove only package-owned runtime files disappear.

## Phase 2 checklist — Termux `.deb`

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
- [ ] Reject paths outside `$PREFIX`, hard links, invalid symlinks, and invalid
  shebangs.
- [ ] Prove `postinst` performs no networked pip operation.
- [ ] Clean-install and validate imports, CLI, `/api/health`, and app workers.
- [ ] Validate Terminal's Node runtime bootstrap.
- [ ] Validate the separate managed Code Server opt-in flow.
- [ ] Validate upgrade and uninstall ownership behavior.

## Phase 3A checklist — saved remote targets

- [ ] Add typed versioned target-store contracts.
- [ ] Normalize origins through the existing HTTP/HTTPS rules.
- [ ] Support hostnames, IPv4, bracketed IPv6, and explicit ports.
- [ ] Reject credentials, paths, queries, fragments, duplicate ids, and
  duplicate normalized origins.
- [ ] Import the current singleton host/port once into the profile schema.
- [ ] Add atomic read/write and malformed-file recovery tests.
- [ ] Add target list, add/edit, select, and delete settings controls.
- [ ] Confirm before deleting the active target.
- [ ] Route selection through the existing `saveConnection` transaction.
- [ ] Validate relay, UI IPC, Run Target, app-view, and asset behavior after
  repeated local/remote target switches.

## Phase 3B checklist — local framework launcher

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
- [ ] Validate the complete flow from the installed `.desktop` entry.

## Deferred work

- [ ] Linux arm64 Electron package.
- [ ] Package signing and APT repository publication.
- [ ] Automatic package updates.
- [ ] Background/system service installation for a local framework.
- [ ] Android packaging or launcher changes.
- [ ] HTTPS/client-certificate management.
- [ ] Bundling managed Code Server.

## Acceptance log

| Date | Scope | Evidence | Result |
|---|---|---|---|
| 2026-08-15 | Planning investigation | Current requirements/imports, platform dependency lists, Python package/bootstrap, Rust health route, Electron packager/settings/retarget, and launcher extension registry inspected | Plan shape confirmed; implementation pending |
| 2026-08-17 | Packaging-shape refinement | Direct dependency ownership, Electron compression measurements, install-mode split, prebuilt GNU/Linux and Bionic server matrix, and Cargo staging boundary recorded | Release-asset architecture captured; Linux Python-delivery prototype remains an explicit decision gate |
| 2026-08-17 | Phase 0 first pruning slice | Dead jobs router removed; direct requirements tightened; Framework-Shells pinned; global Code Server prerequisites removed; isolated wheel/CLI/import/HTTP/WebSocket, 217 repository tests, and 31 framework tests passed | Validated; external runtime/build manifest split remains |
