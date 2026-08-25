# Unified Linux And Termux Release Installer Implementation Plan

Status: active phased implementation. This document records the approved
architecture; each implementation phase still requires its own explicit scope.
It does not authorize package publication, version changes, or changes under
`android/`.

This plan covers six ordered outcomes:

0. prune and make the Python/external dependency boundary reproducible;
1. integrate and validate the current `main` client/framework baseline without
   losing the packaging branch's completed dependency work;
2. finish the desktop connection/settings refinements and the remaining small
   client/frontend polish before freezing a package payload;
3. split shared editor-document authority from client-scoped foreground
   presentation while preserving shared drafts, writes, WBA documents, and
   projections;
4. produce a Linux platform wheel, one autodetecting release installer, and
   immutable target components for apt-based glibc Linux and Termux; and
5. validate the Termux target mode against its shared Python interpreter,
   preferred repository dependencies, Bionic server, and user-owned release
   layout.

Linux and Termux intentionally retain different runtime layouts behind one
installer authority. Linux isolates Python dependencies in a user-owned virtual
environment beneath the canonical TE2 data root. Termux uses its shared Python
interpreter and repository-supplied native dependencies, while TE2's own Python
payload remains versioned beneath the same canonical TE2 release root. Phase 5
must discover and validate those package mappings before the Termux target mode
is accepted.

The distribution work also recognizes four intentionally different install
modes. Source, editable, VCS, and sdist-built installs may build and cache the
Rust server from source. A supported PyPI platform wheel carries the validated
GNU/Linux server, while the unified Linux installer composes that wheel with a
separate Electron archive. The Termux archive carries the Bionic/Android
server. Linux owns a private venv; Termux reuses its shared interpreter without
a venv. Distribution payloads must never stage Cargo's intermediate build tree.

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
| `agent-log-server` | Code TE2 agent backend and ALS-RS runtime |
| `nodejs-wheel` (Linux x86-64) | Private-venv Node.js/npm runtime and Node headers for WBA, Terminal first use, and source Electron bootstrap |
| `libarchive-c` | Active Archive Manager backend |
| `python-socketio[client,asyncio-client]` | Sync console client and async app/UI clients |
| `pyyaml` | Current shellspec/configuration parsing |
| `sse-starlette` | Unmounted legacy jobs HTTP/SSE router only |

Both python-socketio client extras remain intentional: the sync console path
uses `socketio.Client` with WebSocket transport, while app/runtime paths use
`AsyncClient`. Replacing `fastmcp` with `fastmcp-slim[server]` is not currently
expected to shrink the installed dependency graph materially because TE2 uses
the server surface.

The unmounted `app.libs.jobs.jobs_bp` HTTP/SSE router and TE2's direct
`sse-starlette` declaration have been removed. The same module's `JobManager`,
job handlers, persistence, and cancellation primitives remain live through
Archive Manager and File Explorer. FastMCP's MCP dependency currently retains
`sse-starlette` transitively, so the cleanup clarifies ownership without yet
removing those installed bytes.

`uvicorn[standard]` was replaced by portable `uvicorn` plus explicit
`websockets`. Runtime-bridge and app-worker WebSocket validation passed without
the native `uvloop` or `httptools` extras.

Source inspection resolves the external dependency classes as follows:

| External tool/library | Current classification |
|---|---|
| Python 3.12+ | Core runtime |
| platform `libarchive` shared library | Archive Manager runtime |
| Node.js and npm | Standalone Terminal private first-use bootstrap, plus the explicit source/editable/Git Electron bootstrap; managed/binary-release desktop installs materialize prebuilt Electron |
| native compiler toolchain and Node headers | Target-specific support to validate for the standalone Terminal's first-use `node-pty` bootstrap |
| Rust and Cargo | Source/Git install framework build only; absent from prebuilt packages |
| Git CLI | Source acquisition only; framework Git is Rust/libgit2-owned and WBA excludes VS Code Git extensions |
| `aria2c` | Aria Downloader package decision: target package relation or packaged capability removal |
| `watchexec` | Code TE2 watcher package decision: target package relation or packaged capability removal |
| C/C++ compilers | User-project toolchain integration; not a TE2 user-installation script concern |
| `curl` or `wget` | Linux managed Code Server opt-in installer only |
| `dtach` | Retired; Code TE2 uses Framework-Shells' PTY backend |
| OpenSSL command-line tools, Termux `libev`, and Termux `c-ares` | No current TE2 execution-path owner |

The unified installer's target manifests own the exact validated dependency
mapping for Linux and Termux in Phases 4 and 5. Checked-in Code TE2, WBA, and
shared browser artifacts are already built or vendored. Managed and
binary-release desktop installs materialize a prebuilt Electron distribution.
Source/editable/Git Python installs may instead invoke the explicit Electron
source bootstrap recorded in Phase 4A.
npm therefore has exactly two installed-code owners: that opt-in source desktop
build and the standalone Terminal's locked private first-use runtime. Elsewhere
npm is source-regeneration tooling. A retained installed capability receives
its external executable through the selected target's prerequisite transaction;
otherwise that capability is removed from the installed product.

The installer must preserve the Terminal's existing per-user runtime authority
without adding another helper. On Linux x86-64, the release-owned private venv
installs exact `nodejs-wheel==24.16.0`, which supplies Node.js, npm, and the
matching Node headers without using the user's global Node installation. The
Termux target manifest still installs or validates its native Node.js/npm
package mapping. The existing packaged Python
`ensure_terminal_node_runtime()` path remains the sole installer, validator,
and repair authority for the Terminal's private modules. The first Terminal
launch installs them; later launches perform the existing cheap validation and
reuse or repair the runtime. The release installer never runs npm on the
Terminal runtime's behalf.

The durable runtime remains under
`$TE2_DATA_HOME/node_runtime/terminal/<fingerprint>`, normally
`~/.local/share/te2/node_runtime/terminal/<fingerprint>`. It is not a second
ad-hoc application root. The existing fingerprint continues to bind the
bootstrap revision, package metadata and lock, platform, architecture, Node
version, and Node module ABI. The existing cross-process lock, atomic staging,
`.te2-runtime.json` marker, required-package validation, and explicit
`TE2_TERMINAL_NODE_RUNTIME_DIR` override remain authoritative.

This is also the dependency-admission rule for the installed product: a
dependency must be installed into the Linux private venv, supplied by an
already-owned application bootstrap, or installed by the unified installer's
validated apt transaction for the selected target. If none of those authorities
owns it, the dependency and the unsupported capability that needs it are
removed instead of gaining another installer or helper script. Repository
scripts may construct the installer and release archives, but installed users
never invoke repository construction scripts for setup.

Code TE2 installs and resolves its pinned private Code Server only beneath
`$TE2_DATA_HOME/code_server`; a global package is neither required nor used.
The Termux path installs its exact package dependencies during the consented
installation. The Linux official standalone script retains its own downloader
prerequisite until that bootstrap is replaced.

Framework-Shells is pinned to an exact validated revision. A reproducible
package build must retain an auditable mapping from every direct Python
dependency to the source import or runtime feature that needs it. The validated
development and isolated-wheel runtime reports Framework-Shells 0.0.63 from commit
`0bf3269cd69a000015b0ac484a04004b8dc564d1`.

The Linux first-party wheel graph is also explicit. Framework-Shells 0.0.63 is
a native distribution, never a pure-Python publication wheel: it carries both
the PyO3 pipe pump and Rust terminal broker. The accepted Linux wheel set has a
`cp39-abi3` wheel for ordinary CPython and a separately tagged `cp314-cp314t`
wheel for free-threaded CPython. Agent Log Server 0.2.118 depends on that exact
Framework-Shells version and its Linux wheel carries a target/version/digest
verified `als-server`; source, VCS, editable, and sdist builds alone retain the
Cargo path. TE2 depends on both exact versions. A Termux/Android wheel is not
created by relabeling these manylinux artifacts: it requires a native Bionic
build and a tag actually advertised by the target interpreter.

### 1.2 The Electron build is an unpacked application directory, not a complete installer

`desktop_client/electron/package.mjs` currently runs `@electron/packager` for
Linux x64 and writes a `TE2Desktop` wrapper beside `TE2Desktop-bin`. It does not
produce a user installation transaction, a `.desktop` entry, an icon
installation, a Python runtime, or a framework executable.

The active Rust bootstrap already accepts `--server-bin`, so an installed release
does not need Cargo on the target system. The Rust server also exposes
`/api/health` with TE2 identity, version, instance id, bind addresses, and
framework URL. Those existing contracts should be reused by both the installed
launcher and local-framework readiness flow.

The current unpacked Electron directory is about 317 MiB on disk. Its measured
xz stream is about 86.6 MiB, zstd is about 102.5 MiB, and gzip is about
120.3 MiB. The Electron executable itself is about 210 MiB unpacked.

The current clean staged TE2 source wheel is 42,056,350 bytes and carries the
complete framework and built-in app asset payload without a Rust server. An
85-MiB candidate produced from the development working directory was rejected
after its content audit found local bytecode/profiler contamination; release
construction must always run from clean isolated staging. A managed desktop
install additionally acquires the native Framework-Shells and Agent Log Server
wheels, the Node runtime wheel, the TE2 platform-wheel server, and the Electron
archive. Package-size work must therefore account for every component instead
of treating the Python wheel or private Node runtime as negligible.

### 1.3 Desktop Settings separate connection and local launch policy

Electron persists `DesktopShellSettings` schema v1 in
`$TE2_CONFIG_HOME/desktop-shell.json`. It contains one active
`frameworkHost`/`frameworkPort`, up to 16 named framework bookmarks, and
`zoomLevel`, but no local-process configuration. Saving a connection performs
the important retarget transaction:

1. stop native Run Target listeners;
2. reconnect UI IPC;
3. clear Run Profile instrumentation;
4. retarget the stable browser relay; and
5. close the active app view.

