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
4. produce one autodetecting release installer plus immutable, target-specific
   archives for apt-based glibc Linux and Termux; and
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
modes. A source checkout and a Git/pip install may build and cache the Rust
server from source. The unified installer selects either a glibc Linux archive
containing the GNU/Linux server and Electron payload or a Termux archive
containing the Bionic/Android server. Linux owns a private venv; Termux reuses
its shared interpreter without a venv. Distribution payloads must never stage
Cargo's intermediate build tree.

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
| Node.js and npm | Package runtime requirements owned by the standalone Terminal's private first-use bootstrap; not framework, Code TE2, WBA, or Electron dependency installers |
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
shared browser artifacts are already built or vendored; the Electron
distribution is built before publication. npm remains an installed prerequisite
only because the standalone Terminal intentionally installs its locked private
runtime on first use; elsewhere npm is source-regeneration tooling. A retained
installed capability receives its external executable through the selected
target's prerequisite transaction; otherwise that capability is removed from
the installed product.

The installer must preserve the Terminal's existing per-user runtime authority
without adding another helper. Its target prerequisite manifest installs or
validates Node.js/npm, and the existing packaged Python
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

The first isolated TE2 wheel is 85,830,112 bytes because it carries the complete
framework and built-in app asset payload. A self-contained desktop package that
embeds both that wheel and the Electron archive therefore starts near 170 MiB
before dependency wheels and the Rust server. The earlier 90--110 MiB estimate
was invalid. Package-size work must account for the TE2 asset payload explicitly
instead of treating the Python wheel as negligible.

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
  installer manifest, Python package, Rust server, Electron package, release
  tag, archive names, and checksums must agree.
- Release assets are produced from one immutable synchronized tag. Moving
  branches and unpinned Git URLs are never package inputs.
- Build jobs may acquire locked source dependencies before staging. Cargo,
  Electron, npm, and wheel caches remain outside the package root.
- Build staging and final release archives stay outside tracked source or under
  an ignored build-output root.
- Release builders enforce the existing 3 GiB free-space guard before Electron
  or Rust compilation begins.
- The packaged Rust binary is a release build and is passed to the existing
  bootstrap through `--server-bin`/`TE2_SERVER_BIN`; Cargo is not a target
  runtime dependency.
- User data never lives beneath the package prefix. The existing canonical
  `TE2_*_HOME`/XDG/Termux resolution remains the only writable-state contract.
- Managed Code Server is not bundled into either target archive. Its existing
  confirmation-gated private installer remains authoritative.
- One installer owns detection, prerequisite installation, archive acquisition,
  verification, staging, receipts, activation, upgrades, and removal. Target
  adapters may differ only where the platform runtime layout requires it.
- Detection checks Termux before generic Linux. The initial generic Linux target
  requires Linux, glibc, `apt-get`, and a supported architecture. Musl systems,
  unsupported package managers, and unknown architectures fail explicitly.
- Linux and Termux modes receive independent clean-install, upgrade, uninstall,
  and launch smoke tests.

The initial tagged release-asset matrix is:

```text
install-te2
te2-<version>-linux-x86_64.tar.gz
te2-<version>-termux-aarch64.tar.gz
SHA256SUMS
```

Each target archive carries a versioned `manifest.json`, the exact TE2 wheel or
release-owned Python payload input, its validated final Rust server, and only
the target-specific additions it needs. The Linux archive also carries the
pruned Electron application and XDG assets. The Termux archive carries no
Electron payload. Release binaries belong in release assets, not Git history.
The Bionic server remains a Termux installer input and does not authorize
embedding the framework server into an Android APK.

Tar with gzip is the initial archive format because it preserves executable
modes and symlinks without adding a decompressor prerequisite. ZIP is not a
release format. The installer supports three deterministic acquisition paths in
this order: an explicit `--payload <archive>`, a matching archive adjacent to
the installer, or a download from the selected immutable release. Downloaded
and local archives use the same checksum and internal-manifest validation. An
offline payload install assumes its OS/Termux prerequisite packages are already
available; it does not promise an offline apt repository.

### 2.2 Install-mode contract

| Install mode | Python environment | Rust server | Electron |
|---|---|---|---|
| Editable/source checkout | Caller-owned environment | Built/reused through the canonical cache | Optional source build |
| Git/pip source install | Caller-owned environment or venv | Built/reused through the canonical cache | Not implied |
| Unified installer: glibc Linux | Release-owned private venv under the canonical TE2 data root | Archive-owned GNU/Linux release binary | Archive-owned Linux x64 payload |
| Unified installer: Termux | Shared Termux interpreter and repository dependencies; release-owned TE2 Python tree | Archive-owned Bionic/Android release binary | Not included |

