# pyright: strict
from __future__ import annotations

import asyncio
import itertools
import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Queue
from typing import Literal, cast

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope

from ...worker_services.event_bus import current_project_generation, next_project_generation
from ..context import EmitPersonal
from ..contracts.search_review import (
    JsonObject,
    SearchContentMatch,
    SearchMoreInFileParams,
    SearchMoreParams,
    SearchProviderContentMatch,
    SearchProviderFileItem,
    SearchRunParams,
    SearchTextRange,
)
from ..search import cancel_search_job, start_content_search, start_file_search

logger = logging.getLogger(__name__)

PipeEventQueue = Queue[PipeEnvelope]
PipeNotificationListener = tuple[PipeEventQueue, set[str] | None]
SearchKind = Literal["name", "content"]
GetProjectRoot = Callable[[], Path]

_SEARCH_COUNTER = itertools.count(1)

INITIAL_MATCHES_PER_FILE = 10
INITIAL_MATCH_TOTAL = 50


def _file_items_list() -> list[SearchProviderFileItem]:
    return []


def _content_matches() -> list[SearchProviderContentMatch]:
    return []


def _content_file_map() -> dict[str, CachedContentFile]:
    return {}


def _content_order_list() -> list[str]:
    return []


@dataclass
class CachedContentFile:
    path: str
    relative_path: str
    matches: list[SearchProviderContentMatch] = field(default_factory=_content_matches)
    complete_match_count: int | None = None


@dataclass
class SearchSession:
    search_id: str
    job_id: str
    kind: SearchKind
    root: Path
    project_generation: int | None
    correlation_id: str
    query: str
    complete: bool = False
    cancelled: bool = False
    status: str = "running"
    name_items: list[SearchProviderFileItem] = field(default_factory=_file_items_list)
    content_files: dict[str, CachedContentFile] = field(default_factory=_content_file_map)
    content_order: list[str] = field(default_factory=_content_order_list)
    initial_matches_emitted: int = 0


