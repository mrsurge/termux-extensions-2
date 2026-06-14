# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Callable, cast

from ..contracts.extensions import (
    ExplorerExtensionConfigureParams,
    ExplorerExtensionExtIdParams,
    ExplorerExtensionInstallParams,
    ExplorerExtensionSettingsParams,
    ExplorerExtensionToggleParams,
    ExplorerExtensionsNoParams,
)
from ..context import ExplorerExtensionHandlerContext
from ..services.extension_restarts import (
    restart_adapter_only,
    restart_code_server_and_adapter,
)

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]


async def handle_ext_list(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionsNoParams,
    msg_id: str | None,
) -> None:
    del params
    from ... import extension_registry as extension_registry

    get_extension_list = extension_registry.get_extension_list
    get_language_slots = cast(
        Callable[[], JsonObject],
        extension_registry.get_language_slots,
    )

    await context.emit_personal(
        "ext:list",
        {
            "extensions": get_extension_list(),
            "language_slots": get_language_slots(),
        },
        msg_id,
    )


async def handle_ext_install(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionInstallParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    install_extension = cast(
        Callable[[str], JsonObject],
        extension_registry.install_extension,
    )
    get_extension_config_schema = cast(
        Callable[[str], JsonObject],
        extension_registry.get_extension_config_schema,
    )

    result = await asyncio.to_thread(install_extension, params["vsix_path"])
    ext = _as_object(result.get("extension")) or {}
    ext_id_obj = ext.get("id")
    ext_id = ext_id_obj if isinstance(ext_id_obj, str) else ""
    config_schema = get_extension_config_schema(ext_id) if ext_id else {}
    registry_summary = _as_object(result.get("registry_summary")) or {}
    await context.emit_personal(
        "ext:installed",
        {
            "ok": True,
            "extension": ext,
            "config_schema": config_schema,
            "registry_summary": registry_summary,
        },
        msg_id,
    )
    await restart_code_server_and_adapter(context.emit_personal, "ext_install")


async def handle_ext_uninstall(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionExtIdParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    uninstall_extension = cast(
        Callable[[str], JsonObject],
        extension_registry.uninstall_extension,
    )

    result = await asyncio.to_thread(uninstall_extension, params["ext_id"])
    registry_summary = _as_object(result.get("registry_summary")) or {}
    await context.emit_personal(
        "ext:uninstalled",
        {
            "ok": True,
            "uninstalled_id": params["ext_id"],
            "registry_summary": registry_summary,
        },
        msg_id,
    )
    await restart_code_server_and_adapter(context.emit_personal, "ext_uninstall")


async def handle_ext_configure(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionConfigureParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    set_extension_config = cast(
        Callable[[str, JsonObject], JsonObject],
        extension_registry.set_extension_config,
    )

    set_extension_config(params["ext_id"], params["values"])
    await context.emit_personal(
        "ext:configured",
        {"ok": True, "ext_id": params["ext_id"]},
        msg_id,
    )
    await restart_adapter_only(context.emit_personal, "ext_configure")


async def handle_ext_custom_settings_get(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionsNoParams,
    msg_id: str | None,
) -> None:
    del params
    from ... import extension_registry as extension_registry

    get_custom_settings = extension_registry.get_custom_settings
    await context.emit_personal(
        "ext:custom_settings_get",
        {"ok": True, "settings": get_custom_settings()},
        msg_id,
    )


async def handle_ext_custom_settings_set(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionSettingsParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    set_custom_settings = cast(
        Callable[[JsonObject], None],
        extension_registry.set_custom_settings,
    )

    await asyncio.to_thread(set_custom_settings, params["settings"])
    await context.emit_personal(
        "ext:custom_settings_set",
        {"ok": True, "count": len(params["settings"])},
        msg_id,
    )
    await restart_adapter_only(context.emit_personal, "custom_settings")


async def handle_ext_workspace_settings_get(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionsNoParams,
    msg_id: str | None,
) -> None:
    del params

    project_path = str(context.project_root) if context.project_root else ""
    if not project_path:
        await context.emit_personal(
            "ext:workspace_settings_get",
            {"ok": True, "settings": {}, "path": ""},
            msg_id,
        )
        return

    settings_path = os.path.join(project_path, ".vscode", "settings.json")
    settings: JsonObject = {}
    try:
        if os.path.isfile(settings_path):
            with open(settings_path, "r", encoding="utf-8") as file_obj:
                raw = cast(object, json.loads(file_obj.read()))
            settings = _as_object(raw) or {}
    except Exception as exc:
        logger.warning("[workspace_settings] read error: %s", exc)

    await context.emit_personal(
        "ext:workspace_settings_get",
        {"ok": True, "settings": settings, "path": settings_path},
        msg_id,
    )


async def handle_ext_workspace_settings_set(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionSettingsParams,
    msg_id: str | None,
) -> None:
    project_path = str(context.project_root) if context.project_root else ""
    if not project_path:
        raise RuntimeError("No active project")

    settings_dir = os.path.join(project_path, ".vscode")
    settings_path = os.path.join(settings_dir, "settings.json")
    os.makedirs(settings_dir, exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as file_obj:
        file_obj.write(json.dumps(params["settings"], indent=2) + "\n")

    await context.emit_personal(
        "ext:workspace_settings_set",
        {
            "ok": True,
            "count": len(params["settings"]),
            "path": settings_path,
        },
        msg_id,
    )
    await restart_adapter_only(context.emit_personal, "workspace_settings")


async def handle_ext_toggle(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionToggleParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    toggle_extension = cast(
        Callable[[str, bool], JsonObject],
        extension_registry.toggle_extension,
    )
    toggle_language_slot = cast(
        Callable[[str, bool], JsonObject],
        extension_registry.toggle_language_slot,
    )

    active = params.get("active", True)
    ext_id = params.get("ext_id")
    lang_id = params.get("lang_id")
    if ext_id is not None:
        toggle_extension(ext_id, active)
        await context.emit_personal(
            "ext:toggled",
            {"ok": True, "ext_id": ext_id, "active": active},
            msg_id,
        )
        await restart_adapter_only(context.emit_personal, "ext_toggle")
        return

    if lang_id is not None:
        toggle_language_slot(lang_id, active)
        await context.emit_personal(
            "ext:toggled",
            {"ok": True, "lang_id": lang_id, "active": active},
            msg_id,
        )
        return

    raise RuntimeError("ext_id or lang_id is required")


async def handle_ext_config_schema(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionExtIdParams,
    msg_id: str | None,
) -> None:
    from ... import extension_registry as extension_registry

    get_extension_config_schema = cast(
        Callable[[str], JsonObject],
        extension_registry.get_extension_config_schema,
    )

    schema = get_extension_config_schema(params["ext_id"])
    await context.emit_personal(
        "ext:configSchema",
        {"ext_id": params["ext_id"], "schema": schema},
        msg_id,
    )


async def handle_ext_restart_adapter(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionsNoParams,
    msg_id: str | None,
) -> None:
    del params
    await restart_adapter_only(context.emit_personal, "manual")
    await context.emit_personal("explorer.extensions.adapter.restarted", {"ok": True}, msg_id)


def _as_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
