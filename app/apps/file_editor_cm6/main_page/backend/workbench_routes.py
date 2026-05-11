# pyright: strict, reportUnusedFunction=false
from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Protocol, cast

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from .state_payload import JsonObject


class ShellRecordLike(Protocol):
    id: str
    pid: int | None
    status: str | None
    env_overrides: Mapping[str, object] | None


class WorkbenchExtensionSidecarLike(Protocol):
    def get_workbench_enabled_extensions(self) -> list[str]: ...

    def set_workbench_enabled_extensions(self, enabled: list[str]) -> None: ...

    def enable_workbench_extension(self, extension_id: str) -> None: ...

    def disable_workbench_extension(self, extension_id: str) -> None: ...

    def save(self) -> None: ...


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...

    def get_session_state(self) -> JsonObject: ...

    def get_project_sidecar(self, project_root: str) -> WorkbenchExtensionSidecarLike | None: ...


class EnsureCodeServerShellFn(Protocol):
    def __call__(self, project_root: str) -> Awaitable[ShellRecordLike]: ...


class EnsureWorkbenchAdapterShellFn(Protocol):
    def __call__(
        self,
        project_root: str,
        *,
        code_server_http: str,
        code_server_socket_path: str | None,
    ) -> Awaitable[ShellRecordLike]: ...


class CodeServerConnectionTargetFn(Protocol):
    def __call__(self, record: ShellRecordLike) -> tuple[str, str | None]: ...


@dataclass(slots=True)
class WorkbenchAdapterBootRecord:
    worker_shell_id: str | None = None
    project_root: str | None = None
    adapter_shell_id: str | None = None
    boot_ts_ms: float = 0.0


@dataclass(frozen=True, slots=True)
class WorkbenchRoutesDeps:
    history: HistoryStoreLike
    get_project_root: Callable[[], Path]
    ensure_code_server_shell: EnsureCodeServerShellFn
    ensure_workbench_adapter_shell: EnsureWorkbenchAdapterShellFn
    code_server_connection_target: CodeServerConnectionTargetFn
    nudge_diagnostics_for_file: Callable[[str], Awaitable[bool]]
    get_shell_by_id: Callable[[str], Awaitable[ShellRecordLike | None]] | None = None
    boot_record: WorkbenchAdapterBootRecord = field(default_factory=WorkbenchAdapterBootRecord)


def _now_ms() -> float:
    return time.time() * 1000.0


def _json_error(prefix: str, exc: Exception, status_code: int = 503) -> JSONResponse:
    print(f"{prefix} failed: {type(exc).__name__}: {exc}", flush=True)
    return JSONResponse(
        {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
        status_code=status_code,
    )


def _active_project_root(deps: WorkbenchRoutesDeps) -> str:
    project_root = deps.history.get_active_project() or str(deps.get_project_root())
    if not project_root:
        raise HTTPException(status_code=400, detail="No active project root")
    return project_root


def _record_port(record: ShellRecordLike) -> int:
    env = record.env_overrides or {}
    port_s = env.get("TE2_ADAPTER_PORT") or ""
    try:
        return int(str(port_s))
    except Exception:
        return 0


def _adapter_code_server_target(
    deps: WorkbenchRoutesDeps,
    code_server_record: ShellRecordLike,
    project_root: str,
) -> tuple[str, str, str | None]:
    env = code_server_record.env_overrides or {}
    resolved_project_root = str(env.get("PROJECT_ROOT") or project_root)
    code_server_http, code_server_socket_path = deps.code_server_connection_target(code_server_record)
    return resolved_project_root, code_server_http, code_server_socket_path


def _empty_session() -> JsonObject:
    return {"connected": False, "ready": False}


def _as_json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    result: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            result[key] = item
    return result


def _coerce_session(value: object) -> JsonObject:
    session = _as_json_object(value)
    if not session:
        return _empty_session()
    return session


async def _probe_adapter_status(port: int, *, timeout_s: float) -> tuple[str, JsonObject]:
    if not port:
        return "starting", _empty_session()

    try:
        import httpx

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                f"http://127.0.0.1:{port}/cmd",
                json={"jsonrpc": "2.0", "id": 1, "method": "te2.status", "params": {}},
            )
        raw_payload: object = cast(object, resp.json()) if resp.content else None
        payload = _as_json_object(raw_payload)
        result = _as_json_object(payload.get("result"))
        session = _coerce_session(result.get("session"))
        connected = bool(session.get("connected"))
        ready = bool(session.get("ready"))
        state = "ready" if ready else ("connected" if connected else "starting")
        return state, session
    except Exception:
        return "starting", _empty_session()