class ExplorerSearchSessions:
    def __init__(
        self,
        *,
        get_project_root: GetProjectRoot,
        emit_personal: EmitPersonal,
    ) -> None:
        self._get_project_root: GetProjectRoot = get_project_root
        self._emit_personal: EmitPersonal = emit_personal
        self._sessions: dict[str, SearchSession] = {}
        self._job_to_search: dict[str, str] = {}
        self._active_search_id: str | None = None
        self._queue: PipeEventQueue = Queue()
        self._listener: PipeNotificationListener | None = None
        self._pump_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._listener is not None:
            return
        self._listener = pipe_runtime.add_notification_listener(
            self._queue,
            methods={
                "search.job.progress",
                "search.job.result",
                "search.job.done",
                "search.job.error",
            },
        )
        self._pump_task = asyncio.create_task(self._pump_pipe_events())

    async def stop(self) -> None:
        await self.cancel_active(reason="disconnect")
        if self._pump_task is not None:
            _ = self._pump_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._pump_task
        self._pump_task = None
        if self._listener is not None:
            pipe_runtime.remove_notification_listener(self._listener)
        self._listener = None

    async def run(self, params: SearchRunParams, reply_to: str | None) -> None:
        await self.cancel_active(reason="superseded")
        mode = params["mode"]
        if mode == "changes":
            raise RuntimeError("changes search is not part of service.search progressive sessions")
        root = self._get_project_root()
        project_generation = _ensure_project_generation(root)
        correlation_id = params["correlationId"] or _correlation_id(reply_to)
        if mode == "name":
            started = await start_file_search(
                root,
                params["query"],
                project_generation=project_generation,
                correlation_id=correlation_id,
            )
        else:
            started = await start_content_search(
                root,
                params,
                project_generation=project_generation,
                correlation_id=correlation_id,
            )
        search_id = _required_string(started.get("searchId") or started.get("jobId"), "searchId")
        job_id = _required_string(started.get("jobId") or started.get("opId"), "jobId")
        session = SearchSession(
            search_id=search_id,
            job_id=job_id,
            kind=mode,
            root=root,
            project_generation=project_generation,
            correlation_id=correlation_id,
            query=params["query"],
        )
        self._sessions[search_id] = session
        self._job_to_search[job_id] = search_id
        self._active_search_id = search_id
        payload = _copy_object(started)
        payload["searchId"] = search_id
        payload["jobId"] = job_id
        payload["projectGeneration"] = project_generation
        payload["correlationId"] = correlation_id
        payload["root"] = str(root)
        await self._emit_personal("explorer.search.started", payload, reply_to)

    async def more(self, params: SearchMoreParams, reply_to: str | None) -> None:
        session = self._session_for_request(params["searchId"], params["projectGeneration"])
        cursor = _global_offset(params["cursor"])
        limit = params["limit"]
        window = self._content_window_payload(
            session,
            start_offset=cursor,
            max_matches_per_file=limit["maxMatchesPerFile"],
            max_matches_total=limit["maxMatchesTotal"],
        )
        await self._emit_personal(
            "explorer.search.more.result",
            {
                "dto": "ExplorerSearchMoreResult",
                "version": 1,
                "searchId": session.search_id,
                "windowKind": "global",
                "result": window,
            },
            reply_to,
        )

    async def more_in_file(
        self,
        params: SearchMoreInFileParams,
        reply_to: str | None,
    ) -> None:
        session = self._session_for_request(params["searchId"], params["projectGeneration"])
        file_result = session.content_files.get(params["relativePath"])
        if file_result is None:
            raise RuntimeError("search file result is not cached")
        offset = _file_offset(params["cursor"])
        matches = file_result.matches[offset : offset + params["maxMatches"]]
        next_offset = offset + len(matches)
        file_truncated = next_offset < len(file_result.matches)
        await self._emit_personal(
            "explorer.search.moreInFile.result",
            {
                "dto": "ExplorerSearchMoreInFileResult",
                "version": 1,
                "searchId": session.search_id,
                "root": str(session.root),
                "projectGeneration": session.project_generation,
                "file": {
                    "path": file_result.path,
                    "relativePath": file_result.relative_path,
                    "matches": [_copy_object(match) for match in matches],
                    "fileMatchCount": len(file_result.matches),
                    "matchesReturned": len(matches),
                    "fileTruncated": file_truncated,
                    "nextMatchCursor": _file_cursor(file_result.relative_path, next_offset)
                    if file_truncated
                    else None,
                },
            },
            reply_to,
        )

    async def cancel_active(self, *, reason: str) -> None:
        search_id = self._active_search_id
        if not search_id:
            return
        session = self._sessions.get(search_id)
        if session is None or session.cancelled:
            self._active_search_id = None
            return
        _ = await self._cancel_session(session, reason=reason)

    async def cancel_requested(
        self,
        *,
        search_id: str | None,
        reason: str,
        reply_to: str | None,
    ) -> None:
        target_id = search_id or self._active_search_id
        if not target_id:
            raise RuntimeError("no active search to cancel")
        session = self._sessions.get(target_id)
        if session is None:
            raise RuntimeError("search session is not cached")
        result = await self._cancel_session(session, reason=reason)
        await self._emit_personal("explorer.search.cancelled", result, reply_to)

    def cancel_for_project_switch(self) -> None:
        sessions = [session for session in self._sessions.values() if not session.cancelled]
        for session in sessions:
            session.cancelled = True
        self._active_search_id = None
        if sessions:
            _ = asyncio.create_task(self._cancel_sessions(sessions, reason="projectSwitch"))

    async def _cancel_sessions(
        self,
        sessions: list[SearchSession],
        *,
        reason: str,
    ) -> None:
        for session in sessions:
            try:
                _ = await self._cancel_session(session, reason=reason)
            except Exception:
                logger.exception("search cancel failed searchId=%s", session.search_id)

    async def _cancel_session(self, session: SearchSession, *, reason: str) -> JsonObject:
        session.cancelled = True
        session.status = "cancelled"
        if self._active_search_id == session.search_id:
            self._active_search_id = None
        result = await cancel_search_job(
            root=session.root,
            search_id=session.search_id,
            job_id=session.job_id,
            project_generation=session.project_generation,
            reason=reason,
        )
        return _copy_object(result)

    def _session_for_request(
        self,
        search_id: str,
        project_generation: int | None,
    ) -> SearchSession:
        session = self._sessions.get(search_id)
        if session is None:
            raise RuntimeError("search session is not cached")
        if session.cancelled:
            raise RuntimeError("search session is cancelled")
        if session.project_generation != project_generation:
            raise RuntimeError("search session project generation is stale")
        if session.root != self._get_project_root():
            raise RuntimeError("search session root is stale")
        if session.kind != "content":
            raise RuntimeError("search materialization requires a content search session")
        return session

    async def _pump_pipe_events(self) -> None:
        while True:
            try:
                envelope = await asyncio.to_thread(self._queue.get, timeout=0.5)
                await self._handle_pipe_event(envelope)
            except Empty:
                continue
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("search pipe event handling failed")

    async def _handle_pipe_event(self, envelope: PipeEnvelope) -> None:
        params = _object(envelope.params)
        search_id = _string(params.get("searchId"))
        job_id = _string(params.get("jobId") or params.get("opId"))
        if not search_id and job_id:
            search_id = self._job_to_search.get(job_id, "")
        session = self._sessions.get(search_id)
        if session is None or session.cancelled:
            return
        if not _matches_session(session, params):
            return

        method = str(envelope.method or "")
        if method == "search.job.progress":
            await self._emit_personal(
                "search.job.progress",
                _job_payload(session, params, dto="SearchJobProgress"),
            )
            return
        if method == "search.job.result":
            self._apply_result(session, _object(params.get("result")))
            if session.kind == "content":
                result = self._next_content_result_payload(session)
                if result is not None:
                    await self._emit_personal(
                        "search.job.result",
                        _job_payload(
                            session,
                            params,
                            dto="SearchJobResult",
                            result=result,
                        ),
                    )
            else:
                await self._emit_personal(
                    "explorer.search.results.updated",
                    self._visible_payload(session),
                )
            return
        if method == "search.job.done":
            session.complete = True
            session.status = "done"
            if session.kind == "content":
                result = self._next_content_result_payload(session, force=True)
                if result is not None:
                    await self._emit_personal(
                        "search.job.result",
                        _job_payload(
                            session,
                            params,
                            dto="SearchJobResult",
                            result=result,
                        ),
                    )
            else:
                await self._emit_personal(
                    "explorer.search.results.updated",
                    self._visible_payload(session),
                )
            await self._emit_personal(
                "search.job.done",
                _job_payload(
                    session,
                    params,
                    dto="SearchJobDone",
                    fileCount=len(session.content_order)
                    if session.kind == "content"
                    else len(session.name_items),
                    matchCount=_total_content_matches(session)
                    if session.kind == "content"
                    else len(session.name_items),
                ),
            )
            return
        if method == "search.job.error":
            session.status = "error"
            await self._emit_personal(
                "search.job.error",
                _job_payload(session, params, dto="SearchJobError"),
            )

    def _apply_result(self, session: SearchSession, result: JsonObject) -> None:
        dto = _string(result.get("dto"))
        if session.kind == "name" and dto == "SearchFilesResult":
            items = result.get("items")
            if isinstance(items, list):
                session.name_items.extend(_file_items(cast(list[object], items)))
            session.complete = bool(result.get("complete", session.complete))
            return
        if session.kind == "content" and dto == "SearchContentResult":
            files = result.get("files")
            if isinstance(files, list):
                for file_obj in cast(list[object], files):
                    file_result = _content_file(file_obj)
                    if file_result is None:
                        continue
                    cached = session.content_files.get(file_result.relative_path)
                    if cached is None:
                        session.content_files[file_result.relative_path] = file_result
                        session.content_order.append(file_result.relative_path)
                    else:
                        cached.matches.extend(file_result.matches)
                        cached.complete_match_count = file_result.complete_match_count
            session.complete = bool(result.get("complete", session.complete))

    def _visible_payload(self, session: SearchSession) -> JsonObject:
        if session.kind == "name":
            return {
                "mode": "name",
                "query": session.query,
                "searchId": session.search_id,
                "jobId": session.job_id,
                "results": [
                    {
                        "path": item["path"],
                        "rel": item["relativePath"],
                        "type": item["kind"],
                        "name": item["name"],
                    }
                    for item in session.name_items
                ],
                "truncated": False,
                "count": len(session.name_items),
                "complete": session.complete,
                "projectGeneration": session.project_generation,
            }
        return self._content_window_payload(
            session,
            start_offset=0,
            max_matches_per_file=INITIAL_MATCHES_PER_FILE,
            max_matches_total=INITIAL_MATCH_TOTAL,
        )

    def _next_content_result_payload(
        self,
        session: SearchSession,
        *,
        force: bool = False,
    ) -> JsonObject | None:
        remaining = max(0, INITIAL_MATCH_TOTAL - session.initial_matches_emitted)
        result = self._content_window_payload(
            session,
            start_offset=session.initial_matches_emitted,
            max_matches_per_file=INITIAL_MATCHES_PER_FILE,
            max_matches_total=remaining,
        )
        match_count = _optional_int(result.get("match_count")) or 0
        if match_count > 0:
            session.initial_matches_emitted += match_count
            return result
        if force:
            return result
        return None

    def _content_window_payload(
        self,
        session: SearchSession,
        *,
        start_offset: int,
        max_matches_per_file: int,
        max_matches_total: int,
    ) -> JsonObject:
        grouped = _content_window(
            session,
            start_offset=start_offset,
            max_matches_per_file=max_matches_per_file,
            max_matches_total=max_matches_total,
        )
        total_matches = _total_content_matches(session)
        total_window_matches = _total_window_matches(
            session,
            max_matches_per_file=max_matches_per_file,
        )
        next_offset = start_offset + grouped.match_count
        global_truncated = next_offset < total_window_matches
        file_truncated = _has_file_truncation(session, max_matches_per_file)
        truncated = global_truncated or file_truncated
        return {
            "mode": "content",
            "query": session.query,
            "searchId": session.search_id,
            "jobId": session.job_id,
            "results": grouped.results,
            "truncated": truncated,
            "truncatedReason": _truncated_reason(global_truncated, file_truncated),
            "file_count": len(grouped.results),
            "match_count": grouped.match_count,
            "totalFileCount": len(session.content_order),
            "totalMatchCount": total_matches,
            "complete": session.complete,
            "nextGlobalCursor": _global_cursor(next_offset) if global_truncated else None,
            "projectGeneration": session.project_generation,
        }

