# Desktop And Termux Debian Packaging Implementation Plan

Status: planning only. No phase in this document authorizes implementation,
dependency removal, package publication, version changes, or changes under
`android/`.

This plan covers four ordered outcomes:

0. prune and make the Python/external dependency boundary reproducible;
1. produce a Linux desktop Debian package containing Electron, a private Python
   runtime, a prebuilt Rust server, launchers, and a desktop entry;
2. produce a separate Termux Debian package that uses Termux's shared Python
   environment and preferred repository packages; and
3. replace the desktop shell's single target setting with saved remote server
   profiles and add an explicit launcher action for starting a packaged local
   framework.

The Linux and Termux artifacts intentionally have different runtime layouts.
Linux isolates Python dependencies in a package-owned virtual environment.
Termux uses its shared Python environment because several native Python
dependencies are better supplied by Termux repositories than rebuilt through
pip. Phase 2 must discover and validate those package mappings before a Termux
payload is designed.

The distribution work also recognizes four intentionally different install
modes. A source checkout and a Git/pip install may build and cache the Rust
server from source. A Linux desktop Debian package receives a prebuilt GNU/Linux
server and owns a private venv. A Termux Debian package receives a prebuilt
Bionic/Android server and installs TE2 into Termux's shared Python environment.
The Debian packages must never stage Cargo's intermediate build tree.

## 1. Source-backed starting point

### 1.1 Python dependencies are mostly live, but one dead router keeps an extra dependency

`pyproject.toml` obtains its runtime dependencies from `requirements.txt`.
Current source directly imports FastAPI, Starlette, Uvicorn, HTTPX, msgspec,
AnyIO, FastMCP, Framework-Shells, libarchive-c, python-socketio, and PyYAML.
They cannot be removed merely because the Rust server is the framework
authority: the Python runtime bridge and current app workers still use them.

The Phase 0 direct-dependency inventory currently resolves as follows:

| Requirement | Current owner |
|---|---|
| `fastapi` | Python runtime bridge and current app-worker routers |
| `starlette` | Direct request/response and ASGI helpers |
| `uvicorn` | Runtime bridge and generic app-worker ASGI servers |
| `httpx` | Current async HTTP clients and proxy/service calls |
| `msgspec` | Strict MessagePack runtime and app protocols |
| `anyio` | Current async/runtime helpers |
| `fastmcp` | Rust-proxied TE2 MCP sidecar |
| `framework-shells` | App/shell execution and process integration |
| `libarchive-c` | Active Archive Manager backend |
| `python-socketio[client,asyncio-client]` | Sync console client and async app/UI clients |
| `pyyaml` | Current shellspec/configuration parsing |
| `sse-starlette` | Unmounted legacy jobs HTTP/SSE router only |

Both python-socketio client extras remain intentional: the sync console path
uses `socketio.Client` with WebSocket transport, while app/runtime paths use
`AsyncClient`. Replacing `fastmcp` with `fastmcp-slim[server]` is not currently
expected to shrink the installed dependency graph materially because TE2 uses
the server surface.

`sse-starlette` is different. Its only source import is the unmounted
`app.libs.jobs.jobs_bp` HTTP/SSE router. The same module's `JobManager`, job
handlers, persistence, and cancellation primitives remain live through Archive
Manager and File Explorer. Phase 0 should remove the dead route layer while
retaining the live job core, allowing `sse-starlette` to leave the runtime
requirements without reviving `/api/jobs`. FastMCP's MCP dependency currently
retains `sse-starlette` transitively, so removing TE2's direct declaration
clarifies ownership but does not yet reduce the installed environment.

`uvicorn[standard]` is broader than the current runtime requires. TE2 needs
Uvicorn and an explicit WebSocket implementation, but Uvicorn can use its
portable asyncio/h11 path without the native `uvloop` and `httptools` extras.
Phase 0 should validate replacing it with `uvicorn` plus an explicit
`websockets` requirement. The remaining packages pulled by the `standard`
extra are already direct requirements or transitive requirements of FastMCP.

The current platform requirement lists also install Code Server globally:

