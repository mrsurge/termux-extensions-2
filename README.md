# Termux Extensions 2 

> It won't make you a professional programmer... but it'll make you feel like one.
---

TE2 is a local development workspace that runs the same project environment on
Linux desktops and in Termux. Its framework launches isolated apps, owns shell
and process orchestration, and provides shared filesystem, Git, search, state,
proxy, console, and debugging services.

Code TE2 is the flagship workspace app: a Monaco-based editor with an Explorer,
terminal surfaces, language tooling through code-server, diagnostics, drafts,
diff/review flows, and stateful sidebar apps.

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

The current Rust source still lives under `rust-spike/` for historical reasons.
That directory is the supported framework implementation.

Important roots:

- `rust-spike/rust/` — Rust framework workspace
- `rust-spike/app/bootstrap.py` — cached build and launch bootstrap
- `app/apps/` — built-in TE2 apps
- `app/static/` and `app/templates/` — framework-served assets
- `app/te2_mcp/` and `app/te2_console_runtime.py` — runtime observability bridge
- `~/.local/share/te2/apps/` — user-local apps and proxy wrappers

## Included Apps

- `file_editor_cm6` — Code TE2, the primary workspace/editor app
- `terminal` — standalone Node PTY terminal with reconnect checkpoints
- `file_explorer` — standalone file browser
- `archive_manager` — archive browsing and extraction
- `aria_downloader` — aria2 download surface
- `settings` — framework settings and diagnostics
- `als-rs` — tracked ALS-RS proxy wrapper
- `file_editor` — older lightweight editor app retained separately from Code TE2

Integration depth varies by app. The app catalog is defined by the manifests
under `app/apps/*/manifest.json`; there is no built-in `codex_agent` app.

## Requirements

The supported package requires Python 3.12 or newer, a Rust toolchain with
Cargo, and Node.js with npm. Git and Framework-Shells are required for the
normal development workflow. The standalone Terminal uses Node.js at runtime
and builds its native `node-pty` dependency for the current device on first
use. Code-server is required for Code TE2 language/extension integration.

Platform package lists live under `scripts/requirements/`. Install their
non-Python dependencies with:

```bash
./scripts/install_dependencies.sh
```

Use `--platform termux` or `--platform ubuntu` when auto-detection is not
appropriate.

## Install And Run

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
te2 console list-workers
te2 migrate-legacy-roots          # write-free report
te2 migrate-legacy-roots --json   # write-free structured report
```

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
cd app/apps/file_editor_cm6
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

## Repository Guidance

- Read [AGENTS.md](AGENTS.md) before changing the repository.
- Read [.repo_memory.md](.repo_memory.md) for concise current architecture.
- Use [docs/README.md](docs/README.md) to understand the documentation tree.
- Treat `docs/planning/` as design history. Verify every claimed path and
  runtime contract against current source.

Android source and Android asset publication are separate work areas. They are
not implied by ordinary framework or frontend changes.

GeckoView remains the primary Android client. The isolated `android/cefrium`
application module evaluates the Cefrium CEF runtime without adding Chromium
resources or native libraries to Gecko builds; see
`android/cefrium/README.md` for its build and runtime contract.