Source and Git/pip installs continue to include Rust source because they must be
able to build the server. Both installed target modes always set the exact
`TE2_SERVER_BIN`/`--server-bin` path so the target machine never invokes Cargo.
The builder may retain incremental Cargo artifacts in its external cache, but
copies only the validated final `te2-server` executable into release staging.

The Python-delivery decision is closed: installed releases use the immutable
target archive, not a Git clone or exact-tag network bootstrap. The archive
contains the version-matched TE2 wheel and the target's locked Python install
inputs. Linux constructs its private venv from those inputs. Termux uses its
shared interpreter and repository-native dependencies but installs TE2's own
Python files into the versioned release tree rather than relying on a moving
source checkout. Python source identity must match the manifest, Rust server,
Electron payload, and synchronized release version exactly.

### 2.3 Linux desktop user installation

Initial target: Linux `amd64`, matching the current Electron x64 build.

Install identity: `te2-desktop`.

The application payload is user-owned and versioned beneath the already
canonical TE2 data root. The exact leaf naming is finalized during
implementation, but the ownership shape is fixed:

```text
$TE2_DATA_HOME/install/releases/<version>/venv/...
$TE2_DATA_HOME/install/releases/<version>/desktop/...
$TE2_DATA_HOME/install/releases/<version>/libexec/te2-server
$TE2_DATA_HOME/install/current -> releases/<version>
$HOME/.local/bin/te2
$HOME/.local/bin/te2-desktop
$XDG_DATA_HOME/applications/te2-desktop.desktop
$XDG_DATA_HOME/icons/hicolor/<size>/apps/te2.png
```

The release builder always produces:

- the release Rust server binary;
- the pruned Electron application directory; and
- the version-matched Python installation inputs, manifest, and checksums.

The installer stages a complete version from the verified target archive,
constructs and validates the private venv, validates the CLI, Rust server, and
Electron launcher, then switches the `current` pointer atomically. A failed
update leaves the prior release usable. A versioned install receipt owns only
installed application payloads; uninstall never deletes ordinary TE2
configuration, projects, or app state.

The small user-local wrappers invoke the current private venv and exact prebuilt
server. Installation writes the versioned desktop local-framework record with
the current release's exact `te2` command and private venv. The environment
override remains only a higher-priority source/test seam.

The desktop entry launches the user-local `te2-desktop` wrapper, has a stable
application id, uses the user-local installed icon, and does not open a
terminal. The existing intentional Electron `--no-sandbox` launcher behavior
remains unchanged unless a separately approved sandboxing design replaces it.

The installer runs application-file operations as the user. Its Linux target
adapter may use a narrow, explicit privileged apt step for system requirements
that are impractical to vendor, such as platform Python/venv support, Node/npm,
SSL runtime, or the `libarchive` shared library. Apt never owns the TE2
application payload. All TE2 Python/bootstrap, Rust, and Electron files remain
in the user installation root.

Repository construction scripts may build the public installer and its release
archives. Repository scripts themselves are not copied into the installed
application. A user sees the repository `scripts/` directory only in a cloned
or editable source checkout.

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
Termux apt owns the shared interpreter and validated native/runtime
dependencies; it does not own TE2 application files. Phase 5 begins with a
device-native dependency matrix:

1. enumerate every direct and transitive Python requirement from the cleaned
   Phase 0 set;
2. query the current Termux repositories for preferred Python/native packages;
3. validate import names and versions from those packages;
4. identify only the packages that still require a target-built wheel or other
   release-owned input; and
5. prove that the release-owned Python tree runs against those shared
   dependencies without writing TE2 into shared `site-packages`.

The installer records the exact apt package mapping in the Termux target
manifest and installs missing prerequisites directly, without `sudo`. Any
remaining Python payload must be built for the actual Termux ABI and included
in the immutable target archive. Installer activation performs no networked pip
resolution after archive verification. If a dependency cannot be supplied by
the accepted apt mapping or immutable archive without overwriting shared-prefix
files, Phase 5 stops for a new design decision.

