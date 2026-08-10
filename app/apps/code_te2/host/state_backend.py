# pyright: strict
from __future__ import annotations

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..stores import get_history_store


def _coerce_float(value: object) -> float:
    if isinstance(value, bool):
        raise ValueError("value must be a number")
    if isinstance(value, (int, float, str)):
        return float(value)
    raise ValueError("value must be a number")


def _required_scroll_line(data: dict[str, object]) -> float:
    raw_scroll_line = data.get("scroll_line")
    if raw_scroll_line is None:
        raw_scroll_line = data.get("scrollLine")
    if raw_scroll_line is None:
        raise ValueError("scroll_line is required")
    try:
        return _coerce_float(raw_scroll_line)
    except (TypeError, ValueError) as exc:
        raise ValueError("scroll_line must be a number") from exc


def _path_value(data: dict[str, object]) -> str:
    value = data.get("path")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("path is required")
    return value.strip()


def _project_path(data: dict[str, object]) -> str:
    history = get_history_store()
    raw_project = data.get("project")
    project_path = raw_project if isinstance(raw_project, str) and raw_project.strip() else history.get_active_project()
    if not project_path:
        raise ValueError("no project selected")
    return project_path


async def handle_host_file_scroll_update_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name

    history = get_history_store()
    path = _path_value(data)
    scroll_line = _required_scroll_line(data)
    project_path = _project_path(data)
    updated = history.update_file_scroll_line(project_path, path, scroll_line)
    return {
        "ok": True,
        "data": {
            "updated": updated,
        },
    }
