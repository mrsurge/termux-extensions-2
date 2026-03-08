import asyncio
import inspect
import re
import sys
from contextlib import suppress
from typing import Any, Optional

import httpx
import websockets
from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse, Response
from starlette.requests import ClientDisconnect
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.extensions.apps import loader as apps_loader

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


def _is_bool(value: Any) -> bool:
    return isinstance(value, bool)


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_str_list(value: Any, field_name: str, errors: list[str]) -> None:
    if not isinstance(value, list):
        errors.append(f"{field_name} must be a list of strings")
        return
    for idx, item in enumerate(value):
        if not _is_nonempty_str(item):
            errors.append(f"{field_name}[{idx}] must be a non-empty string")


def validate_proxy_shell_manifest(manifest: dict[str, Any]) -> list[str]:
    """
    Validate a manifest's proxy_shell block.
    Returns a list of human-readable validation errors.
    """
    errors: list[str] = []
    app_id = manifest.get("id", "<unknown>")
    cfg = manifest.get("proxy_shell")
    if cfg is None:
        return errors
    if not isinstance(cfg, dict):
        return [f"proxy_shell for '{app_id}' must be an object"]

    enabled = cfg.get("enabled", True)
    if not _is_bool(enabled):
        errors.append(f"proxy_shell.enabled for '{app_id}' must be a boolean")
        return errors
    if enabled is False:
        return errors

    if not _is_nonempty_str(cfg.get("start_path")):
        errors.append(f"proxy_shell.start_path for '{app_id}' is required and must be a non-empty string")
    if not _is_nonempty_str(cfg.get("health_path")):
        errors.append(f"proxy_shell.health_path for '{app_id}' is required and must be a non-empty string")
    if "ws_max_size_mb" in cfg and not _is_positive_int(cfg.get("ws_max_size_mb")):
        errors.append(f"proxy_shell.ws_max_size_mb for '{app_id}' must be a positive integer")

    rewrite_cfg = cfg.get("rewrite")
    if rewrite_cfg is not None:
        if not isinstance(rewrite_cfg, dict):
            errors.append(f"proxy_shell.rewrite for '{app_id}' must be an object")
        else:
            if "enabled" in rewrite_cfg and not _is_bool(rewrite_cfg.get("enabled")):
                errors.append(f"proxy_shell.rewrite.enabled for '{app_id}' must be a boolean")
            for key in ("path_prefixes", "content_types", "absolute_root_paths", "css_root_paths"):
                if key in rewrite_cfg:
                    _validate_str_list(rewrite_cfg.get(key), f"proxy_shell.rewrite.{key}", errors)
            if "ws_template_marker" in rewrite_cfg and not _is_nonempty_str(rewrite_cfg.get("ws_template_marker")):
                errors.append(f"proxy_shell.rewrite.ws_template_marker for '{app_id}' must be a non-empty string")
            if "ws_template_replacement" in rewrite_cfg and not _is_nonempty_str(rewrite_cfg.get("ws_template_replacement")):
                errors.append(f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' must be a non-empty string")
            if "ws_template_marker" in rewrite_cfg and "ws_template_replacement" not in rewrite_cfg:
                errors.append(
                    f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' is required when ws_template_marker is set"
                )
            if "ws_template_replacement" in rewrite_cfg and "{proxy_prefix}" not in str(rewrite_cfg.get("ws_template_replacement")):
                errors.append(
                    f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' must include '{{proxy_prefix}}'"
                )

    socketio_cfg = cfg.get("socketio")
    if socketio_cfg is not None:
        if not isinstance(socketio_cfg, dict):
            errors.append(f"proxy_shell.socketio for '{app_id}' must be an object")
        else:
            if "enabled" in socketio_cfg and not _is_bool(socketio_cfg.get("enabled")):
                errors.append(f"proxy_shell.socketio.enabled for '{app_id}' must be a boolean")
            if "inject_path" in socketio_cfg and not _is_bool(socketio_cfg.get("inject_path")):
                errors.append(f"proxy_shell.socketio.inject_path for '{app_id}' must be a boolean")
            if "namespace_marker" in socketio_cfg and not _is_nonempty_str(socketio_cfg.get("namespace_marker")):
                errors.append(f"proxy_shell.socketio.namespace_marker for '{app_id}' must be a non-empty string")
            if socketio_cfg.get("inject_path") is True and not _is_nonempty_str(socketio_cfg.get("namespace_marker")):
                errors.append(
                    f"proxy_shell.socketio.namespace_marker for '{app_id}' is required when socketio.inject_path is true"
                )

    return errors


def _proxy_prefix(app_id: str) -> str:
    return f"/api/app/{app_id}/proxy"


def _get_loaded_apps() -> list[dict[str, Any]]:
    return apps_loader.get_loaded_apps()


def _find_proxy_shell_config(app_id: str) -> Optional[dict[str, Any]]:
    app_def = apps_loader.get_app_registry().get_app(app_id)
    if app_def is None:
        return None
    cfg = app_def.proxy_shell
    if not isinstance(cfg, dict):
        return None
    if cfg.get("enabled") is False:
        return None
    return cfg


def _proxy_ws_max_size(cfg: dict[str, Any]) -> int:
    value = cfg.get("ws_max_size_mb")
    if _is_positive_int(value):
        return int(value) * 1024 * 1024
    return 16 * 1024 * 1024


async def _get_upstream_port(app_id: str) -> Optional[int]:
    app_info = await apps_loader.get_app_runtime().get_running_app(app_id)
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


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            item = item.strip()
            if item:
                out.append(item)
    return out


def _should_rewrite(upstream_path: str, content_type: str, cfg: dict[str, Any]) -> bool:
    rewrite_cfg = cfg.get("rewrite")
    if not isinstance(rewrite_cfg, dict):
        return False
    if rewrite_cfg.get("enabled") is False:
        return False

    types = _str_list(rewrite_cfg.get("content_types"))
    if not types:
        return False
    if not any(t in content_type for t in types):
        return False

    prefixes = _str_list(rewrite_cfg.get("path_prefixes"))
    if not prefixes:
        return True
    return any(upstream_path.startswith(p) for p in prefixes)


def _replace_quoted_root(text: str, root: str, replacement: str) -> str:
    if root == "/api/":
        return re.sub(r"(?P<q>['\"`])/api/(?!app/)", rf"\g<q>{replacement}", text)
    return re.sub(rf"(?P<q>['\"`]){re.escape(root)}", rf"\g<q>{replacement}", text)


def _rewrite_prefixed_payload(text: str, app_id: str, cfg: dict[str, Any]) -> str:
    proxy_prefix = _proxy_prefix(app_id)
    rewrite_cfg = cfg.get("rewrite") if isinstance(cfg.get("rewrite"), dict) else {}
    socketio_cfg = cfg.get("socketio") if isinstance(cfg.get("socketio"), dict) else {}

    out = text

    roots = _str_list(rewrite_cfg.get("absolute_root_paths"))
    ordered_roots: list[str] = []
    for fixed in ("/api/", "/ws/"):
        if fixed in roots:
            ordered_roots.append(fixed)
    for root in roots:
        if root not in ordered_roots:
            ordered_roots.append(root)

    for root in ordered_roots:
        out = _replace_quoted_root(out, root, f"{proxy_prefix}{root}")

    css_roots = _str_list(rewrite_cfg.get("css_root_paths"))
    for root in css_roots:
        out = re.sub(
            rf"url\(\s*(['\"]?){re.escape(root)}",
            rf"url(\1{proxy_prefix}{root}",
            out,
        )

    ws_marker = rewrite_cfg.get("ws_template_marker")
    ws_replacement = rewrite_cfg.get("ws_template_replacement")
    if isinstance(ws_marker, str) and ws_marker and isinstance(ws_replacement, str) and ws_replacement:
        out = out.replace(ws_marker, ws_replacement.replace("{proxy_prefix}", proxy_prefix))

    if socketio_cfg.get("enabled") is True and socketio_cfg.get("inject_path") is True:
        marker = socketio_cfg.get("namespace_marker")
        if isinstance(marker, str) and marker and f"path: '{proxy_prefix}/socket.io'" not in out:
            out = out.replace(
                marker,
                f"{marker}\n      path: '{proxy_prefix}/socket.io',",
                1,
            )

    return out


def _upstream_path(rest: str) -> str:
    if not rest:
        return "/"
    return f"/{rest.lstrip('/')}"


async def _proxy_http(app_id: str, request: Request, rest: str) -> Response:
    cfg = _find_proxy_shell_config(app_id)
    if cfg is None:
        return JSONResponse({"ok": False, "error": f"proxy_shell is not enabled for '{app_id}'"}, status_code=404)

    port = await _get_upstream_port(app_id)
    if port is None:
        return JSONResponse({"ok": False, "error": f"App '{app_id}' is not running"}, status_code=503)

    upstream_path = _upstream_path(rest)
    url = f"http://{UPSTREAM_HOST}:{port}{upstream_path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    headers = _strip_hop_headers(dict(request.headers))
    try:
        body = await request.body()
    except ClientDisconnect:
        return Response(status_code=499)
    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, follow_redirects=False) as client:
            upstream = await client.request(request.method, url, headers=headers, content=body)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": f"upstream request failed: {exc}"}, status_code=502)

    response_headers = _response_headers(upstream.headers)
    content_type = (upstream.headers.get("content-type") or "").lower()
    payload = upstream.content

    if _should_rewrite(upstream_path, content_type, cfg):
        try:
            text = upstream.text
            rewritten = _rewrite_prefixed_payload(text, app_id, cfg)
            if rewritten != text:
                payload = rewritten.encode("utf-8")
                response_headers.pop("content-length", None)
                response_headers.pop("Content-Length", None)
        except Exception:
            pass

    return Response(content=payload, status_code=upstream.status_code, headers=response_headers)


