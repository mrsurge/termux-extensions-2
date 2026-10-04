"""Explorer-owned app intent, using the authenticated connection context."""
from __future__ import annotations

import uuid

from ..context import ExplorerFileTreeHandlerContext


async def handle_open_in_file_explorer(
    context: ExplorerFileTreeHandlerContext, params: dict[str, object], msg_id: str | None,
) -> None:
    from ...host.sidebar_app_backend import open_sidebar_app
    raw_rel = params.get("rel")
    if not isinstance(raw_rel, str):
        raise ValueError("directory relative path is required")
    project = context.project_root.expanduser().resolve(strict=True)
    target = (project / raw_rel).resolve(strict=True)
    try:
        _ = target.relative_to(project)
    except ValueError as exc:
        raise ValueError("directory must be inside the active project") from exc
    if not target.is_dir():
        raise ValueError("File Explorer target must be a directory")
    result = await open_sidebar_app(
        app_id="file_explorer", params={"path": str(target)},
        client_id=context.client_instance_id, operation_id=msg_id or uuid.uuid4().hex,
        expected_project_root=project,
    )
    if msg_id:
        await context.emit_personal("explorer.directory.openedInFileExplorer", result, msg_id)


async def handle_open_in_terminal(
    context: ExplorerFileTreeHandlerContext, params: dict[str, object], msg_id: str | None,
) -> None:
    from ...host.terminal_intent_backend import open_directory_terminal
    rel, destination = params.get("rel"), params.get("destination", "ask")
    if not isinstance(rel, str) or not isinstance(destination, str):
        raise ValueError("directory and terminal destination are required")
    project = context.project_root.expanduser().resolve(strict=True)
    target = (project / rel).resolve(strict=True)
    _ = target.relative_to(project)
    result = await open_directory_terminal(
        directory=str(target), destination=destination, client_id=context.client_instance_id,
        operation_id=msg_id or uuid.uuid4().hex, expected_project_root=project,
    )
    if msg_id:
        await context.emit_personal("explorer.directory.openedInTerminal", result, msg_id)
