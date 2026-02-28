# Codex Agent App Wrapper (Framework-Hosted)

This app is a framework wrapper around the Codex Agent server process.

The UI is loaded inside the framework app shell, but all Codex Agent content is served by the worker process and accessed through a framework-owned reverse proxy namespace.

## Purpose

`codex_agent` exists to:
- launch and supervise the Codex Agent worker via shellspec,
- expose the Codex Agent web UI inside framework app shell UX,
- route all iframe traffic through framework-owned proxy routes,
- avoid modifying framework core routing (`app/main.py`) for app-specific transport behavior.

## Components

### 1) App Manifest

File: `app/apps/codex_agent/manifest.json`

Defines:
- app identity (`id: codex_agent`),
- frontend entrypoints (`template.html`, `main.js`),
- backend blueprint (`main.py`, minimal readiness route),
- worker shellspec reference,
- framework service modules:
  - `services/appserver_transport.py`.

### 2) Frontend Wrapper

Files:
- `app/apps/codex_agent/template.html`
- `app/apps/codex_agent/main.js`

Behavior:
- renders a loading screen + iframe,
- waits for health on proxied URL:
  - `/api/app/codex_agent/proxy/api/health`
- once healthy, sets iframe `src` to:
  - `/api/app/codex_agent/proxy/codex-agent`

This keeps the browser origin on the framework host/port while the content is served from the worker through proxying.

### 3) Worker Launch (Shellspec)

File: `app/apps/codex_agent/shellspec/app_worker.yaml`

Starts the worker from:
- `worktrees/agent_log_server/`

Command:
- `python server.py --log app-server.log --port 12359 --host 127.0.0.1 --debug --broadcast-all`

Readiness:
- TCP port check on `127.0.0.1:12359`.

### 4) Framework-Owned Service Proxy

File: `app/apps/codex_agent/services/appserver_transport.py`

Loaded by framework process at startup via apps extension service loader.

Registers namespaced proxy routes under:
- HTTP:
  - `/api/app/codex_agent/proxy`
  - `/api/app/codex_agent/proxy/{rest:path}`
- WebSocket:
  - `/api/app/codex_agent/proxy/socket.io`
  - `/api/app/codex_agent/proxy/socket.io/{rest:path}`
  - `/api/app/codex_agent/proxy/ws/{rest:path}`

It also promotes namespaced HTTP routes ahead of the generic app proxy route to ensure requests resolve to this service first.

## Why Path Rewriting Exists

The upstream Codex Agent server emits absolute root paths such as:
- `/codex-agent/...`
- `/static/...`
- `/api/...`
- `/ws/...`

When served through framework namespace `/api/app/codex_agent/proxy*`, those absolute paths must be rewritten so assets, API calls, and sockets stay inside the namespaced proxy.

Current rewrite behavior (service module):
- quoted paths in HTML/JS: `'/static/'`, `'/api/'`, `'/ws/'`, `'/codex-agent'`,
- CSS/HTML `url(/static/...)` and `url(/codex-agent/...)`,
- socket.io client init for `/appserver` namespace to use namespaced engine path,
- xterm/raw websocket URL template segment using `window.location.host}/ws/`.

No framework-core route edits are required for this.

## End-to-End Runtime Flow

1. User opens framework app route:
   - `/app/codex_agent`
2. Framework app shell loads `codex_agent` frontend script.
3. Frontend polls proxied health endpoint.
4. Worker is ensured/running on `127.0.0.1:12359`.
5. Frontend sets iframe to proxied UI path.
6. Framework service forwards HTTP/WS to worker and rewrites payload paths.
7. UI runs fully through framework origin (for remote access via framework port).

## Route Ownership Model

- Framework process owns:
  - `/api/app/codex_agent/proxy*` transport surface.
- Worker process owns:
  - native upstream routes (e.g. `/codex-agent`, `/static`, `/api/...`, `/ws/...`) on port `12359`.
- Wrapper frontend consumes framework-owned surface only.

This separation matches services model used by other app services.

## Validation Commands

Framework-side checks:

```bash
curl -i http://127.0.0.1:8089/api/app/codex_agent/proxy/api/health
curl -i http://127.0.0.1:8089/api/app/codex_agent/proxy/codex-agent/
```

Worker-side direct checks:

```bash
curl -i http://127.0.0.1:12359/api/health
curl -i http://127.0.0.1:12359/codex-agent/
```

If framework-side endpoints fail but worker-side succeeds, restart framework process so app services reload.

## Troubleshooting

### Symptom: iframe stuck on "Waiting for Codex Agent server..."

Check:
- worker is running/listed,
- proxy health endpoint returns 200,
- framework process has loaded latest service module.

### Symptom: HTML loads but assets/api/ws fail

Check:
- proxied HTML/JS/CSS responses contain namespaced paths,
- socket.io endpoint under `/api/app/codex_agent/proxy/socket.io` is reachable,
- no stale framework process using old service code.

### Symptom: 404 on `/api/app/codex_agent/proxy/*`

Likely cause:
- framework process started before service module update (stale route table).

Action:
- restart framework process, then retest validation commands.

## Files of Interest

- `app/apps/codex_agent/manifest.json`
- `app/apps/codex_agent/main.js`
- `app/apps/codex_agent/template.html`
- `app/apps/codex_agent/main.py`
- `app/apps/codex_agent/services/appserver_transport.py`
- `app/apps/codex_agent/shellspec/app_worker.yaml`
- `worktrees/agent_log_server/server.py`