@dataclass(frozen=True)
class ContentWindow:
    results: list[JsonObject]
    match_count: int


def _content_window(
    session: SearchSession,
    *,
    start_offset: int,
    max_matches_per_file: int,
    max_matches_total: int,
) -> ContentWindow:
    results: list[JsonObject] = []
    emitted_matches = 0
    skipped_visible = 0
    for rel in session.content_order:
        if emitted_matches >= max_matches_total:
            break
        cached = session.content_files[rel]
        visible_candidates = cached.matches[:max_matches_per_file]
        if skipped_visible + len(visible_candidates) <= start_offset:
            skipped_visible += len(visible_candidates)
            continue
        local_start = max(0, start_offset - skipped_visible)
        file_matches: list[SearchContentMatch] = []
        for match in visible_candidates[local_start:]:
            if emitted_matches >= max_matches_total:
                break
            file_matches.append(_project_match(match))
            emitted_matches += 1
        if file_matches:
            file_offset = local_start
            next_file_offset = file_offset + len(file_matches)
            file_truncated = next_file_offset < len(cached.matches)
            results.append(
                {
                    "path": cached.path,
                    "rel": cached.relative_path,
                    "matches": [dict(match) for match in file_matches],
                    "fileMatchCount": len(cached.matches),
                    "matchesReturned": len(file_matches),
                    "fileTruncated": file_truncated,
                    "nextMatchCursor": _file_cursor(cached.relative_path, next_file_offset)
                    if file_truncated
                    else None,
                }
            )
        skipped_visible += len(visible_candidates)
    return ContentWindow(results=results, match_count=emitted_matches)