The Rust server is built for `aarch64-linux-android` in the release pipeline and
installed as a prebuilt Bionic-compatible binary. Native Termux validation
remains required even if a cross-build is later automated. The installer audit
rejects hard links, paths outside the declared release root or wrapper path,
invalid shebangs, and invalid symlinks. Code Server remains the existing
separate, user-approved managed installation.

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

## 7. Phase 4 — unified installer and Linux target archive

1. Add an ignored distribution staging layout and one deterministic release
   builder under repository construction tooling.
2. Produce the public `install-te2` entrypoint, versioned target manifests,
   target archives, and `SHA256SUMS` from one synchronized immutable tag.
3. Implement Termux-first platform detection, then apt-based glibc Linux
   detection, architecture normalization, and explicit rejection of unsupported
   kernels, libc implementations, package managers, and architectures.
4. Implement deterministic payload selection: explicit `--payload`, adjacent
   matching archive, then immutable release download.
5. Verify the external checksum and internal target/version/content manifest
   before any release is activated.
6. Produce the Linux `x86_64` archive with the tagged TE2 wheel and locked
   Python inputs, GNU/Linux Rust server, pruned Electron payload, XDG assets,
   and no build intermediates.
7. Add the user-owned versioned install root beneath `$TE2_DATA_HOME`, atomic
   `current` switching, manifest/receipt, user-local CLI/desktop wrappers, icon,
   `.desktop` entry, and private-venv handling.
8. Add the narrow Linux apt prerequisite transaction for system Python/venv
   support, Node/npm, SSL/runtime libraries, and platform `libarchive` after
   validating the exact baseline mapping. Apt must not own TE2 application
   files.
9. Validate the existing Python Terminal bootstrap from a clean user install,
   including target-native `node-pty`, canonical data-root placement,
   fingerprint reuse, marker validation, and repair behavior.
10. Seed and validate the Phase 2 local-framework config with the installed
    command and private-venv paths without overwriting later user edits.
11. Validate online download, adjacent payload, explicit offline payload,
    checksum failure, interrupted install, atomic upgrade, rollback, and
    receipt-owned removal on clean Debian/Ubuntu targets.
12. Validate `te2 --help`, `/api/health`, desktop launch, app launch, assets,
    and normal shutdown without deleting ordinary TE2 user state.

## 8. Phase 5 — Termux target mode

1. Run the dependency-to-Termux-package investigation on a current Termux
   device before freezing its target manifest.
2. Freeze the accepted apt package/import mapping in a machine-readable
   installer input, including Python, Node/npm, compiler requirements for
   `node-pty`, SSL/runtime libraries, and retained optional capabilities.
3. Build any remaining Python payloads for the Termux ABI and validate the
   tagged `aarch64-linux-android` Rust server natively on Termux.
4. Produce `te2-<version>-termux-aarch64.tar.gz` with the release-owned TE2
   Python tree inputs, Bionic server, manifest, and no Electron assets.
5. Reuse the common installer acquisition, checksum, staging, receipt, current
   pointer, upgrade, rollback, and removal transaction.
6. Install Termux prerequisites with apt directly and without `sudo`; never
   install TE2 itself into shared `site-packages` or use a networked pip
   resolution after archive verification.
7. Install `$PREFIX/bin/te2` as a receipt-owned wrapper for the current
   release's exact Python tree and server.
8. Preserve the existing Python Terminal bootstrap and canonical per-user
   `$TE2_DATA_HOME/node_runtime/terminal` runtime; the installer must not run
   npm for that private runtime.
9. Audit payload paths, shared-prefix collisions, shebangs, symlinks, hard
   links, and uninstall ownership.
10. Validate download and offline payload modes, imports, `te2 --help`, release
    server launch, `/api/health`, app workers, Terminal bootstrap, managed Code
    Server opt-in, atomic upgrade/rollback, and uninstall on a clean device.

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
- Phase 4: Electron typecheck/tests/build, Rust release build/tests, installer
  detection/acquisition/checksum tests, archive content audit, clean Linux
  install/upgrade/remove smoke, desktop-file validation, and local server health.
- Phase 5: device-native dependency resolution, Termux target-manifest and
  archive audit, clean install/upgrade/remove smoke, framework/app-worker/
  terminal tests, offline payload validation, and managed Code Server opt-in.

Each phase is a separate implementation approval boundary. Artifact signing,
automatic update channels, Android distribution, HTTPS certificate management,
background system services, non-apt glibc distributions, musl targets, and
non-amd64 Electron archives are deferred unless separately approved.
