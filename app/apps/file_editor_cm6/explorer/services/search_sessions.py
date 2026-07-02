# pyright: strict
from __future__ import annotations

import asyncio
import itertools
import logging
from collections.abc import Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Queue
from typing import Literal, TypeAlias, cast

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope

from ...worker_services.event_bus import current_project_generation, next_project_generation
from ..context import EmitPersonal
from ..contracts.search_review import (
    JsonObject,
    SearchContentMatch,
    SearchMoreInFileParams,
    SearchMoreParams,
    SearchRunParams,
    SearchTextRange,
)
from ..search import cancel_search_job, start_content_search, start_file_search

logger = logging.getLogger(__name__)

PipeEventQueue = Queue[PipeEnvelope]
PipeNotificationListener = tuple[PipeEventQueue, set[str] | None]
SearchKind = Literal["name", "content"]
GetProjectRoot = Callable[[], Path]
SearchRange: TypeAlias = tuple[int, int]

_SEARCH_COUNTER = itertools.count(1)

INITIAL_MATCHES_PER_FILE = 10
INITIAL_MATCH_TOTAL = 50


def _file_items_list() -> list[CachedNameItem]:
    return []


def _content_matches() -> list[CachedContentMatch]:
    return []


def _content_file_map() -> dict[str, CachedContentFile]:
    return {}


def _content_order_list() -> list[str]:
    return []


@dataclass(frozen=True, slots=True)
class CachedNameItem:
    path: str
    relative_path: str
    kind: Literal["file", "dir"]
    name: str


@dataclass(frozen=True, slots=True)
class CachedContentMatch:
    line: int
    column: int
    text: str
    snippet: str
    match_text: str
    line_ranges: tuple[SearchRange, ...] = ()
    snippet_ranges: tuple[SearchRange, ...] = ()


@dataclass(slots=True)
class CachedContentFile:
    path: str
    relative_path: str
    matches: list[CachedContentMatch] = field(default_factory=_content_matches)
    complete_match_count: int | None = None


@dataclass(slots=True)
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
    name_items: list[CachedNameItem] = field(default_factory=_file_items_list)
    content_files: dict[str, CachedContentFile] = field(default_factory=_content_file_map)
    content_order: list[str] = field(default_factory=_content_order_list)
    initial_matches_emitted: int = 0
    search_limit_reached: bool = False
    search_limit_reason: str | None = None
    search_match_limit: int | None = None