async def _ensure_code_server_target(
    deps: WorkbenchRoutesDeps,
    project_root: str,
    *,
    log_prefix: str,
) -> tuple[str, str, str | None] | JSONResponse:
    try:
        code_server_record = await deps.ensure_code_server_shell(project_root)
    except Exception as exc:
        return _json_error(log_prefix, exc)
    return _adapter_code_server_target(deps, code_server_record, project_root)


async def _ensure_adapter_record(
    deps: WorkbenchRoutesDeps,
    project_root: str,
    *,
    code_server_http: str,
    code_server_socket_path: str | None,
    log_prefix: str,
) -> ShellRecordLike | JSONResponse:
    try:
        return await deps.ensure_workbench_adapter_shell(
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
        )
    except Exception as exc:
        return _json_error(log_prefix, exc)


async def _reuse_boot_adapter_record(
    deps: WorkbenchRoutesDeps,
    *,
    project_root: str,
    code_server_socket_path: str | None,
) -> ShellRecordLike | None:
    if deps.get_shell_by_id is None:
        return None

    boot = deps.boot_record
    boot_shell_id = boot.adapter_shell_id or ""
    boot_worker_id = boot.worker_shell_id or ""
    boot_project = boot.project_root or ""
    this_worker_id = os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown")
    if not boot_shell_id or not boot_worker_id:
        return None
    if boot_worker_id != this_worker_id or boot_project != project_root:
        return None

    try:
        maybe = await deps.get_shell_by_id(boot_shell_id)
    except Exception:
        return None
    if not maybe or not maybe.pid or maybe.status != "running":
        return None

    maybe_env = maybe.env_overrides or {}
    maybe_socket = str(maybe_env.get("TE2_CODE_SERVER_SOCKET") or "").strip()
    expected_socket = str(code_server_socket_path or "").strip()
    if maybe_socket != expected_socket:
        return None
    return maybe


def _remember_boot_adapter(deps: WorkbenchRoutesDeps, *, project_root: str, record: ShellRecordLike) -> None:
    deps.boot_record.worker_shell_id = os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown")
    deps.boot_record.project_root = project_root
    deps.boot_record.adapter_shell_id = record.id
    deps.boot_record.boot_ts_ms = _now_ms()


def _enabled_extensions(sidecar: WorkbenchExtensionSidecarLike) -> list[str]:
    try:
        return sidecar.get_workbench_enabled_extensions()
    except Exception:
        return []


def _coerce_enabled_list(payload: JsonObject) -> list[str] | None:
    raw_items = payload.get("enabled")
    if not isinstance(raw_items, list):
        return None

    enabled: list[str] = []
    for item in cast(list[object], raw_items):
        text = str(item).strip()
        if not text or text in enabled:
            continue
        enabled.append(text)
    return enabled


