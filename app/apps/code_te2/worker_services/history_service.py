# pyright: strict
"""Async, exact-generation History transport. No statistics or working-file state."""
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
