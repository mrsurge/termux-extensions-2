# pyright: strict
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Literal, cast

from ..boot_snapshot_backend import cancel_backend_runtime_prepare_tasks
from ..code_server_bootstrap import (
    inspect_code_server_prerequisite,
    install_code_server_installation,
    remove_code_server_installation,
)
from ..code_server_runtime_hooks import prime_code_server_runtime
from ..explorer.services.state_facts import publish_preferences_changed
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..stores import get_history_store, get_preferences_store

LanguageBackendMode = Literal["code-server", "web-workers"]
_mode_switch_lock = asyncio.Lock()


async def handle_host_language_backend_set_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    mode_value = data.get("mode")
    if mode_value not in {"code-server", "web-workers"}:
        return {"ok": False, "error": "mode must be 'code-server' or 'web-workers'."}
    mode = cast(LanguageBackendMode, mode_value)

    async with _mode_switch_lock:
        if mode == "code-server":
            return await _enable_code_server()
        return await _enable_web_workers()


async def _enable_code_server() -> JsonMap:
    try:
        installation = await asyncio.to_thread(install_code_server_installation)
    except Exception as exc:
        return {"ok": False, "error": f"Code Server installation failed: {exc}"}

    project_root = _active_project()
    if project_root is not None:
        try:
            await prime_code_server_runtime(project_root)
        except Exception as exc:
            return {
                "ok": False,
                "error": (
                    "Code Server was installed, but its extension host failed to start: "
                    f"{exc}"
                ),
                "data": inspect_code_server_prerequisite().payload(),
            }

    ui_prefs = await _persist_mode(web_workers_enabled=False)
    return {
        "ok": True,
        "data": {
            "mode": "code-server",
            "webWorkersEnabled": False,
            "code_server": inspect_code_server_prerequisite().payload(),
            "executable": str(installation.executable),
            "ui": ui_prefs,
        },
    }


async def _enable_web_workers() -> JsonMap:
    try:
        await cancel_backend_runtime_prepare_tasks()
        from ..workbench_adapter_shell_manager import terminate_adapter_shell
        from ..code_server_shell_manager import terminate_code_server_shell

        adapter_stopped = await terminate_adapter_shell()
        code_server_stopped = await terminate_code_server_shell()
        removed = await asyncio.to_thread(remove_code_server_installation)
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Failed to switch to Monaco language web workers: {exc}",
        }

    ui_prefs = await _persist_mode(web_workers_enabled=True)
    return {
        "ok": True,
        "data": {
            "mode": "web-workers",
            "webWorkersEnabled": True,
            "managedRuntimeRemoved": removed,
            "adapterStopped": adapter_stopped,
            "codeServerStopped": code_server_stopped,
            "code_server": inspect_code_server_prerequisite().payload(),
            "ui": ui_prefs,
        },
    }


async def _persist_mode(*, web_workers_enabled: bool) -> JsonMap:
    updated = get_preferences_store().update_preferences(
        ui={"webWorkersEnabled": web_workers_enabled}
    )
    raw_ui = updated.get("ui")
    ui: JsonMap = {}
    if isinstance(raw_ui, dict):
        ui = {
            str(key): value
            for key, value in cast(dict[object, object], raw_ui).items()
            if isinstance(key, str)
        }
    await publish_preferences_changed(
        ui=ui,
        source="host_language_backend:set",
    )
    return ui


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    return str(Path(value).expanduser().resolve(strict=False))