def create_workbench_router(deps: WorkbenchRoutesDeps) -> APIRouter:
    router = APIRouter()

    @router.get("/workbench_adapter/discover", response_model=None)
    async def workbench_adapter_discover() -> JsonObject | JSONResponse:
        """Start/adopt the Node workbench adapter and return a same-origin cmd URL."""
        project_root = _active_project_root(deps)
        target = await _ensure_code_server_target(deps, project_root, log_prefix="[code_server][discover]")
        if isinstance(target, JSONResponse):
            return target
        project_root, code_server_http, code_server_socket_path = target

        record = await _ensure_adapter_record(
            deps,
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
            log_prefix="[workbench_adapter][discover]",
        )
        if isinstance(record, JSONResponse):
            return record

        return {
            "ok": True,
            "data": {
                "project_root": project_root,
                "port": _record_port(record),
                "shell_id": record.id,
                "cmd_url": "/api/app/file_editor_cm6/workbench_adapter/cmd",
            },
        }

    @router.get("/workbench_adapter/start", response_model=None)
    async def workbench_adapter_start() -> JsonObject | JSONResponse:
        """Start/adopt the workbench adapter and return a baton token."""
        project_root = _active_project_root(deps)
        target = await _ensure_code_server_target(deps, project_root, log_prefix="[code_server][start]")
        if isinstance(target, JSONResponse):
            return target
        project_root, code_server_http, code_server_socket_path = target

        record = await _reuse_boot_adapter_record(
            deps,
            project_root=project_root,
            code_server_socket_path=code_server_socket_path,
        )
        if record is None:
            ensured = await _ensure_adapter_record(
                deps,
                project_root,
                code_server_http=code_server_http,
                code_server_socket_path=code_server_socket_path,
                log_prefix="[workbench_adapter][start]",
            )
            if isinstance(ensured, JSONResponse):
                return ensured
            record = ensured
            _remember_boot_adapter(deps, project_root=project_root, record=record)

        return {
            "ok": True,
            "data": {
                "state": "starting",
                "project_root": project_root,
                "port": _record_port(record),
                "shell_id": record.id,
                "cmd_url": "/api/app/file_editor_cm6/workbench_adapter/cmd",
            },
        }

    @router.get("/workbench_adapter/attach", response_model=None)
    async def workbench_adapter_attach() -> JsonObject | JSONResponse:
        """Attach to the adapter without perturbing an already-running session."""
        project_root = _active_project_root(deps)
        target = await _ensure_code_server_target(deps, project_root, log_prefix="[code_server][attach]")
        if isinstance(target, JSONResponse):
            return target
        project_root, code_server_http, code_server_socket_path = target

        record = await _ensure_adapter_record(
            deps,
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
            log_prefix="[workbench_adapter][attach]",
        )
        if isinstance(record, JSONResponse):
            return record

        port = _record_port(record)
        state, session = await _probe_adapter_status(port, timeout_s=3.0)
        return {
            "ok": True,
            "data": {
                "state": state,
                "session": session,
                "project_root": project_root,
                "port": port,
                "shell_id": record.id,
                "cmd_url": "/api/app/file_editor_cm6/workbench_adapter/cmd",
            },
        }

    @router.get("/workbench_adapter/nudge", response_model=None)
    async def workbench_adapter_nudge(path: str = "") -> JsonObject | JSONResponse:
        """Request a diagnostics nudge for the active file path."""
        project_root = _active_project_root(deps)
        abs_path = str(path or "").strip()
        if not abs_path:
            try:
                session_state = deps.history.get_session_state()
                current_path = session_state.get("currentPath")
                abs_path = current_path.strip() if isinstance(current_path, str) else ""
            except Exception:
                abs_path = ""
        if not abs_path:
            return JSONResponse({"ok": False, "error": "missing_path"}, status_code=400)

        try:
            project_root_path = Path(project_root).expanduser().resolve(strict=False)
            abs_path_resolved = Path(abs_path).expanduser().resolve(strict=False)
        except Exception:
            return JSONResponse({"ok": False, "error": "invalid_path"}, status_code=400)

        if not str(abs_path_resolved).startswith(str(project_root_path)):
            return JSONResponse({"ok": False, "error": "outside_project"}, status_code=400)

        try:
            ok = await deps.nudge_diagnostics_for_file(str(abs_path_resolved))
        except Exception as exc:
            return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, status_code=500)

        return {
            "ok": True,
            "data": {
                "path": str(abs_path_resolved),
                "requested": bool(ok),
            },
        }

    @router.get("/workbench_adapter/status", response_model=None)
    async def workbench_adapter_status() -> JsonObject | JSONResponse:
        """Return workbench adapter readiness state."""
        project_root = _active_project_root(deps)
        target = await _ensure_code_server_target(deps, project_root, log_prefix="[code_server][status]")
        if isinstance(target, JSONResponse):
            return target
        project_root, code_server_http, code_server_socket_path = target

        record = await _ensure_adapter_record(
            deps,
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
            log_prefix="[workbench_adapter][status]",
        )
        if isinstance(record, JSONResponse):
            return record

        state, session = await _probe_adapter_status(_record_port(record), timeout_s=5.0)
        return {"ok": True, "state": state, "session": session}

    @router.post("/workbench_adapter/cmd", response_model=None)
    async def workbench_adapter_cmd(request: Request) -> Response | JSONResponse:
        """Same-origin JSON-RPC proxy to the Node workbench adapter /cmd endpoint."""
        project_root = _active_project_root(deps)
        code_server_record = await deps.ensure_code_server_shell(project_root)
        project_root, code_server_http, code_server_socket_path = _adapter_code_server_target(
            deps,
            code_server_record,
            project_root,
        )
        record = await deps.ensure_workbench_adapter_shell(
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
        )
        port = _record_port(record)
        if not port:
            raise HTTPException(status_code=503, detail="workbench adapter not ready (missing port)")

        try:
            body = await request.body()
        except Exception:
            body = b""

        try:
            import httpx

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"http://127.0.0.1:{port}/cmd",
                    content=body,
                    headers={"content-type": request.headers.get("content-type", "application/json")},
                )
        except Exception as exc:
            print(f"[workbench_adapter][cmd] proxy failed: {type(exc).__name__}: {exc}", flush=True)
            return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, status_code=503)

        content_type = cast(object, resp.headers.get("content-type", "application/json"))
        media_type = content_type if isinstance(content_type, str) else "application/json"
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=media_type,
        )

    @router.get("/workbench/extensions/enabled", response_model=None)
    async def workbench_get_enabled_extensions() -> JsonObject:
        """Return VSIX extensions enabled for the active project."""
        project_root = _active_project_root(deps)
        sidecar = deps.history.get_project_sidecar(project_root)
        if not sidecar:
            raise HTTPException(status_code=500, detail="Failed to load project sidecar")
        return {"ok": True, "data": {"project_root": project_root, "enabled": _enabled_extensions(sidecar)}}

    @router.post("/workbench/extensions/enabled", response_model=None)
    async def workbench_set_enabled_extensions(payload: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Set or toggle enabled extensions for the active project."""
        project_root = _active_project_root(deps)
        sidecar = deps.history.get_project_sidecar(project_root)
        if not sidecar:
            raise HTTPException(status_code=500, detail="Failed to load project sidecar")

        enabled = _coerce_enabled_list(payload)
        if enabled is not None:
            try:
                sidecar.set_workbench_enabled_extensions(enabled)
                sidecar.save()
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to save enabled extensions: {exc}") from exc
            return {
                "ok": True,
                "data": {"project_root": project_root, "enabled": sidecar.get_workbench_enabled_extensions()},
            }

        ext_id = payload.get("id")
        if not ext_id:
            raise HTTPException(status_code=400, detail="Expected 'enabled' list or ('id' + 'enabled') payload")
        flag = bool(payload.get("enabled", False))
        try:
            if flag:
                sidecar.enable_workbench_extension(str(ext_id))
            else:
                sidecar.disable_workbench_extension(str(ext_id))
            sidecar.save()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to save enabled extensions: {exc}") from exc

        return {"ok": True, "data": {"project_root": project_root, "enabled": sidecar.get_workbench_enabled_extensions()}}

    return router
