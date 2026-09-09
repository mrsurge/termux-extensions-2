# pyright: strict
from __future__ import annotations

from pathlib import Path
from ..contracts.search_review import (
    SearchHighlightClearParams,
    SearchHighlightSetParams,
)
from ..context import ExplorerSearchReviewHandlerContext
from ..services.state_facts import publish_search_highlight_changed


async def handle_search_highlight_set(
    context: ExplorerSearchReviewHandlerContext,
    params: SearchHighlightSetParams,
    msg_id: str | None,
) -> None:
    del msg_id
    if params["projectRoot"] and not _project_root_matches(
        params["projectRoot"],
        context.project_root,
    ):
        return

    await publish_search_highlight_changed(
        context.project_root,
        {
            "clientInstanceId": context.client_instance_id,
            "active": True,
            "query": params["query"],
            "isRegex": params["isRegex"],
            "isCaseSensitive": params["isCaseSensitive"],
            "isWholeWords": params["isWholeWords"],
            "reason": "set",
            "source": params["source"],
        },
        source="explorer.search.highlight.set",
    )


async def handle_search_highlight_clear(
    context: ExplorerSearchReviewHandlerContext,
    params: SearchHighlightClearParams,
    msg_id: str | None,
) -> None:
    del msg_id
    await publish_search_highlight_changed(
        context.project_root,
        {
            "clientInstanceId": context.client_instance_id,
            "active": False,
            "query": "",
            "isRegex": False,
            "isCaseSensitive": False,
            "isWholeWords": False,
            "reason": params["reason"],
            "source": params["source"],
        },
        source="explorer.search.highlight.clear",
    )


def _project_root_matches(project_root: str, active_project_root: Path) -> bool:
    try:
        return (
            Path(project_root).expanduser().resolve(strict=False)
            == active_project_root.expanduser().resolve(strict=False)
        )
    except Exception:
        return str(project_root) == str(active_project_root)