Saved-target work must reuse that transaction. It must not create a second
relay or connection authority.

Local launch policy is a separate versioned
`$TE2_CONFIG_HOME/desktop-local-framework.json` record:

```json
{
  "version": 1,
  "command": "/absolute/path/to/te2",
  "venvPath": "/absolute/path/to/venv",
  "broadcast": [],
  "port": 8089,
  "env": {}
}
```

The file is absent on an unmanaged source install. Electron projects unsaved
defaults and resolves `te2` from PATH in main-process code only; the renderer
never executes a shell substitution. Saving Settings creates the record, while
the Linux installer writes the same contract with its exact private-venv and
command paths. The source-only absolute `TE2_DESKTOP_TE2_EXECUTABLE` override
has highest precedence, then the saved command, then unsaved PATH detection.
An empty broadcast array is loopback-only; a non-empty array maps to the
existing multi-selector `--broadcast` CLI contract.

The local launcher is a frontend extension registry rooted in
`desktop_client/android_shell/extensions/`. That is the natural presentation
point for a local-framework action. The renderer cannot own process lifetime;
Electron main must expose a bounded native request surface and retain the child
process handle.

Current remote `main` also supplies a useful Android-owned bookmark contract.
It stores at most 16 named host/port pairs in application-private preferences,
validates bookmark names and framework endpoints natively, and exposes bounded
get/upsert/delete routes to the local Settings page. Choosing a bookmark fills
the current host/port fields; it does not retarget the client until the user
presses Save. The active endpoint and the bookmark collection therefore remain
separate authorities.

Desktop bookmarks should mirror that behavior rather than replacing the active
connection with a second target-selection state machine. Electron main remains
the only desktop persistence and retarget authority. The local Settings page is
only a projection and intent surface.

### 1.4 `main` now changes the same seams needed by the client work

At the 2026-08-17 investigation point, this branch was one packaging commit
ahead of its old base and nine commits behind remote `main` at `f00ba916`.
Those commits include the Android framework bookmark implementation, Run
Profile/native-client fixes, and `3a1e542a`'s boot-snapshot, open-flow, UI IPC,
editor-state, WBA, and framework projection changes.

The client-scoped active-document work necessarily touches those same open and
projection paths. Implementing it on the older branch and merging afterward
would create avoidable semantic conflicts and risk restoring Run Profile bugs.
The remaining independent dependency cleanup may finish first, but the full
approved `main` integration and baseline validation is a hard gate before
desktop/client/editor source changes.

### 1.5 Pre-Phase 3 active-file authority was global while membership was shared

The pre-Phase 3 sidecar contract stored one project-wide `last_file`, one
`open_state_revision`, and a shared `recent_files` list. An editor open recorded
that file as the shared last file and broadcast `editor:open` to the global
`code_te2` room, so one client's open forced every connected editor to converge
on the same model. Boot restored `serverState.currentPath`/`lastFile`; file tabs
and Explorer active highlighting also derived their foreground from that shared
open-state projection.

Several prerequisites for separating foreground state already exist:

- every main page resolves a stable `clientInstanceId` and a reload-stable
  `windowId`;
- file-tab order is already client-local presentation state;
- drafts and mirror events are keyed by file path, and receivers already ignore
  mirror/cache events for a different active path;
- the WBA document registry retains one shared set of active/background logical
  documents without closing a document merely because it leaves Monaco's
  foreground; and
- editor open-complete requests already carry request identity and source
  connection metadata.

The identified lock was therefore not the document/draft set itself. It was the
single global foreground path, global open notification room, global Explorer
active-file projection, and WBA's one synthetic active-editor facade.

Phase 3 replaces those foreground paths with bounded stable-client projections
while retaining shared membership, drafts, writes, and one WBA logical-document
registry. Legacy `last_file` now exists only as a one-time migration seed.

## 2. Distribution architecture

### 2.1 Common rules

- Package versions come from the synchronized TE2 framework version; the
  installer manifest, Python package, Rust server, Electron package, Android
  APKs, release tag, artifact names, and checksums must agree.
- Release assets are produced from one immutable synchronized tag. Moving
  branches and unpinned Git URLs are never package inputs.
- Build jobs may acquire locked source dependencies before staging. Cargo,
  Electron, npm, and wheel caches remain outside the package root.
- Build staging and final release artifacts stay outside tracked source or under
  an ignored build-output root.
- Release builders enforce the existing 3 GiB free-space guard before Electron
  or Rust compilation begins.
- A supported release platform wheel contains the validated Rust release
  server as package data plus an explicit release manifest. The bootstrap
  resolves that binary as release provenance equivalent to an explicit
  `--server-bin`/`TE2_SERVER_BIN`; Cargo is not a release-wheel runtime
  dependency.
- User data never lives beneath the package prefix. The existing canonical
  `TE2_*_HOME`/XDG/Termux resolution remains the only writable-state contract.
- Managed Code Server is not bundled into any release component. Its existing
  confirmation-gated private installer remains authoritative.
- One installer owns detection, prerequisite installation, component acquisition,
  verification, staging, receipts, activation, upgrades, and removal. Target
  adapters may differ only where the platform runtime layout requires it.
- Detection checks Termux before generic Linux. The initial generic Linux target
  requires Linux, glibc, `apt-get`, and a supported architecture. Musl systems,
  unsupported package managers, and unknown architectures fail explicitly.
- Linux and Termux modes receive independent clean-install, upgrade, uninstall,
  and launch smoke tests.

The initial tagged release matrix is split between PyPI and the matching GitHub
Release. Exact wheel tags are release-test outputs, not names guessed from the
build host:

```text
PyPI / TestPyPI
  te2-<version>-py3-none-<validated-linux-x86_64-tag>.whl
  te2-<version>.tar.gz

GitHub Release
  install-te2
  release-manifest.json
  te2-<version>-py3-none-<validated-linux-x86_64-tag>.whl
  te2-desktop-<version>-linux-x86_64.tar.gz
  te2-<version>-termux-aarch64.tar.gz
  te2-<version>-gecko-release.apk
  te2-<version>-cefrium-release.apk
  SHA256SUMS
```

The Linux wheel published to PyPI and mirrored byte-for-byte on GitHub contains
the Python/framework payload, validated GNU/Linux Rust server, and embedded
release manifest. Electron remains a separate pruned archive so `pip install
te2` does not acquire Chromium unless desktop installation is requested. The
Termux archive contains the release-owned Python inputs and Bionic server but no
Electron payload. The APKs contain their own synchronized frontend assets; the
Bionic server remains a Termux input and is not embedded in either APK.

Tar with gzip remains the format for directory-shaped Electron and Termux
payloads because it preserves executable modes and symlinks without another
decompressor prerequisite. ZIP is not a release format. The installer supports
three deterministic component-acquisition paths in this order: an explicit
local release-component directory, a complete matching component set adjacent
to the installer, or immutable release downloads selected by
`release-manifest.json`. PyPI is the canonical package index for the Linux
wheel; the GitHub mirror makes checksummed offline and installer composition
possible. Local and downloaded components use identical checksum and embedded
manifest validation. Offline installation assumes OS/Termux prerequisites are
already available; it does not promise an offline apt repository.

### 2.2 Install-mode contract

| Install mode | Python environment | Rust server | Electron |
|---|---|---|---|
| Editable/source/VCS/source-distribution install | Caller-owned environment | Built/reused through the canonical cache | Optional source build |
| PyPI platform wheel: glibc Linux | Caller-owned environment or venv | Wheel-owned validated GNU/Linux release binary | Downloaded only by explicit desktop materialization |
| Unified installer: glibc Linux | Release-owned private venv under the canonical TE2 data root | Exact platform-wheel binary | GitHub Release Linux x64 payload |
| Unified installer: Termux | Shared Termux interpreter and repository dependencies; release-owned TE2 Python tree | Archive-owned Bionic/Android release binary | Not included |

Source, editable, VCS, and sdist-built installations retain Rust source and may
build the server through the existing fingerprinted cache. A platform release
wheel is different: its explicit manifest marks binary-release provenance and
names the packaged server path, target, version, and digest. It must never
silently fall back to Cargo. A missing, corrupt, or target-incompatible release
binary is repaired only from the exact immutable version and verified digest,
or the launch fails with an actionable repair command.

Provenance is artifact-authored, not inferred from a path containing
`site-packages`. Each built distribution records whether it is a source-build
input or a platform release, along with the release identity and target.
PEP 610 `direct_url.json` may refine editable/VCS diagnostics, but it is never
the primary behavior switch.

The Python-delivery decision is closed: the unified Linux installer installs
the exact platform wheel into its private venv; it does not clone Git or compile
Rust. Termux uses its shared interpreter and repository-native dependencies but
installs TE2's own Python files into the versioned release tree rather than
relying on a moving checkout. Python source identity must match the manifest,
Rust server, Electron payload, APKs, and synchronized release version exactly.

### 2.3 Linux desktop user installation

Initial target: Linux `amd64`, matching the current Electron x64 build.

Install identity: `te2-desktop`.

The application payload is user-owned and versioned beneath the already
canonical TE2 data root. The exact leaf naming is finalized during
implementation, but the ownership shape is fixed:

```text
$TE2_DATA_HOME/install/releases/<version>/venv/...
$TE2_DATA_HOME/install/releases/<version>/desktop/...
$TE2_DATA_HOME/install/current -> releases/<version>
$HOME/.local/bin/te2
$HOME/.local/bin/te2-desktop
$XDG_DATA_HOME/applications/te2-desktop.desktop
$XDG_DATA_HOME/icons/hicolor/<size>/apps/te2.png
```

The release builder always produces:

- the Linux platform wheel containing the release Rust server;
- the pruned Electron application directory; and
- the version-matched manifest, XDG inputs, and checksums.

