# pyright: strict
from __future__ import annotations

from .. import search as search_service
from ..contracts.search_review import (
    SearchRunParams,
    SearchRunResult,
    project_search_content_result,
    project_search_files_result,
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
        result = project_search_files_result(
            await search_service.search_files(context.project_root, query)
        )
    elif mode == "content":
        content_params: search_service.SearchContentOptionsParams = {
            "query": query,
            "isRegex": params["isRegex"],
            "isCaseSensitive": params["isCaseSensitive"],
            "isWholeWords": params["isWholeWords"],
            "includePattern": params["includePattern"],
            "excludePattern": params["excludePattern"],
            "useIgnoreFiles": params["useIgnoreFiles"],
        }
        result = project_search_content_result(
            await search_service.search_content(context.project_root, content_params)
        )
    else:
        result = search_service.search_by_changes(context.project_root)

    await context.emit_personal("explorer.search.results.updated", dict(result), msg_id)
