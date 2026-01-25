# Framework Shells Extraction + TE2 Integration (PR Summary)

## Overview

This PR completes the “Framework Shells” extraction: a large TE2-internal feature is now a standalone, framework-agnostic module (`framework_shells/`) with its own manager, runtime isolation, shellspec/orchestration layer, CLI, API, and self-hosted UI. TE2 is updated to consume this module as the reference integration (app workers, terminals, LSPs, shutdown, adoption, and UI).

Documentation split is intentional:
- `framework_shells.md` is the authoritative module reference.
- `te2.md` explains how TE2 uses the module.

## Why

- Replace hard-coded shell “types” and scattered process logic with a declarative spec (`shellspec`) and a single responsible runtime manager.
- Make shells observable and controllable via stable IDs/labels/subgroups and a unified shutdown story.
- Provide a module-owned, platform-agnostic UI so TE2’s historical “Sessions & Shortcuts” UI becomes a thin shim instead of the de facto owner.
- Set up the next step: extracting `framework_shells/` into its own repo/submodule after this merges cleanly to `main`.

## What’s Included

### 1) Standalone `framework_shells/` module

- `FrameworkShellManager` as the central runtime for spawning/tracking shells.
- Backends: `proc`, `pty`, `pipe`, `dtach` (persistent terminals).
- Runtime isolation: namespaced storage under:
  - `~/.cache/te_framework/runtimes/<fingerprint>/<runtime_id>/` (meta/logs/sockets)
- Adoption: best-effort adoption of orphaned shells across restarts where possible (dtach), marking dead shells exited.

### 2) Declarative shellspec (“Pillar 1”)

- `shellspec.py` provides YAML spec parsing + template rendering (e.g. `${free_port}`, `${ctx:*}`, `${env:*}`).
- `orchestrator.py` starts shells from specs/refs and merges UI/env/subgroups overrides.
- Apps provide per-app shellspecs in:
  - `app/apps/<app_id>/shellspec/app_worker.yaml`
- `manifest.json` references the shellspec via:
  - `shellspec/app_worker.yaml#app-worker`

### 3) Self-hosted “Framework Shells” UI (FWS)

The module hosts its own dashboard:
- `/fws/` live dashboard (WebSocket snapshot updates)
- `/fws/logs/{shell_id}` log viewer

Features:
- Groups shells by `subgroups` (umbrella + subgroup).
- Shows procfs-derived child processes under shells for visibility.
- Adds operational affordances:
  - shutdown tree / shells
  - per-shell stop/purge
  - exited-shell cleanup
  - log management (truncate vs delete)
- Compatibility routes retained for legacy TE2 callers.

### 4) UI hints moved to YAML (generic + module-owned)

UI styling hints now live in shellspec under `ShellSpec.ui` (and flow into `ShellRecord.ui`). The FWS UI supports:
- `ui.subgroup_styles` with pattern matching (e.g. `project:*`) to style subgroup cards/accents.

This removes host-specific UI coupling from app manifests and keeps the UI contract owned by the module.

### 5) TE2 integration updates (reference implementation)

- TE2 app worker spawning uses shellspec + `Orchestrator` rather than hardcoded command/port logic.
- TE2 mounts `framework_shells` routers (REST + websocket + FWS UI) into the framework app.
- TE2 shutdown flow correctly accounts for shells that outlive the framework PID (new sessions / dtach) by explicitly terminating via the manager + process snapshot planning.

### 6) Observability / tooling

CLI supports:
- `list`, `up`, `down`, `attach`
- `tree` (managed shells + procfs descendants) for debugging “invisible” child-process behavior (e.g. TypeScript language server child `node` processes).

## Notable Behavior Changes / Migration Notes

- Shell “types” are no longer a pile of hard-coded branching logic; they’re expressed as shellspec.
- The authoritative UI for shells is now module-owned at `/fws/`; TE2’s previous UI becomes an iframe shim.
- Log cleanup semantics are explicit:
  - truncation clears file contents (safe for running processes)
  - purge deletes metadata/log files for exited shells

## Testing / Verification

Manual verification paths:
- `/fws/` dashboard + logs pages
- `python -m framework_shells.cli.main list`
- `python -m framework_shells.cli.main tree --depth 4`

Practical shutdown testing:
- Ctrl+C from `scripts/run_framework.sh` / supervisor shutdown paths
- UI-driven shutdown paths

## Follow-up (Step 2)

After merging to `main`, extract `framework_shells/` into its own repo/submodule and wire TE2 to consume it as an external dependency.

