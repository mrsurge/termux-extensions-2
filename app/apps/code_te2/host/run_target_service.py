# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import cast
from urllib.parse import urlsplit, urlunsplit

from app.libs.pipe_runtime import call_async

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..runner_profiles import RunProfileAdditionalPort

RUN_TARGET_SERVICE_NID = 2400
RUN_TARGET_SERVICE_NAME = "service.runTarget"
RunTargetRoutesEmitter = Callable[[JsonMap], Awaitable[None]]
_run_target_routes_emitter: RunTargetRoutesEmitter | None = None
_run_target_routes_projection_lock = asyncio.Lock()


def set_run_target_routes_emitter(emitter: RunTargetRoutesEmitter | None) -> None:
    global _run_target_routes_emitter
    _run_target_routes_emitter = emitter


async def emit_run_target_routes_snapshot(emitter: RunTargetRoutesEmitter) -> None:
    """Serialize connect snapshots with registration/release publications."""
    async with _run_target_routes_projection_lock:
        await emitter(await list_run_target_routes())


async def register_run_target_route(
    *,
    owner_id: str,
    shell_id: str,
    port: int,
    original_url: str | None = None,
) -> JsonMap:
    result = await call_async(
        "runTarget.route.register",
        {
            "ownerId": owner_id,
            "shellId": shell_id,
            "port": port,
            "originalUrl": original_url or f"http://127.0.0.1:{port}/",
        },
        target_nid=RUN_TARGET_SERVICE_NID,
        target_name=RUN_TARGET_SERVICE_NAME,
        origin_name="code_te2.run_profiles",
        timeout_seconds=5.0,
    )
    route = _json_object(result)
    ticket = _text(route.get("ticket"))
    tunnel_path = _text(route.get("tunnelPath"))
    preferred_port = route.get("preferredPort")
    if (
        route.get("dto") != "RunTargetRoute"
        or not ticket
        or tunnel_path != f"/api/run-targets/{ticket}/tunnel"
        or preferred_port != port
    ):
        raise RuntimeError("Rust run-target service returned an invalid route")
    await _publish_run_target_routes_best_effort()
    return route


async def register_run_target_routes(
    *,
    owner_id: str,
    shell_id: str,
    primary_port: int,
    primary_url: str,
    additional_ports: tuple[RunProfileAdditionalPort, ...],
) -> JsonMap:
    result = await call_async(
        "runTarget.routes.register",
        {
            "ownerId": owner_id,
            "shellId": shell_id,
            "primaryPort": primary_port,
            "primaryUrl": primary_url,
            "additionalPorts": [
                {
                    "port": item.port,
                    "label": item.label,
                    "originalUrl": f"http://127.0.0.1:{item.port}/",
                }
                for item in additional_ports
            ],
        },
        target_nid=RUN_TARGET_SERVICE_NID,
        target_name=RUN_TARGET_SERVICE_NAME,
        origin_name="code_te2.run_profiles",
        timeout_seconds=5.0,
    )
    route_set = _json_object(result)
    if route_set.get("dto") != "RunTargetRouteSet" or route_set.get("version") != 1:
        raise RuntimeError("Rust run-target service returned an invalid route set")
    if (
        _text(route_set.get("ownerId")) != owner_id
        or _text(route_set.get("shellId")) != shell_id
    ):
        raise RuntimeError("Rust run-target service returned mismatched route ownership")
    primary = _validated_route(
        route_set.get("primary"),
        expected_port=primary_port,
        expected_url=primary_url,
    )
    additional_obj = route_set.get("additional")
    additional = (
        cast(list[object], additional_obj) if isinstance(additional_obj, list) else []
    )
    if len(additional) != len(additional_ports):
        raise RuntimeError("Rust run-target service returned incomplete auxiliary routes")
    projected_additional: list[object] = []
    for expected, raw_route in zip(additional_ports, additional, strict=True):
        route = _validated_route(
            raw_route,
            expected_port=expected.port,
            expected_url=f"http://127.0.0.1:{expected.port}/",
        )
        if _text(route.get("label")) != expected.label:
            raise RuntimeError("Rust run-target service returned a mismatched route label")
        projected_additional.append(route)
    projected: JsonMap = {
        "dto": "RunTargetRouteSet",
        "version": 1,
        "ownerId": owner_id,
        "shellId": shell_id,
        "relayGroupId": _text(route_set.get("relayGroupId")),
        "primary": primary,
        "additional": projected_additional,
    }
    if _text(projected.get("relayGroupId")) != _text(primary.get("ticket")):
        raise RuntimeError("Rust run-target service returned an invalid relay group")
    await _publish_run_target_routes_best_effort()
    return projected


