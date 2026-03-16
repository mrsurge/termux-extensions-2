# Codex Agent Wrapper (Manifest-Driven Proxy Shell)

`codex_agent` is now configured as a generic `proxy_shell` app.

It no longer uses a bespoke per-app service proxy module. Proxy routing is provided by the shared apps extension engine.

## What Owns What

- App wrapper (`app/apps/codex_agent`) owns:
  - shellspec worker launch
  - iframe bootstrap UI (`template.html`, `main.js`)
  - manifest `proxy_shell` configuration
- Shared apps extension owns proxy transport:
  - `app/extensions/apps/proxy_shell.py`
  - route registration via `app/extensions/apps/loader.py`

## Runtime Flow

1. Launcher starts app worker with existing app lifecycle/manager flow.
2. Wrapper frontend waits on proxied health endpoint:
   - resolved via `/api/apps/codex_agent/proxy_shell`
3. Wrapper iframe loads proxied start path:
   - resolved via `/api/apps/codex_agent/proxy_shell`
4. Shared proxy engine forwards HTTP/WS/Socket.IO to the worker port.
5. Shared proxy rewrites absolute root paths to stay under:
   - `/api/app/codex_agent/proxy/*`

## Manifest Contract Used by This App

File: `app/apps/codex_agent/manifest.json`

`proxy_shell` block:
- `start_path`: upstream UI entry path
- `health_path`: upstream readiness path used by wrapper UI
- `rewrite`: explicit rewrite rules for quoted paths and CSS `url(...)`
- `socketio`: optional Socket.IO path injection marker

## Shared Proxy Routes

Registered once by apps extension:
- HTTP:
  - `/api/app/{app_id}/proxy`
  - `/api/app/{app_id}/proxy/{rest:path}`
- WebSocket:
  - `/api/app/{app_id}/proxy`
  - `/api/app/{app_id}/proxy/{rest:path}`

The engine promotes its HTTP routes ahead of generic framework app proxy route matching.

Apps extension also exposes manifest-resolved proxy URLs:
- `/api/apps/{app_id}/proxy_shell`

## Validation

Framework path:

```bash
curl -i http://127.0.0.1:8089/api/app/codex_agent/proxy/api/health
curl -i http://127.0.0.1:8089/api/app/codex_agent/proxy/
```

Worker direct:

```bash
curl -i http://127.0.0.1:12359/api/health
curl -i http://127.0.0.1:12359/
```

## Converting Another Non-Native App

Minimum pattern:

1. Provide app shellspec worker with `TE_APP_WORKER_PORT`.
2. Add `proxy_shell` block in app manifest.
3. Point wrapper iframe at `/api/app/<id>/proxy/<start_path>`.
4. Use proxied health endpoint for readiness gate.

No per-endpoint proxy module should be needed.

## TE2 Harness Value

As a sidebar-hosted TE2 app, `codex_agent` is useful as more than a wrapper smoke test.

It has already validated this development loop:
- use the sidebar-hosted app as the real harness instead of a parallel ad hoc server
- use TE2 console tools against the live frontend worker
- use framework-shells visibility against the TE2-owned runtime
- iterate by patching, rebuilding, and validating inside the hosted path

That combination is materially better than debugging from static code or visible UI guesswork alone.

## TODO

- Ensure `/api/apps/reload` applies the same `proxy_shell` manifest validation used at startup (`validate_proxy_shell_manifest`) before refreshed manifests are exposed.