- Ubuntu installs it through npm; and
- Termux installs it through TUR.

That conflicts with Code TE2's current managed-runtime contract. Code TE2
installs and resolves its pinned private Code Server only beneath
`$TE2_DATA_HOME/code_server`; a global package is neither required nor used.

The Framework-Shells requirement currently follows a mutable Git branch. A
reproducible package build must use an exact validated revision and must retain
an auditable mapping from every direct Python dependency to the source import
or runtime feature that needs it. The validated development and isolated-wheel
runtime reports Framework-Shells 0.0.63 from commit
`0bf3269cd69a000015b0ac484a04004b8dc564d1`.

### 1.2 The Electron build is an unpacked application directory, not a Debian package

`desktop_client/electron/package.mjs` currently runs `@electron/packager` for
Linux x64 and writes a `TE2Desktop` wrapper beside `TE2Desktop-bin`. It does not
produce Debian metadata, a `.desktop` entry, an icon installation, a Python
runtime, or a framework executable.

The active Rust bootstrap already accepts `--server-bin`, so a packaged install
does not need Cargo on the target system. The Rust server also exposes
`/api/health` with TE2 identity, version, instance id, bind addresses, and
framework URL. Those existing contracts should be reused by both the package
launcher and local-framework readiness flow.

The current unpacked Electron directory is about 317 MiB on disk. Its measured
xz stream is about 86.6 MiB, zstd is about 102.5 MiB, and gzip is about
120.3 MiB. The Electron executable itself is about 210 MiB unpacked.

The first isolated TE2 wheel is 85,830,112 bytes because it carries the complete
framework and built-in app asset payload. A self-contained desktop package that
embeds both that wheel and the Electron archive therefore starts near 170 MiB
before dependency wheels and the Rust server. The earlier 90--110 MiB estimate
was invalid. Package-size work must account for the TE2 asset payload explicitly
instead of treating the Python wheel as negligible.

### 1.3 Desktop Settings store one endpoint

Electron persists `DesktopShellSettings` in
`$TE2_CONFIG_HOME/desktop-shell.json`. The current schema contains one
`frameworkHost`, one `frameworkPort`, and `zoomLevel`. Saving a connection
already performs the important retarget transaction:

1. stop native Run Target listeners;
2. reconnect UI IPC;
3. clear Run Profile instrumentation;
4. retarget the stable browser relay; and
5. close the active app view.

Saved-target work must reuse that transaction. It must not create a second
relay or connection authority.

The local launcher is a frontend extension registry rooted in
`desktop_client/android_shell/extensions/`. That is the natural presentation
point for a local-framework action. The renderer cannot own process lifetime;
Electron main must expose a bounded native request surface and retain the child
process handle.

## 2. Distribution architecture

### 2.1 Common rules

- Package versions come from the synchronized TE2 framework version; the
  Python package, Rust server, Electron package, Debian metadata, release tag,
  and checksums must agree.
- Release assets are produced from one immutable synchronized tag. Moving
  branches and unpinned Git URLs are never package inputs.
- Build jobs may acquire locked source dependencies before staging. Cargo,
  Electron, npm, and wheel caches remain outside the package root.
- Build staging and final `.deb` files stay outside tracked source or under an
  ignored build-output root.
- Both builders enforce the existing 3 GiB free-space guard before Electron or
  Rust compilation begins.
- The packaged Rust binary is a release build and is passed to the existing
  bootstrap through `--server-bin`/`TE2_SERVER_BIN`; Cargo is not a target
  runtime dependency.
- User data never lives beneath the package prefix. The existing canonical
  `TE2_*_HOME`/XDG/Termux resolution remains the only writable-state contract.
- Managed Code Server is not bundled into either package. Its existing
  confirmation-gated private installer remains authoritative.
- Linux and Termux artifacts receive independent clean-install, upgrade,
  uninstall, and launch smoke tests.

The initial tagged release-asset matrix is:

```text
te2-<version>-py3-none-any.whl
te2-server-<version>-x86_64-unknown-linux-gnu
te2-server-<version>-aarch64-linux-android
TE2Desktop-<version>-linux-x64.tar.xz
SHA256SUMS
```

