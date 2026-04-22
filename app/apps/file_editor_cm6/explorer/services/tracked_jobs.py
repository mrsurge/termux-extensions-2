# pyright: strict
from __future__ import annotations

import importlib
from pathlib import Path
from typing import Protocol, cast

from ...project_sidecar import ProjectSidecar


class ExplorerTrackedJob(Protocol):
    id: str


class ExplorerJobManager(Protocol):
    def create_job(
        self,
        job_type: str,
        params: dict[str, object],
    ) -> ExplorerTrackedJob: ...


def get_job_manager() -> ExplorerJobManager:
    jobs_module: object = importlib.import_module("app.libs.jobs")
    manager_obj: object = getattr(jobs_module, "manager", None)
    create_job_obj: object = getattr(manager_obj, "create_job", None)
    if manager_obj is None or not callable(create_job_obj):
        raise RuntimeError("job manager unavailable")
    return cast(ExplorerJobManager, manager_obj)


def remember_tracked_job(
    project_root: Path,
    tracked_job_ids: set[str],
    job_id: str,
) -> None:
    tracked_job_ids.add(job_id)
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        sidecar.add_tracked_job(job_id)
        sidecar.save()
    except Exception:
        pass
