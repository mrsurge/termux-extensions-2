# pyright: strict
from __future__ import annotations

from typing import cast

from .. import search as search_service
from ..contracts.search_review import (
    SearchChangesResult,
    SearchContentResult,
    SearchNameResult,
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
    query = params["query"]

    result: SearchRunResult
    if mode == "name":
        result = cast(
            SearchNameResult,
            await search_service.search_by_name(context.project_root, query),
        )
    elif mode == "content":
        result = cast(
            SearchContentResult,
            await search_service.search_by_content(context.project_root, params),
        )
    else:
        result = cast(
            SearchChangesResult,
            search_service.search_by_changes(context.project_root),
        )

    await context.emit_personal("explorer.search.results.updated", dict(result), msg_id)
