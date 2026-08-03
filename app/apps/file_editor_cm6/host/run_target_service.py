# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from app.libs.pipe_runtime import call_async

from ..monaco_editor.editor_backend_services.contracts import JsonMap

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


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""
