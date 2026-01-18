# Framework Shells “Project Fork” (10/10 Plan)

This doc is the “make it worth forking” plan: turn Framework Shells from “internal TE2 shell manager” into a **manifest-driven local process platform** that is useful on its own, while still being able to slot back into TE2.

## Execution stance (this branch)

This branch is not “incremental rollout engineering”. We patch forward:

- **One code path** (no feature flags / no dual implementations)
- **Hard prerequisites** (document them; don’t soft-detect)
- **Package-first split**: fully package the `framework_shells` library first, accept that TE2 will be temporarily broken, then patch both until we end with:
  - a standalone library
  - a fully functional TE2 consuming that library

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
- `cwd` (string; omit to use default)
- `env` (map; omit for none)
- `subgroups` (string[]; omit for none)
- `ui` (free-form UI hints; omit for none)
- `readiness` (omit for none):
  - `type: "stdout_regex" | "tcp_port" | "http_ok"`
  - per-type fields
- `restart` (omit for none):
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
- TE2 is updated to use `Authorization: Bearer` (no parallel auth surfaces)

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
  - FastAPI router

TE2 integration:

- `sessions_and_shortcuts` swaps from “poll every 5s” to:
  - initial snapshot + incremental events
- IPC registry events (process register/unregister) can be forwarded into the same bus (or streamed in parallel and merged client-side).

### 4) “Attach that feels like tmux” (UX is the sexiness)

Requirements:

- PTY attach/reconnect without losing the shell
- scrollback persistence (server-side log replay)
- resize correctness
- can attach from CLI and from browser UI

This is where the shell manager stops feeling like plumbing.

#### Pillar 4 implementation notes (dtach plan, v1 + v2)

This pillar is best achieved by using **dtach as the server-side PTY persistence layer**, then treating TE2/framework_shells as a disposable “client bridge”.

**v1 guarantees (practical, still big):**

- the shell survives browser reloads/disconnects
- the shell survives framework restarts *if* dtach/socket remains
- scrollback can be restored from the existing `.stdout.log` file (replay API + then switch to live)

**v1 limitation (important):**

dtach is a PTY multiplexer, not a scrollback store. If TE2 is down and **no dtach client is attached**, output produced during that window will not be appended to TE2’s `.stdout.log` (because TE2 isn’t connected to record it).

**Phase 4B (“no missed output during framework downtime”):**

spawn a lightweight always-on “tap” process per dtach-backed shell that stays attached and appends output to the log continuously. This costs another process per persistent terminal but closes the downtime gap.

**Implementation sketch (dtach-backed PTY):**

- spawn: `dtach -n <socket> <command...>`
- attach: run `dtach -a <socket>` as a subprocess *behind a local pty* (so dtach behaves like a real terminal program), then forward bytes between that pty master and:
  - websocket subscribers (browser terminal)
  - CLI attach (stdio)
- write: either write to the attach-bridge pty master, or use `dtach -p <socket>` for one-shot injections
- resize: propagate via local pty ioctl (bridge), plus `SIGWINCH` as needed

**Security / isolation notes (must-haves):**

- dtach sockets must be runtime-namespaced: `<base>/<runtime_id>/sockets/<shell_id>.sock`
- ensure sockets are not world-readable/writable (0600); otherwise the filesystem becomes a cross-runtime control surface regardless of API auth
- treat “socket path” as a capability: if another runtime can open it, it can inject input

**API surface (minimal):**

- `GET /api/framework_shells/{id}/replay?lines=N` → returns log tail (for scrollback restore)
- terminal attach is exposed via the websocket adapter (TE2 already has a working terminal WS surface; the library provides the same concept via its adapter)

This pillar is documented in more detail in `pillar4draft.md` (folded into this plan by reference; v1 clarifications above override any ambiguity).

---

## TE2 App Worker Integration (fold-in from `app-worker_integration_issues.md`)

This section fills a gap: TE2 app workers are themselves framework shells, and their child shells (terminals, LSP servers, agents) need a first-class integration story in the fork plan.

### Current architecture (what TE2 already does well)

- App manifest schema lives at `app/apps/<app_id>/manifest.json`.
- App workers are spawned by `app_manager.ensure_app_running()` as framework shells with `label="app-worker:<app_id>"`.
- Child shells are spawned from app backend code and are tracked via:
  - framework shells records (label/subgroups)
  - IPC registry (for `parent_pid` and child enumeration)