The installer stages a complete version from the verified wheel and Electron
archive, constructs and validates the private venv, validates the CLI, packaged
Rust server, and Electron launcher, then switches the `current` pointer
atomically. A failed update leaves the prior release usable. A versioned install
receipt owns only installed application payloads; uninstall never deletes
ordinary TE2 configuration, projects, or app state.

The small user-local wrappers invoke the current private venv; the bootstrap
resolves the exact wheel-owned prebuilt server from its manifest. Installation
writes the versioned desktop local-framework record with
the current release's exact `te2` command and private venv. The environment
override remains only a higher-priority source/test seam.

The desktop entry launches the user-local `te2-desktop` wrapper, has a stable
application id, uses the user-local installed icon, and does not open a
terminal. The existing intentional Electron `--no-sandbox` launcher behavior
remains unchanged unless a separately approved sandboxing design replaces it.

The installer runs application-file operations as the user. Its Linux target
adapter may use a narrow, explicit privileged apt step for system requirements
that are impractical to vendor, such as platform Python/venv support, the native
compiler prerequisites needed by first-use `node-pty`, SSL runtime, or the
`libarchive` shared library. Linux Node.js/npm and Node headers come from the
exact private-venv `nodejs-wheel`, not apt. Apt never owns the TE2 application
payload. All TE2 Python/bootstrap, Rust, Node, and Electron files remain in the
user installation root.

Repository construction scripts may build the public installer and its release
archives. Repository scripts themselves are not copied into the installed
application. A user sees the repository `scripts/` directory only in a cloned
or editable source checkout.

A raw supported-platform `pip install te2` is intentionally smaller than the
managed desktop installation. It can launch the framework immediately from the
wheel-owned Rust server. `te2 desktop install` then reads the wheel's release
manifest, downloads and verifies the exact matching Electron archive, publishes
it under the existing desktop runtime root, and installs the user-local XDG
integration. Source/editable/VCS installs retain the existing source-build
behavior. A binary-release install never substitutes a source build for a
missing Electron or server asset.

### 2.4 Termux target mode

Initial target: Termux `aarch64`. This mode is framework/CLI-only: its archive
contains no Electron payload and installs no desktop entry.

Termux deliberately uses the active `$PREFIX/bin/python` interpreter rather
than a venv. The unified installer still keeps TE2's own versioned application
payload and server under the canonical TE2 data root:

```text
$TE2_DATA_HOME/install/releases/<version>/python/...
$TE2_DATA_HOME/install/releases/<version>/libexec/te2-server
$TE2_DATA_HOME/install/releases/<version>/manifest.json
$TE2_DATA_HOME/install/current -> releases/<version>
$PREFIX/bin/te2
```

The wrapper resolves the current release's exact Python tree and Bionic server.
Termux apt owns the shared interpreter and validated native/runtime foundations;
it does not own TE2 application files. The absence of a venv does not mean that
arbitrary packages already installed by pip become release dependencies. The
accepted ownership split is:

| Dependency class | Owner | Installation rule |
|---|---|---|
| Python, pip, Node/npm, shared libraries, and accepted native Python packages | Termux apt | Install or validate through the target manifest; never duplicate them in a venv |
| TE2, Framework-Shells, Agent Log Server, and every Python dependency without an accepted apt owner | Versioned Termux release tree | Materialize only from the checksummed release archive/wheelhouse beneath `releases/<version>/python` |
| Existing user-installed pip packages outside the release tree | User | Never treat them as satisfying the release manifest and never remove or upgrade them |
| Compilers and build tools | Termux apt, only when an owned first-use path requires them | They may support the existing Terminal `node-pty` bootstrap, but package installation never silently falls back to CMake, Cargo, Clang, or an sdist build |

This hybrid uses the active Termux interpreter without copying it, shares only
apt-owned packages, and keeps the otherwise necessary Python payload isolated
by release. The `$PREFIX/bin/te2` wrapper prepends the current release's Python
tree while retaining the interpreter's ordinary apt-owned `site-packages`.
There is no `VIRTUAL_ENV`, duplicated interpreter, or release-time dependence
on mutable user pip state.

Phase 5 begins with a machine-readable dependency matrix. Each row records:

```text
distribution name and accepted version/range
direct or transitive TE2 owner
pure-Python or native payload
import names and import smoke
official/TUR apt package, repository, architecture, and version when accepted
release-wheel filename, tag, source identity, and digest otherwise
runtime shared-library requirements
whether build tools are runtime, first-use, or release-builder only
install, upgrade, and uninstall owner
```

The initial 2026-08-25 device audit found Python 3.14.6 reporting
`sys.platform == "android"` and `aarch64` on both connected Termux devices.
Consequently the Linux-only `nodejs-wheel` marker is false; Termux obtains Node
from `nodejs`/`nodejs-lts`. The official/TUR apt views exposed Node,
`libarchive`, and `python-cryptography`, but did not expose apt packages for the
current direct FastAPI/Starlette/Uvicorn/HTTPX/msgspec/AnyIO/FastMCP/
Framework-Shells/Agent Log Server/libarchive-c/Socket.IO/PyYAML set or for
Pydantic/Pydantic Core. Personal third-party repositories are observations,
not accepted installer inputs unless separately approved.

The same devices already demonstrate viable Android wheel tags for native
inputs including Framework-Shells, `aiohttp`, `msgspec`, Pydantic Core, PyYAML,
`rpds-py`, and cryptography. Those installed artifacts are compatibility
evidence, not publication provenance: final wheels must be reproducibly rebuilt
from the synchronized source/dependency identities and audited before entering
the release wheelhouse.

The Termux installer transaction is therefore:

1. detect Termux before Linux and capture prefix, architecture, Python version,
   `sys.platform`, compatible tags, and configured repository identities;
2. load the checksummed target manifest and reject an unsupported Python
   minor, ABI, architecture, or repository requirement before mutation;
3. present the exact apt transaction, install it directly without `sudo`, and
   record the installed apt versions without claiming ownership of those files;
4. validate every accepted apt import, executable, version constraint, and
   required shared library;
5. acquire and verify the complete immutable Termux archive and local
   wheelhouse before altering the current release;
6. materialize TE2 and non-apt Python inputs into the staged versioned Python
   tree using only local compatible wheels (`--no-index`, `--only-binary=:all:`)
   or an equivalent deterministic wheel unpack; sdists and network fallback are
   forbidden;
7. validate native tags, ELF/Bionic linkage, imports, CLI selection, the
   packaged server, and Terminal prerequisites from the staged release;
8. atomically switch `current` and write a receipt separating release-owned
   paths, external apt prerequisites, source identities, tags, and digests; and
9. on uninstall, remove only receipt-owned TE2 release paths and an unchanged
   wrapper. Never remove apt packages or unrelated shared Python content.

If a dependency cannot be supplied by the accepted apt mapping or immutable
wheelhouse without overwriting shared-prefix files, Phase 5 stops for a new
design decision. A Termux Python minor/ABI change also invalidates native wheel
selection and requires a matching release before activation; the wrapper must
fail clearly rather than import an old native tree.

The Rust server is built for `aarch64-linux-android` in the release pipeline and
installed as a prebuilt Bionic-compatible binary. Native Termux validation
remains required even if a cross-build is later automated. The installer audit
rejects hard links, paths outside the declared release root or wrapper path,
invalid shebangs, and invalid symlinks. Code Server remains the existing
separate, user-approved managed installation.

Termux Python-wheel selection is an evidence gate. The release pipeline must
inspect the target interpreter's actual compatible tags and prove that pip can
select and execute a Bionic-compatible artifact. It must not label a Termux
artifact as manylinux or assume that a PyPI platform tag will be selected. If
the target pip does not advertise an appropriate Android/Termux tag, the
checksummed Termux archive remains the supported delivery vehicle for the exact
Python payload and Bionic server.

Testing has two separate authorities. The remote Debian acceptance host may run
the current `termux/termux-docker:x86_64` image to exercise clean repository
setup, target detection, apt planning, local-wheel enforcement, receipts,
upgrade, rollback, and uninstall. That container is not AArch64/Bionic release
acceptance. The supplied AArch64 image cannot run natively on the x86-64 host
without a separately approved QEMU/binfmt setup. Final native acceptance runs
on a physical AArch64 Termux device and covers compatible tags, ELF linkage,
imports, Framework-Shells, Agent Log Server, Rust framework health, app workers,
Terminal `node-pty`, managed Code Server opt-in, and background/relaunch use.

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
7. Keep `requirements.txt` as the audited direct-runtime input. Generate the
   platform-specific transitive lock only after Phase 4 selects the Linux
   Python-delivery mode and baseline interpreter.
8. Build a wheel and run imports, CLI help, runtime bridge, app-worker loading,
   archive-job, and terminal protocol smoke tests from an isolated environment.

### 3.2 External dependency boundary

1. Audit `node`, `npm`, compiler tools, libarchive, Git, dtach, aria2,
   watchexec, curl/wget, OpenSSL, and the old Termux native packages against
   current subprocess/native-library use.
2. Keep dependency installation owned by the Linux private-venv transaction,
   the unified installer's target prerequisite manifest, or an existing app
   bootstrap; remove unowned dependencies and capabilities.
3. Document the source/core-runtime/build-only/optional split in the supported
   README without presenting it as the finalized installer dependency manifest.
4. Let the unified release builder own separate exact Linux and Termux target
   manifests after their clean-target investigations in Phases 4 and 5.
5. Allow repository scripts to construct development artifacts, the public
   installer, and release archives, but never expose repository scripts as
   installed-user setup paths.

## 4. Phase 1 — integrate and validate the current `main` baseline

This phase is a deliberate merge gate, not permission to merge as part of a
planning or dependency-cleanup slice.

1. Finish, validate, and commit the Phase 0 dependency-boundary cleanup.
2. Fetch the then-current remote `main`, record both heads, inspect the complete
   delta, and confirm the integration target with the user.
3. Merge `main` into this feature branch without rebasing or rewriting the
   already-published packaging commit.
