# Framework Shells “Project Fork” (10/10 Plan)

This doc is the “make it worth forking” plan: turn Framework Shells from “internal TE2 shell manager” into a **manifest-driven local process platform** that is useful on its own, while still being able to slot back into TE2.

The “10/10” is achieved by:

1. Declarative `shellspec` manifests (compose-like, but for local shells)
2. A real event bus (push updates, no polling, no localStorage/cookies)
3. A great default UX, reusing TE2’s existing “Sessions & Shortcuts” UI as the flagship dashboard
4. Multi-transport, not tied to FastAPI (FastAPI is *one* adapter)
5. Diagnostics + reproducibility (shareable bundles, deterministic records)
6. Strong runtime isolation (no cross-count/adopt/control across clones)

---

## Existing TE2 pieces to reuse (don’t reinvent)

### UI: “Sessions & Shortcuts” already *is* the shell manager dashboard

Files:

- `app/extensions/sessions_and_shortcuts/main.py`
- `app/extensions/sessions_and_shortcuts/main.js`
- `app/extensions/sessions_and_shortcuts/template.html`

What it already provides:

- framework shells listing + actions
- subgroup grouping + subgroup color styling
- tree view (app-worker “parent” with IPC children)
- “exited shells” section
- manifest-driven UI hints loaded live from disk (`/framework_ui`)

The biggest missing piece for “10/10” is replacing its 5s snapshot polling websocket with true shell lifecycle events.

---

## Product pillars (what changes the usefulness needle)

### 1) `shellspec` manifests (the headline feature)

Goal: make shell policies a “manifest problem”, not a “code wiring problem”.

Minimal spec file (v0):

- `id` (string)
- `command` (string or argv list)
- `cwd` (string, optional)
- `env` (map, optional)
- `subgroups` (string[], optional)
- `ui` (free-form UI hints, optional)
- `readiness` (optional):
  - `type: "stdout_regex" | "tcp_port" | "http_ok"`
  - per-type fields
- `restart` (optional):
  - `policy: "never" | "on-failure" | "always"`
  - `max_restarts`, `backoff_ms`

CLI semantics:

- `fs up shellspec.yaml` (start all)
- `fs down shellspec.yaml` (stop all)
- `fs ps` (list)
- `fs logs <id>`
- `fs attach <id>`
- `fs diag <id|group>`

### 2) Runtime isolation (keep your current split plan)

Single knob:

- `FRAMEWORK_SHELLS_SECRET`

Derived:

- `runtime_id = sha256(secret)[:16]`
- `api_token = HMAC(secret, "api")`
- `record_sig = HMAC(secret, canonical_json(record_without_sig))`

Rules:

- list/adopt/control is runtime-scoped by default
- record is trusted only if signature verifies
- mutating endpoints require auth (`Authorization: Bearer <api_token>`)
- compatibility: accept TE2’s `X-Framework-Key` as an alias for the bearer token while transitioning

Store namespace:

- `<base>/<runtime_id>/{meta,logs,sockets}`

Stable secret per repo clone:

- `repo_fingerprint = sha256(realpath(REPO_ROOT))[:16]`
- persist `~/.cache/te_framework/runtimes/<repo_fingerprint>/secret`
- `scripts/run_framework.sh` loads/creates and exports it so IPC + supervisor + framework inherit it

### 3) Event bus (push, not poll)

Define a minimal “shell events” feed:

Events (examples):

- `shell.created`, `shell.spawned`, `shell.ready`, `shell.updated`, `shell.exited`
- `shell.pty_chunk`, `shell.log_chunk`
- `shell.removed`

Transport:

- core has a subscription API (in-process event emitter)
- adapters can expose:
  - websocket stream
  - SSE (optional)
  - FastAPI router (optional)

TE2 integration:

- `sessions_and_shortcuts` swaps from “poll every 5s” to:
  - initial snapshot + incremental events
- IPC registry events (process register/unregister) can be forwarded into the same bus (or separately, then merged client-side).

### 4) “Attach that feels like tmux” (UX is the sexiness)

Requirements:

- PTY attach/reconnect without losing the shell
- scrollback persistence (server-side log replay)
- resize correctness
- can attach from CLI and from browser UI

This is where the shell manager stops feeling like plumbing.

### 5) Diagnostics bundles (shareable, supportable)

Command:

- `fs diag <id|group>`

Bundle includes:

- spec snapshot (if any)
- record JSON (sanitized env keys only)
- last N lines of stdout/stderr
- basic runtime/platform info
- last events timeline

---

## Target architecture (forkable)

### Core package (host-agnostic)

`framework_shells/`:

- `record.py` (schema + signing)
- `store.py` (namespaced store)
- `manager.py` (spawn/adopt/control)
- `pty.py` (pty spawn/attach/read/write/resize)
- `events.py` (event bus)
- `shellspec.py` (manifest parsing + orchestration)
- `diag.py` (bundles)
- `auth.py` (runtime_id + api token + signature)

### Adapters (optional)

- `framework_shells/api/fastapi_router.py`
- `framework_shells/api/sse.py` (optional)
- `framework_shells/cli/main.py` (CLI as first-class)

### TE2 adapter glue (stays in TE2)

Example:

- `app/libs/framework_shells_te2_adapter.py`

Responsibilities:

- map TE2 `get_setting()` / env to library Config
- compatibility header handling (`X-Framework-Key`)
- IPC hooks (register/unregister) if desired

---

## Execution plan (keep it safe, but fast)

### Step 1 — Keep TE2 running, add secret plumbing

- Update `scripts/run_framework.sh` to persist/load `FRAMEWORK_SHELLS_SECRET` per repo clone.
- Update log archive behavior to avoid cross-runtime interference (archive per `<runtime_id>` not global).

### Step 2 — Implement runtime namespace + record signatures inside TE2 first

- Modify the current manager to write runtime-scoped records/logs and verify signatures on read/adopt.
- Apply auth checks consistently (bearer + X-Framework-Key alias).

### Step 3 — Introduce a real event stream

- Add event emission in the manager for shell lifecycle changes.
- Replace `sessions_and_shortcuts` websocket loop from snapshot polling to event-driven updates.

### Step 4 — Add `shellspec` orchestration + CLI

- Implement `shellspec` parser + `up/down`.
- Add CLI commands for list/logs/attach/diag.

### Step 5 — Split to standalone package (in-repo first, then extracted repo)

- Move core into `framework_shells/` and keep TE2 glue thin.
- Once stable: extract to new repo.

---

## Acceptance criteria (“it’s a 10”)

- You can hand someone:
  - a `shellspec.yaml`
  - `pipx install framework-shells`
  - and they can run/inspect/attach/diag services locally (without TE2).
- TE2 can embed it and keep its UI (Sessions & Shortcuts) as the dashboard.
- Two clones running concurrently cannot see/control each other via APIs and don’t collide on disk.
- “Attach” feels reliable (reconnect is boring).

