# Termux Extensions 2 

> It won't change you into a professional programmer... but it'll make you feel like one.
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

The supported package requires Python 3.12 or newer and a Rust toolchain with
Cargo. Git and Framework-Shells are required for the normal development
workflow. Node.js is required when rebuilding TypeScript/JavaScript frontends,
and code-server is required for Code TE2 language/extension integration.

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
`te2 --broadcast all` (or a narrower supported broadcast target) when network
access is intentional.

The first launch builds a fingerprinted Rust binary and caches Cargo/build
artifacts under the TE2 cache directory. Later launches reuse that binary until
the Rust source fingerprint changes.

Useful launcher commands:

```bash
te2 --build-only
te2 --print-command
te2 console list-workers
```

`te2-rust` is an alias for the same Rust launcher. `scripts/run_framework.sh`
is a source-checkout helper that also invokes the Rust launcher directly.

For a code-server installation outside the normal `PATH`, pass its executable
from the TE2 entry point:

```bash
TE2_CODE_SERVER_BIN=/home/droid/.nvm/versions/node/v22.23.1/bin/code-server te2
```

The override is inherited by Rust/Ferrous and the `file_editor_cm6` app worker.
Code TE2 uses the same resolved executable for process launch, version probing,
builtin-extension discovery, and WBA nid extraction. Without an override it
checks `PATH`, the login shell, NVM installations, `$PREFIX/bin`, and
`~/.local/bin` in that order.

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