The exact names may be normalized when the release builder is implemented, but
the semantic matrix is fixed: one tagged Python payload, one GNU/Linux server,
one Bionic/Android server, one Electron payload, and checksums. Release binaries
belong in release assets, not committed into Git history. The
`aarch64-linux-android` server is initially a Termux package input; it does not
authorize embedding the framework server into an Android APK.

### 2.2 Install-mode contract

| Install mode | Python environment | Rust server | Electron |
|---|---|---|---|
| Editable/source checkout | Caller-owned environment | Built/reused through the canonical cache | Optional source build |
| Git/pip source install | Caller-owned environment or venv | Built/reused through the canonical cache | Not implied |
| Linux desktop `.deb` | Package-owned private venv | Tagged GNU/Linux release binary | Tagged bundled Linux x64 payload |
| Termux `.deb` | Shared Termux Python environment | Tagged Bionic/Android release binary | Not included |

Source and Git/pip installs continue to include Rust source because they must be
able to build the server. Debian package launchers always set the exact
`TE2_SERVER_BIN`/`--server-bin` path so the target machine never invokes Cargo.
The builder may retain incremental Cargo artifacts in its external cache, but
copies only the validated final `te2-server` executable into package staging.

The Linux Python-delivery detail remains a measured Phase 1 decision rather
than an accidental maintainer-script behavior:

1. **Thin network bootstrap:** `postinst` creates the private venv and installs
   an exact immutable Git tag. This minimizes the `.deb` payload but makes dpkg
   success depend on GitHub, DNS, TLS, Git, pip resolution, and mutable external
   package indexes.
2. **Self-contained package:** the `.deb` carries the tagged TE2
   wheel and locked dependency payload needed to construct or ship its private
   venv without network access. This is larger but deterministic, reinstallable
   offline, and suitable for atomic upgrade recovery.

Phase 1 must build and measure both prototypes before locking the final payload
shape. The measured wheel size makes the thin exact-tag bootstrap the current
size-oriented candidate, matching the intended small `.deb`; its networked
failure and recovery contract must be explicit rather than hidden in a generic
`postinst`. The self-contained form remains the offline/reproducible alternative.
In either prototype, the Python source revision must match the Debian version
and bundled Rust/Electron release assets exactly.

### 2.3 Linux desktop package

Initial target: Linux `amd64`, matching the current Electron x64 build.

Package name: `te2-desktop`.

Intended installed layout:

```text
/usr/bin/te2
/usr/bin/te2-desktop
/usr/lib/te2/desktop/...
/usr/lib/te2/libexec/te2-server
/usr/lib/te2/venv/...
/usr/share/applications/te2-desktop.desktop
/usr/share/icons/hicolor/<size>/apps/te2.png
```

The package build always stages:

- the release Rust server binary;
- the pruned Electron application directory; and
- Debian control/maintainer metadata.

The self-contained prototype additionally stages the exact TE2 wheel and locked
dependency payload. The thin prototype instead records the exact tagged Git
source and every target prerequisite. Both prototypes create or replace the
private venv atomically, validate the TE2 entry point, and leave the previously
valid runtime usable after failure. Removal cleans only package-owned runtime
files and never touches XDG/TE2 user state.

`/usr/bin/te2` invokes the private venv entry point and supplies the exact
prebuilt server path. `/usr/bin/te2-desktop` invokes the packaged Electron
launcher and supplies the exact `te2` executable to Electron main through a
`TE2_DESKTOP_*` environment contract.

The desktop entry launches `/usr/bin/te2-desktop`, has a stable application id,
uses the installed icon, and does not open a terminal. The existing intentional
Electron `--no-sandbox` launcher behavior remains unchanged unless a separately
approved sandboxing design replaces it.

### 2.4 Termux package

Initial target: Termux `aarch64`. The package is framework/CLI-only: it contains
no Electron payload and no desktop entry.

Package name: `te2`.

Intended installed layout, expressed relative to the active Termux `$PREFIX`:

```text
$PREFIX/bin/te2
$PREFIX/lib/te2/libexec/te2-server
$PREFIX/lib/pythonX.Y/site-packages/app/...
$PREFIX/lib/pythonX.Y/site-packages/te2-<version>.dist-info/...
```

Termux deliberately uses the shared Python environment. Phase 2 begins with a
device-native dependency matrix:

1. enumerate every direct and transitive Python requirement from the cleaned
   Phase 0 set;
2. query the current Termux repositories for preferred Python/native packages;
3. validate import names and versions from those packages;
4. identify only the packages that still require a TE2-built payload; and
5. prove that TE2-owned files do not collide with files owned by another Termux
   package.

Repository packages become Debian `Depends` entries and remain owned by their
Termux packages. Any missing Python package must be built on Termux for the
actual ABI and staged into the TE2 payload at package-build time so dpkg owns
the installed files. `postinst` must not run networked pip. If a dependency
cannot be packaged without overwriting another package's files, Phase 2 stops
for a new design decision instead of forcing pip into the shared prefix.

The Rust server is built for `aarch64-linux-android` in the release pipeline and
installed as a prebuilt Bionic-compatible binary. Native Termux build validation
remains required even if a cross-build is later automated. The package audit
rejects hard links, rejects paths outside `$PREFIX`, and checks all generated
shebangs and symlinks. Code Server remains the existing separate, user-approved
managed installation.

## 3. Phase 0 — dependency cleanup and reproducibility

### 3.1 Python runtime boundary

1. Generate a direct-import inventory for packaged Python source.
2. Record the runtime feature that owns each declared direct dependency.
3. Remove the unmounted `jobs_bp` routes while retaining `JobManager`, job
   handlers, persistence, cancellation, and Archive/File Explorer behavior.
4. Remove `sse-starlette` after tests prove no import or route remains.
5. Replace `uvicorn[standard]` with `uvicorn` plus explicit `websockets` after
   runtime-bridge and app-worker WebSocket validation.
6. Pin Framework-Shells to an exact validated revision.
7. Add a packaging lock/constraints input for deterministic Linux wheelhouse
   resolution without turning generated platform locks into the source of
   architectural truth.
8. Build a wheel and run imports, CLI help, runtime bridge, app-worker loading,
   archive-job, and terminal protocol smoke tests from an isolated environment.

### 3.2 External dependency boundary

1. Split build-only tools from target runtime tools.
2. Remove global Code Server installation from Ubuntu npm and Termux TUR lists.
3. Audit `node`, `npm`, compiler tools, libarchive, Git, dtach, aria2,
   watchexec, curl/wget, and OpenSSL against current subprocess/native-library
   use.
4. Retain optional app capability dependencies only when the shipped built-in
   app still exposes that capability; document the owner.
5. Produce separate Linux runtime/build and Termux runtime/build manifests that
   the package builders consume directly.

## 4. Phase 1 — Linux desktop `.deb`

1. Add a package staging layout and one deterministic Linux builder.
2. Map Electron `x64` to Debian `amd64` and fail unsupported architectures
   explicitly.
3. Produce the tagged TE2 wheel, GNU/Linux Rust server, and Electron release
   assets without copying build caches or intermediate trees into staging.
4. Prototype and measure both the exact-tag Git bootstrap and self-contained
   Python payload; record compressed size, install time, failure behavior, and
   offline reinstall behavior.
5. Select the Python-delivery mode explicitly; the thin exact-tag mode is the
   current size-oriented candidate and the self-contained mode is the offline
   alternative.
6. Add package-owned CLI/desktop wrappers, icon, `.desktop` entry, control file,
   and atomic private-venv handling.
7. Inspect the resulting package with `dpkg-deb --info` and `--contents`.
8. Install into a clean Debian/Ubuntu target, validate `te2 --help`,
   `/api/health`, desktop launch, app launch, asset install, and clean removal.
9. Validate an upgrade over the prior package without deleting TE2 user data.

## 5. Phase 2 — Termux `.deb`

1. Run the dependency-to-Termux-package investigation on a current Termux
   device before writing payload rules.
2. Freeze the accepted repository/package mapping in a machine-readable input.
3. Build any remaining Python payloads and validate the tagged
   `aarch64-linux-android` Rust server natively on Termux.