4. Resolve overlap by preserving both the dependency-pruning decisions and the
   newer client/framework/editor contracts; never resolve generated assets in
   favor of stale source.
5. Validate the merged framework, Code TE2 frontend, Electron client, and the
   Android tests/builds affected by the imported commits before beginning new
   client behavior.
6. Record the accepted merge commit and validation evidence in the tracker.

No desktop bookmark, local-framework, active-document, or package source work
starts on the older pre-integration baseline.

## 5. Phase 2 — desktop connection and frontend refinements

### 5.1 Named framework bookmarks

Extend the desktop-owned settings record without replacing its active endpoint:

```text
version
frameworkHost
frameworkPort
frameworkBookmarks[] = { name, frameworkHost, frameworkPort }
zoomLevel
```

- Electron main owns bookmark validation and atomic persistence beneath the
  existing desktop configuration root.
- Match Android's bounded contract: at most 16 entries, trimmed names up to 64
  characters, case-insensitive name identity, and validated host/port values.
- Upserting an existing name edits that bookmark in place. Removing a bookmark
  never changes the active connection because bookmarks are not connection
  authority.
- Choosing a bookmark fills the editable host/port controls and requires the
  existing Save action before any retarget occurs.
- Save continues through the existing `saveConnection` transaction, including
  Run Target listener cleanup, UI IPC reconnect, instrumentation cleanup, relay
  retarget, and app-view close.
- The Settings renderer receives only bounded get/upsert/delete results; it
  does not write configuration files directly.
- Tests cover malformed stored entries, limit enforcement, case-insensitive
  upsert/delete, host/IPv4/IPv6 validation, atomic writes, and repeated bookmark
  load plus Save retargets.

### 5.2 Launcher-owned local framework action

Add a launcher extension that renders local runtime state separately from the
remote app catalog. Start is enabled only when Electron main resolves a usable
command from the source override, saved local-launch record, or unsaved PATH
detection. An already-running external TE2 on the configured local port may
still be selected without claiming ownership. The browser renderer never
searches PATH, executes shell substitutions, or guesses paths.

Electron main owns a `LocalFrameworkController` with these rules:

1. Start is always an explicit user action; there is no automatic local daemon.
2. The framework always retains loopback access and uses the configured local
   port. It is exposed beyond loopback only through explicit validated
   `broadcast[]` selectors.
3. If `/api/health` identifies an existing TE2 server on that port, the client
   may select it but does not claim ownership or stop it.
4. If the port is occupied by anything else, start fails with a concise error
   and does not silently choose a different endpoint.
5. A spawned framework uses the exact resolved command, optional validated
   venv activation, bounded environment overrides, explicit broadcast
   selectors, and `--stdio-control`. The installed `te2` entry continues through
   `app.cli.run_rust_framework` into `framework/bootstrap/bootstrap.py`, so the
   controller does not create a second framework launch architecture.
6. Only after readiness succeeds does Electron select the local target,
   retarget the existing relay/UI IPC path, and refresh launcher apps.
7. Electron retains the child handle and exposes starting, running, stopping,
   exited, and failed state to the launcher without renderer polling.
8. Stop first sends the allowlisted versioned `shutdown` request through the
   bootstrap control channel. Electron shutdown sends the same request and
   closes stdin; stdin EOF is an ownership-loss shutdown signal. If graceful
   shutdown does not finish within the bound, Electron signals only the owned
   process group with SIGTERM and then SIGKILL.
9. Switching back to a remote target does not kill an externally owned local
   framework. Behavior for an Electron-owned child is explicit in the UI and
   covered by tests.

The launcher presents Start/Stop/Use Local state, the detected command source,
venv readiness/load status, broadcast exposure, and errors. Settings owns the
separate versioned launch record and the connection bookmarks. Neither surface
becomes framework process authority; that remains Electron main.

The source-mode controller and UI can be validated before distribution work.
Phase 4 later wires the user-installed executable path and performs installed
acceptance.

The stdio control plane is intentionally narrow and independent from TE2's TCP
data plane:

- Electron captures the bootstrap's unchanged stdout and stderr and forwards
  them to the desktop launcher's stdio streams.
- stdin accepts newline-delimited JSON requests with protocol `version: 1`.
- inherited file descriptor 3 emits newline-delimited hello, response, and
  lifecycle event records.
- protocol v1 allows only `shutdown`; arbitrary command or shell execution is
  rejected. New control methods can be added later only as explicit allowlisted
  protocol revisions.
- HTTP, Socket.IO, WebSocket, SSE, app proxying, and worker IPC remain on their
  existing transports. The control channel is not a second framework API.

### 5.3 Remaining small desktop/frontend changes

Keep one explicit intake checkpoint for the remaining user-identified client
and frontend polish. Each item must be named and approved before source edits;
this placeholder does not authorize unspecified cleanup or Android changes.
Every accepted tweak receives its own bounded test/build/live-validation row in
the tracker. Complete this intake before the package payload is frozen so the
desktop archive is not knowingly built from a transient UI state.

## 6. Phase 3 — client-scoped foreground editor presentation

### 6.1 Authority split

Keep these facts shared for the one active project/runtime:

- admitted/open document membership;
- project-scoped draft content and draft decorations;
- disk content, writes, save conflict checks, Git state, and diagnostics;
- WBA logical documents, extension activation, and language-provider state;
- project switch and document admission/close authority.

Make these facts client presentation state:

- the foreground/active path;
- tab order, which is already local;
- cursor, selection, scroll, and focus metadata for that client's active
  editor; and
- live host/window routing identity.

The first implementation slice changes foreground ownership only. Shared
document close/membership semantics remain explicit and global. Client-local
tab hiding is a later optional refinement and must not be smuggled into a close
button change.

### 6.2 Identity, persistence, and boot

- `clientInstanceId` is the stable installation/profile identity already
  supplied by Browser, Electron, GeckoView, and Cefrium.
- `windowId` distinguishes simultaneous/reloaded main-page presentations for
  observability and presentation plumbing only. It is not another foreground
  authority in this first slice.
- Live editor routing uses the stable `clientInstanceId`. A bounded backend
  projection keyed by project and stable client identity retains the last
  client-declared active path for cold reconnect.
- The client owns the choice. Backend storage is a reconnect projection, not a
  cross-client active-file authority.
- On first migration only, a client without a projection may seed from the
  legacy project `last_file`. Ordinary opens then stop writing/reading
  `last_file` as the global foreground lock.
- Boot returns shared membership and a separate validated client foreground.
  If that path left membership or the project, the client chooses a
  deterministic shared-member fallback without changing other clients.
- Records are bounded by stable client identity so arbitrary identities cannot
  grow durable state indefinitely.

Browser, Electron, GeckoView, and Cefrium use this same contract through the
shared Code TE2 frontend. An Electron process may own several windows without
silently creating several editor authorities: those windows share the one
Electron client foreground until a later explicit multi-window interface offers
an action such as `Open in new window as new client`. That future action must
allocate and persist a distinct client identity deliberately; it must not infer
independent editor state from `windowId`.

### 6.3 Client rooms and projections

1. Editor, Explorer, and relevant UI IPC connections authenticate the resolved
   client/window identity and join an exact presentation room.
2. `editor.open` validates/adjoins shared document membership, records only the
   source client's foreground, and sends the materialized open payload only to
   that presentation room.
3. Shared membership, draft, Git, diagnostic, and decoration changes remain
   shared broadcasts.
4. Active file, open completion, jump/focus, Explorer highlight, toolbar state,
   and active-file Run intent are exact-client projections.
5. File tabs derive membership from shared state and the active class from
   client state. A remote client's open must never scroll or activate another
   client's tab strip.
6. Reconnect publishes one fresh client snapshot; there is no active-file
   polling and no replay of disconnected foreground intent.

### 6.4 WBA and extension-host semantics

WBA keeps one shared document registry and one extension host for the project;
it does not open/close duplicate extension documents per client. It adds
client-keyed synthetic editor facades for selection, visibility, and command
context.

Code OSS still exposes one `activeTextEditor` per extension-host window. TE2
therefore projects the request- or command-originating client's facade as that
singular active editor under a reentrant client-context fence immediately before
focus/command-sensitive work.
Document-scoped language requests continue to address the exact URI and must
not depend on that global pointer. Commands, menus, mentions, diffs, and
extension navigation carry the originating client identity so their result
returns to the correct presentation.

The direct WBA Socket.IO server authenticates the stable client identity and
injects it into request parameters. Every normalized `vscode.openFile` request
must retain that `clientInstanceId` and metadata-only `windowId` through the
dispatcher into the client-keyed editor facade. Dropping them prevents the WBA
open acknowledgement and therefore blocks hover and semantic-token requests,
while shared extension-host diagnostic pushes can misleadingly continue to
work.

This preserves one extension-host/project runtime while being honest about the
single-window Code OSS contract. A separate extension host per client is not
the initial design and would require a later explicit resource/lifecycle
decision.

### 6.5 Draft, write, and conflict behavior

Draft authority remains path-scoped and shared. Existing mirror/cache
notifications continue to reach all clients, while only clients currently
showing that path apply the content to Monaco. Monotonic path/document revision
fencing prevents stale delayed projections from overwriting a newer shared
draft or post-save clean state.

The implemented fence uses one durable project-wide monotonic watermark plus a
bounded 256-entry path-to-revision map in `ProjectSidecar`. Every authoritative
draft, clean/save, discard, external-change, and cache-clear transition advances
that stream once. Evicted paths read the global watermark before their next
advance, so bounded storage can never revive a lower revision. A correlated
mirror/cache projection pair carries the same revision.

Frontend revision state is memory-only and bounded to 256 paths. A matched
runtime requires a non-negative safe-integer revision on content-bearing open,
mirror, and cache projections; a missing or lower revision is rejected before
Monaco or host chrome changes. Equal revisions are accepted because paired
mirror/cache projections describe the same backend transition. Project switch
clears the frontend fence. This is arrival-order protection, not a browser
content cache, CRDT, or operational transform.