@dataclass(frozen=True, slots=True)
class PipeSearchEvent:
    method: str
    search_id: str
    job_id: str
    root: str
    project_generation: int | None
    correlation_id: str
    sequence: int | None
    status: str
    message: str
    files_scanned: int | None
    files_matched: int | None
    matches_found: int | None
    cancelled: bool
    truncated: bool
    truncated_reason: str
    match_limit: int | None
    code: str
    raw_result: object


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
        await self._emit_personal(
            "explorer.search.started",
            _started_payload(session, started),
            reply_to,
        )

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
                    "matches": [_provider_match_payload(match) for match in matches],
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
        event = _pipe_search_event(envelope)
        search_id = event.search_id
        job_id = event.job_id
        if not search_id and job_id:
            search_id = self._job_to_search.get(job_id, "")
        session = self._sessions.get(search_id)
        if session is None or session.cancelled:
            return
        if not _matches_session(session, event):
            return

        if event.method == "search.job.progress":
            await self._emit_personal(
                "search.job.progress",
                _progress_payload(session, event),
            )
            return
        if event.method == "search.job.result":
            self._apply_result(session, event.raw_result)
            if session.kind == "content":
                result = self._next_content_result_payload(session)
                if result is not None:
                    await self._emit_personal(
                        "search.job.result",
                        _result_payload(session, event, result),
                    )
            else:
                await self._emit_personal(
                    "explorer.search.results.updated",
                    self._visible_payload(session),
                )
            return
        if event.method == "search.job.done":
            _apply_search_limit_event(session, event)
            session.complete = True
            session.status = "done"
            if session.kind == "content":
                result = self._next_content_result_payload(session, force=True)
                if result is not None:
                    await self._emit_personal(
                        "search.job.result",
                        _result_payload(session, event, result),
                    )
            else:
                await self._emit_personal(
                    "explorer.search.results.updated",
                    self._visible_payload(session),
                )
            await self._emit_personal(
                "search.job.done",
                _done_payload(
                    session,
                    event,
                    fileCount=len(session.content_order)
                    if session.kind == "content"
                    else len(session.name_items),
                    matchCount=_total_content_matches(session)
                    if session.kind == "content"
                    else len(session.name_items),
                ),
            )
            return
        if event.method == "search.job.error":
            session.status = "error"
            await self._emit_personal(
                "search.job.error",
                _error_payload(session, event),
            )

    def _apply_result(self, session: SearchSession, result: object) -> None:
        raw = _mapping(result)
        dto = _string(raw.get("dto"))
        if session.kind == "name" and dto == "SearchFilesResult":
            items = raw.get("items")
            if isinstance(items, list):
                session.name_items.extend(_file_items(cast(list[object], items)))
            session.complete = _bool(raw.get("complete"), default=session.complete)
            return
        if session.kind == "content" and dto == "SearchContentResult":
            _apply_search_limit_result(session, raw)
            files = raw.get("files")
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
            session.complete = _bool(raw.get("complete"), default=session.complete)

    def _visible_payload(self, session: SearchSession) -> JsonObject:
        if session.kind == "name":
            return {
                "mode": "name",
                "query": session.query,
                "searchId": session.search_id,
                "jobId": session.job_id,
                "results": [
                    {
                        "path": item.path,
                        "rel": item.relative_path,
                        "type": item.kind,
                        "name": item.name,
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
        truncated = global_truncated or file_truncated or session.search_limit_reached
        truncated_reason = _truncated_reason(global_truncated, file_truncated)
        return {
            "mode": "content",
            "query": session.query,
            "searchId": session.search_id,
            "jobId": session.job_id,
            "results": grouped.results,
            "truncated": truncated,
            "truncatedReason": truncated_reason or session.search_limit_reason,
            "file_count": len(grouped.results),
            "match_count": grouped.match_count,
            "totalFileCount": len(session.content_order),
            "totalMatchCount": total_matches,
            "complete": session.complete,
            "nextGlobalCursor": _global_cursor(next_offset) if global_truncated else None,
            "projectGeneration": session.project_generation,
            "searchLimitReached": session.search_limit_reached,
            "searchLimitReason": session.search_limit_reason,
            "searchMatchLimit": session.search_match_limit,
        }

@dataclass(frozen=True, slots=True)
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
                    "matches": file_matches,
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


def _project_match(match: CachedContentMatch) -> SearchContentMatch:
    return {
        "line": match.line,
        "column": match.column,
        "text": match.text,
        "snippet": match.snippet,
        "matchText": match.match_text,
        "lineRanges": _range_objects(match.line_ranges),
        "snippetRanges": _range_objects(match.snippet_ranges),
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


def _apply_search_limit_result(
    session: SearchSession,
    raw: Mapping[object, object],
) -> None:
    truncated_reason = _string(raw.get("truncatedReason"))
    match_limit = _optional_int(raw.get("matchLimit"))
    if raw.get("truncated") is True and truncated_reason == "matchLimit":
        session.search_limit_reached = True
        session.search_limit_reason = truncated_reason
    if match_limit is not None:
        session.search_match_limit = match_limit


def _apply_search_limit_event(session: SearchSession, event: PipeSearchEvent) -> None:
    if event.truncated and event.truncated_reason == "matchLimit":
        session.search_limit_reached = True
        session.search_limit_reason = event.truncated_reason
    if event.match_limit is not None:
        session.search_match_limit = event.match_limit


def _ensure_project_generation(root: Path) -> int:
    generation = current_project_generation(root)
    if generation is not None:
        return generation
    return next_project_generation(root)


def _pipe_search_event(envelope: PipeEnvelope) -> PipeSearchEvent:
    raw = _mapping(envelope.params)
    return PipeSearchEvent(
        method=str(envelope.method or ""),
        search_id=_string(raw.get("searchId")),
        job_id=_string(raw.get("jobId") or raw.get("opId")),
        root=_string(raw.get("root")),
        project_generation=_optional_int(raw.get("projectGeneration")),
        correlation_id=_string(raw.get("correlationId")),
        sequence=_optional_int(raw.get("sequence")),
        status=_string(raw.get("status")),
        message=_string(raw.get("message")),
        files_scanned=_optional_int(raw.get("filesScanned")),
        files_matched=_optional_int(raw.get("filesMatched")),
        matches_found=_optional_int(raw.get("matchesFound")),
        cancelled=raw.get("cancelled") is True,
        truncated=raw.get("truncated") is True,
        truncated_reason=_string(raw.get("truncatedReason")),
        match_limit=_optional_int(raw.get("matchLimit")),
        code=_string(raw.get("code")),
        raw_result=raw.get("result"),
    )


def _started_payload(session: SearchSession, started: object) -> JsonObject:
    raw = _mapping(started)
    payload = _base_job_payload(session, "SearchJobStarted")
    payload["status"] = _string(raw.get("status")) or "running"
    _put_optional_string(payload, "message", _string(raw.get("message")))
    _put_optional_int(payload, "sequence", _optional_int(raw.get("sequence")))
    return payload


def _progress_payload(session: SearchSession, event: PipeSearchEvent) -> JsonObject:
    payload = _base_job_payload(session, "SearchJobProgress")
    payload["status"] = event.status or "running"
    _put_optional_string(payload, "message", event.message)
    _put_optional_int(payload, "sequence", event.sequence)
    _put_optional_int(payload, "filesScanned", event.files_scanned)
    _put_optional_int(payload, "filesMatched", event.files_matched)
    _put_optional_int(payload, "matchesFound", event.matches_found)
    payload["truncated"] = event.truncated
    _put_optional_string(payload, "truncatedReason", event.truncated_reason)
    _put_optional_int(payload, "matchLimit", event.match_limit)
    return payload


def _result_payload(
    session: SearchSession,
    event: PipeSearchEvent,
    result: JsonObject,
) -> JsonObject:
    payload = _base_job_payload(session, "SearchJobResult")
    _put_optional_int(payload, "sequence", event.sequence)
    payload["result"] = result
    return payload


def _done_payload(
    session: SearchSession,
    event: PipeSearchEvent,
    *,
    fileCount: int,
    matchCount: int,
) -> JsonObject:
    payload = _base_job_payload(session, "SearchJobDone")
    payload["status"] = event.status or session.status
    payload["fileCount"] = fileCount
    payload["matchCount"] = matchCount
    payload["cancelled"] = event.cancelled
    _put_optional_string(payload, "message", event.message)
    _put_optional_int(payload, "sequence", event.sequence)
    _put_optional_int(payload, "filesScanned", event.files_scanned)
    _put_optional_int(payload, "filesMatched", event.files_matched)
    _put_optional_int(payload, "matchesFound", event.matches_found)
    return payload


def _error_payload(session: SearchSession, event: PipeSearchEvent) -> JsonObject:
    payload = _base_job_payload(session, "SearchJobError")
    payload["status"] = event.status or "error"
    _put_optional_string(payload, "code", event.code)
    _put_optional_string(payload, "message", event.message)
    _put_optional_int(payload, "sequence", event.sequence)
    return payload


def _base_job_payload(session: SearchSession, dto: str) -> JsonObject:
    return {
        "dto": dto,
        "version": 1,
        "searchId": session.search_id,
        "jobId": session.job_id,
        "root": str(session.root),
        "kind": session.kind,
        "projectGeneration": session.project_generation,
        "correlationId": session.correlation_id,
    }


def _put_optional_int(payload: JsonObject, key: str, value: int | None) -> None:
    if value is not None:
        payload[key] = value


def _put_optional_string(payload: JsonObject, key: str, value: str) -> None:
    if value:
        payload[key] = value


def _matches_session(session: SearchSession, event: PipeSearchEvent) -> bool:
    root = event.root
    if root and Path(root).expanduser().resolve() != session.root:
        return False
    generation = event.project_generation
    return generation is None or generation == session.project_generation


def _content_file(value: object) -> CachedContentFile | None:
    raw = _mapping(value)
    path = _string(raw.get("path"))
    relative_path = _string(raw.get("relativePath"))
    if not path or not relative_path:
        return None
    matches_raw = raw.get("matches")
    matches: list[CachedContentMatch] = []
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


def _content_match(value: object) -> CachedContentMatch | None:
    raw = _mapping(value)
    line_number = _optional_int(raw.get("lineNumber"))
    column_number = _optional_int(raw.get("columnNumber"))
    if line_number is None or column_number is None:
        return None
    return CachedContentMatch(
        line=line_number,
        column=max(0, column_number - 1),
        text=_string(raw.get("lineText")),
        snippet=_string(raw.get("snippet")),
        match_text=_string(raw.get("matchText")),
        line_ranges=_range_tuples(raw.get("lineRanges")),
        snippet_ranges=_range_tuples(raw.get("snippetRanges")),
    )


def _provider_match_payload(match: CachedContentMatch) -> JsonObject:
    return {
        "lineNumber": match.line,
        "columnNumber": match.column + 1,
        "lineText": match.text,
        "snippet": match.snippet,
        "matchText": match.match_text,
        "lineRanges": _range_objects(match.line_ranges),
        "snippetRanges": _range_objects(match.snippet_ranges),
    }


def _range_tuples(value: object) -> tuple[SearchRange, ...]:
    if not isinstance(value, list):
        return ()
    ranges: list[SearchRange] = []
    for item in cast(list[object], value):
        raw = _mapping(item)
        start = _optional_int(raw.get("start"))
        end = _optional_int(raw.get("end"))
        if start is None or end is None or start < 0 or end <= start:
            continue
        ranges.append((start, end))
    return tuple(ranges)


def _range_objects(ranges: tuple[SearchRange, ...]) -> list[SearchTextRange]:
    return [{"start": start, "end": end} for start, end in ranges]


def _file_items(values: list[object]) -> list[CachedNameItem]:
    items: list[CachedNameItem] = []
    for item_obj in values:
        raw = _mapping(item_obj)
        kind = _string(raw.get("kind"))
        if kind not in ("file", "dir"):
            continue
        items.append(
            CachedNameItem(
                path=_string(raw.get("path")),
                relative_path=_string(raw.get("relativePath")),
                kind=kind,
                name=_string(raw.get("name")),
            )
        )
    return items


def _mapping(value: object) -> Mapping[object, object]:
    if not isinstance(value, dict):
        return {}
    return cast(Mapping[object, object], value)


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


def _bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


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