async def _proxy_http_root(app_id: str, request: Request) -> Response:
    return await _proxy_http(app_id, request, rest="")


async def _proxy_http_path(app_id: str, rest: str, request: Request) -> Response:
    return await _proxy_http(app_id, request, rest=rest)


async def _proxy_websocket(app_id: str, websocket: WebSocket, rest: str) -> None:
    await websocket.accept()

    cfg = _find_proxy_shell_config(app_id)
    if cfg is None:
        with suppress(Exception):
            await websocket.close(code=1008)
        return

    port = await _get_upstream_port(app_id)
    if port is None:
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    upstream_path = _upstream_path(rest)
    if upstream_path == "/socket.io":
        upstream_path = "/socket.io/"

    query = (websocket.scope.get("query_string") or b"").decode("utf-8", "ignore")
    upstream_url = f"ws://{UPSTREAM_HOST}:{port}{upstream_path}"
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

    connect_kwargs = {"origin": origin_hdr, "subprotocols": subprotocols}
    if extra_headers:
        param_names = inspect.signature(websockets.connect).parameters
        if "additional_headers" in param_names:
            connect_kwargs["additional_headers"] = extra_headers
        else:
            connect_kwargs["extra_headers"] = extra_headers

    try:
        async with websockets.connect(upstream_url, max_size=_proxy_ws_max_size(cfg), **connect_kwargs) as upstream_ws:

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
        print(f"[apps.proxy_shell] websocket upstream failed app={app_id} url={upstream_url}: {exc}", file=sys.stderr, flush=True)
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


