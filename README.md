# Termux Extensions 2 

> It won't make you a professional programmer... but it'll make you feel like one.

---

> **Preview alpha:** TE2 is usable today, but its interfaces, extension coverage,
> and installation contracts are still evolving. Expect sharp edges and keep
> important work under version control.

TE2 is a local development workspace that runs the same project environment on
Linux desktops and in Termux. Its framework launches isolated apps, owns shell
and process orchestration, and provides shared filesystem, Git, search, state,
proxy, console, and debugging services.

Code TE2 is the flagship workspace app: a Monaco-based editor with an Explorer,
terminal surfaces, language tooling through code-server, diagnostics, drafts,
diff/review flows, and stateful sidebar apps.

## Remote-First Workspace

TE2 specializes in remote multi-client project mirroring, shared drafting, and
collaborative workflows. One framework owns the project, its open logical
documents, drafts, language and extension services, processes, and sidebar
membership. Each connected client keeps its own foreground document and local
presentation, so a desktop, phone, tablet, or another browser can work against
the same live project without screen sharing.

The framework can run on a conventional Linux host or directly inside Termux on
an Android device. A mobile device can therefore host the workspace as well as
connect to one hosted elsewhere.

The mobile and desktop clients are developed in parallel. Their layouts and
native controls differ, but features introduced for one form factor are designed
to remain meaningfully usable from the other rather than making mobile a
read-only or reduced companion.

Observed load times on the validated preview setups are approximately:

- **Warm project restoration:** 1–2 seconds.
- **Cold framework and project start:** about 5 seconds.
- **Document opens:** perceptually immediate on localhost and effectively
  immediate over ordinary remote/mobile connections. Testing has remained
  responsive even with slow transfer speeds and poor network latency.

These are practical observations, not performance guarantees. Project size,
storage, enabled extensions, host load, and network conditions still matter.

## Architecture

TE2 is Rust-first. Python remains a support and app-backend language, not the
framework authority.

```text
te2
  -> Python bootstrap locator
  -> fingerprinted Rust framework binary
       -> Ferrous / Framework-Shells process orchestration
       -> Rust filesystem, Git, search, state, app, and proxy services
       -> Python runtime bridge for TE2 console and MCP
       -> per-app Python/Node/native workers
```

The supported Rust framework source lives under `framework/`.

Important roots:

- `framework/rust/` — Rust framework workspace
- `framework/bootstrap/bootstrap.py` — cached build and launch bootstrap
- `app/apps/` — built-in TE2 apps
- `app/static/` and `app/templates/` — framework-served assets
- `app/te2_mcp/` and `app/te2_console_runtime.py` — runtime observability bridge
- `~/.local/share/te2/apps/` — user-local apps and proxy wrappers

## Included Apps

- `code_te2` — Code TE2, the primary workspace/editor app
- `terminal` — standalone Node PTY terminal with reconnect checkpoints
- `file_explorer` — standalone file browser
- `archive_manager` — archive browsing and extraction
- `aria_downloader` — aria2 download surface
- `settings` — framework settings and diagnostics
- `als-rs` — tracked ALS-RS proxy wrapper
- `file_editor` — older lightweight editor app retained separately from Code TE2

Integration depth varies by app. The app catalog is defined by the manifests
under `app/apps/*/manifest.json`; there is no built-in `codex_agent` app.

## VS Code Extension Compatibility

Code TE2 runs VS Code extensions through its private Code Server runtime and
WBA. Extensions can be searched and installed from the Explorer's **Open VSX**
tab. Language and LSP extensions generally work with little or no adjustment on
glibc Linux desktop hosts, especially when the extension bundles or can discover
a supported native language server.

Termux can run many of the same extension-host components, but a bundled glibc
language-server executable cannot run on Android/Bionic. The usual solution is
to install the native language server from the Termux repositories and point the
extension's normal executable setting at it. Confirmed examples include:

| Extension | Termux requirement |
| --- | --- |
| BasedPyright (`detachhead.basedpyright`) | Also install `ms-python.python` from the Open VSX tab. |
| Rust Analyzer (`rust-lang.rust-analyzer`) | Install the Termux `rust-analyzer` package and configure the extension to use that executable. |
| Clangd (`llvm-vs-code-extensions.vscode-clangd`) | Install Clang/LLVM, including `clangd`, from the Termux repositories and configure the extension to use the host-native server. |

This pattern applies to many other language extensions: install the extension,
provide a Termux-native LSP when its bundled server is incompatible, and use the
extension's existing server-path setting. Desktop installations usually discover
their supported server automatically.

Validated UI extensions include:

- Json Crack (`AykutSarac.jsoncrack-vscode`), including its editor action and
  visualization panel;
- Code Visualizer (`ducphamngoc.codevisualizer`), including live caret-driven
  visualization; and
