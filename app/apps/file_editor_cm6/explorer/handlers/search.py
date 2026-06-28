# pyright: strict
from __future__ import annotations

from .. import search as search_service
from ..contracts.search_review import (
    SearchRunParams,
    SearchRunResult,
)
from ..context import ExplorerSearchReviewHandlerContext


async def handle_search_run(
    context: ExplorerSearchReviewHandlerContext,
    params: SearchRunParams,
    msg_id: str | None,
) -> None:
    mode = params["mode"]

    result: SearchRunResult
    if mode == "changes":
        result = search_service.search_by_changes(context.project_root)
    else:
        raise RuntimeError("name/content search must use progressive search sessions")

    await context.emit_personal("explorer.search.results.updated", dict(result), msg_id)
