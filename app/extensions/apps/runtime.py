from __future__ import annotations

import asyncio
import contextlib
import os
import time
from pathlib import Path
from typing import Any, Optional

import app as app_pkg
from framework_shells import ShellRecord, get_manager as get_framework_shell_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.shellspec import parse_shellspec_data, parse_shellspec_ref

from app.extensions.apps.registry import AppDefinition, AppRegistry
from app.libs import app_lifecycle


def _project_root() -> Path:
    return Path(app_pkg.__file__).resolve().parents[1]


def _parse_port(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _record_app_id(record: ShellRecord) -> str:
    return str(record.derive_app_id() or "").strip()


def _record_port(record: ShellRecord) -> Optional[int]:
    env = getattr(record, "env_overrides", None) or {}
    return _parse_port(env.get("TE_APP_WORKER_PORT"))


def _is_app_worker_record(record: ShellRecord) -> bool:
    subgroups = list(getattr(record, "subgroups", None) or [])
    if len(subgroups) >= 2 and str(subgroups[1]).strip() == "app-worker":
        return True
    label = str(getattr(record, "label", "") or "")
    return label.startswith("app-worker:")


def _record_payload(record: ShellRecord) -> dict[str, Any]:
    to_payload = getattr(record, "to_payload", None)
    if callable(to_payload):
        return to_payload()
    return {
        "id": getattr(record, "id", None),
        "label": getattr(record, "label", None),
        "pid": getattr(record, "pid", None),
        "status": getattr(record, "status", None),
        "subgroups": list(getattr(record, "subgroups", None) or []),
    }


def _record_sort_key(record: ShellRecord) -> tuple[float, float, int]:
    updated_at = getattr(record, "updated_at", None) or 0.0
    created_at = getattr(record, "created_at", None) or 0.0
    pid = getattr(record, "pid", None) or 0
    return (float(updated_at), float(created_at), int(pid))


async def _wait_for_port(port: int, *, host: str = "127.0.0.1", timeout: float = 10.0, interval: float = 0.2) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            reader, writer = await asyncio.open_connection(host, port)
        except (OSError, ConnectionError):
            await asyncio.sleep(interval)
            continue
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()
        return True
    return False


class AppRuntime:
    def __init__(self, registry: AppRegistry):
        self.registry = registry
        self.project_root = _project_root()

    async def list_running_records(self) -> list[ShellRecord]:
        manager = await get_framework_shell_manager()
        shells = await manager.list_shells()
        return [record for record in shells if getattr(record, "status", None) == "running"]

    async def _find_running_app_worker_record(self, app_id: str) -> Optional[ShellRecord]:
        candidates = [
            record
            for record in await self.list_running_records()
            if _record_app_id(record) == app_id and _is_app_worker_record(record)
        ]
        if not candidates:
            return None
        return max(candidates, key=_record_sort_key)

    async def get_running_app_map(self) -> dict[str, dict[str, Any]]:
        running: dict[str, dict[str, Any]] = {}
        for record in await self.list_running_records():
            app_id = _record_app_id(record)
            if not app_id or self.registry.get_app(app_id) is None:
                continue
            if not _is_app_worker_record(record):
                continue
            port = _record_port(record)
            if port is None:
                continue
            running[app_id] = {
                "app_id": app_id,
                "port": port,
                "shell_id": record.id,
                "label": record.label,
                "source": "framework_shells",
            }
        return running

    async def get_running_app(self, app_id: str) -> Optional[dict[str, Any]]:
        return (await self.get_running_app_map()).get(str(app_id or "").strip())

    async def adopt_running_apps(self) -> list[dict[str, Any]]:
        adopted: list[dict[str, Any]] = []
        for app_id, info in (await self.get_running_app_map()).items():
            port = _parse_port(info.get("port"))
            if port is None:
                continue
            await app_lifecycle.register_app(app_id, str(info["shell_id"]), port)
            adopted.append(dict(info))
        return adopted

    async def _start_shell(self, app: AppDefinition) -> ShellRecord:
        if not app.shells:
            raise RuntimeError(f"App '{app.app_id}' has no app worker shellspec")
        shell = app.shells[0]
        manager = await get_framework_shell_manager()
        orch = Orchestrator(manager)
        ctx: dict[str, Any] = {
            "APP_ID": app.app_id,
            "PROJECT_ROOT": str(self.project_root),
        }
        if app.backend_module:
            ctx["BACKEND_MODULE_PATH"] = str((app.root_dir / app.backend_module).resolve())

        env_overrides = dict(shell.env)
        env_overrides["TE_APP_ID"] = app.app_id
        if os.environ.get("TE_FRAMEWORK_URL"):
            env_overrides["TE_FRAMEWORK_URL"] = os.environ["TE_FRAMEWORK_URL"]
        else:
            framework_port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
            env_overrides["TE_FRAMEWORK_URL"] = f"http://127.0.0.1:{framework_port}"
        ui: Optional[dict[str, Any]] = None
        if app.framework_shell_ui or shell.ui:
            ui = {}
            if app.framework_shell_ui:
                ui.update(app.framework_shell_ui)
            if shell.ui:
                ui.update(shell.ui)
        label = shell.label or f"app-worker:{app.app_id}"

        if shell.ref:
            _ref_path, spec_shell_id = parse_shellspec_ref(shell.ref)
            if not spec_shell_id:
                raise RuntimeError(f"shellspec ref '{shell.ref}' must include '#<id>'")
            return await orch.start_from_ref(
                shell.ref,
                base_dir=app.root_dir,
                ctx=ctx,
                label=label,
                record_spec_id=f"app:{app.app_id}:{spec_shell_id}",
                ui=ui,
                env_overrides=env_overrides or None,
                subgroups_overrides=[app.app_id, shell.subgroup],
                wait_ready=False,
            )

        specs_map = parse_shellspec_data(shell.inline_spec or {}, default_id="app-worker")
        if not specs_map:
            raise RuntimeError(f"Invalid inline shellspec for app '{app.app_id}'")
        spec = specs_map.get("app-worker") or next(iter(specs_map.values()))
        return await orch.start_spec(
            spec,
            ctx=ctx,
            label=label,
            record_spec_id=f"app:{app.app_id}:{spec.id}",
            ui=ui,
            env_overrides=env_overrides or None,
            subgroups_overrides=[app.app_id, shell.subgroup],
            wait_ready=False,
        )

    async def start_app(self, app_id: str) -> dict[str, Any]:
        app = self.registry.get_app(app_id)
        if app is None:
            raise ValueError(f"App '{app_id}' not found")
        if not app.enabled:
            raise RuntimeError(f"App '{app_id}' is disabled")

        running = await self.get_running_app(app_id)
        if running:
            port = _parse_port(running.get("port"))
            shell_id = str(running.get("shell_id") or "").strip()
            if port is not None and shell_id and await app_lifecycle.get_app_readiness(app_id) is None:
                await app_lifecycle.register_app(app_id, shell_id, port)
            return running

        if not app.backend_module and not app.shells:
            return {"app_id": app.app_id, "message": "No backend to start"}

        record = await self._start_shell(app)
        port = _record_port(record)
        if port is None:
            raise RuntimeError(f"App worker shellspec did not set TE_APP_WORKER_PORT for app '{app.app_id}'")

        await app_lifecycle.register_app(app.app_id, record.id, port)
        return {
            "app_id": app.app_id,
            "port": port,
            "shell_id": record.id,
            "label": record.label,
        }

    async def describe_app(self, app_id: str) -> dict[str, Any]:
        app = self.registry.get_app(app_id)
        if app is None:
            return {"ok": False, "error": f"unknown app: {app_id}"}

        manager = await get_framework_shell_manager()
        shells = await manager.list_shells()
        owned = [record for record in shells if _record_app_id(record) == app_id]
        described: list[dict[str, Any]] = []
        for record in owned:
            try:
                described.append(await manager.describe(record))
            except Exception:
                described.append(_record_payload(record))
        return {
            "ok": True,
            "app_id": app_id,
            "definition": app.to_payload(),
            "shells": described,
        }

    async def shutdown_app(self, app_id: str) -> dict[str, Any]:
        app = self.registry.get_app(app_id)
        if app is None:
            return {"ok": False, "error": f"unknown app: {app_id}"}
        manager = await get_framework_shell_manager()
        result = await manager.shutdown_app_group(app_id)
        await app_lifecycle.unregister_app_group(app_id)
        return {
            "ok": True,
            "app_id": app_id,
            "shutdown": result.get("data", result) if isinstance(result, dict) else result,
        }

    async def restart_app(self, app_id: str) -> dict[str, Any]:
        shutdown = await self.shutdown_app(app_id)
        started = await self.start_app(app_id)
        return {"ok": True, "app_id": app_id, "shutdown": shutdown, "started": started}
