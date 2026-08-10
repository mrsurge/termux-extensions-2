# pyright: strict
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
from typing import cast

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope

from ...project_sidecar import ProjectSidecar
from ..context import EmitPersonal

logger = logging.getLogger(__name__)

GetProjectRoot = Callable[[], Path]
RefreshExplorerState = Callable[[], Awaitable[None]]
JsonObject = dict[str, object]
PipeEventQueue = Queue[PipeEnvelope]


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


@dataclass
class ExplorerJobTrackingRuntime:
    pipe_queue: PipeEventQueue
    pipe_listener: pipe_runtime.PipeNotificationListener
    pipe_pump_task: asyncio.Task[None]


async def start_job_tracking(
    *,
    get_project_root: GetProjectRoot,
    tracked_job_ids: set[str],
    emit_personal: EmitPersonal,
    refresh_explorer_state: RefreshExplorerState,
) -> ExplorerJobTrackingRuntime | None:
    try:
        try:
            sidecar = ProjectSidecar.load_or_create(str(get_project_root()))
            tracked_job_ids.update(sidecar.list_tracked_jobs())
        except Exception:
            pass

        pipe_queue: PipeEventQueue = Queue()
        pipe_listener = pipe_runtime.add_notification_listener(
            pipe_queue,
            methods={"git.job.progress"},
        )
        pipe_pump_task = asyncio.create_task(
            _pump_pipe_git_job_events(
                get_project_root=get_project_root,
                queue=pipe_queue,
                tracked_job_ids=tracked_job_ids,
                emit_personal=emit_personal,
                refresh_explorer_state=refresh_explorer_state,
            )
        )
        return ExplorerJobTrackingRuntime(
            pipe_queue=pipe_queue,
            pipe_listener=pipe_listener,
            pipe_pump_task=pipe_pump_task,
        )
    except Exception as exc:
        logger.warning("Failed to register job listener: %s", exc)
        return None


async def stop_job_tracking(runtime: ExplorerJobTrackingRuntime | None) -> None:
    if runtime is None:
        return

    _ = runtime.pipe_pump_task.cancel()
    with suppress(asyncio.CancelledError):
        await runtime.pipe_pump_task

    pipe_runtime.remove_notification_listener(runtime.pipe_listener)


async def _pump_pipe_git_job_events(
    *,
    get_project_root: GetProjectRoot,
    queue: PipeEventQueue,
    tracked_job_ids: set[str],
    emit_personal: EmitPersonal,
    refresh_explorer_state: RefreshExplorerState,
) -> None:
    logger.debug("[PIPE_JOB_PUMP] Started pipe git job pump task")
    while True:
        try:
            envelope = await asyncio.to_thread(queue.get, timeout=0.5)
            job_data = _pipe_git_progress_to_job_data(envelope)
            if not job_data:
                continue
            job_id_obj = job_data.get("id")
            job_type_obj = job_data.get("type")
            job_status_obj = job_data.get("status")
            job_id = job_id_obj if isinstance(job_id_obj, str) else ""
            job_type = job_type_obj if isinstance(job_type_obj, str) else ""
            job_status = job_status_obj if isinstance(job_status_obj, str) else ""
            if not job_id:
                continue

            if job_id not in tracked_job_ids and not _sidecar_tracks_job(get_project_root(), job_id):
                logger.debug("[PIPE_JOB_PUMP] Ignoring untracked pipe job %s (%s)", job_id, job_type)
                continue

            tracked_job_ids.add(job_id)
            await emit_personal("explorer.job.progress", job_data, None)

            if job_status in ("succeeded", "failed", "cancelled"):
                tracked_job_ids.discard(job_id)
                _remove_sidecar_job(get_project_root(), job_id)
                if job_type == "git_clone" and job_status == "succeeded":
                    logger.info("[PIPE_JOB_PUMP] Clone succeeded, refreshing explorer")
                    await refresh_explorer_state()
        except Empty:
            continue
        except asyncio.CancelledError:
            logger.debug("[PIPE_JOB_PUMP] Task cancelled")
            break
        except Exception as exc:
            logger.warning("[PIPE_JOB_PUMP] Error: %s", exc)
            await asyncio.sleep(0.5)


def _pipe_git_progress_to_job_data(envelope: PipeEnvelope) -> JsonObject:
    if envelope.method != "git.job.progress":
        return {}
    params = _json_object(envelope.params)
    op_id = _string_value(params.get("opId"))
    provider_job_id = _string_value(params.get("jobId"))
    job_id = op_id or provider_job_id
    if not job_id:
        return {}
    progress = _json_object(params.get("progress"))
    error = _json_object(params.get("error"))
    error_message = _string_value(error.get("message"))
    result = params.get("result")
    job_data: JsonObject = {
        "id": job_id,
        "providerJobId": provider_job_id,
        "opId": op_id,
        "type": _string_value(params.get("type")),
        "status": _string_value(params.get("status")),
        "message": _string_value(params.get("message")),
        "progress": progress,
    }
    if isinstance(result, dict):
        job_data["result"] = {
            str(key): item for key, item in cast(dict[object, object], result).items()
        }
    if error_message:
        job_data["error"] = error_message
    return job_data


def _string_value(value: object) -> str:
    return value if isinstance(value, str) else ""


def _sidecar_tracks_job(project_root: Path, job_id: str) -> bool:
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        return job_id in set(sidecar.list_tracked_jobs())
    except Exception:
        return False


def _remove_sidecar_job(project_root: Path, job_id: str) -> None:
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        sidecar.remove_tracked_job(job_id)
        sidecar.save()
    except Exception:
        pass
