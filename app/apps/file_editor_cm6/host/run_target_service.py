# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
import hashlib
from typing import cast

from app.libs.pipe_runtime import call_async

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..runner_profiles import RunProfileAdditionalPort

RUN_TARGET_SERVICE_NID = 2400
RUN_TARGET_SERVICE_NAME = "service.runTarget"


async def register_run_target_route(
    *,
    owner_id: str,
    shell_id: str,
    port: int,
) -> JsonMap:
    result = await call_async(
        "runTarget.route.register",
        {"ownerId": owner_id, "shellId": shell_id, "port": port},
        target_nid=RUN_TARGET_SERVICE_NID,
        target_name=RUN_TARGET_SERVICE_NAME,
        origin_name="file_editor_cm6.run_profiles",
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
    return route


async def register_run_target_routes(
    *,
    owner_id: str,
    shell_id: str,
    primary_port: int,
    additional_ports: tuple[RunProfileAdditionalPort, ...],
) -> JsonMap:
    result = await call_async(
        "runTarget.routes.register",
        {
            "ownerId": owner_id,
            "shellId": shell_id,
            "primaryPort": primary_port,
            "additionalPorts": [
                {"port": item.port, "label": item.label}
                for item in additional_ports
            ],
        },
        target_nid=RUN_TARGET_SERVICE_NID,
        target_name=RUN_TARGET_SERVICE_NAME,
        origin_name="file_editor_cm6.run_profiles",
        timeout_seconds=5.0,
    )
    route_set = _json_object(result)
    if route_set.get("dto") != "RunTargetRouteSet" or route_set.get("version") != 1:
        raise RuntimeError("Rust run-target service returned an invalid route set")
    primary = _validated_route(route_set.get("primary"), expected_port=primary_port)
    additional_obj = route_set.get("additional")
    additional = (
        cast(list[object], additional_obj) if isinstance(additional_obj, list) else []
    )
    if len(additional) != len(additional_ports):
        raise RuntimeError("Rust run-target service returned incomplete auxiliary routes")
    projected_additional: list[object] = []
    for expected, raw_route in zip(additional_ports, additional, strict=True):
        route = _validated_route(raw_route, expected_port=expected.port)
        if _text(route.get("label")) != expected.label:
            raise RuntimeError("Rust run-target service returned a mismatched route label")
        projected_additional.append(route)
    return {
        "dto": "RunTargetRouteSet",
        "version": 1,
        "relayGroupId": hashlib.sha256(owner_id.encode("utf-8")).hexdigest(),
        "primary": primary,
        "additional": projected_additional,
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
            origin_name="file_editor_cm6.run_profiles",
            timeout_seconds=5.0,
        )
    )
    return result.get("released") is True


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in cast(Mapping[object, object], value).items()}


def _validated_route(value: object, *, expected_port: int) -> JsonMap:
    route = _json_object(value)
    ticket = _text(route.get("ticket"))
    tunnel_path = _text(route.get("tunnelPath"))
    if (
        route.get("dto") != "RunTargetRoute"
        or route.get("version") != 1
        or len(ticket) != 64
        or any(char not in "0123456789abcdef" for char in ticket)
        or tunnel_path != f"/api/run-targets/{ticket}/tunnel"
        or route.get("preferredPort") != expected_port
    ):
        raise RuntimeError("Rust run-target service returned an invalid route")
    return route


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""
