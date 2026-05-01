# Termux Extensions 2

TE2 is a fully loaded development and app environment built for programming on mobile and desktop from the same unified workspace.

It is geared toward web development, compiled-language development, and local tool-driven workflows, while staying practical on a phone or tablet through a mobile-first UI and a real host runtime underneath.

Today, the deepest integration is **Code TE2**, but the framework is bigger than the editor. The long-term goal is a **fully unified project environment** where the editor, terminal, explorer, settings, wrappers, and hosted tools all operate as parts of the same system.

## Screenshots

> Screenshot 1: TE2 app launcher on mobile

> Screenshot 2: Code TE2 editor on desktop

> Screenshot 3: Code TE2 editor on mobile

> Screenshot 4: Integrated sidebar app or harness app

> Screenshot 5: Multi-app project workspace

## What TE2 Is

TE2 is a framework that combines:
- a shared launcher and app shell
- isolated app workers
- framework-owned process and shell management
- app proxying and app hosting
- mobile-friendly UI patterns that also work cleanly on desktop
- a path for both native TE2 apps and shimmed external apps

This is not just a web editor. It is an environment for running a project workspace with tools around it.

## What You Get

- **One environment across devices**
  The same project environment can be used from desktop and mobile, with UI that is intentionally designed for both.

- **A real coding stack**
  Code TE2 is the flagship app today: editor, explorer, terminal, diagnostics, language tooling, drafts, diff overlays, and project-aware behavior.

- **Tooling for real development**
  TE2 is meant for web work, scripting, and compiled-language workflows, not just note-taking or toy demos.

- **App-based architecture**
  Features are not hardcoded into one monolith. They live as apps and framework services that can evolve together.

- **A practical mobile story**
  The project is built around the idea that a mobile environment should still be able to host serious development work.

## Current Integrated Apps

Current app roots in this repo already include:
- `file_editor_cm6` — **Code TE2**, the current primary editor app
- `terminal` — standalone terminal app
- `file_explorer` — file browsing / project navigation surface
- `archive_manager` — archive workflows
- `settings` — framework/app settings surface
- `codex_agent` — a shimmed/harnessed app for the `agent_log_server` stack, running through the shared proxy model

Integration depth is not equal across all apps yet. Code TE2 is currently the deepest and most complete app lane, while the larger goal is to bring the full project environment into one coherent system.

## App Model

TE2 has **two app roots**:
- built-in apps in `app/apps/`
- user-local apps in `~/.local/share/te2/apps`

That means TE2 can ship first-party apps from the repo while also supporting locally added apps outside the repo tree.

Apps can enter the environment in two ways:
- **native TE2 apps** that live directly in an app root
- **shimmed / harnessed apps** that are brought in through the shared wrapper/proxy path

The concrete example in this tree is `codex_agent`, which is integrated as a proxy-shell app rather than a bespoke parallel server.
Its current shim target is the `agent_log_server` repo, which is installed as part of the preferred TE2 package install path.

## Framework Harness / Wrapper Path

Not every useful tool needs to be rewritten as a native TE2 app.

TE2 also supports bringing external apps into the environment through the shared harness/wrapper model:
- the framework can scaffold wrapper apps
- shared proxy infrastructure can host external UIs inside the TE2 shell
- those apps can still participate in the broader environment instead of living completely outside it

This is the path that lets TE2 absorb useful tools instead of forcing everything to start as a first-party app.

## Quick Start

### Desktop / Linux

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install "te2 @ git+https://github.com/mrsurge/termux-extensions-2.git"
te2
```

### Termux

```bash
python -m pip install "te2 @ git+https://github.com/mrsurge/termux-extensions-2.git"
te2
```

Then open:
- `http://127.0.0.1:8089`

By default TE2 stays on localhost. If you want LAN access, run `te2` with the appropriate `--broadcast` arguments.

The preferred install path is the package install path above. It installs:
- this repo as the `te2` package/CLI
- `framework-shells`
- `agent-log-server`

## Why The Framework Matters

The important idea is not just "there is an editor app."

The important idea is:
- editor, terminal, explorer, settings, wrappers, and future tools can live in one environment
- the environment works on mobile without giving up desktop usability
- apps can be added natively or brought in through a harness
- the project is moving toward a 100% unified workspace instead of a pile of unrelated tools

## Current Direction

Right now TE2 is strongest in the Code TE2 lane.

The current direction is to keep tightening the framework as a whole:
- unify the project environment more completely
- deepen cross-app integration
- keep mobile support first-class instead of treating it as an afterthought
- make external tools easier to absorb through wrappers and harness apps

## Deeper Docs

If you want the deeper app-specific details:
- Code TE2 app docs in the repo docs tree
- Code TE2 architecture reference in the repo architecture docs
- Codex harness app notes: `app/apps/codex_agent/README.md`