4. Stage TE2 into the shared Termux Python environment with dpkg ownership and
   no networked maintainer step.
5. Generate the Termux control metadata and `$PREFIX/bin/te2` wrapper.
6. Audit payload paths, ownership collisions, shebangs, symlinks, and hard
   links.
7. Install on a clean Termux target and validate imports, `te2 --help`, release
   server launch, `/api/health`, app-worker startup, terminal runtime bootstrap,
   managed Code Server opt-in, upgrade, and uninstall.

## 6. Phase 3 — settings profiles and local framework launch

### 6.1 Saved remote targets

Replace the singleton connection schema with a versioned settings record:

```text
version
activeTargetId
targets[] = { id, label, origin }
localFrameworkPort
zoomLevel
```

- `origin` is normalized through the existing HTTP/HTTPS validation and may
  represent a hostname, IPv4 address, or bracketed IPv6 address plus port.
- Credentials, paths, query strings, and fragments are rejected.
- Target ids are stable and independent from their labels.
- Duplicate normalized origins are rejected or merged deliberately.
- The current singleton host/port is imported once as the initial target when
  reading the pre-profile settings shape.
- Selecting a target invokes the existing `saveConnection` retarget
  transaction; profiles do not own relays or sockets.
- Settings provides add, rename/edit, select, and delete operations with a
  confirmation before deleting the active target.
- Tests cover malformed files, duplicate ids/origins, IPv4/IPv6/hostnames,
  current-settings migration, atomic writes, and retarget cleanup.

### 6.2 Launcher-owned local framework action

Add a launcher extension that renders local runtime state separately from the
remote app catalog. It is enabled only when Electron main reports a usable
packaged/runtime executable. Source development may provide an explicit tested
`TE2_DESKTOP_*` executable override; the browser renderer never guesses paths.

Electron main owns a `LocalFrameworkController` with these rules:

1. Start is always an explicit user action; there is no automatic local daemon.
2. The framework binds only to loopback and uses the configured local port.
3. If `/api/health` identifies an existing TE2 server on that port, the client
   may select it but does not claim ownership or stop it.
4. If the port is occupied by anything else, start fails with a concise error
   and does not silently choose a different endpoint.
5. A spawned framework uses the exact package launcher/prebuilt server and a
   bounded `/api/health` readiness check.
6. Only after readiness succeeds does Electron select the local target,
   retarget the existing relay/UI IPC path, and refresh launcher apps.
7. Electron retains the child handle and exposes starting, running, stopping,
   exited, and failed state to the launcher without renderer polling.
8. Stop and Electron shutdown send SIGTERM to only the owned bootstrap child,
   allow its existing Rust/FWS shutdown sequence to run, then use a bounded
   forced termination only for that child if required.
9. Switching back to a remote target does not kill an externally owned local
   framework. Behavior for an Electron-owned child is explicit in the UI and
   covered by tests.

The launcher presents Start/Stop/Use Local state and errors. Settings owns the
local port and saved remote targets. Neither surface becomes framework process
authority; that remains Electron main.

## 7. Validation and publication boundaries

Minimum automated validation by phase:

- Phase 0: Python tests, isolated-wheel import/CLI smoke, dependency inventory,
  and absence checks for the removed route/dependency/global Code Server lists.
- Phase 1: Electron typecheck/tests/build, Rust release build/tests, package
  metadata/content audit, clean Linux install/upgrade/remove smoke, desktop-file
  validation, and local server health.
- Phase 2: device-native dependency resolution, package ownership/path audit,
  clean Termux install/upgrade/remove smoke, framework/app-worker/terminal tests,
  and managed Code Server opt-in.
- Phase 3: target-store and process-controller unit tests, Electron
  typecheck/tests/build, source-mode local-runtime smoke, packaged desktop
  launch, target switching, owned shutdown, and external-server non-ownership.

Each phase is a separate implementation approval boundary. Package signing,
APT repository publication, automatic updates, Android distribution, HTTPS
certificate management, background system services, and non-amd64 Electron
packages are deferred unless separately approved.
