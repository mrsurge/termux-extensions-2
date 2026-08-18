# pyright: strict
from __future__ import annotations

import asyncio
from pathlib import Path

from .worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish as publish_worker_event,
)


def publish_file_saved(
    *,
    project_root: str | Path,
    path: str | Path,
    source: str,
    sha256: str = "",
    document_revision: int | None = None,
) -> None:
    """Queue a post-commit save fact without extending the save response path."""
    root = Path(project_root).expanduser().resolve(strict=False)
    absolute = Path(path).expanduser().resolve(strict=False)
    try:
        relative = absolute.relative_to(root).as_posix()
    except ValueError:
        return
    event = build_event(
        "FileSaved",
        project_root=root,
        project_generation=current_project_generation(root),
        source=source,
        payload={
            "fileSaved": {
                "path": str(absolute),
                "relativePath": relative,
                "sha256": sha256,
                "documentRevision": document_revision,
            }
        },
    )
    _ = asyncio.create_task(
        publish_worker_event(event),
        name=f"code_te2_file_saved:{relative}",
    )