def _project_match(match: SearchProviderContentMatch) -> SearchContentMatch:
    return {
        "line": match["lineNumber"],
        "column": max(0, match["columnNumber"] - 1),
        "text": match["lineText"],
        "snippet": match["snippet"],
        "matchText": match["matchText"],
        "lineRanges": _copy_text_ranges(match["lineRanges"]),
        "snippetRanges": _copy_text_ranges(match["snippetRanges"]),
    }


def _total_content_matches(session: SearchSession) -> int:
    return sum(len(session.content_files[rel].matches) for rel in session.content_order)


def _total_window_matches(session: SearchSession, *, max_matches_per_file: int) -> int:
    return sum(
        min(len(session.content_files[rel].matches), max_matches_per_file)
        for rel in session.content_order
    )


def _has_file_truncation(session: SearchSession, max_matches_per_file: int) -> bool:
    return any(
        len(session.content_files[rel].matches) > max_matches_per_file
        for rel in session.content_order
    )


def _truncated_reason(global_truncated: bool, file_truncated: bool) -> str | None:
    if global_truncated and file_truncated:
        return "presentationWindow"
    if global_truncated:
        return "maxMatchesTotal"
    if file_truncated:
        return "maxMatchesPerFile"
    return None


def _ensure_project_generation(root: Path) -> int:
    generation = current_project_generation(root)
    if generation is not None:
        return generation
    return next_project_generation(root)


