# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import stat
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, TypedDict, cast

from .monaco_editor.editor_backend_services.document_materialization_service import (
    materialize_document_payload,
)
from .open_state_backend import SidecarOpenStatePayload
from .open_state_events import open_state_payload_from_event
from .project_sidecar import ProjectSidecar
from .worker_services.event_bus import (
    JsonObject,
    WorkerEvent,
    current_project_generation,
    event_payload_list,
    event_payload_object,
    record_coalesced_event,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)


class LogicalDocumentDescriptor(TypedDict):
    path: str
    contentIdentity: str
    baseSha256: str | None
    dirty: bool


class LogicalDocumentSnapshot(TypedDict):
    projectPath: str
    projectGeneration: int
    openStateRevision: int
    activePath: str | None
    background: list[LogicalDocumentDescriptor]


class LogicalHydrationRequest(LogicalDocumentDescriptor):
    languageId: str
    reason: str
    expectedActiveEpoch: int


class AdapterRpcCall(Protocol):
    def __call__(
        self,
        method: str,
        params: JsonObject | None = None,
        timeout: float = 30.0,
    ) -> Awaitable[JsonObject]: ...


SnapshotBuilder = Callable[
    [SidecarOpenStatePayload, int],
    LogicalDocumentSnapshot,
]
HydrationMaterializer = Callable[
    [str, LogicalHydrationRequest],
    JsonObject | None,
]

_MAX_LOGICAL_DOCUMENTS = 12
_STALE_HYDRATION_ERRORS = {
    "active_document_protected",
    "logical_snapshot_missing",
    "path_not_in_logical_snapshot",
    "stale_active_epoch",
    "stale_open_state_revision",
    "stale_project_generation",
}
_event_bus_handlers_registered = False


def _normalize_path(value: str | Path) -> str:
    return str(Path(value).expanduser().resolve(strict=False))


def _is_within_project(path: str, project_path: str) -> bool:
    try:
        candidate = Path(path)
        root = Path(project_path)
        _ = candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _stat_identity(file_stat: os.stat_result) -> str:
    return (
        "stat-v1:"
        f"{file_stat.st_dev}:{file_stat.st_ino}:"
        f"{file_stat.st_size}:{file_stat.st_mtime_ns}"
    )


def _draft_sha256(entry: Mapping[str, object]) -> str | None:
    raw_sha = entry.get("content_sha256")
    if isinstance(raw_sha, str) and raw_sha:
        return raw_sha
    content = entry.get("content")
    if not isinstance(content, str):
        return None
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _draft_base_sha256(entry: Mapping[str, object]) -> str | None:
    raw_sha = entry.get("base_sha256")
    return raw_sha if isinstance(raw_sha, str) and raw_sha else None


def build_logical_document_snapshot(
    open_state: SidecarOpenStatePayload,
    project_generation: int,
) -> LogicalDocumentSnapshot:
    """Build one metadata-only WBA snapshot from the authoritative sidecar state."""
    project_path = _normalize_path(open_state["projectPath"])
    active_path: str | None = None
    sidecar = ProjectSidecar(project_path)
    descriptors: list[LogicalDocumentDescriptor] = []
    seen: set[str] = set()

    for raw_recent in open_state.get("recents", []):
        raw_path = raw_recent.get("path")
        if not raw_path:
            continue
        path = _normalize_path(raw_path)
        if (
            path in seen
            or not _is_within_project(path, project_path)
        ):
            continue

        cached = sidecar.get_cached_document(path)
        if cached and cached.get("unsaved") is True:
            content_sha = _draft_sha256(cached)
            if not content_sha:
                continue
            descriptor: LogicalDocumentDescriptor = {
                "path": path,
                "contentIdentity": f"sha256:{content_sha}",
                "baseSha256": _draft_base_sha256(cached),
                "dirty": True,
            }
        else:
            try:
                file_stat = Path(path).stat()
            except OSError:
                continue
            if not stat.S_ISREG(file_stat.st_mode):
                continue
            descriptor = {
                "path": path,
                "contentIdentity": _stat_identity(file_stat),
                "baseSha256": None,
                "dirty": False,
            }

        seen.add(path)
        descriptors.append(descriptor)
        if len(descriptors) >= _MAX_LOGICAL_DOCUMENTS:
            break

    revision = open_state.get("revision")
    return {
        "projectPath": project_path,
        "projectGeneration": max(0, project_generation),
        "openStateRevision": (
            revision
            if not isinstance(revision, bool) and revision >= 0
            else 0
        ),
        "activePath": active_path,
        "background": descriptors,
    }


