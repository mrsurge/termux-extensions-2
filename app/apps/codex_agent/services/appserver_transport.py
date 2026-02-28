import asyncio
import inspect
import re
import sys
from contextlib import suppress
from typing import Optional

import httpx
import websockets
from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse, Response
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.libs.app_manager import get_running_apps

APP_ID = "codex_agent"
PROXY_PREFIX = f"/api/app/{APP_ID}/proxy"
UPSTREAM_HOST = "127.0.0.1"
HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
UPSTREAM_TIMEOUT = httpx.Timeout(60.0, connect=5.0)

_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

_http_client: Optional[httpx.AsyncClient] = None


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, follow_redirects=False)
    return _http_client


async def _get_upstream_port() -> Optional[int]:
    running = await get_running_apps()
    app_info = running.get(APP_ID)
    if not isinstance(app_info, dict):
        return None
    try:
        return int(app_info.get("port"))
    except Exception:
        return None


def _strip_hop_headers(headers: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in _HOP_HEADERS:
            continue
        if lk == "host":
            continue
        out[k] = v
    return out


def _response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in _HOP_HEADERS:
            continue
        if lk in {"content-length", "content-encoding"}:
            continue
        out[k] = v
    return out


def _rewrite_prefixed_payload(text: str) -> str:
    out = text
    # Rewrite API/WS first so paths introduced by codex/static rewrites are not re-prefixed.
    for q in ("'", '"', "`"):
        out = out.replace(f"{q}/api/", f"{q}{PROXY_PREFIX}/api/")
        out = out.replace(f"{q}/ws/", f"{q}{PROXY_PREFIX}/ws/")
    for q in ("'", '"', "`"):
        out = out.replace(f"{q}/codex-agent", f"{q}{PROXY_PREFIX}/codex-agent")
        out = out.replace(f"{q}/static/", f"{q}{PROXY_PREFIX}/static/")

    # CSS / HTML forms such as: url(/static/foo.svg)
    out = re.sub(r"url\(\s*/static/", f"url({PROXY_PREFIX}/static/", out)
    out = re.sub(r"url\(\s*/codex-agent/", f"url({PROXY_PREFIX}/codex-agent/", out)

    # xterm raw ws URL in codex_agent.js uses template interpolation:
    # `${protocol}//${window.location.host}/ws/pty/...`
    out = out.replace("window.location.host}/ws/", f"window.location.host}}{PROXY_PREFIX}/ws/")

    # Socket.IO uses namespace '/appserver' with default engine path '/socket.io'.
    # Force engine path under the namespaced proxy.
    socketio_marker = "io('/appserver', {"
    if socketio_marker in out and f"path: '{PROXY_PREFIX}/socket.io'" not in out:
        out = out.replace(
            socketio_marker,
            f"io('/appserver', {{\n      path: '{PROXY_PREFIX}/socket.io',",
            1,
        )
    return out


def _upstream_path_from_prefixed(path: str, prefix: str = PROXY_PREFIX) -> str:
    if path == prefix:
        return "/"
    marker = f"{prefix}/"
    if path.startswith(marker):
        return f"/{path[len(marker):]}"
    return "/"


async def _proxy_http_request(request: Request, upstream_path: Optional[str] = None) -> Response:
    port = await _get_upstream_port()
    if port is None:
        return JSONResponse(
            {"ok": False, "error": "codex_agent worker is not running"},
            status_code=503,
        )

    path = upstream_path if upstream_path is not None else request.url.path
    url = f"http://{UPSTREAM_HOST}:{port}{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    headers = _strip_hop_headers(dict(request.headers))
    body = await request.body()
    client = await _get_http_client()

    try:
        upstream = await client.request(
            request.method,
            url,
            headers=headers,
            content=body,
        )
    except Exception as exc:
        return JSONResponse(
            {"ok": False, "error": f"upstream request failed: {exc}"},
            status_code=502,
        )

    response_headers = _response_headers(upstream.headers)
    content_type = (upstream.headers.get("content-type") or "").lower()
    payload = upstream.content

    is_prefixed_request = (upstream_path is not None)
    should_rewrite = (
        is_prefixed_request
        and path.startswith(("/codex-agent", "/static/"))
        and (
            "text/html" in content_type
            or "javascript" in content_type
            or "application/json" in content_type
            or "text/css" in content_type
        )
    )
    if should_rewrite:
        try:
            text = upstream.text
            rewritten = _rewrite_prefixed_payload(text)
            if rewritten != text:
                payload = rewritten.encode("utf-8")
                response_headers.pop("content-length", None)
                response_headers.pop("Content-Length", None)
        except Exception:
            # Keep original payload on rewrite failure.
            pass

    return Response(content=payload, status_code=upstream.status_code, headers=response_headers)


async def _proxy_http_route(request: Request, rest: str = "") -> Response:
    _ = rest
    return await _proxy_http_request(request)


async def _proxy_prefixed_http_route(request: Request, rest: str = "") -> Response:
    _ = rest
    upstream_path = _upstream_path_from_prefixed(request.url.path)
    return await _proxy_http_request(request, upstream_path=upstream_path)


async def _proxy_websocket_internal(
    websocket: WebSocket,
    upstream_path: Optional[str] = None,
) -> None:
    await websocket.accept()

    port = await _get_upstream_port()
    if port is None:
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    incoming_path = upstream_path or (websocket.scope.get("path") or "")
    if incoming_path == "/socket.io":
        incoming_path = "/socket.io/"

    query = (websocket.scope.get("query_string") or b"").decode("utf-8", "ignore")
    upstream_url = f"ws://{UPSTREAM_HOST}:{port}{incoming_path}"
    if query:
        upstream_url = f"{upstream_url}?{query}"

    client_headers = websocket.headers
    origin_hdr = client_headers.get("origin")
    cookie_hdr = client_headers.get("cookie")
    ua_hdr = client_headers.get("user-agent")
    sec_ws_proto = client_headers.get("sec-websocket-protocol")
    subprotocols = None
    if sec_ws_proto:
        subprotocols = [p.strip() for p in sec_ws_proto.split(",") if p.strip()]

    extra_headers = []
    if cookie_hdr:
        extra_headers.append(("Cookie", cookie_hdr))
    if ua_hdr:
        extra_headers.append(("User-Agent", ua_hdr))

    connect_kwargs = {
        "origin": origin_hdr,
        "subprotocols": subprotocols,
    }
    if extra_headers:
        param_names = inspect.signature(websockets.connect).parameters
        if "additional_headers" in param_names:
            connect_kwargs["additional_headers"] = extra_headers
        else:
            connect_kwargs["extra_headers"] = extra_headers

    try:
        async with websockets.connect(upstream_url, **connect_kwargs) as upstream_ws:

            async def forward_client_to_upstream() -> None:
                try:
                    while True:
                        packet = await websocket.receive()
                        if packet.get("type") == "websocket.disconnect":
                            break
                        if packet.get("text") is not None:
                            await upstream_ws.send(packet["text"])
                        elif packet.get("bytes") is not None:
                            await upstream_ws.send(packet["bytes"])
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def forward_upstream_to_client() -> None:
                try:
                    async for msg in upstream_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    pass
                except Exception:
                    pass

            tasks = [
                asyncio.create_task(forward_client_to_upstream()),
                asyncio.create_task(forward_upstream_to_client()),
            ]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(
            f"[codex_agent proxy] websocket upstream failed url={upstream_url}: {exc}",
            file=sys.stderr,
            flush=True,
        )
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


async def _proxy_websocket(websocket: WebSocket, rest: str = "") -> None:
    _ = rest
    await _proxy_websocket_internal(websocket, upstream_path=None)


async def _proxy_prefixed_websocket(websocket: WebSocket, rest: str = "") -> None:
    _ = rest
    raw_path = websocket.scope.get("path") or PROXY_PREFIX
    upstream_path = _upstream_path_from_prefixed(raw_path)
    await _proxy_websocket_internal(websocket, upstream_path=upstream_path)


def _promote_routes(app, route_names: set[str], before_path: str) -> None:
    routes = list(app.router.routes)
    selected = [r for r in routes if getattr(r, "name", None) in route_names]
    if not selected:
        return
    remaining = [r for r in routes if getattr(r, "name", None) not in route_names]
    insert_at = len(remaining)
    for idx, route in enumerate(remaining):
        if getattr(route, "path", None) == before_path:
            insert_at = idx
            break
    app.router.routes = remaining[:insert_at] + selected + remaining[insert_at:]


def register(app) -> None:
    # Namespaced proxy surface owned by framework process service:
    # /api/app/codex_agent/proxy/*
    app.add_api_route(
        f"{PROXY_PREFIX}",
        _proxy_prefixed_http_route,
        methods=HTTP_METHODS,
        name="codex_agent_ns_proxy_root",
    )
    app.add_api_route(
        f"{PROXY_PREFIX}/{{rest:path}}",
        _proxy_prefixed_http_route,
        methods=HTTP_METHODS,
        name="codex_agent_ns_proxy_path",
    )
    app.add_api_websocket_route(
        f"{PROXY_PREFIX}/socket.io",
        _proxy_prefixed_websocket,
        name="codex_agent_ns_proxy_socketio_root",
    )
    app.add_api_websocket_route(
        f"{PROXY_PREFIX}/socket.io/{{rest:path}}",
        _proxy_prefixed_websocket,
        name="codex_agent_ns_proxy_socketio_path",
    )
    app.add_api_websocket_route(
        f"{PROXY_PREFIX}/ws/{{rest:path}}",
        _proxy_prefixed_websocket,
        name="codex_agent_ns_proxy_ws_path",
    )

    # Ensure namespaced HTTP routes win over the generic /api/app/{app_id}/{subpath:path}.
    _promote_routes(
        app,
        {"codex_agent_ns_proxy_root", "codex_agent_ns_proxy_path"},
        "/api/app/{app_id}/{subpath:path}",
    )
