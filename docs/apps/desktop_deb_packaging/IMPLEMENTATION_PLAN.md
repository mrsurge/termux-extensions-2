# Desktop User Install And Termux Debian Packaging Implementation Plan

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
4. produce a Linux desktop user-owned installation containing Electron, a
   private Python runtime, a prebuilt Rust server, launchers, and a desktop
   entry; and
5. produce a separate Termux Debian package that uses Termux's shared Python
   environment and preferred repository packages.

The Linux and Termux artifacts intentionally have different runtime layouts.
Linux isolates Python dependencies in a user-owned virtual environment beneath
the canonical TE2 data root.
Termux uses its shared Python environment because several native Python
dependencies are better supplied by Termux repositories than rebuilt through
pip. Phase 5 must discover and validate those package mappings before a Termux
payload is designed.

The distribution work also recognizes four intentionally different install
modes. A source checkout and a Git/pip install may build and cache the Rust
server from source. A Linux desktop user install receives a prebuilt GNU/Linux
server and owns a private venv beneath `$TE2_DATA_HOME`. A Termux Debian package
receives a prebuilt Bionic/Android server and installs TE2 into Termux's shared
Python environment. Distribution payloads must never stage Cargo's intermediate
build tree.

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

Linux and Termux package metadata own their exact validated dependency mapping
in Phases 4 and 5. Checked-in Code TE2, WBA, and shared browser artifacts are
already built or vendored; the Electron distribution is built before packaging.
npm remains a package requirement only because the standalone Terminal
intentionally installs its locked private runtime on first use; elsewhere npm
is source-regeneration tooling. A retained packaged capability receives its
external executable through package metadata; otherwise that capability is
removed from the packaged product.

The package must preserve the Terminal's existing per-user runtime authority
without adding another helper. The `.deb` declares the target Node.js/npm
packages, and the existing packaged Python `ensure_terminal_node_runtime()`
path remains the sole installer, validator, and repair authority for the
Terminal's private modules. The first Terminal launch installs them; later
launches perform the existing cheap validation and reuse or repair the runtime.
No Debian maintainer script runs npm or writes into a user's home.

The durable runtime remains under
`$TE2_DATA_HOME/node_runtime/terminal/<fingerprint>`, normally
`~/.local/share/te2/node_runtime/terminal/<fingerprint>`. It is not a second
ad-hoc application root. The existing fingerprint continues to bind the
bootstrap revision, package metadata and lock, platform, architecture, Node
version, and Node module ABI. The existing cross-process lock, atomic staging,
`.te2-runtime.json` marker, required-package validation, and explicit
`TE2_TERMINAL_NODE_RUNTIME_DIR` override remain authoritative.

This is also the dependency-admission rule for the packaged product: a
dependency must be installed by pip, by an already-owned application bootstrap,
or by the target `.deb` and its declared package dependencies. If none of those
authorities owns it, the dependency and the unsupported capability that needs
it are removed instead of gaining another installer or helper script.
Repository scripts may construct development or release artifacts, including
the `.deb`, but installed users never invoke them for setup.

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

### 1.5 Current active-file authority is global while document membership is already shared

The current sidecar stores one project-wide `last_file`, one
`open_state_revision`, and a shared `recent_files` list. An editor open records
that file as the shared last file and broadcasts `editor:open` to the global
`code_te2` room, so one client's open forces every connected editor to converge
on the same model. Boot restores `serverState.currentPath`/`lastFile`; file tabs
and Explorer active highlighting also derive their foreground from that shared
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

The remaining lock is therefore not the document/draft set itself. It is the
single global foreground path, global open notification room, global Explorer
active-file projection, and WBA's one synthetic active-editor facade.

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
| Linux desktop user install | Private venv under the canonical TE2 user data root | Tagged GNU/Linux release binary | Tagged bundled Linux x64 payload |
| Termux `.deb` | Shared Termux Python environment | Tagged Bionic/Android release binary | Not included |

Source and Git/pip installs continue to include Rust source because they must be
able to build the server. The Linux installed launchers and Termux package
launcher always set the exact `TE2_SERVER_BIN`/`--server-bin` path so the target
machine never invokes Cargo. The builder may retain incremental Cargo artifacts
in its external cache, but copies only the validated final `te2-server`
executable into distribution staging.

