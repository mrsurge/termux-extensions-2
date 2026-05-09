from __future__ import annotations

import asyncio
import inspect
import json
import sys
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, cast

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.extensions.apps.registry import AppDefinition


TargetKind = Literal["app_worker", "static"]


@dataclass(frozen=True)
class SioProxyRoute:
    app_id: str
    route_id: str
    target: TargetKind
    public_path: str
    upstream_path: str
    aliases: tuple[str, ...]
    host: str
    port: int | None
    description: str


_REGISTERED_ROUTE_KEYS: set[str] = set()


def _normalize_path(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty path string")
    path = value.strip()
    if not path.startswith("/"):
        raise ValueError(f"{field_name} must start with '/'")
    if len(path) > 1:
        path = path.rstrip("/")
    return path


def _normalize_upstream_path(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty path string")
    path = value.strip()
    if not path.startswith("/"):
        raise ValueError(f"{field_name} must start with '/'")
    return path


def _str_list(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    paths: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            paths.append(_normalize_path(item, field_name="aliases[]"))
    return tuple(dict.fromkeys(paths))


def _coerce_port(value: object, *, field_name: str) -> int:
    if not isinstance(value, (int, str)):
        raise ValueError(f"{field_name} must be an integer")
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
    if port <= 0 or port > 65535:
        raise ValueError(f"{field_name} must be between 1 and 65535")
    return port


def _load_config(app_def: AppDefinition) -> dict[str, Any] | None:
    raw = app_def.raw_manifest.get("sio_service")
    if raw is None:
        return None
    if isinstance(raw, dict):
        return dict(raw)
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("sio_service must be a path string or object")
    config_path = (app_def.root_dir / raw.strip()).resolve()
    if not config_path.exists():
        raise ValueError(f"sio_service file not found: {config_path}")
    try:
        loaded = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"sio_service parse failed: {type(exc).__name__}: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ValueError("sio_service root must be a JSON object")
    return cast(dict[str, Any], loaded)


def _default_public_path(app_id: str, route_id: str, target: TargetKind) -> str:
    if target == "app_worker":
        return f"/api/app/{app_id}/socket.io"
    return f"/api/app/{app_id}/services/{route_id}/socket.io"


def _parse_routes(app_def: AppDefinition) -> list[SioProxyRoute]:
    config = _load_config(app_def)
    if not config:
        return []
    routes_raw = config.get("routes")
    if not isinstance(routes_raw, list):
        raise ValueError("sio_service.routes must be a list")

    routes: list[SioProxyRoute] = []
    for index, raw_route in enumerate(routes_raw):
        if not isinstance(raw_route, dict):
            raise ValueError(f"sio_service.routes[{index}] must be an object")
        route_id = str(raw_route.get("id") or "").strip()
        if not route_id:
            raise ValueError(f"sio_service.routes[{index}].id is required")
        target_raw = str(raw_route.get("target") or "app_worker").strip()
        if target_raw not in {"app_worker", "static"}:
            raise ValueError(f"sio_service route '{route_id}' target must be app_worker or static")
        target = cast(TargetKind, target_raw)
        public_path = _normalize_path(
            raw_route.get("public_path") or _default_public_path(app_def.app_id, route_id, target),
            field_name=f"sio_service route '{route_id}' public_path",
        )
        upstream_path = _normalize_upstream_path(
            raw_route.get("upstream_path") or "/socket.io/",
            field_name=f"sio_service route '{route_id}' upstream_path",
        )
        host = str(raw_route.get("host") or "127.0.0.1").strip() or "127.0.0.1"
        port: int | None = None
        if target == "static":
            port = _coerce_port(raw_route.get("port"), field_name=f"sio_service route '{route_id}' port")
        description = str(raw_route.get("description") or "").strip()
        routes.append(
            SioProxyRoute(
                app_id=app_def.app_id,
                route_id=route_id,
                target=target,
                public_path=public_path,
                upstream_path=upstream_path,
                aliases=_str_list(raw_route.get("aliases")),
                host=host,
                port=port,
                description=description,
            )
        )
    return routes


def _join_upstream_path(base_path: str, rest: str) -> str:
    if not rest:
        return base_path
    return f"{base_path.rstrip('/')}/{rest.lstrip('/')}"


async def _resolve_upstream(route: SioProxyRoute) -> tuple[str, int] | None:
    if route.target == "static":
        if route.port is None:
            return None
        return route.host, route.port

    from framework_shells import get_manager  # pyright: ignore[reportMissingImports]

    manager = await get_manager()
    try:
        shells = await manager.list_shells()
    except Exception:
        return None

    candidates: list[object] = []
    for record in shells:
        if getattr(record, "status", None) != "running":
            continue
        derive_app_id = getattr(record, "derive_app_id", None)
        record_app_id = str(derive_app_id() if callable(derive_app_id) else "").strip()
        if record_app_id != route.app_id:
            continue
        subgroups = list(getattr(record, "subgroups", None) or [])
        label = str(getattr(record, "label", "") or "")
        if len(subgroups) >= 2 and str(subgroups[1]).strip() == "app-worker":
            candidates.append(record)
        elif label.startswith("app-worker:"):
            candidates.append(record)

    def _sort_key(record: object) -> tuple[float, float, int]:
        updated_at = float(getattr(record, "updated_at", None) or 0.0)
        created_at = float(getattr(record, "created_at", None) or 0.0)
        pid = int(getattr(record, "pid", None) or 0)
        return updated_at, created_at, pid

    if not candidates:
        return None
    record = max(candidates, key=_sort_key)
    env_overrides = getattr(record, "env_overrides", None) or {}
    port_raw = env_overrides.get("TE_APP_WORKER_PORT") if hasattr(env_overrides, "get") else None
    if not isinstance(port_raw, (int, str)):
        return None
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return None
    return "127.0.0.1", port


async def _proxy_socketio_websocket(route: SioProxyRoute, websocket: WebSocket, rest: str = "") -> None:
    """Route-level raw Socket.IO websocket proxy.

    The framework owns only the physical Engine.IO route. Socket.IO namespaces
    and JSON-RPC/application semantics remain owned by the upstream server.
    """

    await websocket.accept()

    upstream = await _resolve_upstream(route)
    if upstream is None:
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    upstream_host, upstream_port = upstream
    scope = cast(dict[str, object], websocket.scope)
    query_obj = scope.get("query_string", b"")
    query = query_obj.decode("utf-8", "ignore") if isinstance(query_obj, bytes) else ""
    upstream_path = _join_upstream_path(route.upstream_path, rest)
    upstream_url = f"ws://{upstream_host}:{upstream_port}{upstream_path}"
    if query:
        upstream_url = f"{upstream_url}?{query}"

    client_headers = websocket.headers
    origin_hdr = client_headers.get("origin")
    cookie_hdr = client_headers.get("cookie")
    ua_hdr = client_headers.get("user-agent")
    sec_ws_proto = client_headers.get("sec-websocket-protocol")
    subprotocols = None
    if sec_ws_proto:
        subprotocols = [part.strip() for part in sec_ws_proto.split(",") if part.strip()]

    extra_headers: list[tuple[str, str]] = []
    if cookie_hdr:
        extra_headers.append(("Cookie", cookie_hdr))
    if ua_hdr:
        extra_headers.append(("User-Agent", ua_hdr))

    connect_kwargs: dict[str, object] = {"origin": origin_hdr, "subprotocols": subprotocols}
    if extra_headers:
        param_names = inspect.signature(websockets.connect).parameters
        if "additional_headers" in param_names:
            connect_kwargs["additional_headers"] = extra_headers
        else:
            connect_kwargs["extra_headers"] = extra_headers

    try:
        async with websockets.connect(upstream_url, **connect_kwargs) as upstream_ws:  # pyright: ignore[reportArgumentType]

            async def forward_client_to_upstream() -> None:
                try:
                    while True:
                        packet = cast(dict[str, object], await websocket.receive())
                        if packet.get("type") == "websocket.disconnect":
                            break
                        text_msg = packet.get("text")
                        bytes_msg = packet.get("bytes")
                        if isinstance(text_msg, str):
                            await upstream_ws.send(text_msg)
                        elif isinstance(bytes_msg, (bytes, bytearray)):
                            await upstream_ws.send(bytes(bytes_msg))
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def forward_upstream_to_client() -> None:
                try:
                    async for message in upstream_ws:
                        if isinstance(message, (bytes, bytearray)):
                            await websocket.send_bytes(bytes(message))
                        else:
                            await websocket.send_text(str(message))
                except websockets.ConnectionClosedOK:
                    pass
                except Exception:
                    pass

            tasks = [
                asyncio.create_task(forward_client_to_upstream()),
                asyncio.create_task(forward_upstream_to_client()),
            ]
            _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(
            f"[apps.sio_service] websocket upstream failed "
            f"app={route.app_id} route={route.route_id} url={upstream_url}: {exc}",
            file=sys.stderr,
            flush=True,
        )
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


def _make_endpoint(route: SioProxyRoute):
    async def _endpoint(websocket: WebSocket, rest: str = "") -> None:
        await _proxy_socketio_websocket(route, websocket, rest)

    return _endpoint


def _register_route(app: Any, *, route: SioProxyRoute, path: str, name_suffix: str) -> None:
    route_key = f"{route.app_id}:{route.route_id}:{path}"
    if route_key in _REGISTERED_ROUTE_KEYS:
        return
    endpoint = _make_endpoint(route)
    root_name = f"sio_service_{route.app_id}_{route.route_id}_{name_suffix}_root"
    rest_name = f"sio_service_{route.app_id}_{route.route_id}_{name_suffix}"
    app.add_api_websocket_route(path, endpoint, name=root_name)
    app.add_api_websocket_route(f"{path}/{{rest:path}}", endpoint, name=rest_name)
    _REGISTERED_ROUTE_KEYS.add(route_key)


def register_sio_service_proxy(app_def: AppDefinition, app: Any) -> None:
    for route in _parse_routes(app_def):
        _register_route(app, route=route, path=route.public_path, name_suffix="public")
        for index, alias in enumerate(route.aliases):
            _register_route(app, route=route, path=alias, name_suffix=f"alias_{index}")


def register_sio_service_proxies(apps: list[AppDefinition], app: Any) -> None:
    for app_def in apps:
        register_sio_service_proxy(app_def, app)
