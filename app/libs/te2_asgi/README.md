# Neutral ASGI helpers

`app.libs.te2_asgi` shares transport primitives, not app routes or a second server.
It depends on msgspec and Starlette response/exception primitives, without
FastAPI, Pydantic, Socket.IO, Uvicorn or app imports. `app_worker_asgi.py` remains
the worker export/lifespan/probe integration; this library does not own readiness.

## Body policy belongs to the app

- `read_json_object(scope, receive, max_bytes=...)`: bounded JSON-object ingress,
  requiring an object even for JSON `null`. `empty="decode"` preserves an invalid
  JSON error for an empty body; `"reject"` uses "Request body is required";
  `"object"` yields `{}` for an empty body only.
- `read_optional_json_object(...)`: empty body or JSON `null` yields `None`.
- Both validate Content-Length/content type before reading, bound accumulated
  chunks before appending, reject invalid body events/bytes, and raise
  `ConnectionAbortedError` on disconnect without reaching a mutation.
- The default decoder is msgspec JSON. `decoder=` permits an explicit existing
  app codec policy. File Explorer retains `json.loads` encoding/number semantics;
  its string-field validation and DTO handling stay app-owned.

| Consumer | Limit | Empty body | JSON null |
| --- | --- | --- | --- |
| Terminal normal commands | 1 MiB | Invalid JSON | Reject |
| Terminal sidebar state | 1 MiB | None | None |
| File Editor commands | 32 MiB | Invalid JSON | Reject |
| File Explorer normal commands | 1 MiB | Required-body error | Reject |
| File Explorer sidebar state/open URL | 1 MiB | Empty object | Reject |

## Response and lifecycle boundaries

`resolve_http_response(dispatch, logger=..., error_message=...)` catches only
pre-response dispatch errors. It retains `{"detail": ...}`/status/headers for
Starlette HTTPException and typed `HTTPError` (which supports structured detail).
Disconnected ingress returns `None`; unexpected dispatch failure logs and returns
the established plain 500 response. The app must transmit the returned response
**outside** this helper: streaming/download failures propagate after start without
an extra response, mutation retry or replay.

`require_method` preserves 405/Allow. `redirect_to` preserves the caller-selected
canonical path, mount root, raw query and 307; the app decides which routes and
slash forms qualify. `noop_lifespan` only acknowledges ASGI startup/shutdown for
apps that have no application lifecycle work. It must not replace worker hooks
or File Explorer's tab/socket/terminal service composition.

Routes, auth/identity/path checks, DTO validation, query policy, sockets/rooms,
downloads, state and process ownership remain app-owned. There are no decorators,
schema generation, handler introspection, automatic mounts or global app context.

Validation: `python -m pytest -q tests/test_te2_asgi.py` plus the adopted app/worker
regression suites. Runtime activation requires an approved ordinary app-worker
restart, not a frontend OTA or Code TE2 mypyc/Cargo rebuild.