The Linux Python-delivery detail remains a measured Phase 4 decision:

1. **Thin network bootstrap:** the user installer creates a private venv and
   installs an exact immutable Git tag. This minimizes the downloaded release
   payload but depends on GitHub, DNS, TLS, Git, pip resolution, and external
   package indexes.
2. **Self-contained release:** the installer downloads or carries the tagged
   TE2 wheel and locked dependency payload needed to construct the private venv
   without further Python network access. This is larger but deterministic,
   reinstallable offline, and suitable for atomic upgrade recovery.

Phase 4 must build and measure both prototypes before locking the final payload
shape. The measured wheel size makes the thin exact-tag bootstrap the current
size-oriented candidate. Its networked failure and recovery contract must be
explicit. The self-contained form remains the offline/reproducible alternative.
In either prototype, the Python source revision must match the installed version
and bundled Rust/Electron release assets exactly.

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
- the version-matched Python installation input and checksums.

The self-contained prototype additionally carries the exact TE2 wheel and
locked dependency payload. The thin prototype records the exact tagged Git
source and every target prerequisite. Both prototypes stage a complete version,
validate the private venv, CLI, Rust server, and Electron launcher, then switch
the `current` pointer atomically. A failed update leaves the prior release
usable. A versioned install receipt owns only installed application payloads;
uninstall never deletes ordinary TE2 configuration, projects, or app state.

The small user-local wrappers invoke the current private venv and exact prebuilt
server. Installation writes the versioned desktop local-framework record with
the current release's exact `te2` command and private venv. The environment
override remains only a higher-priority source/test seam.

The desktop entry launches the user-local `te2-desktop` wrapper, has a stable
application id, uses the user-local installed icon, and does not open a
terminal. The existing intentional Electron `--no-sandbox` launcher behavior
remains unchanged unless a separately approved sandboxing design replaces it.

The installer runs as the user. It may use apt with a narrow, explicit
privileged step for system requirements that are impractical to vendor, such as
the platform Python/venv support, Node/npm, SSL runtime, or `libarchive` shared
library. Apt never owns the TE2 application payload. All TE2 Python/bootstrap,
Rust, and Electron files remain in the user installation root.

Repository construction scripts may build this installer and its release
payloads. They are not copied into the installed application. A user sees the
repository `scripts/` directory only in a cloned or editable source checkout.

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

Termux deliberately uses the shared Python environment. Phase 5 begins with a
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
cannot be packaged without overwriting another package's files, Phase 5 stops
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
7. Keep `requirements.txt` as the audited direct-runtime input. Generate the
   platform-specific transitive lock only after Phase 4 selects the Linux
   Python-delivery mode and baseline interpreter.
8. Build a wheel and run imports, CLI help, runtime bridge, app-worker loading,
   archive-job, and terminal protocol smoke tests from an isolated environment.

### 3.2 External dependency boundary

1. Audit `node`, `npm`, compiler tools, libarchive, Git, dtach, aria2,
   watchexec, curl/wget, OpenSSL, and the old Termux native packages against
   current subprocess/native-library use.
2. Keep dependency installation owned by pip, existing app bootstraps, or the
   target package metadata; remove unowned dependencies and capabilities.
3. Document the source/core-runtime/build-only/optional split in the supported
   README without presenting it as target package metadata.
4. Let the Linux and Termux package builders own separate exact dependency
   manifests after their clean-target investigations in Phases 4 and 5.
5. Allow repository scripts to construct development and release artifacts,
   including `.deb` files, but never expose them as installed-user setup paths.

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
- `windowId` distinguishes simultaneous/reloaded main-page presentations.
- Live editor routing uses both values. A bounded backend projection keyed by
  project and stable client identity retains the last client-declared active
  path for cold reconnect; live window state wins while connected.
- The client owns the choice. Backend storage is a reconnect projection, not a
  cross-client active-file authority.
- On first migration only, a client without a projection may seed from the
  legacy project `last_file`. Ordinary opens then stop writing/reading
  `last_file` as the global foreground lock.