def _parse_hydration_request(raw: object) -> LogicalHydrationRequest | None:
    if not isinstance(raw, dict):
        return None
    item = cast(dict[object, object], raw)
    path = item.get("path")
    language_id = item.get("languageId")
    content_identity = item.get("contentIdentity")
    base_sha = item.get("baseSha256")
    reason = item.get("reason")
    expected_active_epoch = item.get("expectedActiveEpoch")
    dirty = item.get("dirty")
    if (
        not isinstance(path, str)
        or not path
        or not isinstance(language_id, str)
        or not language_id
        or not isinstance(content_identity, str)
        or not content_identity
        or (base_sha is not None and (not isinstance(base_sha, str) or not base_sha))
        or not isinstance(reason, str)
        or not reason
        or not isinstance(expected_active_epoch, int)
        or isinstance(expected_active_epoch, bool)
        or expected_active_epoch < 0
        or not isinstance(dirty, bool)
    ):
        return None
    return {
        "path": _normalize_path(path),
        "languageId": language_id,
        "contentIdentity": content_identity,
        "baseSha256": base_sha,
        "dirty": dirty,
        "reason": reason,
        "expectedActiveEpoch": expected_active_epoch,
    }


def materialize_logical_document_hydration(
    project_path: str,
    request: LogicalHydrationRequest,
) -> JsonObject | None:
    """Materialize exactly one requested descriptor and reject content races."""
    path = request["path"]
    if not _is_within_project(path, project_path):
        return None

    sidecar = ProjectSidecar(project_path)
    cached = sidecar.get_cached_document(path)
    if request["dirty"]:
        if not cached or cached.get("unsaved") is not True:
            return None
        content_sha = _draft_sha256(cached)
        if (
            not content_sha
            or request["contentIdentity"] != f"sha256:{content_sha}"
            or request["baseSha256"] != _draft_base_sha256(cached)
        ):
            return None
        payload = materialize_document_payload(path, cached)
    else:
        if cached and cached.get("unsaved") is True:
            return None
        try:
            before = Path(path).stat()
        except OSError:
            return None
        if (
            not stat.S_ISREG(before.st_mode)
            or request["contentIdentity"] != _stat_identity(before)
            or request["baseSha256"] is not None
        ):
            return None
        try:
            payload = materialize_document_payload(
                path,
                None,
                strict_disk_errors=True,
            )
            after = Path(path).stat()
        except OSError:
            return None
        if _stat_identity(before) != _stat_identity(after):
            return None

    content = payload["content"]
    return {
        "path": path,
        "text": content,
        "languageId": request["languageId"],
        "contentIdentity": request["contentIdentity"],
        "baseSha256": request["baseSha256"],
        "dirty": request["dirty"],
        "expectedActiveEpoch": request["expectedActiveEpoch"],
    }