async def _proxy_ws_root(app_id: str, websocket: WebSocket) -> None:
    await _proxy_websocket(app_id, websocket, rest="")


async def _proxy_ws_path(app_id: str, rest: str, websocket: WebSocket) -> None:
    await _proxy_websocket(app_id, websocket, rest=rest)


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


def register_proxy_shell_engine(app) -> None:
    existing = {getattr(route, "name", None) for route in app.router.routes}
    if "apps_proxy_shell_http_root" in existing:
        return

    app.add_api_route(
        "/api/app/{app_id}/proxy",
        _proxy_http_root,
        methods=HTTP_METHODS,
        name="apps_proxy_shell_http_root",
    )
    app.add_api_route(
        "/api/app/{app_id}/proxy/{rest:path}",
        _proxy_http_path,
        methods=HTTP_METHODS,
        name="apps_proxy_shell_http_path",
    )
    app.add_api_websocket_route(
        "/api/app/{app_id}/proxy",
        _proxy_ws_root,
        name="apps_proxy_shell_ws_root",
    )
    app.add_api_websocket_route(
        "/api/app/{app_id}/proxy/{rest:path}",
        _proxy_ws_path,
        name="apps_proxy_shell_ws_path",
    )

    _promote_routes(
        app,
        {"apps_proxy_shell_http_root", "apps_proxy_shell_http_path"},
        "/api/app/{app_id}/{subpath:path}",
    )
