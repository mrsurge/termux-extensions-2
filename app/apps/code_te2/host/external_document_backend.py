"""Canonical, exact-client external document routing; no project model mutation."""
from __future__ import annotations

from pathlib import Path


async def open_external_document(
    *, path: str, project: str, client_id: str, request_id: str,
    source_context: dict[str, object] | None = None,
    requester_app_id: str | None = None,
) -> None:
    from .sidebar_app_backend import open_sidebar_app

    target = Path(path).expanduser().resolve(strict=True)
    if not target.is_file():
        raise ValueError("external document must be an existing file")
    await open_sidebar_app(
        app_id="file_editor", params={"file": str(target)},
        client_id=client_id, operation_id=request_id,
        expected_project_root=Path(project).resolve(),
        source_context=source_context, requester_app_id=requester_app_id,
    )