Save always includes the source client's exact path, model snapshot, base hash,
and client identity. Backend path/project validation and the existing base-hash
conflict remain mandatory. A save or shared draft change updates other clients'
tabs/decorations even when they are viewing another file.

This phase guarantees independent simultaneous work on different files and
deterministic projection of shared drafts. It does not claim CRDT/OT semantics
for two users concurrently typing into the same file; that remains a separate
collaboration design.

### 6.6 Acceptance sequence

1. Two clients open different files without forcing either foreground to move.
2. Opening a new shared document adds membership/tabs for both but activates
   only the source client.
3. Reorder stays local; shared membership/close stays consistent.
4. Draft and save changes project by path without changing another client's
   foreground.
5. Reconnect and full client restart restore the correct client path without
   reviving stale global `last_file` authority.
6. Explorer selection, Run, save, diagnostics, mentions, extension commands,
   navigation, and WBA cursor/selection APIs act on the originating client.
7. Project switch remains shared and deterministically resets/reconciles every
   client.
8. Browser, Electron, GeckoView, and Cefrium pass the same matrix before the
   package baseline is frozen.

### 6.7 Phase 3B — Electron `Open in a Second Window`

Phase 3 established the prerequisite: one stable client identity owns one
reconnectable foreground while shared document membership, drafts, writes,
diagnostics, and WBA logical documents remain project-scoped. Phase 3B uses
that contract rather than creating an Electron-only document authority.

The user-facing feature is named **Open in a Second Window** even while its
secondary editor is docked inside the main Electron window. The first version
supports exactly one secondary editor surface. Its placement can be closed,
docked, visually collapsed, or detached into a floating native window.

#### 6.7.1 State ownership

The secondary editor is a real Code TE2 client with its own stable
`clientInstanceId` and the normal Editor, UI IPC, and WBA routing needed by its
reduced surface. It is not another `windowId` attached to the primary client.
Its canonical foreground therefore already belongs in the existing bounded
`ProjectSidecar.client_foregrounds` map. No `secondWindow`, geometry, dock
mode, or Electron presentation object is added to `ProjectSidecar`.

The ownership split is:

- `ProjectSidecar.client_foregrounds[secondaryClientInstanceId]` owns the
  canonical foreground file and reconnect revision for each project;
- existing shared open-state authority owns admitted documents, recents,
  drafts, writes, diagnostics, and WBA logical-document lifetime;
- Electron main owns whether the secondary surface is closed, docked,
  collapsed, or detached, plus dock size and detached native-window geometry;
- the secondary renderer owns ephemeral Monaco cursor, selection, scroll, and
  focus state through the same client projection paths as any other frontend;
- `windowId` and `presentationId` remain transient presentation and
  observability metadata.

The Electron store must not duplicate a `filePath`. On creation or reconnect,
the secondary renderer authenticates with its own stable client id and obtains
the backend-owned foreground through the ordinary boot/open-state flow.

#### 6.7.2 Electron presentation schema

The current Electron sidebar-only presentation file is generalized into the
versioned `$TE2_CONFIG_HOME/desktop-state.json` store. It atomically owns both
desktop client identities, the existing Sidebar state, and a bounded
editor-surface section. The implemented schema is:

```jsonc
{
  "version": 1,
  "identities": {
    "primaryClientInstanceId": "client_<stable-random-id>",
    "secondaryClientInstanceId": "client_<stable-random-id>"
  },
  "sidebar": {
    "version": 1,
    "order": [],
    "foregroundHostId": "",
    "lastAgentHostId": "",
    "lastAgentPresentationId": "",
    "presentations": {}
  },
  "editorSurfaces": {
    "secondary": {
      "projects": {
        "<configured-framework-origin>\u0000<canonical-project-path>": {
          "mode": "closed",
          "dockSize": 480,
          "detachedBounds": {
            "x": 100,
            "y": 100,
            "width": 980,
            "height": 720
          },
          "maximized": false
        }
      }
    }
  }
}
```

The store performs one bounded migration from the former
`desktop-client-identity.json` and `sidebar-presentation.json` records, then
removes those legacy files. A malformed canonical store fails closed instead
of silently reverting to another identity or presentation authority.

The exact configured upstream framework origin participates in the project
key. The random loopback browser-relay origin must not: it changes between
processes and would collide or strand state. Project records are normalized,
validated, bounded, and written through atomic replacement. Invalid bounds are
clamped to the current display work area before showing a detached window.

The secondary `clientInstanceId` is generated as another complete valid client
identity, not derived from `windowId` or by appending an unchecked suffix to the
primary id. It is stable across Electron restarts and reused across projects;
the backend foreground map is already project-scoped. Resetting the desktop
client identity rotates both primary and secondary ids and clears or rekeys the
corresponding local presentation records in one transaction.

Closing the surface is presentation-only in the first version. It records
`mode: "closed"` but may retain the backend foreground so reopening returns to
the warm document. A separately named reset/remove action may clear the
secondary client foreground; ordinary Close must not remove shared document
membership.

#### 6.7.3 Renderer and native placement

The secondary editor requires its own renderer/WebContents because Code TE2's
Socket.IO identity, Monaco host globals, DOM ids, and editor boot state are
renderer-scoped singletons. It must not be implemented by cloning DOM nodes,
moving the primary Monaco instance, or applying CSS to a second copy of the
full main page.

Add a dedicated reduced Code TE2 boot mode that mounts one Monaco editor plus a
compact header. It omits the shared file-tab strip and does not render
background tabs. Its header contains:

- the canonical active filename;
- a reduced menu with Save, Save As, Discard Draft, and other actions already
  valid for the secondary client's foreground;
- Close, Collapse/Expand, and Detach/Attach controls; and
- an explicit visual indication that this is the second editor surface.

The primary main-page client remains orchestration authority for creating the
secondary surface and requesting which admitted model it should show. The
intent flows through an allowlisted Electron preload/main broker to the
secondary renderer. The secondary renderer then performs the normal
client-authenticated backend open itself; Electron must not forge its Editor
RPC identity on behalf of the renderer.

Docked and collapsed placement uses a retained Electron `WebContentsView`
inside the main window. The primary Code TE2 page owns a real grid placeholder
below the shared toolbar and between the primary editor and Sidebar. It reports
that placeholder's CSS-pixel bounds through an exact-view preload command;
Electron translates them through the primary app-view zoom and positions the
retained native view over that slot. The primary app view remains full-size, so
this is not an outer Electron window split. Detach reparents that same view into
a floating `BrowserWindow`, and Attach reparents it back without navigating or
replacing the renderer. Close returns its IPC response before deferred renderer
disposal, retains the backend foreground, and allows reopen to reconstruct the
reduced client against that warm state. Renderer loss uses the same
reconstruction path without moving the primary foreground.

The docked boundary is a Code TE2-owned drag handle. During a drag, the primary
renderer hides the sibling native `WebContentsView` so it cannot capture the
pointer stream, updates only the grid's secondary-column size, and persists the
final bounded width through a primary-only Electron command. Electron writes
that width into the existing per-framework/per-project presentation record;
browser `localStorage` does not become a second presentation authority. The
reduced renderer also removes only the primary template's visual surfaces. It
must retain the injected stylesheet, font, and Codicon nodes on which Monaco's
breadcrumb and flex sizing depend.

The secondary renderer is still hosted through the ordinary Code TE2 app shell,
so it may invoke the shared event-driven `wait_for_app_prerequisites` gate before
the reduced runtime boots. That does not grant it primary-only app-view actions.
Its compact header replaces the background tab strip inside the placeholder.

The native registry remains one-entry in this phase but should use a keyed
surface shape so later multiple secondary editors do not require replacing the
contract. Only Electron exposes the broker and native placement implementation.

#### 6.7.4 Shared-document and WBA behavior

Opening a file in the second window admits or reuses the shared logical
document, records the path only for the secondary client foreground, and sends
the materialized open only to that client room. The primary client's foreground
does not move.

The primary may select from shared membership to direct the secondary surface,
but the secondary surface intentionally shows no background tab bar. Shared
draft, save, diagnostic, Git, semantic-token, hover, extension command, and
revision-fence behavior remains unchanged. WBA reuses its one extension host
and existing client-keyed editor facade; the secondary identity participates
exactly like another remote client.

The primary file-tab strip exposes an Electron-only right-click action named
**Open in a Second Window**. It sends the clicked tab's admitted path directly
to the secondary client without activating that tab in the primary client or
changing shared membership. Keyboard Context Menu and Shift+F10 invoke the
same path-specific action.

Project switch remains shared. Electron resolves the new
framework-origin/project presentation record, then either keeps the secondary
surface closed or reconstructs its stored presentation and allows the
secondary client boot to obtain that project's foreground. Stale project,
membership, or display geometry is reconciled deterministically rather than
silently opening an unrelated primary-client file.

#### 6.7.5 Android and browser contract

GeckoView and Cefrium do not read Electron's `$TE2_CONFIG_HOME` presentation
store and do not receive its native broker. No Android source or asset change is
required for this phase. Each Android frontend continues requesting only its
own exact client foreground; another entry in the server's bounded
`client_foregrounds` map is not projected as Android presentation state.

The ordinary browser client likewise remains single-surface. Unknown future
presentation fields must be rejected or ignored only at the Electron native
store boundary; they are not added to shared Code TE2 boot snapshots merely to
make unsupported clients ignore them.

#### 6.7.6 Implementation slices

1. Generalize and test the Electron desktop presentation schema, including the
   stable secondary client identity, bounded framework/project records, atomic
   writes, reset behavior, and display-bound validation.
2. Add the exact-view Electron broker and one-entry secondary editor native
   registry with docked, collapsed, detached, attached, and closed modes.