async def list_run_target_routes() -> JsonMap:
    result = _json_object(
        await call_async(
            "runTarget.routes.list",
            {},
            target_nid=RUN_TARGET_SERVICE_NID,
            target_name=RUN_TARGET_SERVICE_NAME,
            origin_name="code_te2.run_profiles",
            timeout_seconds=5.0,
        )
    )
    if result.get("dto") != "RunTargetRouteProjection" or result.get("version") != 1:
        raise RuntimeError("Rust run-target service returned an invalid route projection")
    groups_obj = result.get("groups")
    if not isinstance(groups_obj, list):
        raise RuntimeError("Rust run-target service returned invalid route groups")
    groups: list[object] = []
    for raw_group in cast(list[object], groups_obj):
        group = _json_object(raw_group)
        owner_id = _text(group.get("ownerId"))
        shell_id = _text(group.get("shellId"))
        primary = _validated_route(group.get("primary"))
        relay_group_id = _text(group.get("relayGroupId"))
        if not owner_id or not shell_id or relay_group_id != _text(primary.get("ticket")):
            raise RuntimeError("Rust run-target service returned invalid route ownership")
        additional_obj = group.get("additional")
        if not isinstance(additional_obj, list):
            raise RuntimeError("Rust run-target service returned invalid auxiliary routes")
        raw_additional = cast(list[object], additional_obj)
        if len(raw_additional) > 8:
            raise RuntimeError("Rust run-target service returned invalid auxiliary routes")
        additional = [
            _validated_route(item, require_label=True) for item in raw_additional
        ]
        groups.append(
            {
                "dto": "RunTargetRouteSet",
                "version": 1,
                "ownerId": owner_id,
                "shellId": shell_id,
                "relayGroupId": relay_group_id,
                "primary": primary,
                "additional": additional,
            }
        )
    return {
        "dto": "RunTargetRouteProjection",
        "version": 1,
        "groups": groups,
    }


async def release_run_target_route(
    *,
    owner_id: str,
    shell_id: str | None = None,
    ticket: str | None = None,
) -> bool:
    params: JsonMap = {"ownerId": owner_id}
    if shell_id:
        params["shellId"] = shell_id
    if ticket:
        params["ticket"] = ticket
    result = _json_object(
        await call_async(
            "runTarget.route.release",
            params,
            target_nid=RUN_TARGET_SERVICE_NID,
            target_name=RUN_TARGET_SERVICE_NAME,
            origin_name="code_te2.run_profiles",
            timeout_seconds=5.0,
        )
    )
    released = result.get("released") is True
    await _publish_run_target_routes_best_effort()
    return released


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in cast(Mapping[object, object], value).items()}


def _validated_route(
    value: object,
    *,
    expected_port: int | None = None,
    expected_url: str | None = None,
    require_label: bool = False,
) -> JsonMap:
    route = _json_object(value)
    ticket = _text(route.get("ticket"))
    tunnel_path = _text(route.get("tunnelPath"))
    if (
        route.get("dto") != "RunTargetRoute"
        or route.get("version") != 1
        or len(ticket) != 64
        or any(char not in "0123456789abcdef" for char in ticket)
        or tunnel_path != f"/api/run-targets/{ticket}/tunnel"
        or not isinstance(route.get("preferredPort"), int)
        or not 1 <= cast(int, route.get("preferredPort")) <= 65535
    ):
        raise RuntimeError("Rust run-target service returned an invalid route")
    preferred_port = cast(int, route.get("preferredPort"))
    original_url = _text(route.get("originalUrl"))
    parsed = urlsplit(original_url)
    if (
        parsed.scheme != "http"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or (parsed.port or 80) != preferred_port
        or (expected_port is not None and preferred_port != expected_port)
        or (
            expected_url is not None
            and original_url != _normalize_original_url(expected_url)
        )
    ):
        raise RuntimeError("Rust run-target service returned an invalid original URL")
    if require_label and not _text(route.get("label")):
        raise RuntimeError("Rust run-target service returned an unlabeled auxiliary route")
    return route


def _normalize_original_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc,
            parsed.path or "/",
            parsed.query,
            parsed.fragment,
        )
    )


async def _publish_run_target_routes_best_effort() -> None:
    emitter = _run_target_routes_emitter
    if emitter is None:
        return
    try:
        await emit_run_target_routes_snapshot(emitter)
    except Exception:
        pass


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""