- Boot returns shared membership and a separate validated client foreground.
  If that path left membership or the project, the client chooses a
  deterministic shared-member fallback without changing other clients.
- Records are bounded and stale client/window entries are pruned so arbitrary
  identities cannot grow durable state indefinitely.

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
therefore projects the most recently focused or command-originating client as
that singular active editor immediately before focus/command-sensitive work.
Document-scoped language requests continue to address the exact URI and must
not depend on that global pointer. Commands, menus, mentions, diffs, and
extension navigation carry the originating client identity so their result
returns to the correct presentation.

This preserves one extension-host/project runtime while being honest about the
single-window Code OSS contract. A separate extension host per client is not
the initial design and would require a later explicit resource/lifecycle
decision.

### 6.5 Draft, write, and conflict behavior

Draft authority remains path-scoped and shared. Existing mirror/cache
notifications continue to reach all clients, while only clients currently
showing that path apply the content to Monaco. Add monotonic path/document
revision fencing so stale delayed projections cannot overwrite a newer shared
draft or post-save clean state.

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

## 7. Phase 4 — Linux desktop user installation

1. Add an ignored distribution staging layout and one deterministic Linux
   release/installer builder under repository construction tooling.
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
6. Add a user-owned versioned install root beneath `$TE2_DATA_HOME`, atomic
   `current` switching, a manifest/receipt, user-local CLI/desktop wrappers,
   icon, `.desktop` entry, and private-venv handling.
7. Add the narrow apt prerequisite transaction for system Python/venv support,
   Node/npm, SSL/runtime libraries, and platform `libarchive` after validating
   the exact baseline mapping. Apt must not own the TE2 application tree.
8. Validate that the existing Python Terminal bootstrap from a clean user
   install writes to the same canonical per-user data root, including its
   target-native `node-pty` installation path, fingerprint reuse, marker
   validation, and repair behavior.
9. Seed and validate the Phase 2 local-framework config with the installed
   command and private-venv paths without overwriting later user edits during an
   ordinary desktop launch.
10. Install into a clean Debian/Ubuntu target and audit the install receipt,
    permissions, current pointer, wrappers, desktop entry, and payload paths.
11. Validate `te2 --help`, `/api/health`, desktop launch, app launch, asset
    install, and clean removal.
12. Validate an atomic upgrade and rollback without deleting ordinary TE2 user
    data.

## 8. Phase 5 — Termux `.deb`

1. Run the dependency-to-Termux-package investigation on a current Termux
   device before writing payload rules.
2. Freeze the accepted repository/package mapping in a machine-readable input.
3. Build any remaining Python payloads and validate the tagged
   `aarch64-linux-android` Rust server natively on Termux.
4. Stage TE2 into the shared Termux Python environment with dpkg ownership and
   no networked maintainer step.
5. Generate the Termux control metadata and `$PREFIX/bin/te2` wrapper. Declare
   the Termux Node.js/npm packages required by the standalone Terminal's
   current private first-use runtime bootstrap; do not install global npm
   application packages.
6. Preserve the existing Python Terminal bootstrap and canonical per-user
   `$TE2_DATA_HOME/node_runtime/terminal` runtime; never execute npm from a
   package maintainer script.
7. Audit payload paths, ownership collisions, shebangs, symlinks, and hard
   links.
8. Install on a clean Termux target and validate imports, `te2 --help`, release
   server launch, `/api/health`, app-worker startup, terminal runtime bootstrap,
   managed Code Server opt-in, upgrade, and uninstall.

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
- Phase 4: Electron typecheck/tests/build, Rust release build/tests, package
  metadata/content audit, clean Linux install/upgrade/remove smoke, desktop-file
  validation, and local server health.
- Phase 5: device-native dependency resolution, package ownership/path audit,
  clean Termux install/upgrade/remove smoke, framework/app-worker/terminal tests,
  and managed Code Server opt-in.

Each phase is a separate implementation approval boundary. Package signing,
APT repository publication, automatic updates, Android distribution, HTTPS
certificate management, background system services, and non-amd64 Electron
packages are deferred unless separately approved.
