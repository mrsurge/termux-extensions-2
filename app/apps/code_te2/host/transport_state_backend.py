# pyright: strict
"""Socket-facing snapshots and telemetry, never a foreground-state authority."""
from typing import Callable, cast
from ..stores import get_history_store


def handle_editor_state_get() -> dict[str, object]:
    from ..monaco_editor import editor_backend
    build_view = cast(Callable[[], dict[str, object]], getattr(editor_backend, "_get_view_state_dict"))
    return {"view_state": build_view(), "session_state": get_history_store().get_session_state()}


def handle_session_update(data: dict[str, object]) -> dict[str, object]:
    # Keep the former telemetry contract without admitting arbitrary store keys.
    # This does not change project membership or any client's foreground.
    result: dict[str, object] = {}
    for key in ("activeProject", "currentPath", "lastSha256", "updatedAt"):
        if key in data:
            value = data[key]
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{key} must be a string or null")
            result[key] = value
    if "unsaved" in data:
        if not isinstance(data["unsaved"], bool):
            raise ValueError("unsaved must be a boolean")
        result["unsaved"] = data["unsaved"]
    return get_history_store().update_session_state(result)
