# pyright: strict
from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
from typing import Awaitable, Callable

from ...project_sidecar import ProjectSidecar
from ..context import EmitPersonal

logger = logging.getLogger(__name__)

GetProjectRoot = Callable[[], Path]
RefreshExplorerState = Callable[[], Awaitable[None]]


@dataclass
class ExplorerJobTrackingRuntime:
    queue: Queue[dict[str, object]]
    listener: object
    pump_task: asyncio.Task[None]


async def start_job_tracking(
    *,
    get_project_root: GetProjectRoot,
    tracked_job_ids: set[str],
    emit_personal: EmitPersonal,
    refresh_explorer_state: RefreshExplorerState,
) -> ExplorerJobTrackingRuntime | None:
    try:
        from app.libs.jobs import manager as job_manager

        try:
            sidecar = ProjectSidecar.load_or_create(str(get_project_root()))
            tracked_job_ids.update(sidecar.list_tracked_jobs())
        except Exception:
            pass

        job_queue: Queue[dict[str, object]] = Queue()
        listener = job_manager.add_listener(job_queue, job_ids=None)
        pump_task = asyncio.create_task(
            _pump_job_events(
                get_project_root=get_project_root,
                queue=job_queue,
                tracked_job_ids=tracked_job_ids,
                emit_personal=emit_personal,
                refresh_explorer_state=refresh_explorer_state,
            )
        )
        return ExplorerJobTrackingRuntime(
            queue=job_queue,
            listener=listener,
            pump_task=pump_task,
        )
    except Exception as exc:
        logger.warning("Failed to register job listener: %s", exc)
        return None


async def stop_job_tracking(runtime: ExplorerJobTrackingRuntime | None) -> None:
    if runtime is None:
        return

    runtime.pump_task.cancel()
    with suppress(asyncio.CancelledError):
        await runtime.pump_task

    try:
        from app.libs.jobs import manager as job_manager

        job_manager.remove_listener(runtime.listener)
    except Exception:
        pass


async def _pump_job_events(
    *,
    get_project_root: GetProjectRoot,
    queue: Queue[dict[str, object]],
    tracked_job_ids: set[str],
    emit_personal: EmitPersonal,
    refresh_explorer_state: RefreshExplorerState,
) -> None:
    logger.debug("[JOB_PUMP] Started job pump task")
    while True:
        try:
            payload = await asyncio.to_thread(queue.get, timeout=0.5)
            if not isinstance(payload, dict):
                continue

            jobs_value = payload.get("jobs")
            if not isinstance(jobs_value, list):
                continue

            for job_data in jobs_value:
                if not isinstance(job_data, dict):
                    continue
                job_id = job_data.get("id")
                job_type = job_data.get("type")
                job_status = job_data.get("status")

                if not isinstance(job_id, str) or not job_id:
                    continue

                if job_id in tracked_job_ids:
                    await emit_personal(
                        "explorer.job.progress",
                        dict(job_data),
                        None,
                    )

                    if job_status in ("succeeded", "failed", "cancelled"):
                        tracked_job_ids.discard(job_id)
                        try:
                            sidecar = ProjectSidecar.load_or_create(str(get_project_root()))
                            sidecar.remove_tracked_job(job_id)
                            sidecar.save()
                        except Exception:
                            pass

                        if job_type == "git_clone" and job_status == "succeeded":
                            logger.info("[JOB_PUMP] Clone succeeded, refreshing explorer")
                            await refresh_explorer_state()
                else:
                    try:
                        sidecar = ProjectSidecar.load_or_create(str(get_project_root()))
                        tracked = set(sidecar.list_tracked_jobs())
                    except Exception:
                        tracked = set()

                    if job_id in tracked:
                        tracked_job_ids.add(job_id)
                        await emit_personal("explorer.job.progress", dict(job_data), None)
                    else:
                        logger.debug(
                            "[JOB_PUMP] Ignoring untracked job %s (%s)",
                            job_id,
                            job_type,
                        )
        except Empty:
            continue
        except asyncio.CancelledError:
            logger.debug("[JOB_PUMP] Task cancelled")
            break
        except Exception as exc:
            logger.warning("[JOB_PUMP] Error: %s", exc)
            await asyncio.sleep(0.5)
