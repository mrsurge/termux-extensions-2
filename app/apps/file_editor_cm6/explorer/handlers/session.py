# pyright: strict
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Callable, cast

from ..contracts.session import (
    ExplorerListParams,
    ExplorerOpenDirsParams,
    ExplorerSessionNoParams,
)
from ..context import ExplorerSessionHandlerContext
from ..services import file_ops as _file_ops
from ...project_sidecar import ProjectSidecar

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
ListDirFn = Callable[[str], JsonObject]
MarkGitCacheDirtyFn = Callable[[Path], None]

list_dir = cast(ListDirFn, _file_ops.list_dir)
mark_git_cache_dirty = cast(MarkGitCacheDirtyFn, _file_ops.mark_git_cache_dirty)


async def handle_explorer_list(
    context: ExplorerSessionHandlerContext,
    params: ExplorerListParams,
    msg_id: str | None,
) -> None:
    data = await asyncio.to_thread(list_dir, params["rel"])
    await context.emit_personal("explorer.list.updated", data, msg_id)


async def handle_explorer_refresh(
    context: ExplorerSessionHandlerContext,
    params: ExplorerSessionNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id

    mark_git_cache_dirty(context.project_root)
    await context.broadcast_git_status()
    await context.broadcast_review_state()
    data = await asyncio.to_thread(list_dir, ".")
    await context.broadcast("explorer.list.updated", data)


async def handle_set_open_dirs(
    context: ExplorerSessionHandlerContext,
    params: ExplorerOpenDirsParams,
    msg_id: str | None,
) -> None:
    del msg_id
    try:
        sidecar = ProjectSidecar.load_or_create(str(context.project_root))
        sidecar.set_open_directories(params["dirs"])
        sidecar.save()
    except Exception as exc:
        logger.warning("Failed to save open directories: %s", exc)