3. Add the reduced secondary-editor boot mode and compact header using existing
   Editor/UI IPC/WBA lanes rather than new document transports.
4. Add primary-page File-menu and selected-tab right-click `Open in a Second
   Window` orchestration without changing the primary foreground, shared close,
   or background-tab membership.
5. Add cold boot, project switch, reconnect, retarget, secondary renderer
   crash, and identity-reset reconciliation.
6. Validate shared drafts/writes/WBA behavior with primary and secondary
   editors showing different files and then the same file.

Slices 1 through 5 are implemented in source. The native registry retains one
exact `WebContentsView`; the reduced renderer opens through its own authenticated
UI IPC and Editor clients; and Save, Focus, and Blur backend projections now
target the originating client's presentation room. Slice 6 remains the live
acceptance gate rather than another state authority.

#### 6.7.7 Acceptance matrix

1. Opening file B in the second surface leaves the primary on file A and keeps
   both in shared document membership.
2. Dock, collapse, detach, attach, and close never change either client's
   canonical foreground accidentally.
3. Reopening after Close restores the secondary client's warm foreground.
4. Electron restart restores the saved per-framework/per-project presentation
   after framework readiness and project identity are established.
5. Retargeting to another framework never reuses a same-path project record
   from the previous server.
6. Project switch reconciles both client foregrounds and selects the correct
   stored presentation without reviving legacy `last_file` authority.
7. Save, Save As, discard, diagnostics, hover, semantic tokens, extension
   commands, and navigation act through the secondary client's exact identity.
8. Simultaneous primary/secondary edits to one shared draft obey the existing
   monotonic revision fence and make no new CRDT/OT claim.
9. Secondary renderer loss can reconstruct from native presentation plus
   backend foreground without moving the primary editor.
10. Browser, GeckoView, and Cefrium behavior and payloads remain unchanged.

### 6.8 Phase 3C — mobile `Open in a Second Window` drawer

Phase 3C deliberately follows the Electron-only Phase 3B implementation. It
reuses the same shared-document and exact-client editor contracts, but it does
not copy Electron's native `WebContentsView`, geometry store, or detach broker
into Android or an ordinary browser.

Implementation status as of 2026-08-22: the initial source implementation
exposed two lifecycle defects during review: explicit-null secondary foreground
fell back to the shared current path, and the drawer tab was capability-driven
instead of occupancy-driven. The correction keeps null authoritative, projects
exact secondary occupancy, adds real outer-drawer collapse, and assigns one
stable repository-owned debug/staging signing identity. Code TE2 rebuild,
version `0.2.333` asset publication, and all debug/staging APK assemblies have
passed. The follow-up source/build slice is synchronized and published as
`0.2.334`; the GeckoView/Cefrium interaction acceptance matrix remains.

The follow-up `0.2.334` slice keeps an unpopulated auxiliary foreground fully
absent, adds the main editor's exact-client error/warning pills to the portable
reduced header, and exposes a translucent mobile shortcut only while a second
foreground exists. The shortcut reopens a dismissed or collapsed drawer; it
does not invent, select, or force an auxiliary file.

The user-facing feature remains named **Open in a Second Window**. On an
eligible mobile client, the second editor is presented in the existing bottom
drawer. The drawer is already the constrained portrait-layout surface and
avoids adding another horizontal editor split to a narrow viewport.

#### 6.8.1 Eligibility and breakpoint contract

Availability is a client capability, not a CSS accident. The mobile second
editor is enabled only for a non-desktop browser identity:

- GeckoView and Cefrium native renderer identities are explicitly eligible;
- an ordinary browser is eligible when the browser reports a mobile user agent
  through `NavigatorUAData.mobile` or a bounded mobile fallback;
- Electron continues using its existing native second editor; and
- a desktop browser made narrow enough to enter `.layout-mobile` does not gain
  a second editor merely because of its viewport width.

The bottom-drawer presentation mounts only while the shared layout manager is
in the mobile breakpoint. Rotating or resizing out of that breakpoint hides
the mobile presentation without changing either client foreground or shared
document membership. Returning to the mobile breakpoint can reveal the same
warm iframe during the page session.

The Explorer and file-tab actions are capability-driven. Electron shows them
through its existing native implementation; eligible mobile clients show them
through the drawer implementation; unsupported desktop browser clients do not
offer a command that cannot be fulfilled.

#### 6.8.2 Identity and state ownership

The mobile auxiliary editor is a complete second Code TE2 client. It receives
its own valid `clientInstanceId`, `windowId`, Editor lane, UI IPC lane, and WBA
facade. It is never represented as another `windowId` on the primary client.

One stable auxiliary identity is paired with each stable primary identity:

- ordinary mobile browser profiles persist a separately generated valid client
  id beside the existing browser identity;
- GeckoView and Cefrium persist the paired id in application-private native
  storage and expose it through a role-aware extension/query identity bridge;
- the random Android framework-relay origin is never an identity store; and
- identity reset rotates the primary and auxiliary ids in one transaction so
  a stale auxiliary foreground cannot survive under the new installation
  identity.

The secondary client id is independently generated and validated against the
canonical `client_<lowercase-alphanumeric>` contract. Do not append an
unchecked suffix to the primary id or derive identity from a transient
presentation/window id.

Canonical file ownership stays unchanged:

- `ProjectSidecar.client_foregrounds[auxiliaryClientInstanceId]` owns the
  auxiliary foreground for each project;
- shared open-state owns admitted/background documents and tab membership;
- drafts, writes, Git, diagnostics, and WBA logical documents remain shared;
- the mobile host owns only drawer/iframe visibility for the current page
  session; and
- the bottom drawer does not introduce native geometry or another durable
  backend presentation record.

An explicit null auxiliary foreground remains empty; it must not fall back to
the primary/shared current path. The drawer tab is absent while that exact
foreground is empty. Closing or hiding a populated mobile surface does not
clear its backend foreground. Close dismisses the tab for the current page
session, while Collapse only minimizes the outer drawer and preserves the
visible populated tab. An explicit second-window open clears the dismissal and
reveals the warm auxiliary client. An explicit future reset action may clear
the foreground; ordinary presentation close must not.

#### 6.8.3 Portable reduced renderer and drawer presentation

The mobile auxiliary editor runs in one retained same-origin iframe mounted in
the existing bottom drawer. The iframe is required: Code TE2's Monaco globals,
DOM ids, socket identity, and editor boot state are singleton-shaped inside one
document realm. Do not clone the primary Monaco DOM or mount a second editor in
the primary page document.

Refactor the implemented Electron secondary runtime into a renderer-neutral
reduced-editor core plus small Electron and mobile presentation adapters. The
portable core retains:

- the compact filename header;
- the File menu with Save, Save As, and Discard Draft;
- one Monaco editor with no background tab strip; and
- the ordinary exact-client Editor/UI IPC/WBA boot and open sequence.

Electron retains its Close, Collapse, Detach, and Attach native controls. The
mobile adapter keeps the reduced header's Collapse and Close controls but
delegates their effects to the outer drawer; it does not render a redundant
inner tab bar or pretend to support native detach. Collapse preserves the warm
renderer and populated drawer tab. Close returns the drawer to a locally
dismissed, explicitly reopenable state while retaining the canonical auxiliary
foreground.

The portable header also renders error/warning pills from the auxiliary
client's existing `ui.editor.diagnostics.counts` projection. Activating those
pills sends the ordinary Next Issue command through that renderer's own UI IPC
connection, preserving exact-client navigation. On mobile, a translucent
Second Window shortcut shares the editor overlay affordance only while the
auxiliary foreground is populated. It remains available after local drawer
dismissal and only restores presentation state.

The existing Problems drawer tab, header, container, toggle-menu entry, and
duplicate `createProblemsPanel` instance are removed. The Explorer diagnostics
tab remains diagnostics presentation authority: it already retains the same
`explorer.diagnostics.detail` projection, updates live while open, derives tree
badges while closed, supports navigation/mentions, and provides a better
project-wide view. Host diagnostics export must read that retained Explorer
detail (or a shared nonvisual diagnostics projection), not preserve a hidden
Problems-panel DOM instance as state authority.

On eligible mobile clients, **Second Window** occupies the removed Problems
drawer slot. On desktop layouts the redundant Problems item remains absent;
Electron continues rendering its native secondary editor outside the drawer.

#### 6.8.4 Open intent and Explorer integration

The primary file-tab action is generalized from Electron-only to the advertised
second-editor capability. A mobile invocation ensures the retained iframe
exists and sends only a correlated bounded presentation/open intent. The
auxiliary renderer performs the ordinary authenticated `editor.open` under its
own client id and returns only success plus its canonical foreground path. The
host reveals and selects the Second Window tab only after success. No document
content, draft, or WBA response crosses a `postMessage` presentation channel.

File cards in Explorer gain **Open in a Second Window** for admitted files on
both supported desktop and mobile clients. Explorer remains on its own lane:

1. the menu action calls a new typed `/rpc/explorer` method with the clicked
   relative path;
2. Python validates the active project, file kind, admission boundary, and the
   originating primary client identity;
3. the backend emits one exact-client UI IPC open request to that invoking
   host; and
4. the host selects its Electron or mobile presentation, after which the
   auxiliary renderer performs its own canonical open.

There is no global-active-client fallback or broadcast. The clicked file is
admitted into shared membership and therefore appears as a background tab in
the primary client, while only the invoking client's auxiliary foreground
moves. Opening from one phone, browser profile, or Electron installation must
not affect another client's auxiliary foreground.

#### 6.8.5 Lifecycle and reconciliation

- Project switch remains shared. Both the primary and auxiliary clients receive
  exact-client foreground reconciliation for the new project.
- A missing/stale auxiliary foreground resolves through the existing explicit
  null contract; once `clientForeground` is present, null never copies the
  primary/shared foreground implicitly and the drawer tab disappears.