- `framework_shell_ui` is already manifest-driven and is live-loaded from disk by Sessions & Shortcuts.

### Integration requirements

- App manifests must coexist with `shellspec` (apps do not need to migrate to `shellspec.yaml`).
- App workers must remain first-class shells:
  - runtime_id + signatures apply
  - events apply
  - CLI listing includes them (`fs ps`).
- Child shells should inherit app context:
  - convention: `subgroups[0] = app_id`
  - tree view groups children under the app worker.
- Shutdown ordering must be preserved (children before parents).

### Proposed record-level app context (good idea; required)

Add fields to `ShellRecord` (library-core):

- `app_id: Optional[str]` (derived from `label` or `subgroups[0]`)
- `is_app_worker: bool` (derived from `label.startswith("app-worker:")`)
- `parent_shell_id: Optional[str]` (see contention note)

Derivation logic:

- if label starts with `app-worker:` → `app_id = label.split(':', 1)[1]`
- else if `subgroups` non-empty → `app_id = subgroups[0]`

**Contention / note:** do **not** rely on scanning in-memory PTY state to “infer parent shell id” (the `_infer_parent_shell_id()` idea from `app-worker_integration_issues.md`). It won’t be reliable across restarts and it mixes concerns. Prefer:

- pass `parent_shell_id` explicitly when spawning children (best), or
- continue to use IPC `parent_pid` to build the tree in the UI (already works today), or
- store `parent_pid` in the record and resolve to a parent shell id in the UI layer.

### UI hints registry

The current Sessions & Shortcuts behavior is a good dev affordance:

- it loads `framework_shell_ui` from app manifests on disk (live) so subgroup styling can be tweaked without respawning shells

This should remain TE2-side glue; the standalone library can support a generic `ui` dict in shell records and in `shellspec`, but it shouldn’t import TE2 app manifests as a hard dependency.

### Manager helpers (nice for both CLI and TE2)

- `list_shells_by_app(app_id)` (app worker + children)
- `terminate_app_shells(app_id, children_first=True)` (children first, then worker)
- CLI:
  - `fs ps --app <app_id>`
  - `fs down --app <app_id>`

### Event-driven Sessions & Shortcuts (ties directly to Pillar 3)

Today the extension polls every 5s. In the fork plan:

- connect → initial snapshot
- then stream events:
  - shell lifecycle events (`spawned/exited/updated`)
  - IPC registry events (`process.registered/unregistered`)

This keeps your existing UI as the flagship dashboard while removing polling.

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

### Adapters

- `framework_shells/api/fastapi_router.py`
- `framework_shells/cli/main.py` (CLI as first-class)

### TE2 adapter glue (stays in TE2)

Example:

- `app/libs/framework_shells_te2_adapter.py`

Responsibilities:

- map TE2 `get_setting()` / env to library Config
- IPC hooks (register/unregister) if desired

---

## Execution plan (package-first hard split)

### Step 1 — Package the library first (break TE2 on purpose)

- Create a real `framework_shells/` package (plus `pyproject.toml`) and move the current core into it.
- Keep FastAPI and websocket adapters in the package, but keep TE2-specific wiring out of core.
- Delete “two code paths” language from docs; we’re converging to the new architecture.

### Step 2 — Rewire TE2 to consume the package (patch forward until green)

- Replace `app.libs.framework_shells` imports with `framework_shells` imports.
- Update TE2 control surfaces to use one auth mechanism (`Authorization: Bearer`).
- Accept temporary breakage while the coupling is removed; the deliverable is “works again, but cleaner.”

### Step 3 — Implement event bus + update Sessions & Shortcuts

- Shell lifecycle changes emit events.
- Sessions & Shortcuts becomes snapshot + event stream (no polling loop).

### Step 4 — Implement dtach-backed PTY persistence + replay

- dtach becomes the standard persistence layer for PTY shells on this branch.
- Replay becomes a first-class API (log tail), then live attach.

### Step 5 — Implement shellspec orchestration + CLI

- `fs up/down/ps/logs/attach/diag` are part of the product, not “nice later.”

---

## Acceptance criteria (“it’s a 10”)

- You can hand someone:
  - a `shellspec.yaml`
  - `pipx install framework-shells`
  - and they can run/inspect/attach/diag services locally (without TE2).
- TE2 can embed it and keep its UI (Sessions & Shortcuts) as the dashboard.
- Two clones running concurrently cannot see/control each other via APIs and don’t collide on disk.
- “Attach” feels reliable (reconnect is boring).
