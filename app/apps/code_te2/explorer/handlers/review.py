# pyright: strict
from __future__ import annotations

from typing import cast

from .. import review as review_service
from ..contracts.search_review import (
    ReviewDiscardResult,
    ReviewEntriesPayload,
    ReviewEntry,
    ReviewFilesParams,
    ReviewListParams,
    ReviewSaveResult,
)
from ..context import ExplorerSearchReviewHandlerContext


async def handle_review_list(
    context: ExplorerSearchReviewHandlerContext,
    params: ReviewListParams,
    msg_id: str | None,
) -> None:
    entries = cast(
        list[ReviewEntry],
        await review_service.list_reviews(
            context.project_root,
            params["lightweight"],
        ),
    )
    payload: ReviewEntriesPayload = {"entries": entries}
    await context.emit_personal("explorer.review.entries.updated", dict(payload), msg_id)


async def handle_review_save(
    context: ExplorerSearchReviewHandlerContext,
    params: ReviewFilesParams,
    msg_id: str | None,
) -> None:
    files = params["files"]
    result = cast(
        ReviewSaveResult,
        await review_service.save_reviews(context.project_root, files),
    )
    if msg_id:
        await context.emit_personal("explorer.review.entries.updated", dict(result), msg_id)
    context.mark_git_cache_dirty(context.project_root)
    context.mark_draft_cache_dirty(context.project_root)
    await context.broadcast_git_status()
    await context.broadcast_review_state()
    await context.notify_editor_draft_cleared(files)


async def handle_review_discard(
    context: ExplorerSearchReviewHandlerContext,
    params: ReviewFilesParams,
    msg_id: str | None,
) -> None:
    files = params["files"]
    result = cast(
        ReviewDiscardResult,
        await review_service.discard_reviews(context.project_root, files),
    )
    if msg_id:
        await context.emit_personal("explorer.review.entries.updated", dict(result), msg_id)
    context.mark_draft_cache_dirty(context.project_root)
    await context.broadcast_review_state()
    await context.notify_editor_draft_cleared(files)
