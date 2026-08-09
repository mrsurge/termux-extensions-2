# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import TypedDict

JsonMap = dict[str, object]
ReadonlyJsonMap = Mapping[str, object]


class RuntimeMeta(TypedDict):
    run_id: str
    shell_id: str
    shell_run_id: str
    launcher_pid: int
    worker_pid: int


class EditorOpenFields(TypedDict):
    project: str
    path: str
    request_id: str
    line: int | None
    column: int | None
    scroll_y: str | None
    focus: bool | None
    scroll_to_top: bool | None


class EditorOpenPayload(TypedDict, total=False):
    path: str
    source_client: str
    request_id: str
    line: int
    column: int
    scroll_y: str
    focus: bool
    scroll_to_top: bool
    source: str
    content: str
    base_sha256: str
    content_sha256: str
    state: str
    unsaved: bool
    auto_save: bool | None
    has_draft: bool
    reason: str
    scroll_line: float
    preferences: object


class SnapshotResponse(TypedDict, total=False):
    requestId: str
    request_id: str
    error: str
    path: str
    content: str
    base_sha256: str


EmitToRoomFn = Callable[[str, JsonMap], Awaitable[None]]
EmitToSidFn = Callable[[str, JsonMap], Awaitable[None]]
