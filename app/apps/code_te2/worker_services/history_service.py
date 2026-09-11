# pyright: strict
"""Async, exact-generation History transport; Rust owns Git content and counts."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast
from uuid import uuid4

from app.libs import pipe_runtime


def _map(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Invalid History object")
    return cast(dict[str, object], value)


def _str(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Invalid History string")
    return value


def _int(value: object) -> int:
    if type(value) is not int:
        raise ValueError("Invalid History integer")
    return value


def _list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("Invalid History list")
    return cast(list[object], value)


def _contract(value: object, dto: str) -> dict[str, object]:
    data = _map(value)
    if data.get("dto") != dto or _int(data.get("version")) != 1:
        raise ValueError("Invalid History DTO/version")
    return data


def _oid(value: object, size: int = 40) -> str:
    text = _str(value)
    if len(text) != size or any(c not in "0123456789abcdef" for c in text):
        raise ValueError("Invalid History hash")
    return text


@dataclass(frozen=True)
class HistoryRef:
    name: str
    commit_id: str


@dataclass(frozen=True)
class HistorySnapshot:
    identity: str
    head_id: str | None
    head_ref: str | None
    refs: tuple[HistoryRef, ...]


@dataclass(frozen=True)
class HistoryCommit:
    identity: str
    parents: tuple[str, ...]
    subject: str
    author: str
    timestamp: int


@dataclass(frozen=True)
class HistoryPage:
    offset: int
    commits: tuple[HistoryCommit, ...]
    complete: bool


@dataclass(frozen=True)
class HistoryCounts:
    state: str
    additions: int | None
    deletions: int | None


@dataclass(frozen=True)
class HistoryFile:
    index: int
    status: str
    old_path: str | None
    new_path: str | None
    old_blob: str | None
    new_blob: str | None
    counts: HistoryCounts


@dataclass(frozen=True)
class HistoryFilesPage:
    commit_id: str
    parent_id: str | None
    offset: int
    files: tuple[HistoryFile, ...]
    next_offset: int | None
    total_files: int


@dataclass(frozen=True)
class HistoryBlobSide:
    state: str
    path: str | None
    identity: str | None
    text: str | None


@dataclass(frozen=True)
class HistoryBlobPair:
    commit_id: str
    parent_id: str | None
    index: int
    original: HistoryBlobSide
    modified: HistoryBlobSide


def _optional_str(value: object) -> str | None:
    return None if value is None else _str(value)


def _optional_oid(value: object) -> str | None:
    return None if value is None else _oid(value)


def _nonnegative(value: object) -> int:
    number = _int(value)
    if number < 0:
        raise ValueError("Negative History integer")
    return number


def _counts(value: object) -> HistoryCounts:
    data = _map(value)
    state = _str(data.get("state"))
    if state == "ready":
        return HistoryCounts(state, _nonnegative(data.get("additions")), _nonnegative(data.get("deletions")))
    if state not in {"binary", "tooLarge", "unavailable"}:
        raise ValueError("Invalid History count state")
    return HistoryCounts(state, None, None)


def _side(value: object) -> HistoryBlobSide:
    data = _map(value)
    state = _str(data.get("state"))
    if state == "absent":
        return HistoryBlobSide(state, None, None, None)
    if state not in {"text", "binary", "tooLarge", "invalidUtf8", "unsupported"}:
        raise ValueError("Invalid History blob state")
    text = _str(data.get("text")) if state == "text" else None
    if text is not None and len(text.encode("utf-8")) > 375 * 1024:
        raise ValueError("History blob exceeds size bound")
    return HistoryBlobSide(state, _str(data.get("path")), _oid(data.get("id")), text)


class HistorySession:
    def __init__(self, root: Path, generation: int) -> None:
        if not root.is_absolute():
            raise ValueError("History requires an absolute project path")
        self.root: str = str(root)
        self.generation: int = generation
        self.session_id: str = uuid4().hex
        self.snapshot: HistorySnapshot | None = None
        self.offset: int = 0
        self.closed: bool = False
        self._lock: asyncio.Lock = asyncio.Lock()

    async def _call(self, action: str, fields: dict[str, object] | None = None) -> object:
        params: dict[str, object] = {"version": 1, "sessionId": self.session_id}
        if fields:
            params.update(fields)
        return await pipe_runtime.call_async(
            f"git.historyGraph.{action}", params,
            target_nid=2200, target_name="service.git", workspace_root=self.root,
            project_generation=self.generation, origin_name="code_te2.history",
            timeout_seconds=30,
        )

    def _reply(self, raw: object, dto: str) -> dict[str, object]:
        data = _contract(raw, dto)
        if data.get("sessionId") != self.session_id:
            raise ValueError("History session mismatch")
        return data

    async def open(self) -> HistorySnapshot:
        if self.closed or self.snapshot is not None:
            raise ValueError("History session cannot be reopened")
        raw = self._reply(await self._call("open"), "GitHistoryOpened")
        data = _contract(raw.get("snapshot"), "GitHistorySnapshot")
        refs: list[HistoryRef] = []
        for item in _list(data.get("refs")):
            ref = _map(item)
            refs.append(HistoryRef(_str(ref.get("name")), _oid(ref.get("commitId"))))
        head = data.get("headId")
        head_ref = data.get("headRef")
        self.snapshot = HistorySnapshot(
            _oid(data.get("snapshotId"), 64), None if head is None else _oid(head),
            None if head_ref is None else _str(head_ref), tuple(refs),
        )
        return self.snapshot

    async def next_page(self, limit: int = 100) -> HistoryPage:
        if type(limit) is not int or not 1 <= limit <= 500:
            raise ValueError("Invalid History page size")
        async with self._lock:
            if self.closed or self.snapshot is None:
                raise ValueError("History session is not open")
            raw = self._reply(await self._call("next", {"offset": self.offset, "limit": limit}), "GitHistoryPageResult")
            data = _contract(raw.get("page"), "GitHistoryPage")
            if data.get("snapshotId") != self.snapshot.identity or _int(data.get("offset")) != self.offset:
                raise ValueError("History page generation/offset mismatch")
            complete = data.get("complete")
            if type(complete) is not bool:
                raise ValueError("Invalid History completion")
            commits: list[HistoryCommit] = []
            for item in _list(data.get("commits")):
                commit = _map(item)
                commits.append(HistoryCommit(
                    _oid(commit.get("id")), tuple(_oid(p) for p in _list(commit.get("parentIds"))),
                    _str(commit.get("subject")), _str(commit.get("author")), _int(commit.get("timestamp")),
                ))
            if len(commits) > limit:
                raise ValueError("History page exceeds requested limit")
            result = HistoryPage(self.offset, tuple(commits), complete)
            self.offset += len(commits)
            return result

    async def files(self, commit_id: str, offset: int = 0, limit: int = 40) -> HistoryFilesPage:
        commit_id = _oid(commit_id)
        offset = _nonnegative(offset)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Invalid History file page size")
        async with self._lock:
            if self.closed or self.snapshot is None:
                raise ValueError("History session is not open")
            raw = self._reply(await self._call("files", {"commitId": commit_id, "offset": offset, "limit": limit}), "GitHistoryFilesResult")
            data = _contract(raw.get("page"), "GitHistoryFilesPage")
            if data.get("commitId") != commit_id or _nonnegative(data.get("offset")) != offset:
                raise ValueError("History files identity mismatch")
            files: list[HistoryFile] = []
            for item in _list(data.get("files")):
                file = _map(item)
                index = _nonnegative(file.get("index"))
                status = _str(file.get("status"))
                if index != offset + len(files) or status not in {"added", "deleted", "modified", "renamed", "copied", "typeChanged", "unsupported"}:
                    raise ValueError("Invalid History file identity/status")
                files.append(HistoryFile(index, status, _optional_str(file.get("oldPath")), _optional_str(file.get("newPath")),
                                         _optional_oid(file.get("oldBlob")), _optional_oid(file.get("newBlob")), _counts(file.get("counts"))))
            total = _nonnegative(data.get("totalFiles"))
            next_value = data.get("nextOffset")
            next_offset = None if next_value is None else _nonnegative(next_value)
            end = offset + len(files)
            if len(files) > limit or end > total or next_offset != (end if end < total else None) or (end < total and not files):
                raise ValueError("Invalid History file continuation")
            return HistoryFilesPage(commit_id, _optional_oid(data.get("parentId")), offset, tuple(files), next_offset, total)

    async def blob_pair(self, commit_id: str, file: HistoryFile) -> HistoryBlobPair:
        commit_id = _oid(commit_id)
        index = _nonnegative(file.index)
        async with self._lock:
            if self.closed or self.snapshot is None:
                raise ValueError("History session is not open")
            raw = self._reply(await self._call("blob", {"commitId": commit_id, "index": index}), "GitHistoryBlobResult")
            data = _contract(raw.get("pair"), "GitHistoryBlobPair")
            if data.get("commitId") != commit_id or _nonnegative(data.get("index")) != index:
                raise ValueError("History blob identity mismatch")
            original = _side(data.get("original"))
            modified = _side(data.get("modified"))
            # A rebuilt native file list must still match the exact row the user
            # selected; never display a different pair merely because its index fits.
            if (original.identity, modified.identity, original.path, modified.path) != (file.old_blob, file.new_blob, file.old_path, file.new_path):
                raise ValueError("History blob pair no longer matches selected file")
            return HistoryBlobPair(commit_id, _optional_oid(data.get("parentId")), index, original, modified)

    async def close(self) -> None:
        self.closed = True
        _ = self._reply(await self._call("close"), "GitHistoryClosed")


@asynccontextmanager
async def history_session(root: Path, generation: int) -> AsyncIterator[HistorySession]:
    session = HistorySession(root, generation)
    opening = asyncio.create_task(session.open())
    try:
        # Shield admission so cancellation cannot send close before open was sent.
        _ = await asyncio.shield(opening)
        yield session
    finally:
        try:
            _ = await asyncio.shield(opening)
        finally:
            await session.close()
