# pyright: strict
from __future__ import annotations

from copy import deepcopy
from typing import Literal, TypedDict

CodeInspectorStatus = Literal["loading", "ready", "empty", "unsupported", "error"]
CodeInspectorMode = Literal["references", "implementations", "callHierarchy"]
JsonObject = dict[str, object]


class CodeInspectorProjection(TypedDict):
    revision: int
    requestId: str
    requestSequence: int
    status: CodeInspectorStatus
    mode: CodeInspectorMode
    target: JsonObject
    summary: JsonObject
    tree: list[object]
    error: object | None


_current_projection: CodeInspectorProjection | None = None


def copy_code_inspector_projection(
    projection: CodeInspectorProjection,
) -> CodeInspectorProjection:
    return deepcopy(projection)


def get_code_inspector_projection() -> CodeInspectorProjection | None:
    projection = _current_projection
    return (
        copy_code_inspector_projection(projection)
        if projection is not None
        else None
    )


def peek_code_inspector_projection() -> CodeInspectorProjection | None:
    return _current_projection


def replace_code_inspector_projection(
    projection: CodeInspectorProjection,
) -> CodeInspectorProjection | None:
    global _current_projection
    previous = _current_projection
    _current_projection = projection
    return previous


def clear_code_inspector_projection_state() -> CodeInspectorProjection | None:
    global _current_projection
    previous = _current_projection
    _current_projection = None
    return previous
