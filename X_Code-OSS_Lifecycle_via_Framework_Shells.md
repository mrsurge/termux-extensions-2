# X/Code‑OSS Lifecycle via Framework Shells — Plan & Findings

**Goal:** Control the lifecycle of the X‑backed Code‑OSS IDE from your mobile Flask framework using the existing **Framework Shells** and **Supervisor**. Treat Code‑OSS like a GUI service you manage via a CLI control plane and the framework’s REST API.

---

## What the framework already gives you (relevant bits)
- **Supervisor & Run IDs**: a supervisor process creates a unique `TE_RUN_ID`, starts the Flask host, and cleans up framework shells on exit.
- **Framework Shells Manager**: spawn long‑lived background processes with `subprocess.Popen(start_new_session=True)`, track metadata, stream logs, and control them via REST (`spawn`, `list`, `describe`, `stop/kill/restart`, `remove`). Shells run in their own process groups; `SIGTERM`/`SIGKILL` is sent to the group for clean tree shutdown.
- **Runtime Metrics**: a metrics endpoint aggregates all running shells and host CPU/RSS; useful for health checks and dashboards.
- **Auth & Limits**: mutating operations can require `X-Framework-Key`; caps exist for concurrent shells.

*(All of the above is already implemented by your framework and needs no rewrite.)*

---

## Target architecture (X‑backed Code‑OSS under Framework Shells)
1) **Start Code‑OSS as a framework shell** with GUI env (`DISPLAY`, optional `XAUTHORITY`) and a friendly label like `service:code-oss-x`.
2) **Probe readiness** using Code‑OSS’s CLI (`code-oss --status`) via a tiny helper or by tailing logs. Consider the IDE “ready” when `--status` returns 0 (or the log hits a known ready message) and a window is present.
3) **Control lifecycle** via framework shell actions:
   - `stop` → sends `SIGTERM` to the process group (graceful Electron shutdown)
   - `restart` → terminates then relaunches with the same command/env
   - `kill`/`remove` → hard stop and prune metadata/logs
4) **Observe** via `GET …/framework_shells/<id>?logs=true&tail=200` and `/api/framework/runtime/metrics`.

This keeps Code‑OSS fully under the framework’s 
**single control plane** and plays nicely with app restarts (thanks to `TE_RUN_ID` adoption).

---

## Start/Stop Recipes (via your REST API)

### Spawn Code‑OSS (GUI host available)
```http
POST /api/framework_shells
Content-Type: application/json
X-Framework-Key: <token-if-enabled>

{
  "command": ["/usr/bin/code-oss", "--reuse-window", "--verbose"],
  "env": {
    "DISPLAY": ":0",                 // or :100 if using xpra/Xvfb
    "XAUTHORITY": "/home/user/.Xauthority"
  },
  "label": "service:code-oss-x",
  "cwd": "~",
  "autostart": true
}
```

**Readiness:**
- Option A (simple): spawn a short‑lived shell that loops `code-oss --status` for up to N seconds; when it exits 0, mark IDE ready in UI.
- Option B (logs): tail the framework shell’s stdout/stderr; detect the "workbench ready" line and flip status.

### Stop / Kill / Restart
```http
POST /api/framework_shells/<id>/action
Content-Type: application/json
X-Framework-Key: <token-if-enabled>

{ "action": "stop" }        // graceful SIGTERM to process group
{ "action": "restart" }     // stop + relaunch same command
{ "action": "kill" }        // SIGKILL + log cleanup (remove afterward)
```

### Inspect & Logs
```http
GET /api/framework_shells/<id>?logs=true&tail=200
GET /api/framework_shells        // list all shells
GET /api/framework/runtime/metrics
```

---

## Headless/Isolated GUI (optional)
If a desktop session is not present, run Code‑OSS inside **xpra** (recommended) or **Xvfb**—each as **its own framework shell**:

1) Start xpra:
```http
POST /api/framework_shells
{
  "command": ["xpra", "start", ":100", "--exit-with-children"],
  "label": "service:xpra"
}
```
2) Start Code‑OSS on that display:
```http
POST /api/framework_shells
{
  "command": ["/usr/bin/code-oss", "--verbose"],
  "env": { "DISPLAY": ":100" },
  "label": "service:code-oss-x"
}
```
Stopping `service:xpra` cleanly tears down Code‑OSS because it’s a child within that display server.

---

## Health & Readiness Policy
- **Process‑ready:** shell status is `running` and PID alive.
- **UI‑ready:** `code-oss --status` succeeds (0), or a ready log line is observed.
- **Live:** metrics show window(s) and CPU/RSS > 0 for the Code‑OSS PID.
- **Shutdown:** `stop` sends `SIGTERM` to the process group; if not down by timeout, escalates to `SIGKILL` (handled by the manager automatically).

---

## Security & Limits
- Enable `TE_FRAMEWORK_SHELL_TOKEN` and require `X-Framework-Key` for all mutations (spawn/action/delete).
- Keep the default concurrent shell limits unless you expect multiple IDEs.
- Surface last N errors/log‑tails in the Settings/Launcher UI for real debugging.

---

## How this interacts with the Code‑OSS Bridge
- The **bridge** still handles “document mirror + agent edits” inside the IDE; lifecycle here only starts/stops the IDE process and monitors health.
- Store the bridge’s auth/config in the **state store** and let the wrapper inject it when Code‑OSS is ready.

---

## Integration checklist (no code changes to framework libs)
- [ ] Choose GUI host: existing desktop `:0`, or spawn an xpra/Xvfb shell (labels: `service:xpra`, `service:code-oss-x`).
- [ ] Add launcher UI buttons that call the shell endpoints above (spawn/stop/restart/remove).
- [ ] Implement readiness flip using `--status` (helper shell) or a log pattern.
- [ ] Display metrics and log‑tail in the launcher card.
- [ ] Persist choices (display, flags) in the state store for the next run.

---

## Framework leverage recommendations
- **Use labels**: prefix with `service:` for Code‑OSS/X and `app-worker:` for app sandboxes—lets your limits and telemetry split cleanly.
- **Adopt on restart**: rely on the manager’s adoption logic with `TE_RUN_ID` to pick up any surviving GUI processes after crashes/reloads.
- **Group signaling**: the manager already signals the **process group**; this is perfect for Electron trees (no orphans).
- **Metrics as gating**: expose the metrics endpoint in the launcher and gate bridge operations on “UI‑ready”.
- **State store for auth**: keep Code‑OSS bridge tokens and config in `/api/state` so relaunches don’t prompt the user.

---

## Acceptance test
1) Spawn xpra (optional) then Code‑OSS via framework shells.
2) Readiness flips once `--status` passes.
3) Open files; bridge activates; mobile mirror shows the current buffer.
4) `stop` cleanly exits; `restart` brings it back with the same env.
5) Supervisor shutdown cascades and removes all shells and logs.
