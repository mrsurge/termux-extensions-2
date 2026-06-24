# pyright: strict
from __future__ import annotations

from pathlib import Path

from ...project_sidecar import ProjectSidecar


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


def forget_tracked_job(
    project_root: Path,
    tracked_job_ids: set[str],
    job_id: str,
) -> None:
    tracked_job_ids.discard(job_id)
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        sidecar.remove_tracked_job(job_id)
        sidecar.save()
    except Exception:
        pass