- OpenAI Codex (`openai.chatgpt`).

The Codex extension overlaps with TE2's built-in ALS-RS Codex frontend; both are
supported, but running both presents two interfaces to the same underlying kind
of agent workflow. On desktop, the Codex extension works without a separate CLI
installation, while the built-in ALS-RS frontend expects the official Codex CLI
to already be available:

```bash
npm install -g @openai/codex
```

On Termux, both the Codex extension and ALS-RS require a Termux-compatible
`codex` executable to be installed and available on `PATH` before they start:

```bash
npm install -g @mmmbuto/codex-cli-termux@latest
```

The [`DioNanos/codex-termux`](https://github.com/DioNanos/codex-termux)
repository was archived on August 29, 2026. Its published
[`@mmmbuto/codex-cli-termux`](https://www.npmjs.com/package/@mmmbuto/codex-cli-termux)
package remains installable, but the archived line should not be expected to
receive further maintenance. The same maintainer continues the independent
[`@mmmbuto/codex-vl`](https://www.npmjs.com/package/@mmmbuto/codex-vl)
distribution, but its compatibility with TE2 has not yet been validated.

## Requirements

TE2's Python runtime requires Python 3.12 or newer. On the supported x86-64
Debian/Ubuntu Linux alpha, the release installer validates or installs `git`,
`build-essential`, `python3-venv`, and the distribution's `libarchive` runtime.
`build-essential` is needed because the standalone Terminal's first launch
compiles the locked `node-pty` module. TE2's Linux Python dependency supplies
the exact Node.js/npm runtime and matching headers, so a separate global Node.js
install is not required.

The checked-in Code TE2 frontend, WBA backend, and shared browser assets are
already built or vendored; ordinary runtime does not install npm dependency
trees for them. The Linux wheel carries the small locked Electron source tree
without Chromium, `node_modules`, or build output. Electron is materialized only
when the user runs `te2 desktop install`, launches `te2-desktop` for the first
time, or selects the unified installer's `--desktop` option.

A source or Git/pip install also needs Rust with Cargo because the launcher
builds and caches the framework server. Building the optional desktop client
from that install requires a glibc Linux x86-64 host plus Node.js 22.12 or newer
and npm; its locked dependency and Electron downloads remain in the TE2 cache.
Outside that explicit desktop build and the Terminal's private first-use
runtime bootstrap, npm is development-only when regenerating checked-in
artifacts. No global npm application package is required. Git is needed to
clone the repository or resolve a Git dependency, but the running framework's
Git implementation is Rust/libgit2 owned.

Some source integrations invoke external tools:

- `aria2c` enables the Aria Downloader worker;
- `watchexec` enables Code TE2's optional polling watcher; and
- C/C++ compiler commands enable Code TE2's direct C/C++ Run action.

For installed releases, each retained integration is supplied through the
unified installer's validated Linux or Termux prerequisite manifest, or removed
from the product. Users are not sent to repository construction scripts for
dependency setup.

Code TE2 can use its built-in Monaco language workers without Code Server.
VS Code extension-host integration uses Code TE2's confirmation-gated pinned
private Code Server runtime; no global Code Server installation is supported.
The managed Code Server Linux standalone bootstrap may require `curl` or `wget`
when the user opts in. Its Termux path downloads the pinned package with Python
and installs the exact package dependencies at that time.

The release tooling provides one autodetecting `install-te2` entrypoint.
Detection checks Termux first, then supports an initial apt-based glibc Linux
x86-64 target. Unsupported libc implementations, package managers,
architectures, and platforms fail explicitly.

Linux installs the exact PyPI release into a versioned private venv beneath the
canonical TE2 data root. It publishes a receipt, an atomic `current` pointer,
and user-local command wrappers. `--desktop` then delegates to that venv's own
`te2 desktop install`; the existing Electron bootstrap owns its locked source
build, cache, runtime publication, `.desktop` file, icon, and launcher wrapper.
The installer seeds Electron's existing local-framework configuration with the
stable managed command and `current/venv` paths, while preserving an explicit
user configuration.

Termux reuses its shared Python interpreter and apt-supplied dependencies
without a venv, while TE2's own Python tree and Bionic server remain versioned
beneath the canonical TE2 data root. Its target manifest includes `git` and the
native Node/npm mapping. Both targets share receipts, atomic current-release
activation, rollback, and removal.

Repository scripts are developer/release construction tooling and may build the
public installer and target archives. They are not copied into an ordinary
install or exposed as user installation entrypoints; users see them only in a
cloned or editable source checkout.

## Install And Run

From the current `0.2.342` alpha release. The alpha label describes product
maturity; this is a normal GitHub Release and is available through `latest`:

```bash
# Framework and CLI only.
curl -fsSL https://github.com/mrsurge/termux-extensions-2/releases/latest/download/install-te2 \
  | sh -s -- --yes

# Linux only: also build and register the Electron desktop client.
curl -fsSL https://github.com/mrsurge/termux-extensions-2/releases/latest/download/install-te2 \
  | sh -s -- --desktop --yes
```

Set `TE2_RELEASE_TAG=0.2.342` and use the matching tagged download URL when an
immutable pinned install is required.

The desktop option uses the exact private venv selected by the installer; it
does not depend on an unrelated system Python or Node installation. Electron's
existing 3 GiB build-space guard still applies. The installer does not launch
the desktop application automatically.

For the supported x86-64 Debian/Ubuntu Linux alpha from PyPI:

```bash
sudo apt-get update
sudo apt-get install -y build-essential
python -m venv ~/.local/share/te2-alpha-venv
. ~/.local/share/te2-alpha-venv/bin/activate
python -m pip install "te2==0.2.342"
te2
```

`build-essential` supplies the compiler and `make` needed by the Terminal's
first-use `node-pty` build. It is a system prerequisite, not part of TE2's
Python environment.

For a source checkout:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
te2
```

For a package install directly from Git:

```bash
python -m pip install "te2 @ git+https://github.com/mrsurge/termux-extensions-2.git"
te2
```

On supported Linux desktops, the same source/Git install can build and register
the Electron client in the current Python environment:

```bash
te2 desktop install
te2-desktop
```

`te2 desktop status`, `repair`, and `uninstall` inspect, rebuild, or remove the
fingerprinted user-local runtime and receipt-owned XDG integration. The build
requires at least 3 GiB of free disk space; a matching validated runtime is
reused without rebuilding.

Open `http://127.0.0.1:8089`. TE2 binds to localhost by default. Use
`te2 --broadcast all` only when unrestricted network access is intentional.
Prefer a narrower source or interface policy:

```bash
# Machine-readable names, addresses, prefixes, and networks.
te2 --list-interfaces

# Admit traffic whose destination is an address owned by this interface.
# This works for ordinary LAN adapters and /32 VPN adapters such as Tailscale.
te2 --broadcast tailscale0

# Admit only one client address or a client subnet.
te2 --broadcast 100.91.80.45
te2 --broadcast 100.64.0.0/10

# Mixed IPv4/IPv6 selectors are supported.
te2 --broadcast 192.168.1.0/24 fd7a:115c:a1e0::/48
```

Every filtered mode continues to admit loopback. The launcher resolves the
selectors once, opens only the required IPv4/IPv6 wildcard listeners, and
enforces the same policy before HTTP, SSE, raw WebSocket, or Socket.IO routing.
Framework-owned subprocesses continue to receive a loopback
`TE_FRAMEWORK_URL`, even when public listeners use wildcard addresses.

`--host <exact-ip>` remains an advanced bind override. A non-loopback exact
host binds that address plus a private same-family loopback listener; wildcard
host overrides allow all clients. Invalid selectors and interfaces without a
usable IP address fail before the framework binds any socket.

The launcher builds an optimized release server by default; pass `--debug` only
for an unoptimized development server. Cargo incremental artifacts live under
`$TE2_CACHE_HOME/framework/build/cargo-target`, where `$TE2_CACHE_HOME` means
the resolved canonical root described below. Final-binary publication is
locked and atomic, and only the selected validated fingerprint is retained.

Launcher overrides use the canonical `TE2_SERVER_*` namespace:
`TE2_SERVER_HOST`, `TE2_SERVER_PORT`, `TE2_SERVER_CACHE_DIR`,
`TE2_SERVER_BIN`, `TE2_SERVER_CARGO_MANIFEST`, `TE2_SERVER_DEBUG`,
`TE2_SERVER_FORCE_BUILD`, `TE2_SERVER_NO_BUILD_CACHE`, and
`TE2_SERVER_DISABLE_FERROUS_FRAMEWORK`. Bootstrap-to-server values use the same
namespace for bind hosts, internal host, network policy, project/app roots, and
Cargo target selection. The private Python sidecar uses
`TE2_RUNTIME_BRIDGE_HOST`, `TE2_RUNTIME_BRIDGE_PORT`, and
`TE2_RUNTIME_BRIDGE_URL`. Experimental-name environment variables are not read
as compatibility aliases. `TE_PORT` and `TE_FRAMEWORK_URL` remain the stable
cross-component framework contracts.

TE2 path overrides (`TE2_CACHE_HOME`, `TE2_DATA_HOME`, `TE2_CONFIG_HOME`, and
`TE2_RUNTIME_HOME`) name final TE2 roots. Without them, TE2 uses XDG bases when
available, normal `$HOME` fallbacks for cache/data/config, and a protected
runtime directory under `$TMPDIR` or Termux `$PREFIX/tmp`. Normal startup never
uses an old root as a fallback for these migrated caches. Durable framework and
Code TE2 store cutovers are tracked separately.

The first standalone Terminal launch installs its locked production Node
dependencies under `$TE2_DATA_HOME/node_runtime/terminal` (normally
`~/.local/share/te2/node_runtime/terminal` after root resolution). The runtime
is keyed by the lockfile, platform, architecture, and Node ABI, so Python
package installs do not depend on a source-checkout `node_modules` tree.

Useful launcher commands:

```bash
te2 --build-only
te2 --debug
te2 --print-command
te2 --memory-profile "$HOME/.cache/te2-memory-profile"
te2 console list-workers
te2 migrate-legacy-roots          # write-free report
te2 migrate-legacy-roots --json   # write-free structured report
```

`--memory-profile` is an explicit desktop diagnostic mode. It requires a
separately installed Heaptrack, uses an optimized symbolized Rust profile, and
enables explicit Python and Node heap snapshots. It is not a production
allocator mode. See
[the framework memory profiling guide](docs/apps/framework_memory_profiling/README.md)
before running it, especially when the active agent session is hosted by TE2.

Electron stores local launch policy separately at
`$TE2_CONFIG_HOME/desktop-local-framework.json`. When that file is absent,
Settings presents in-memory defaults and an unsaved `te2` PATH detection; the
Linux installer later seeds its exact private-venv and command paths. Source
smokes may still use the higher-priority absolute
`TE2_DESKTOP_TE2_EXECUTABLE` override. The versioned launch record owns the
command, optional venv, broadcast selectors, port, and bounded environment
overrides. An empty broadcast list stays loopback-only. Normal framework
traffic remains on HTTP/Socket.IO/WebSocket/SSE. The bootstrap's
`--stdio-control` mode is a desktop lifecycle channel: stdin accepts versioned
NDJSON control requests, inherited file descriptor 3 returns structured
responses/events, and stdout/stderr remain ordinary logs. Protocol v1 permits
only graceful shutdown; it is not an arbitrary command-execution interface.

Legacy-root recovery is deliberately opt-in. After reviewing the dry-run,
`te2 migrate-legacy-roots --apply` performs the versioned one-time migration
only while the framework is stopped. The allowlisted legacy source is
authoritative: matching canonical files are overwritten, while files that
exist only in a canonical destination tree are retained. Unknown or externally
owned content is reported and left untouched.

`te2-rust` is an alias for the same Rust launcher. `scripts/run_framework.sh`
is a source-checkout helper that also invokes the Rust launcher directly.

Code TE2 does not use a system, `PATH`, NVM, or environment-selected
code-server. Its Code Server mode always uses the pinned private runtime under
`$TE2_DATA_HOME/code_server/4.130.0` and routes process launch, VSIX/Open
VSX management, builtin-extension discovery, and WBA nid extraction through
that exact tree. The Languages & Extensions settings can switch the app to
Monaco language web workers instead; doing so stops the private runtime and
removes only its managed installation while preserving installed extensions.

## Build Code TE2 Frontend

Code TE2 serves generated bundles from `static/dist/`. After changing its
frontend source:

```bash
cd app/apps/code_te2
npm install
npm run typecheck
npm run build
```

The source entrypoints are `main.ts` for the host and
`monaco_editor/m_editor_app.ts` for the editor. Generated bundles are not the
source of truth.

## App Model

Built-in and user-local apps share the same manifest model. An app may provide
frontend assets, an app-worker shellspec, backend routes, semantic readiness,
sidebar state, and proxy-wrapper configuration.

External applications do not need to be rewritten as TE2 internals. A thin
wrapper under `~/.local/share/te2/apps/<app_id>` can launch the real application
through Framework-Shells and expose it through TE2's proxy surface. The wrapped
application remains independently runnable; TE2 is its development harness,
not a hidden product dependency.

## Acknowledgements

TE2 depends on excellent independent open-source projects, including:

- [Cefrium](https://codeberg.org/cefrium/cef-android), which brings CEF to
  Android and powers TE2's Chromium-based Android client. Special thanks to its
  maintainer for the `0.7.1` iframe WebSocket and scheduling-latency fix.
- [Electron](https://www.electronjs.org/), whose Chromium and Node.js runtime
  powers TE2's Linux desktop shell.

## Repository Guidance

[Technical Deep Dive](docs/apps/code_te2/CODE_TE2.md) (for a technical deep dive in how one makes a code/editor dev platform
 with a python script and have it perform as good as a VS-Clone)

GeckoView remains the primary Android client. The isolated `android/cefrium`
application module evaluates the Cefrium CEF runtime without adding Chromium
resources or native libraries to Gecko builds; see
`android/cefrium/README.md` for its build and runtime contract.