def _job_payload(session: SearchSession, params: JsonObject, *, dto: str, **extra: object) -> JsonObject:
    payload = _copy_object(params)
    payload["dto"] = dto
    payload["version"] = 1
    payload["searchId"] = session.search_id
    payload["jobId"] = session.job_id
    payload["root"] = str(session.root)
    payload["kind"] = session.kind
    payload["projectGeneration"] = session.project_generation
    payload["correlationId"] = session.correlation_id
    payload.update(extra)
    return payload


def _matches_session(session: SearchSession, params: JsonObject) -> bool:
    root = _string(params.get("root"))
    if root and Path(root).expanduser().resolve() != session.root:
        return False
    generation = _optional_int(params.get("projectGeneration"))
    return generation is None or generation == session.project_generation


def _content_file(value: object) -> CachedContentFile | None:
    raw = _object(value)
    path = _string(raw.get("path"))
    relative_path = _string(raw.get("relativePath"))
    if not path or not relative_path:
        return None
    matches_raw = raw.get("matches")
    matches: list[SearchProviderContentMatch] = []
    if isinstance(matches_raw, list):
        for match_obj in cast(list[object], matches_raw):
            match = _content_match(match_obj)
            if match is not None:
                matches.append(match)
    return CachedContentFile(
        path=path,
        relative_path=relative_path,
        matches=matches,
        complete_match_count=_optional_int(raw.get("fileMatchCount")),
    )


def _content_match(value: object) -> SearchProviderContentMatch | None:
    raw = _object(value)
    line_number = _optional_int(raw.get("lineNumber"))
    column_number = _optional_int(raw.get("columnNumber"))
    if line_number is None or column_number is None:
        return None
    return {
        "lineNumber": line_number,
        "columnNumber": column_number,
        "lineText": _string(raw.get("lineText")),
        "snippet": _string(raw.get("snippet")),
        "matchText": _string(raw.get("matchText")),
        "lineRanges": _text_ranges(raw.get("lineRanges")),
        "snippetRanges": _text_ranges(raw.get("snippetRanges")),
    }


def _text_ranges(value: object) -> list[SearchTextRange]:
    if not isinstance(value, list):
        return []
    ranges: list[SearchTextRange] = []
    for item in cast(list[object], value):
        raw = _object(item)
        start = _optional_int(raw.get("start"))
        end = _optional_int(raw.get("end"))
        if start is None or end is None or start < 0 or end <= start:
            continue
        ranges.append({"start": start, "end": end})
    return ranges


def _copy_text_ranges(ranges: list[SearchTextRange]) -> list[SearchTextRange]:
    copied: list[SearchTextRange] = []
    for range_ in ranges:
        copied.append({"start": range_["start"], "end": range_["end"]})
    return copied


def _file_items(values: list[object]) -> list[SearchProviderFileItem]:
    items: list[SearchProviderFileItem] = []
    for item_obj in values:
        raw = _object(item_obj)
        kind = _string(raw.get("kind"))
        if kind not in ("file", "dir"):
            continue
        items.append(
            {
                "path": _string(raw.get("path")),
                "relativePath": _string(raw.get("relativePath")),
                "kind": kind,
                "name": _string(raw.get("name")),
            }
        )
    return items


def _object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _copy_object(value: object) -> JsonObject:
    return dict(_object(value))


def _string(value: object) -> str:
    return value if isinstance(value, str) else ""


def _required_string(value: object, field_name: str) -> str:
    result = _string(value)
    if not result:
        raise RuntimeError(f"search provider did not return {field_name}")
    return result


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _correlation_id(reply_to: str | None) -> str:
    if reply_to:
        return reply_to
    return f"explorer-search-{next(_SEARCH_COUNTER)}"


def _global_cursor(offset: int) -> str:
    return f"global:{offset}"


def _global_offset(cursor: str) -> int:
    if not cursor.startswith("global:"):
        raise RuntimeError("invalid global search cursor")
    return _parse_non_negative_int(cursor.removeprefix("global:"))


def _file_cursor(relative_path: str, offset: int) -> str:
    return f"file:{relative_path}:{offset}"


def _file_offset(cursor: str) -> int:
    if not cursor.startswith("file:"):
        raise RuntimeError("invalid file search cursor")
    _, _, raw_offset = cursor.rpartition(":")
    return _parse_non_negative_int(raw_offset)


def _parse_non_negative_int(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError("invalid search cursor") from exc
    if value < 0:
        raise RuntimeError("invalid search cursor")
    return value
