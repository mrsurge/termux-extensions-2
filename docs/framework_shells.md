# Framework Shells Architecture

## 1. Motivation

Services such as aria2 RPC daemons, container helpers, or local LLM runtimes need
long-lived processes but should not consume the finite interactive shells surfaced
by the Sessions extension. Framework shells provide a core-managed way to spawn and
observe background jobs tagged with `TE_SESSION_TYPE=framework`, keeping them out of
user-visible session lists while remaining easy to manage.

## 2. Current Capabilities

- **Manager module:** `FrameworkShellManager` (in `app/framework_shells.py`) stores
  metadata, launches processes with `subprocess.Popen`, captures stdout/stderr logs,
  and updates status across restarts.
- **Metadata layout:**
  - `~/.cache/te_framework/meta/<id>/meta.json` — serialized `ShellRecord` data.
  - `~/.cache/te_framework/logs/<id>.stdout.log` and `.stderr.log` — append-only logs.
- **Lifecycle operations:** spawn, list, describe, graceful terminate, force kill,
  restart, and full removal (including logs and metadata). Supervisor shutdown
  (`POST /api/framework/runtime/shutdown`) cascades through the manager to close
  every recorded shell before the host process exits.
- **Resource stats:** When `psutil` is installed the manager reports CPU%, RSS, and
  thread counts; otherwise only basic uptime/alive flags are provided.
- **Access control:** Mutating endpoints may require the `X-Framework-Key` header if
  `TE_FRAMEWORK_SHELL_TOKEN` is configured. Read operations remain open.
- **Limits:** `TE_FRAMEWORK_SHELL_MAX` (default 5) caps concurrent running shells.
- **Run tracking:** Every shell record includes the launcher PID, run ID, and
  `uses_pty` flag. The supervisor writes the current run ID to
  `~/.cache/te_framework/run_id` so dtach sessions and other helpers can discover
  it on restart.
- **Runtime metrics:** `GET /api/framework/runtime/metrics` aggregates all running
  shells (and matching interactive sessions) for use in the Settings app or other
  diagnostics.

## 3. Core API Surface

| Method & Path | Description |
| --- | --- |
| `GET /api/framework_shells` | List shells with status and resource stats. |
| `POST /api/framework_shells` | Spawn a new shell (`command`, optional `cwd`, `env`, `label`, `autostart`). |
| `GET /api/framework_shells/<id>` | Detailed record; use `logs=true&tail=200` to fetch log tails. |
| `POST /api/framework_shells/<id>/action` | Accepted actions: `stop`, `kill`, `restart`. |
| `DELETE /api/framework_shells/<id>` | Remove metadata/logs. `?force=1` forces termination first. |

All responses honour the `{ "ok": true|false, ... }` envelope.

## 4. Manager Behaviour

1. **Spawn**
   - Validates that the command is a list of strings and the working directory
     (default `~`) resolves inside the home directory.
   - Creates unique shell ID `fs_<timestamp>_<uuid8>`, prepares log files, and
     launches the process with `start_new_session=True` so it survives Flask reloads.
   - Persists metadata and returns the running `ShellRecord`.

2. **Terminate / Kill**
   - Sends `SIGTERM` when asked to `stop`; escalates to `SIGKILL` if the process
     fails to exit within a short timeout (or immediately when `kill`).
   - Updates metadata with exit code (positive = exit status, negative = signal).

3. **Restart**
   - Forces termination, resets timestamps, and relaunches the original command with
     the same overrides/log files while keeping the shell ID stable.

4. **Removal**
   - Optionally terminates the process, prunes metadata directory, and deletes log files.
   - Supervisor shutdown automatically removes every shell directory to avoid
     orphaned metadata between runs.

5. **Sweep**
   - Opportunistically marks shells as `exited` when the process is no longer alive.

## 5. Authentication & Configuration

| Setting | Source | Effect |
| --- | --- | --- |
| `TE_FRAMEWORK_SHELL_TOKEN` | Env or `app.config` | Required value for `X-Framework-Key` header on mutating requests. Leave unset to allow local access without a token. |
| `TE_FRAMEWORK_SHELL_MAX` | Env or `app.config` | Max number of concurrent running shells (default 5). |
| `TE_FRAMEWORK_SHELL_DIR` | Env or `app.config` | Override metadata/log base directory (defaults to `~/.cache/te_framework`). |

## 6. Usage Walkthrough

1. **Spawn aria2 daemon**
   ```bash
   curl -X POST http://localhost:8080/api/framework_shells \
     -H 'Content-Type: application/json' \
     -d '{"command":["aria2c","--enable-rpc"],"label":"aria2"}'
   ```
   Save the returned `id`.

2. **List shells**
   ```bash
   curl http://localhost:8080/api/framework_shells
   ```

3. **Inspect logs**
   ```bash
   curl 'http://localhost:8080/api/framework_shells/<id>?logs=true&tail=200'
   ```

4. **Stop / Remove**
   ```bash
   curl -X POST http://localhost:8080/api/framework_shells/<id>/action \
     -H 'Content-Type: application/json' \
     -d '{"action":"stop"}'
   curl -X DELETE http://localhost:8080/api/framework_shells/<id>
   ```

## 7. Future Enhancements

- Declarative auto-start file (`config/framework_shells.toml`).
- Event bus hooks for crash notifications.
- Optional process quotas per extension/app.
- Richer metrics (I/O, GPU) and WebSocket log streaming.
- Integration UI for managing framework shells graphically.

## 8. Operator Controls & UI

- **🎛️ Settings App:** Surfaces the metrics endpoint, lists all framework shells
  with stop/kill/restart/remove actions, and exposes the supervisor shutdown
  control. Extension ordering is also managed here via `/api/settings`.
- **Supervisor script (`scripts/run_framework.sh`):** Preferred entry point; tags
  the current run, writes the ID to disk, launches `app.supervisor`, and cleans up
  shells on exit.

These notes reflect the implementation currently available in
`app/framework_shells.py`, `app/supervisor.py`, and the Settings app.
