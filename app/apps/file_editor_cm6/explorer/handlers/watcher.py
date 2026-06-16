# pyright: strict
from __future__ import annotations

import asyncio
import importlib
import logging
import subprocess
from typing import Awaitable, Callable, cast

from ..contracts.watcher import (
    WatcherConfigPayload,
    WatcherGetConfigParams,
    WatcherModeStatusPayload,
    WatcherRaiseLimitParams,
    WatcherRaiseResultPayload,
    WatcherSetModeParams,
    build_watcher_config_payload,
)
from ..context import ExplorerWatcherHandlerContext
from ..services.state_facts import publish_watcher_config_changed
from ...project_sidecar import ProjectSidecar

logger = logging.getLogger(__name__)
AdapterRpc = Callable[[str, dict[str, object] | None, float], Awaitable[object]]


async def handle_watcher_raise_limit(
    context: ExplorerWatcherHandlerContext,
    params: WatcherRaiseLimitParams,
    msg_id: str | None,
) -> None:
    cmd = [
        "sudo",
        "-S",
        "sysctl",
        "-w",
        f"fs.inotify.max_user_watches={params['limit']}",
    ]

    def _run() -> subprocess.CompletedProcess[str]:
        password = params["password"]
        return subprocess.run(
            cmd,
            input=(password + "\n") if password else "\n",
            text=True,
            capture_output=True,
            timeout=15,
        )

    try:
        result = await asyncio.to_thread(_run)
        out_payload: WatcherRaiseResultPayload = {
            "ok": result.returncode == 0,
            "code": result.returncode,
            "stdout": (result.stdout or "").strip(),
            "stderr": (result.stderr or "").strip(),
        }
    except Exception as exc:
        out_payload = {
            "ok": False,
            "code": -1,
            "stdout": "",
            "stderr": str(exc),
        }

    await context.emit_personal("explorer.watcher.limit.raiseResult", dict(out_payload), msg_id)

    if not out_payload["ok"]:
        return

    try:
        await _resubscribe_adapter_watcher()
        logger.info("[watcher] resubscribed IPC watcher after inotify raise")
    except Exception as exc:
        logger.warning("[watcher] resubscribe after raise failed: %s", exc)

    try:
        from ...watchexec_shell_manager import stop_watchexec_shell

        await stop_watchexec_shell()
    except Exception:
        pass


async def handle_watcher_set_mode(
    context: ExplorerWatcherHandlerContext,
    params: WatcherSetModeParams,
    msg_id: str | None,
) -> None:
    mode = params["mode"]
    storage_type = params["storage_type"]
    poll_interval_ms = params["poll_interval_ms"]

    try:
        sidecar = ProjectSidecar.load_or_create(str(context.project_root))
        sidecar_data = _sidecar_data_dict(sidecar)
        watcher_cfg = _normalize_config_dict(
            sidecar_data.get("watcher") if sidecar_data is not None else None
        )
        watcher_cfg["mode"] = mode
        watcher_cfg["storage_type"] = storage_type
        watcher_cfg["poll_interval_ms"] = poll_interval_ms
        if sidecar_data is not None:
            sidecar_data["watcher"] = watcher_cfg
        sidecar.save()
    except Exception as exc:
        logger.warning("[watcher] failed to persist mode: %s", exc)

    try:
        from ...code_server_shell_manager import sync_vscode_watcher_settings

        sync_vscode_watcher_settings(mode)
    except Exception as exc:
        logger.warning("[watcher] failed to sync vscode watcher settings: %s", exc)

    from ...watchexec_shell_manager import (
        ensure_watchexec_shell,
        is_watchexec_available,
        stop_watchexec_shell,
    )

    active = True
    if mode == "watchexec":
        try:
            shell = await ensure_watchexec_shell(str(context.project_root), poll_interval_ms)
            active = shell is not None
        except Exception as exc:
            logger.warning("[watcher] failed to start watchexec: %s", exc)
            active = False
    else:
        try:
            await stop_watchexec_shell()
        except Exception:
            pass

    status_payload: WatcherModeStatusPayload = {
        "mode": mode,
        "storage_type": storage_type,
        "poll_interval_ms": poll_interval_ms,
        "active": active,
    }
    await context.emit_personal("explorer.watcher.mode.status", dict(status_payload), msg_id)
    config_payload: WatcherConfigPayload = {
        "mode": mode,
        "storage_type": storage_type,
        "poll_interval_ms": poll_interval_ms,
        "watchexec_available": is_watchexec_available(),
    }
    await publish_watcher_config_changed(
        context.project_root,
        {
            "config": dict(config_payload),
            "mode": mode,
            "mode_status": dict(status_payload),
        },
        source="explorer_watcher:set_mode",
    )


async def handle_watcher_get_config(
    context: ExplorerWatcherHandlerContext,
    params: WatcherGetConfigParams,
    msg_id: str | None,
) -> None:
    del params

    from ...watchexec_shell_manager import is_watchexec_available

    try:
        sidecar = ProjectSidecar.load_or_create(str(context.project_root))
        sidecar_data = _sidecar_data_dict(sidecar)
        watcher_config: object = (
            sidecar_data.get("watcher") if sidecar_data is not None else {}
        )
    except Exception:
        watcher_config = {}

    payload: WatcherConfigPayload = build_watcher_config_payload(
        watcher_config,
        watchexec_available=is_watchexec_available(),
    )
    await context.emit_personal("explorer.watcher.config.updated", dict(payload), msg_id)


def _normalize_config_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized


def _sidecar_data_dict(sidecar: ProjectSidecar) -> dict[object, object] | None:
    data = getattr(sidecar, "_data", None)
    if not isinstance(data, dict):
        return None
    return cast(dict[object, object], data)


async def _resubscribe_adapter_watcher() -> None:
    adapter_module = importlib.import_module(
        "app.apps.file_editor_cm6.workbench_adapter_shell_manager"
    )
    adapter_rpc_obj = getattr(adapter_module, "adapter_rpc", None)
    if not callable(adapter_rpc_obj):
        raise RuntimeError("adapter_rpc unavailable")
    adapter_rpc_call = cast(AdapterRpc, adapter_rpc_obj)
    await adapter_rpc_call("adapter.resubscribeWatcher", None, 30)