- Drawer hide/show and mobile breakpoint changes retain the live iframe.
- Page reload, renderer loss, or full client restart reconstructs the iframe
  through the backend foreground when the user next opens the Second Window
  presentation.
- Shared membership removal and project switch can clear an invalid auxiliary
  model through the existing exact-client SSOT path.
- Disconnected open intents fail explicitly; Socket.IO send buffers and polling
  are not used for deferred secondary opens.

#### 6.8.6 Implementation slices

1. Add a tested, renderer-neutral second-editor capability and role-aware
   primary/auxiliary identity pair for browser, GeckoView, and Cefrium.
2. Extract the reduced editor core from the Electron-only presentation without
   regressing Electron's retained native renderer.
3. Remove the duplicate Problems drawer presentation and point diagnostics
   export/summary consumers at the existing Explorer diagnostics projection.
4. Add the eligible-mobile Second Window drawer tab and retained iframe
   controller, including mobile breakpoint hide/reveal behavior.
5. Generalize file-tab opening and add the typed Explorer card-menu request,
   backend validation, exact-client UI IPC routing, and host presentation
   dispatch.
6. Add project-switch, reconnect, identity-reset, renderer-loss, orientation,
   and unsupported-desktop reconciliation tests.
7. Rebuild Code TE2, publish Android assets only under a separately approved
   publication scope, and run the live client matrix.

#### 6.8.7 Acceptance matrix

1. On GeckoView, Cefrium, and an ordinary eligible mobile browser, opening file
   B in Second Window leaves the primary editor on file A.
2. File B enters shared membership and appears as a background tab without
   becoming the primary foreground.
3. Drawer hide/show and portrait breakpoint exit/re-entry preserve the warm
   auxiliary editor and its cursor/scroll state during the page session.
4. Page reload and full client restart restore the auxiliary client's canonical
   file and repopulated tab unless the current page session explicitly dismissed
   the presentation.
5. Save, Save As, discard, diagnostics, hover, semantic tokens, extension
   commands, and navigation use the auxiliary identity and existing revision
   fence.
6. Explorer card actions select the invoking client's auxiliary editor only;
   two connected mobile clients can open different auxiliary files.
7. Project switch, shared close, identity reset, and transport reconnect cannot
   revive a stale auxiliary path or move the primary foreground.
8. The duplicate Problems drawer is gone while Explorer diagnostics, badges,
   navigation, mentions, summaries, and diagnostics export continue to work.
9. Electron's dock/collapse/detach/attach implementation is unchanged and its
   Explorer action uses the same validated intent contract.
10. A narrow desktop browser exposes neither the mobile drawer tab nor a dead
    Open in a Second Window action.
11. Empty exact-client foreground state exposes no Second Window tab; Collapse
    minimizes the drawer without losing the tab or warm renderer, and Close
    dismisses only the page-session presentation.

### 6.9 Phase 3D — Cefrium IME-dismissal focus release

This phase is deliberately separate from the second-editor work. It changes
the Cefrium Android client and Monaco focus presentation only after Phase 3C is
validated.

#### 6.9.1 Problem and ownership

After Monaco receives focus in Cefrium, manually dismissing the Android soft
keyboard leaves Monaco's controlled textarea focused. Chromium can therefore
request the IME again during a subsequent document scroll. Tapping a
non-editor element prevents the recurrence because it blurs Monaco; the desired
fix is to perform that focus release when native Android confirms a genuine IME
dismissal.

Native Android owns keyboard visibility. Monaco owns editor focus. The existing
UI IPC `ui.ime.focus`/`ui.ime.blur` facts describe editor intent and input-filter
ownership; they are not proof that the system keyboard is currently visible.
Do not infer dismissal from viewport resize, visual-viewport height, timers, or
network polling.

#### 6.9.2 Event-driven transition contract

On Android 11/API 30 and newer, Cefrium observes the root window's
`WindowInsets.Type.ime()` animation lifecycle. `onPrepare` captures the current
visibility before layout; `onStart` reads the applied end state before the
first animated frame. A small testable state reducer emits one dismissal only
when all of these are true:

- the IME animation is a confirmed `visible -> hidden` transition, rather than
  a show or visible-to-visible keyboard resize;
- the current UI IPC IME owner is Monaco/editor input;
- the Activity/window and app page are ready and focused; and
- native Tools chrome is hidden.

Initial hidden state does not emit. Repeated hidden insets do not emit. Older
Android versions retain current behavior unless an equivalent compatibility
signal is separately proven; this phase does not add a resize heuristic.
`onEnd` reconciles final visibility, including an animation Android cancels
before `onStart`, without emitting twice in the same visible epoch.

For a valid dismissal, Cefrium dispatches one exact-page event through its
existing browser JavaScript evaluation surface. The Code TE2 editor listener
transfers focus from Monaco's exact active Android textarea to the real File
toolbar button with `preventScroll`. It reconciles once on the next animation
frame only if Chromium retained or reclaimed the textarea during IME teardown.
This is intentionally the opposite of GeckoView's keyboard recovery control:
Cefrium removes DOM text focus early enough that a subsequent scroll cannot
resurrect the already-dismissed IME.

The normal frontend blur projection updates exact-client UI IPC/input-filter
state. Cefrium consumes that projection as state only and never calls
`restartInput`, `showSoftInput`, or another native focus transaction. Native
code does not forge backend editor state.

The next direct user tap in Monaco follows the existing Chromium focus path and
is allowed to summon the keyboard normally. No sticky suppression flag survives
the dismissal. There is no synthetic click, native focus sink/query, timer
loop, polling loop, or unverified fallback path.

#### 6.9.3 Scope boundaries

- Cefrium only; GeckoView keeps its current explicit Show Keyboard recovery
  control and is not normalized to Chromium behavior in this phase.
- Do not call `hideSoftInput` in response to the already-hidden transition.
- Do not blur on Activity pause, app navigation, native Tools focus, file
  picker/dialog focus, or ordinary focus movement outside Monaco.
- Do not add periodic IME checks or frontend viewport observers.
- Keep the existing Cefrium `preventScroll` textarea focus policy and 16 px
  Find/Replace focus-zoom correction intact.

The `preventScroll` policy must cover the actual realm that owns Monaco.
Cefrium installs it in the top-level page and in every existing or future
same-origin iframe realm; cross-origin frames are deliberately inaccessible.
This is required for the retained mobile second editor, whose textarea
prototype is distinct from the primary page's prototype.

#### 6.9.4 Implementation and acceptance

1. Add a unit-tested Cefrium IME visibility/focus transition reducer.
2. Wire API-30 root-insets animation start/end observation to the reducer and
   Activity/page lifecycle fences.
3. Add one idempotent editor-side native-dismissal listener with explicit
   disposal and a single next-frame focus reconciliation across editor/model
   reconstruction.
4. Validate on a connected Cefrium device: focus Monaco, type, dismiss the IME,
   scroll without keyboard resurrection, then tap Monaco and type again.
5. Validate that navigation, background/foreground, drawer interaction,
   dialogs, rotation, and editor switching do not produce false blur events.
6. Run Cefrium unit/debug builds and the shared Code TE2 typecheck/build/tests;
   retain Gecko debug comparison coverage without changing Gecko behavior.

## 7. Phase 4 — release wheel, unified installer, and Linux publication

### 7.1 Source/editable/Git package desktop bridge

Source-oriented Python installs retain an explicit desktop bootstrap. The sdist
and source-built wheel contain the locked Electron production source,
`desktop_asset_inventory.json`, the desktop shell assets, and the exact shared
dialog/component runtime inputs imported by that source. They do not contain an
Electron runtime, `node_modules`, generated `dist`/`build` trees, or local
profiler output.

`te2 desktop install` and `te2-desktop` are Python-owned entrypoints. On glibc
Linux x86-64 they first resolve the exact private-venv Node.js 24.16.0 and npm
installed by `nodejs-wheel`; explicit overrides and the bounded
PATH/login-shell/NVM/Termux-aware fallbacks remain source/development seams.
The resolver also exports the wheel's matching Node header root for native npm
builds. It fingerprints the complete production input set plus Node identity
and locks the transaction. A missing fingerprint runs locked `npm ci`, source
compilation, and Electron packaging beneath `$TE2_CACHE_HOME/desktop/electron`,
guarded by the existing 3 GiB free-space minimum. Only the validated pruned
application is atomically published beneath
`$TE2_DATA_HOME/desktop/electron/runtimes`; an atomic relative `current` link
selects it.

The bootstrap writes a Python-environment-specific `~/.local/bin/te2-desktop`
wrapper plus XDG desktop entry and icon. A private receipt records their hashes.
Install/repair may replace only byte-identical files or files still matching a
prior receipt; uninstall preserves modified or unrelated external files. Status
does not require Node, and launch builds only when no valid current runtime is
available.

This remains the fallback for explicit source provenance. Official Linux
platform wheels instead carry the Rust server and materialize the matching
prebuilt Electron archive without npm. The Termux archive carries no Electron.

### 7.2 Release provenance and platform wheels

The release dependency graph is built before TE2 itself. Framework-Shells emits
native ordinary-CPython and free-threaded-CPython wheels and refuses a
non-native release artifact. Agent Log Server then emits a platform wheel with
its verified Rust server and exact Framework-Shells dependency. Only after
those wheels exist does TE2 build against exact
`framework-shells==0.0.63`, `agent-log-server==0.2.118`, and, on Linux x86-64,
`nodejs-wheel==24.16.0`. Final published artifacts must be rebuilt from the
clean synchronized tag; dirty-source candidates are acceptance inputs only.

1. Add an ignored distribution staging layout and one deterministic release
   builder under repository construction tooling.
2. Generate an artifact-owned provenance record for sdists/source-built wheels
   and a stronger binary-release manifest for each platform wheel.
3. Build the optimized Rust server once for the accepted Linux baseline, audit
   its dynamic-library and minimum-glibc requirements, and embed only the
   validated final executable in the platform wheel.
