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

