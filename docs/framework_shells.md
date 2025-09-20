# Framework Shells Architecture Proposal

## 1. Motivation

Certain services (aria2 RPC daemons, container supervisors, local LLM runtimes, etc.) need long-lived shells but should not consume the limited interactive slots within Termux. The Sessions extension only surfaces shells marked `TE_SESSION_TYPE="interactive"`, yet today each service must roll its own process management. This proposal defines a core-managed facility for spawning and tracking background "framework shells" that stay hidden from user session UIs while remaining observable, guard-railed, and killable.

## 2. Design Goals

- **Isolation:** Shells run in dedicated dtach sessions tagged `TE_SESSION_TYPE=framework`, invisible to standard session listings.
- **Control:** Core API exposes CRUD operations, lifecycle hooks, and resource metrics.
- **Safety:** Requests are authenticated/authorised; commands run inside the user home; concurrency and resource caps prevent abuse.
- **Observability:** Metadata, logs, and health stats are queryable for monitoring and UI display.
- **Extensibility:** Supports declarative auto-start definitions and future orchestration (e.g., containers) without rewriting infrastructure.

## 3. Components

### 3.1 Shell Manager Module (`app/framework_shells.py`)

Centralises spawning and tracking logic.

- `FrameworkShellManager`
  - `spawn(command: list[str], cwd: Path, env: dict, label: str, autostart: bool) -> ShellRecord`
  - `list() -> list[ShellRecord]`
  - `get(shell_id: str) -> ShellRecord | None`
  - `terminate(shell_id: str, force: bool = False)`
  - `restart(shell_id: str)`
  - `sweep()` removes stale metadata when processes exit unexpectedly.
- Maintains metadata under `~/.cache/te_framework/<shell_id>/meta.json` with: command, cwd, env, pid, created_at, updated_at, label, status, autostart, log_path.
- Optional stdout/err capture to `stdout.log` / `stderr.log` (rotated with max size).

### 3.2 Metadata & Logging

- Directory per shell, owned by user, 0700 permissions.
- Metadata persisted as JSON for atomic updates; updates triggered on spawn, periodic sweep, lifecycle operations.
- Log files truncated/rotated (e.g., keep last 512 KB) to prevent disk growth.

### 3.3 Resource Accounting

- Use `psutil` for CPU %, memory RSS, uptime, optional I/O counters. Fallback to `/proc/<pid>` when psutil unavailable.
- Stats surfaced via manager so APIs/UX can display them.

### 3.4 Auto-Start Definitions

- Config file `config/framework_shells.toml` (optional) storing entries with keys: `id`, `command`, `cwd`, `env`, `autostart`, `restart_policy`.
- On server boot, manager reads config and ensures defined shells are running (respecting max shell limits).

## 4. Core APIs

All responses follow `{ "ok": true|false, "data"?, "error"? }`.

### 4.1 `POST /api/framework_shells`
- **Body:** `{ "command": ["aria2c", "--enable-rpc"], "cwd": "~/services", "env": {"ARIA2_SECRET": "..."}, "label": "aria2", "autostart": true }`
- **Response:** `{ "ok": true, "data": { "id": "fs_...", "pid": 1234 } }`
- Validates allowlist/quota and normalises paths inside `$HOME`.

### 4.2 `GET /api/framework_shells`
- Returns array of shell summaries (id, label, pid, status, cpu, memory, uptime, command_preview).

### 4.3 `GET /api/framework_shells/<id>`
- Returns detailed record including full command, env keys (values optional/masked), metadata, and recent log tail.

### 4.4 `POST /api/framework_shells/<id>/action`
- **Body:** `{ "action": "stop" | "kill" | "restart" }`
- Dispatches to manager; restart only allowed when `autostart` true.

### 4.5 `DELETE /api/framework_shells/<id>`
- Force removal: stop process (if alive), delete metadata/logs.

### 4.6 `GET /api/framework_shells/config`
- Optional endpoint to expose static config (auto-start definitions, quotas) for UI reference.

## 5. Security & Auth

- Core config defines `FRAMEWORK_SHELL_ALLOWLIST` (list of extension/app IDs). Requests from other origins rejected (403).
- Optionally require `X-Framework-Key` header matching secret in config for server-side automation.
- Commands MUST be provided as arrays to avoid shell injection; manager uses `subprocess.Popen(command, ...)` without `shell=True`.
- Enforce `cwd` inside `$HOME`; environment overrides limited to safe keys (e.g., block `PATH` modifications unless allowed).
- Rate limiting: e.g., max 3 spawn requests per minute per extension.

## 6. Resource Limits

- Global caps: `MAX_FRAMEWORK_SHELLS` (default 5), `MAX_MEMORY_PER_SHELL` (warn/deny when estimated > threshold), optional CPU quotas.
- Idle timeout policies: optional config to auto-stop shells after inactivity (tracked via heartbeat from extensions).

## 7. Failure Handling

- If spawn fails, clean up metadata and return descriptive error.
- Periodic sweeper clears orphaned metadata when processes exit or dtach sockets disappear.
- Restart policies (`never` | `on-failure` | `always`) enforced by watcher thread.

## 8. Future UI Extension

A dedicated extension can consume the APIs to display framework shells, offer kill/restart controls, show CPU/RAM charts, and expose log tails. Not in scope for the initial backend but informs API design (ensure sorted, filterable data, consistent timestamps, etc.).

## 9. Implementation Roadmap

1. Scaffold `FrameworkShellManager` and basic spawn/list/terminate operations with metadata storage and tests.
2. Wire Flask blueprint (`app/framework_shells_api.py`) exposing endpoints listed above.
3. Add configuration loader + allowlist enforcement.
4. Integrate psutil for metrics and ensure requirements updated.
5. Implement auto-start on server boot and watchers for restart policies.
6. Document usage in `CORE_API_MANUAL.md` and provide examples for extensions.
7. Optional: build management UI extension.

## 10. Open Questions

- Do we need per-shell log streaming (websocket) or is on-demand tail sufficient?
- Should secrets in env be stored encrypted/obfuscated in metadata?
- What is the ideal default for `MAX_FRAMEWORK_SHELLS` considering resource constraints on typical devices?
- How do we expose container-specific lifecycle events if/when container support lands?

This proposal forms the baseline for implementing the backend scaffolding described below. EOF
