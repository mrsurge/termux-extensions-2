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
from ..services.render_state import (
    build_directory_listing,
    build_open_directory_listings,
    load_pruned_open_directories,
)
from ..services.state_facts import (
    publish_explorer_open_directories_changed,
)
from ...worker_services.event_bus import build_event, current_project_generation, publish
from ...project_sidecar import ProjectSidecar

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
MarkGitCacheDirtyFn = Callable[[Path], None]

mark_git_cache_dirty = cast(MarkGitCacheDirtyFn, _file_ops.mark_git_cache_dirty)


async def handle_explorer_list(
    context: ExplorerSessionHandlerContext,
    params: ExplorerListParams,
    msg_id: str | None,
) -> None:
    data = await build_directory_listing(params["rel"])
    await context.emit_personal("explorer.list.updated", data, msg_id)


async def handle_explorer_refresh(
    context: ExplorerSessionHandlerContext,
    params: ExplorerSessionNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id

    generation = current_project_generation(context.project_root)
    mark_git_cache_dirty(context.project_root)
    open_directories = await asyncio.to_thread(
        load_pruned_open_directories,
        context.project_root,
    )
    if current_project_generation(context.project_root) != generation:
        return
    # Reset the shared expanded-directory projection as well as its listings.
    # Capture the generation before I/O so a late refresh cannot retarget itself.
    await publish(build_event(
        "ExplorerRenderStateChanged",
        project_root=context.project_root,
        project_generation=generation,
        source="explorer_session:refresh",
        payload={
            "reason": "refresh",
            "directories": [".", *sorted(set(open_directories), key=lambda rel: (rel.count('/'), rel))],
            "open_directories": open_directories,
            "open_directories_changed": True,
        },
    ))
    from ..services.runtime_notifications import schedule_git_status_update

    schedule_git_status_update(
        context.project_root,
        project_generation=generation,
        source="explorer_session:refresh",
        delay=0.0,
    )
    await context.broadcast_review_state()


async def handle_set_open_dirs(
    context: ExplorerSessionHandlerContext,
    params: ExplorerOpenDirsParams,
    msg_id: str | None,
) -> None:
    try:
        sidecar = ProjectSidecar.load_or_create(str(context.project_root))
        previous = sidecar.get_open_directories()
        sidecar.set_open_directories(params["dirs"])
        sidecar.save()
        authoritative = load_pruned_open_directories(context.project_root)
    except Exception as exc:
        logger.warning("Failed to save open directories: %s", exc)
        raise RuntimeError("Failed to save Explorer open directories") from exc

    listings = await build_open_directory_listings(authoritative)
    if msg_id is not None:
        await context.emit_personal(
            "explorer.openDirs.updated",
            {"dirs": authoritative, "listings": listings},
            msg_id,
        )
    if authoritative != previous:
        await publish_explorer_open_directories_changed(
            context.project_root,
            authoritative,
            reason="open_directories_set",
            source="explorer_session:set_open_directories",
        )
