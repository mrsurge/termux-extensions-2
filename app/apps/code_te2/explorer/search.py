import os
from pathlib import Path
from typing import cast

from app.libs import pipe_runtime

from .contracts.search_review import (
    JsonObject,
    SearchRunParams,
)


SEARCH_SERVICE_TARGET_NID = 2300
SEARCH_SERVICE_TARGET_NAME = "service.search"
SEARCH_SERVICE_ORIGIN_NAME = "code_te2.explorer.search"
SEARCH_THREADS_ENV = "SEARCH_THREADS"


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


CONTENT_SEARCH_MATCH_LIMIT = 700

async def start_file_search(
    root: Path,
    query: str,
    *,
    project_generation: int | None,
    correlation_id: str,
) -> JsonObject:
    """Start framework service.search file search; no local producer or fallback."""
    data = await _call_search_provider(
        "search.files.start",
        {
            "root": str(root),
            "projectGeneration": project_generation,
            "correlationId": correlation_id,
            "query": query,
            "maxResults": 500,
            "includeHidden": False,
            "useIgnoreFiles": True,
            "includePatterns": [],
            "excludePatterns": [],
        },
        root=root,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobStarted":
        raise RuntimeError("Pipe RPC returned unexpected search.files.start DTO")
    return result


def _parse_glob_patterns(raw: str) -> list[str]:
    patterns: list[str] = []
    for chunk in raw.replace('\n', ',').split(','):
        pattern = chunk.strip()
        if pattern:
            patterns.append(pattern)
    return patterns


async def start_content_search(
    root: Path,
    params: SearchRunParams,
    *,
    project_generation: int | None,
    correlation_id: str,
) -> JsonObject:
    """Start framework service.search content search; no local producer or fallback."""
    request: JsonObject = {
        "root": str(root),
        "projectGeneration": project_generation,
        "correlationId": correlation_id,
        "query": params["query"],
        "isRegex": params["isRegex"],
        "isCaseSensitive": params["isCaseSensitive"],
        "isWholeWords": params["isWholeWords"],
        "includePatterns": _parse_glob_patterns(params["includePattern"]),
        "excludePatterns": _parse_glob_patterns(params["excludePattern"]),
        "useIgnoreFiles": params["useIgnoreFiles"],
        "contextChars": 75,
        "maxMatchesTotal": CONTENT_SEARCH_MATCH_LIMIT,
        "presentationWindow": {
            "maxInitialMatchesPerFile": 10,
            "maxInitialMatchesTotal": 50,
        },
    }
    _put_optional_int(
        request,
        "searchThreads",
        _request_search_threads(params["searchThreads"]),
    )
    data = await _call_search_provider(
        "search.content.start",
        request,
        root=root,
        project_generation=project_generation,
        correlation_id=correlation_id,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobStarted":
        raise RuntimeError("Pipe RPC returned unexpected search.content.start DTO")
    return result


def _request_search_threads(explicit: int | None) -> int | None:
    if explicit is not None and explicit > 0:
        return explicit
    raw = os.environ.get(SEARCH_THREADS_ENV)
    if not raw:
        return None
    try:
        value = int(raw.strip())
    except ValueError:
        return None
    return value if value > 0 else None


def _put_optional_int(payload: JsonObject, key: str, value: int | None) -> None:
    if value is not None:
        payload[key] = value


async def start_changes_search(
    root: Path,
    *,
    project_generation: int | None,
    correlation_id: str,
    base: str,
    head_view: bool,
    offset: int,
    snapshot_token: str | None,
) -> JsonObject:
    data = await _call_search_provider(
        "search.changes.start",
        {
            "dto": "SearchChangesRequest", "version": 1, "root": str(root),
            "projectGeneration": project_generation, "correlationId": correlation_id,
            "base": base, "headView": head_view, "offset": offset,
            "snapshotToken": snapshot_token,
        },
        root=root,
        project_generation=project_generation,
        correlation_id=correlation_id,
    )
    return _json_object(data)


async def cancel_search_job(
    *,
    root: Path,
    search_id: str,
    job_id: str,
    project_generation: int | None,
    reason: str,
) -> JsonObject:
    data = await _call_search_provider(
        "search.job.cancel",
        {
            "dto": "SearchJobCancelRequest",
            "version": 1,
            "root": str(root),
            "projectGeneration": project_generation,
            "searchId": search_id,
            "jobId": job_id,
            "reason": reason,
        },
        root=root,
        project_generation=project_generation,
        correlation_id=search_id,
        op_id=job_id,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobCancelResult":
        raise RuntimeError("Pipe RPC returned unexpected search.job.cancel DTO")
    return result


async def _call_search_provider(
    method: str,
    params: JsonObject,
    *,
    root: Path,
    project_generation: int | None = None,
    correlation_id: str | None = None,
    op_id: str | None = None,
) -> object:
    return await pipe_runtime.call_async(
        method,
        params,
        target_nid=SEARCH_SERVICE_TARGET_NID,
        target_name=SEARCH_SERVICE_TARGET_NAME,
        workspace_root=str(root),
        project_generation=project_generation,
        origin_name=SEARCH_SERVICE_ORIGIN_NAME,
        correlation_id=correlation_id,
        op_id=op_id,
    )