4. Select the narrowest truthful manylinux-compatible wheel tag through build
   and clean-target evidence. Do not derive the compatibility tag from the
   release builder's current distribution name.
5. Make bootstrap resolution prefer the verified packaged server for
   binary-release provenance while preserving the canonical Cargo cache for
   source provenance.
6. Validate packaged server target/version/digest before launch. Exact-version
   repair may atomically restore it; otherwise fail rather than compile.
7. Build one sdist and one accepted Linux platform wheel from the same source
   identity, and prove the wheel contains no Cargo or Electron intermediates.
8. Mirror the exact wheel bytes to the GitHub draft release for offline and
   installer use; PyPI and GitHub digests must agree.

### 7.3 Prebuilt desktop payload and unified installer

1. Produce the public `install-te2` entrypoint, top-level
   `release-manifest.json`, target/component manifests, release archives, and
   `SHA256SUMS` from one synchronized immutable tag.
2. Implement Termux-first platform detection, then apt-based glibc Linux
   detection, architecture normalization, and explicit rejection of unsupported
   kernels, libc implementations, package managers, and architectures.
3. Implement deterministic component selection: explicit local component set,
   complete adjacent set, then immutable PyPI/GitHub release download.
4. Verify external checksums and every embedded
   version/target/content/provenance manifest before activation.
5. Produce the Linux `x86_64` Electron archive with the pruned application and
   XDG assets, but no wheel, Rust duplicate, npm cache, or build intermediates.
6. Add the user-owned versioned install root beneath `$TE2_DATA_HOME`, atomic
   `current` switching, manifest/receipt, user-local CLI/desktop wrappers, icon,
   `.desktop` entry, and private-venv handling.
7. Install the exact platform wheel into that private venv and unfold the exact
   matching Electron archive into the same staged release before validation.
8. Add the narrow Linux apt prerequisite transaction for system Python/venv
   support, native compilation prerequisites for Terminal first use,
   SSL/runtime libraries, and platform `libarchive` after validating the exact
   baseline mapping. Node.js/npm and their headers come from the release-owned
   private venv. Apt must not own TE2 application files.
9. Validate the existing Python Terminal bootstrap from a clean user install,
   including target-native `node-pty`, canonical data-root placement,
   fingerprint reuse, marker validation, and repair behavior.
10. Seed and validate the Phase 2 local-framework config with the installed
    command and private-venv paths without overwriting later user edits.
11. Validate online download, adjacent components, explicit offline components,
    checksum failure, interrupted install, atomic upgrade, rollback, and
    receipt-owned removal on clean Debian/Ubuntu targets.
12. Validate `te2 --help`, `/api/health`, desktop launch, app launch, assets,
    and normal shutdown without deleting ordinary TE2 user state.

The currently provisioned remote Debian Trixie environment is the mandatory
live Linux acceptance harness, not merely a compatibility reference. Phase 4C
is not accepted from local unit tests, archive inspection, or container-only
smoke tests. The candidate installer and exact draft components are transferred
to or downloaded by that host, then exercised through a real SSH session in
this order:

1. record the clean host's kernel, architecture, glibc, Python, pip compatible
   tags, apt state, and initial TE2/XDG absence;
2. run the ordinary install as the unprivileged test user, using root only for
   the installer's narrow declared apt prerequisite transaction;
3. prove the managed venv, versioned release, receipt, wrappers, XDG files, and
   `current` pointer are user-owned and resolve the exact candidate version;
4. launch the packaged Rust framework, verify `/api/health`, app discovery,
   app-worker startup, framework shutdown, and a fresh-login relaunch without
   Cargo or repository source;
5. exercise the appropriate non-graphical desktop materialization checks on the
   remote host and perform graphical Electron acceptance on a display-capable
   Linux client from the same artifacts;
6. test exact-version repair after a controlled packaged-file failure, checksum
   rejection, interrupted staging, upgrade, rollback, and receipt-owned
   uninstall while proving ordinary TE2 state survives; and
7. retain a command/result transcript and the resulting version/hash/ownership
   evidence as release acceptance evidence.

The remote live gate is repeated first with the TestPyPI wheel plus draft
GitHub components, then as a final smoke with the public PyPI wheel before the
GitHub Release becomes public. A failure at either pass blocks publication.
Host addresses, credentials, passwords, and SSH material are test-harness state
and are never recorded in repository documents, logs, or release manifests.

### 7.4 Final integration and publication transaction

1. Synchronize every release-facing version and generated frontend asset before
   final integration. When Android participates, rebuild Code TE2, rebundle the
   Android assets, and build both release APK variants from those exact assets.
2. Complete pre-release validation on the feature branch, merge it into `main`,
   and place one immutable annotated tag on the final integrated commit. If a
   merge commit is used, the tag points to that merge commit; version sync must
   already be present in it.
3. Build wheels, sdist, Rust server, Electron archive, Termux archive, and APKs
   from a clean checkout of that tag. Nothing is copied from a dirty development
   tree.
4. Sign official APKs with the separately supplied release key. Debug/staging
   repository keys are never accepted for release APKs; no release secret or
   password enters Git, logs, manifests, or command lines.
5. Audit APK signature identity, version, packaged asset version, and 16 KiB
   alignment; audit wheel tags/contents, Rust linkage, Electron contents,
   archive paths, and every checksum.
6. Create a draft GitHub Release and upload the complete component set plus
   `release-manifest.json` and `SHA256SUMS`.
7. Upload the exact sdist/wheel candidates to TestPyPI and run the complete
   remote Debian live-acceptance sequence against those candidates and the draft
   GitHub components.
8. Upload the already-tested immutable files to PyPI. Because PyPI files cannot
   be replaced, any identity or content mismatch stops the release and requires
   a new version.
9. Repeat the remote Debian framework/install smoke using the public PyPI wheel
   against the draft GitHub Electron asset. Only after it passes may the
   already-populated GitHub Release be published.
10. Record artifact URLs, hashes, tag, commit, wheel compatibility evidence,
    APK signer fingerprints, and acceptance results in the release record.

## 8. Phase 5 — Termux target mode

1. Generate the complete direct/transitive distribution graph from the locked
   release inputs, including extras and marker evaluation for Android.
2. Audit current official Termux and explicitly approved TUR package indexes,
   then validate candidate apt packages on a physical device. Never derive the
   canonical mapping from personal third-party repositories.
3. Freeze a machine-readable ownership matrix covering apt packages,
   release-local pure wheels, release-local Android-native wheels, executables,
   shared libraries, import names, version constraints, and build-tool scope.
4. Build and audit the remaining Android wheels for the declared target
   interpreter plus the tagged `aarch64-linux-android` Rust server. Installed
   device artifacts may guide the recipes but are not release inputs.
5. Produce `te2-<version>-termux-aarch64.tar.gz` with the versioned TE2 Python
   tree, complete local wheelhouse, Bionic server, target manifest, and no
   Electron assets, venv, interpreter, npm cache, or compiler intermediates.
6. Reuse the common installer acquisition, checksum, staging, receipt, current
   pointer, upgrade, rollback, and removal transaction.
7. Install the consented prerequisites with apt directly and without `sudo`,
   then validate their imports/executables. `nodejs-wheel` is never installed
   in Termux; Node/npm comes from the target apt mapping.
8. Materialize every non-apt Python input beneath the staged release tree using
   only the verified local wheelhouse. Enforce `--no-index` and
   `--only-binary=:all:` or deterministic wheel unpacking so CMake/Cargo/Clang
   cannot become an accidental installation path.
9. Install `$PREFIX/bin/te2` as a receipt-owned wrapper for the current
   release's exact Python tree and server. Do not write TE2 into shared
   `site-packages` and do not create a Termux venv.
10. Preserve the existing Python Terminal bootstrap and canonical per-user
    `$TE2_DATA_HOME/node_runtime/terminal` runtime. Its owned first-use
    `node-pty` build is separate from Python package installation and uses only
    declared apt prerequisites.
11. Run clean transaction/failure testing in the x86-64 Termux container on the
    remote Debian host, including missing-wheel failure, while reserving native
    wheel/server/Terminal acceptance for the physical AArch64 device.
12. Validate download and offline modes, Python-minor/ABI rejection, imports,
    ELF/Bionic linkage, `te2 --help`, release server `/api/health`, app workers,
    Terminal bootstrap, managed Code Server opt-in, atomic upgrade/rollback,
    receipt-owned uninstall, and preservation of external apt/user state.

## 9. Validation and publication boundaries

Minimum automated validation by phase:

- Phase 0: Python tests, isolated-wheel import/CLI smoke, dependency inventory,
  dead-route checks, and direct-dependency ownership validation.
- Phase 1: merge audit, framework/Rust/Python tests, Code TE2 typecheck/build,
  Electron tests/build, and affected Android unit/build validation.
- Phase 2: bookmark/settings/controller tests, Electron typecheck/tests/build,
  source-mode local-runtime smoke, and live retarget acceptance.
- Phase 3: multi-client editor/Explorer/WBA tests plus live Browser, Electron,
  GeckoView, and Cefrium two-client acceptance.
- Phase 4: Electron typecheck/tests/build, Rust release build/tests and linkage
  audit, wheel/sdist provenance and content audit, installer
  detection/acquisition/checksum tests, clean Debian Trixie
  install/upgrade/remove smoke, desktop-file validation, TestPyPI/PyPI install,
  APK signing/alignment audit, and local server health.
- Phase 5: device-native dependency resolution, Termux target-manifest and
  archive audit, clean install/upgrade/remove smoke, framework/app-worker/
  terminal tests, offline payload validation, and managed Code Server opt-in.

Each phase is a separate implementation approval boundary. Non-APK artifact
signing, automatic update channels, store-based Android distribution, HTTPS
certificate management, background system services, non-apt glibc
distributions, musl targets, and non-amd64 Electron archives are deferred unless
separately approved.
