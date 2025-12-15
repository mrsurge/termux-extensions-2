# simple-dtach (sdtach) + tach — spec + user guide

This document covers **two unrelated tools** that happen to have similar names:

- **simple-dtach**: a tiny Python CLI wrapper around the **dtach** terminal utility.
- **tach**: a Python-distributed tool that **enforces module boundaries / dependency rules** in a codebase (configured via `tach.toml`).

---

## 1) simple-dtach

### What it is
**simple-dtach** (CLI: `sdtach`) is a convenience wrapper around the `dtach` command-line utility.

`dtach` is a minimal alternative to `screen`/`tmux` that lets you **detach** from a running process and **reattach** later without taking over your terminal UI like a full multiplexer.

simple-dtach’s stated goals:

- Keep `dtach` session sockets in a **standard location** (so you don’t need to pass `dtach -A <socket>` manually).
- Use **`Ctrl-T`** to detach (instead of dtach’s default `Ctrl-\`).
- Provide a dead-simple “run or reattach” workflow.

### Installation
`simple-dtach` is a Python package, but it **depends on the `dtach` binary** being available on the system.

- Install the Python wrapper:

```bash
pip install simple-dtach
# or
pipx install simple-dtach
```

- Ensure `dtach` is installed and on PATH.

### CLI surface
#### Command synopsis
```bash
sdtach [OPTIONS] [PROGRAM [ARGS...]]
```

- If `PROGRAM` is omitted, `sdtach` runs your default shell.
- If you run `sdtach` again, it reattaches to the existing session (or starts one if none exists).

#### Options
- `-n <name>`
  - Run/attach to a **named session**.
  - Enables multiple independent sessions.

- `--list`
  - List current sessions.

- `--debug`
  - Print extra debugging info.

### Behavioral spec
#### Session lifecycle
1. **Start a session** by running a command under `sdtach`:

```bash
sdtach cat
```

2. **Detach** from the running session using:

- `Ctrl-T`

3. **Reattach** by running:

```bash
sdtach
```

4. **End** a session by exiting the underlying program normally (e.g., `exit`, `Ctrl-D`, program termination).

#### Multiple sessions
Use `-n` to name sessions:

```bash
sdtach -n build
sdtach -n ssh
```

Detach from one and attach to another by running the same name.

### Mental model
Think of `sdtach` as:

- “**run this program under dtach**” +
- “**remember where the socket lives**” +
- “**standard detach key**”.

### Troubleshooting
- **`sdtach` starts, but detaching doesn’t work**
  - Your terminal may intercept `Ctrl-T`, or a remote layer may map it. Try testing locally.

- **`sdtach` errors about dtach**
  - The wrapper can be installed even when `dtach` isn’t. You still need the `dtach` binary.

- **Stale sessions**
  - If a session socket exists but the process is gone, listing sessions and/or cleaning the session directory may be needed.

---

## 2) tach

### What it is
**tach** is a tool to **define and enforce architectural boundaries** in a Python codebase:

- Define “modules” (packages / namespaces / folders treated as architectural units)
- Declare which modules may depend on which
- Optionally define **public interfaces** for modules
- Optionally define **layers** (e.g., `ui -> services -> core`)
- Check third-party dependency declarations vs actual imports
- Visualize dependency graphs
- Generate dependency maps
- Run impact-analysis-based tests

Tach is designed as a development-time tool (linting/CI), not a runtime framework.

### Installation
```bash
pip install tach
```

### Core artifacts
#### `tach.toml`
Project-level configuration file in the repo root.

At a high level it can define:

- `source_roots` — where Python code lives (supports globs)
- `exclude` — glob patterns to skip
- `modules` — module definitions + constraints
- `interfaces` — public interface patterns (optional)
- `layers` — ordering + closed layers (optional)
- extra flags like `exact`, `forbid_circular_dependencies`, etc.

#### `tach.domain.toml` (optional)
A “domain” config file that can be placed in subtrees to define modules/interfaces relative to that subtree (useful in monorepos).

### Concepts / terms
#### Module
A **module** in Tach is an architectural boundary. It maps to Python import paths (e.g., `a.b` corresponds to `<root>/a/b.py` or `<root>/a/b/__init__.py` depending on layout).

Each module can specify constraints like:

- Allowed dependencies (`depends_on`)
- Forbidden dependencies (`cannot_depend_on`)
- Visibility (who can import it)
- Utility modules (importable by all)
- Unchecked modules (excluded from checking)
- Layer membership

#### Interface
An **interface** entry defines what is considered “public” from a module.

If a module defines an interface, other modules are only allowed to import members that match the interface’s `expose` patterns.

#### Layer
A **layer** is an ordered grouping (e.g., `ui`, `commands`, `core`).

A module assigned to a layer cannot depend “upwards” (i.e., a lower layer importing a higher layer).

Some Tach configs also support “closed layers” to force traversal through a boundary layer.

---

## tach: command reference

### `tach init`
Guided setup and validation. It walks you through `tach mod`, `tach sync`, and `tach show`.

```bash
tach init [--force]
```

### `tach mod`
Interactive terminal UI to mark module boundaries.

```bash
tach mod [-d DEPTH] [-e path1,path2,...]
```

Behavioral notes:

- Arrow keys to navigate.
- `Enter` to mark/unmark a module.
- `Ctrl-a` to mark/unmark all siblings.
- Some builds support marking source roots with `s`.
- Save with `Ctrl-s`.

### `tach sync`
Scans imports and syncs your `tach.toml` with actual dependencies.

```bash
tach sync [--add] [-e path1,path2,...]
```

- Without `--add`, it can remove module entries that don’t exist in the current source roots.
- With `--add`, it adds missing dependencies but doesn’t remove unused ones.

### `tach check`
Main “linter-like” check for internal boundaries + interfaces.

```bash
tach check [--exact] [--dependencies] [--interfaces] [-e path1,path2,...]
```

- By default it runs all checks.
- `--dependencies` limits to dependency constraints only.
- `--interfaces` limits to interface rules only.
- `--exact` fails if you declared dependencies that are not used.

### `tach check-external`
Validates that external (third-party) imports are satisfied by declared dependencies (e.g., `pyproject.toml` or `requirements.txt`).

```bash
tach check-external [-e path1,path2,...]
```

### `tach report`
Generates a dependency/usages report for the module containing a given file/dir.

```bash
tach report [--dependencies] [--usages] [--external] \
  [-d module_path,...] [-u module_path,...] [--raw] \
  [-e path1,path2,...] \
  <path>
```

### `tach show`
Renders the module dependency graph.

```bash
tach show [--web] [--mermaid] [-o OUT] [included_paths...]
```

### `tach map`
Outputs a file-to-file dependency map as JSON.

```bash
tach map [-o OUTPUT] [--direction dependencies|dependents] [--closure PATH]
```

Notes:

- Default output is stdout (`-o -`).
- Default direction is `dependencies`.
- With `--closure`, it outputs the transitive closure for a specific file.

### `tach test`
An impact-analysis-based test runner (pytest).

```bash
tach test [--base BASE] [--head HEAD] [--disable-cache] -- [pytest args...]
```

- `--base` defaults to `main`.
- `--head` defaults to the current filesystem.

### `tach install`
Installs `tach check` into your development workflow as a git pre-commit hook.

```bash
tach install pre-commit
```

---

## tach.toml: configuration reference

### Top-level keys (commonly used)
```toml
exclude = [
  "**/*__pycache__",
  "build/",
  "dist/",
  "docs/",
  "tests/",
  "venv/",
]

# Where your import roots live.
# If not set explicitly, it typically defaults to ["."]
source_roots = ["."]

# Fail if declared dependencies are unused.
exact = false

# Ignore imports under `if TYPE_CHECKING:` blocks.
ignore_type_checking_imports = true

# Optional: fail on circular dependency cycles.
forbid_circular_dependencies = false

# Optional layering.
layers = ["ui", "services", "core"]

# Optional: how to treat code not covered by an explicit module.
# (varies by implementation/version; see docs for your tach build)
root_module = "ignore"  # example placeholder
```

### Module entries
```toml
[[modules]]
path = "myproj.api"
depends_on = ["myproj.core"]
layer = "ui"            # optional
visibility = ["myproj.app"]  # optional
utility = false          # optional
unchecked = false        # optional

[[modules]]
path = "myproj.core"
depends_on = []
layer = "core"
```

Key fields:

- `path` — Python import path of the module.
- `depends_on` — allowed module dependencies.
- `cannot_depend_on` — explicit deny list (overrides allows).
- `layer` — assigns module to a layer.
- `visibility` — who is allowed to import this module.
- `utility = true` — module is importable by all modules without declaring deps.
- `unchecked = true` — Tach does not check imports within this module.

### Interfaces
```toml
[[interfaces]]
from = ["myproj.core"]
expose = [
  "types.*",
  "public_api.*",
]

[[interfaces]]
# If `from` is omitted, the interface may apply broadly (depends on version).
expose = ["services.*"]
visibility = ["myproj.api"]
exclusive = false
```

### Cache + external (examples)
```toml
[cache]
file_dependencies = ["tests/**", "src/*.rs"]

[external]
exclude = ["pytest"]
```

---

## Practical workflows

### Workflow A: brand new repo
```bash
pip install tach

# Guided setup
tach init

# Enforce in CI / pre-commit
tach check
```

### Workflow B: incremental adoption
1. Define only a few module boundaries first.
2. Run `tach sync` to populate `depends_on` automatically.
3. Turn on `tach check` in CI.
4. Gradually add interfaces/layers later.

### Workflow C: monorepo / multi-package
- Use `source_roots` to enumerate each package’s source root (or use globs).
- Run `tach check-external` to catch missing inter-package dependency declarations.

---

## Comparison: why these two tools both matter (but in different ways)

- **simple-dtach** solves terminal process persistence (runtime ergonomics):
  - Keep processes alive, detach/reattach, trivial session management.

- **tach** solves architectural integrity (design-time correctness):
  - Keep large projects from turning into a dependency hairball.
  - Enforce boundaries/interfaces/layers.
  - Provide graph visualization and tooling automation.

