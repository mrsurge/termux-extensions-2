# Proxy Shell Manifest Schema

This document defines the `proxy_shell` manifest contract used by the shared apps extension proxy engine.

Engine owner:
- `app/extensions/apps/proxy_shell.py`

Loader validation path:
- `app/extensions/apps/loader.py`

Machine-readable schema:
- `app/extensions/apps/proxy_shell.schema.json`

## Purpose

`proxy_shell` lets an app run its own worker HTTP/WS server while being mounted through framework-owned routes:

- `/api/app/{app_id}/proxy`
- `/api/app/{app_id}/proxy/{rest:path}`

The wrapper UI can load proxied URLs from:

- `/api/apps/{app_id}/proxy_shell`

## Example

```json
{
  "proxy_shell": {
    "enabled": true,
    "start_path": "/codex-agent",
    "health_path": "/api/health",
    "rewrite": {
      "enabled": true,
      "path_prefixes": ["/codex-agent", "/static/"],
      "content_types": ["text/html", "javascript", "application/json", "text/css"],
      "absolute_root_paths": ["/api/", "/ws/", "/static/", "/codex-agent"],
      "css_root_paths": ["/static/", "/codex-agent/"],
      "ws_template_marker": "window.location.host}/ws/",
      "ws_template_replacement": "window.location.host}{proxy_prefix}/ws/"
    },
    "socketio": {
      "enabled": true,
      "inject_path": true,
      "namespace_marker": "io('/appserver', {"
    }
  }
}
```

## Fields

### `proxy_shell.enabled` (boolean, optional, default `true`)
- Enables proxy-shell behavior for this app.

### `proxy_shell.start_path` (string, required when enabled)
- Upstream worker path for iframe UI start.
- Example: `"/codex-agent"`.

### `proxy_shell.health_path` (string, required when enabled)
- Upstream worker path for startup readiness checks.
- Example: `"/api/health"`.

### `proxy_shell.rewrite` (object, optional)
- Configures payload rewrite behavior for proxied responses.

#### `rewrite.enabled` (boolean, optional)
- Enables rewrite stage.

#### `rewrite.path_prefixes` (string array, optional)
- Upstream request path prefixes eligible for rewrite.

#### `rewrite.content_types` (string array, optional)
- Content-type fragments eligible for rewrite.
- Typical values:
  - `text/html`
  - `javascript`
  - `application/json`
  - `text/css`

#### `rewrite.absolute_root_paths` (string array, optional)
- Root paths rewritten in quoted JS/HTML strings.
- Example values:
  - `/api/`
  - `/ws/`
  - `/static/`
  - `/codex-agent`

#### `rewrite.css_root_paths` (string array, optional)
- Root paths rewritten in CSS `url(...)` expressions.

#### `rewrite.ws_template_marker` (string, optional)
- Marker substring replaced in templated WS URL expressions.

#### `rewrite.ws_template_replacement` (string, optional)
- Replacement string for `ws_template_marker`.
- Must include `{proxy_prefix}` token.

### `proxy_shell.socketio` (object, optional)
- Socket.IO-specific rewrite/injection settings.

#### `socketio.enabled` (boolean, optional)
- Enables Socket.IO config handling.

#### `socketio.inject_path` (boolean, optional)
- If `true`, injects Engine.IO path into client init block.

#### `socketio.namespace_marker` (string, optional; required when `inject_path=true`)
- Marker in upstream JS to anchor path injection.
- Example: `"io('/appserver', {"`.

## Validation Rules (Loader-Time)

Loader validates `proxy_shell` at startup and stores errors in manifest diagnostics:
- `__service_errors__` entries prefixed with `proxy_shell:`.

Validation is fail-fast for malformed config but does not alter valid runtime behavior.

## Notes

- Put first-party templates under `app/apps/_templates/*` (not `vendor/`).
- `vendor/` is reserved for third-party/static vendored artifacts.

## TODO

- Run `validate_proxy_shell_manifest` in the `/api/apps/reload` flow so reload-time manifest updates are validated with the same rules as startup loading.