def _rpc_result(response: JsonObject) -> JsonObject:
    error = response.get("error")
    if error is not None:
        raise RuntimeError(f"adapter_rpc_error:{error}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("adapter_rpc_result_missing")
    return {str(key): value for key, value in cast(dict[object, object], result).items()}


class LogicalDocumentReconciler:
    """Project sidecar -> WBA semantic working-set reconciler."""

    def __init__(
        self,
        *,
        adapter_call: AdapterRpcCall,
        snapshot_builder: SnapshotBuilder = build_logical_document_snapshot,
        hydration_materializer: HydrationMaterializer = materialize_logical_document_hydration,
    ) -> None:
        self._adapter_call: AdapterRpcCall = adapter_call
        self._snapshot_builder: SnapshotBuilder = snapshot_builder
        self._hydration_materializer: HydrationMaterializer = hydration_materializer
        self._latest_open_state: SidecarOpenStatePayload | None = None
        self._latest_generation: int = 0
        self._ready_project: str | None = None
        self._work_revision: int = 0
        self._task: asyncio.Task[None] | None = None

    async def handle_open_state(self, event: WorkerEvent) -> None:
        project = event.get("project_root")
        if not project or not self._event_is_current(event, project):
            return
        open_state = open_state_payload_from_event(event)
        if open_state is None:
            return
        normalized_project = _normalize_path(project)
        self._latest_open_state = open_state
        self._latest_generation = self._effective_generation(event, normalized_project)
        if self._ready_project == normalized_project:
            self._schedule("open_state", event["type"])

    async def handle_draft_state(self, event: WorkerEvent) -> None:
        self._schedule_for_matching_project(event, "draft_state")

    async def handle_workspace_files(self, event: WorkerEvent) -> None:
        project = event.get("project_root")
        if not project or not self._event_is_current(event, project):
            return
        open_state = self._latest_open_state
        if open_state is None or _normalize_path(project) != open_state["projectPath"]:
            return
        open_paths = {
            _normalize_path(item["path"])
            for item in open_state.get("recents", [])
            if item["path"]
        }
        changed_paths = {
            _normalize_path(path)
            for key in ("created_abs", "changed_abs", "deleted_abs")
            for path in event_payload_list(event, key)
        }
        if open_paths.intersection(changed_paths):
            self._schedule("workspace_files", event["type"])

    async def handle_adapter_state(self, event: WorkerEvent) -> None:
        state = event_payload_object(event, "state")
        status = state.get("status")
        raw_project = state.get("project") or event.get("project_root")
        project = _normalize_path(raw_project) if isinstance(raw_project, str) and raw_project else None
        open_project = (
            self._latest_open_state["projectPath"]
            if self._latest_open_state is not None
            else None
        )
        if project and open_project and project != open_project:
            return
        if status == "ready" and project and self._event_is_current(event, project):
            self._ready_project = project
            self._schedule("adapter_ready", event["type"])
            return
        if project is None or project in {self._ready_project, open_project}:
            self._mark_adapter_unready(event["type"])

    async def handle_adapter_workspace_ready(self, event: WorkerEvent) -> None:
        project = event.get("project_root")
        if not project or not self._event_is_current(event, project):
            return
        normalized_project = _normalize_path(project)
        open_state = self._latest_open_state
        if open_state is not None and normalized_project != open_state["projectPath"]:
            return
        self._ready_project = normalized_project
        self._schedule("adapter_workspace_ready", event["type"])

    async def handle_active_document_changed(self, event: WorkerEvent) -> None:
        project = event.get("project_root")
        open_state = self._latest_open_state
        path = event["payload"].get("path")
        if (
            not project
            or open_state is None
            or not isinstance(path, str)
            or not path
            or not self._event_is_current(event, project)
            or _normalize_path(project) != open_state["projectPath"]
            or _normalize_path(path)
            not in {
                _normalize_path(item["path"])
                for item in open_state.get("recents", [])
                if item.get("path")
            }
        ):
            return
        self._latest_generation = self._effective_generation(event, project)
        self._schedule("active_document_changed", event["type"])

    async def handle_adapter_reset(self, event: WorkerEvent) -> None:
        self._mark_adapter_unready(event["type"])

    async def handle_project_switch_started(self, event: WorkerEvent) -> None:
        self._latest_open_state = None
        self._latest_generation = self._effective_generation(
            event,
            event.get("project_root") or "",
        )
        self._mark_adapter_unready(event["type"])

    async def wait_idle(self) -> None:
        task = self._task
        if task is not None:
            try:
                await task
            except asyncio.CancelledError:
                pass

    def _schedule_for_matching_project(
        self,
        event: WorkerEvent,
        reason: str,
    ) -> None:
        project = event.get("project_root")
        open_state = self._latest_open_state
        if (
            not project
            or open_state is None
            or not self._event_is_current(event, project)
            or _normalize_path(project) != open_state["projectPath"]
        ):
            return
        self._latest_generation = self._effective_generation(event, project)
        self._schedule(reason, event["type"])

    def _schedule(self, reason: str, event_type: str) -> None:
        open_state = self._latest_open_state
        if (
            open_state is None
            or self._ready_project is None
            or open_state["projectPath"] != self._ready_project
        ):
            return
        self._work_revision += 1
        revision = self._work_revision
        existing = self._task
        if existing is not None and not existing.done():
            _ = existing.cancel()
            record_coalesced_event("logical_document_reconciler", event_type)
        self._task = asyncio.create_task(
            self._run(revision, reason),
            name="code_te2_logical_document_reconcile",
        )

    def _mark_adapter_unready(self, event_type: str) -> None:
        self._ready_project = None
        self._work_revision += 1
        task = self._task
        if task is not None and not task.done():
            _ = task.cancel()
            record_coalesced_event("logical_document_reconciler", event_type)

    async def _run(self, revision: int, reason: str) -> None:
        current_task = asyncio.current_task()
        try:
            # One bounded retry handles a descriptor/materialization race. New
            # state facts still cancel this task and schedule the authoritative run.
            for attempt in range(2):
                raced = await self._reconcile_once(revision)
                if not raced or revision != self._work_revision:
                    return
                if attempt == 0:
                    await asyncio.sleep(0)
            logger.debug(
                "[logical_documents] deferred repeatedly racing snapshot reason=%s",
                reason,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "[logical_documents] reconcile failed reason=%s error=%s",
                reason,
                exc,
            )
        finally:
            if self._task is current_task:
                self._task = None

    async def _reconcile_once(self, revision: int) -> bool:
        open_state = self._latest_open_state
        ready_project = self._ready_project
        generation = self._latest_generation
        if (
            open_state is None
            or ready_project is None
            or open_state["projectPath"] != ready_project
            or revision != self._work_revision
        ):
            return False

        snapshot = await asyncio.to_thread(
            self._snapshot_builder,
            open_state,
            generation,
        )
        if revision != self._work_revision:
            return False
        response = await self._adapter_call(
            "vscode.logicalDocuments.reconcile",
            cast(JsonObject, cast(object, snapshot)),
            timeout=10.0,
        )
        result = _rpc_result(response)
        if result.get("ok") is not True:
            logger.debug(
                "[logical_documents] WBA rejected snapshot error=%s",
                result.get("error"),
            )
            return False

        hydration_items = result.get("hydration")
        if not isinstance(hydration_items, list):
            return False
        for raw_request in cast(list[object], hydration_items):
            if revision != self._work_revision:
                return False
            request = _parse_hydration_request(raw_request)
            if request is None:
                logger.debug("[logical_documents] ignored invalid hydration request")
                continue
            materialized = await asyncio.to_thread(
                self._hydration_materializer,
                snapshot["projectPath"],
                request,
            )
            if materialized is None:
                return True
            hydrate_params: JsonObject = {
                "projectPath": snapshot["projectPath"],
                "projectGeneration": snapshot["projectGeneration"],
                "openStateRevision": snapshot["openStateRevision"],
                **materialized,
            }
            response = await self._adapter_call(
                "vscode.logicalDocuments.hydrate",
                hydrate_params,
                timeout=10.0,
            )
            hydrate_result = _rpc_result(response)
            if hydrate_result.get("ok") is not True:
                error = str(hydrate_result.get("error") or "unknown")
                if error in _STALE_HYDRATION_ERRORS:
                    return False
                logger.warning(
                    "[logical_documents] hydration failed path=%s error=%s",
                    request["path"],
                    error,
                )
            await asyncio.sleep(0)
        return False

    def _event_is_current(self, event: WorkerEvent, project: str) -> bool:
        generation = event.get("project_generation")
        current = current_project_generation(project)
        if generation is not None and generation != current:
            record_stale_drop("logical_document_reconciler", event["type"])
            return False
        return True

    @staticmethod
    def _effective_generation(event: WorkerEvent, project: str) -> int:
        generation = event.get("project_generation")
        if generation is not None:
            return generation
        return current_project_generation(project) or 0


def _default_adapter_call(
    method: str,
    params: JsonObject | None = None,
    timeout: float = 30.0,
) -> Awaitable[JsonObject]:
    from .workbench_adapter_shell_manager import adapter_rpc

    return adapter_rpc(method, params, timeout)


_reconciler = LogicalDocumentReconciler(adapter_call=_default_adapter_call)


def register_logical_document_reconciler_handlers() -> None:
    """Register the sidecar-backed WBA semantic working-set projector."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("OpenStateChanged", _reconciler.handle_open_state)
    subscribe_worker_event("DraftStateChanged", _reconciler.handle_draft_state)
    subscribe_worker_event("WorkspaceFilesChanged", _reconciler.handle_workspace_files)
    subscribe_worker_event("AdapterStateChanged", _reconciler.handle_adapter_state)
    subscribe_worker_event(
        "AdapterActiveDocumentChanged",
        _reconciler.handle_active_document_changed,
    )
    subscribe_worker_event(
        "AdapterWorkspaceReady",
        _reconciler.handle_adapter_workspace_ready,
    )
    subscribe_worker_event("AdapterSessionReset", _reconciler.handle_adapter_reset)
    subscribe_worker_event(
        "ProjectSwitchStarted",
        _reconciler.handle_project_switch_started,
    )
    _event_bus_handlers_registered = True


__all__ = [
    "LogicalDocumentReconciler",
    "LogicalDocumentSnapshot",
    "LogicalHydrationRequest",
    "build_logical_document_snapshot",
    "materialize_logical_document_hydration",
    "register_logical_document_reconciler_handlers",
]
