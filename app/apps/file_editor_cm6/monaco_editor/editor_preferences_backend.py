# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

from .. import diff_helper as _diff_helper
from ..explorer.services import file_ops as _file_ops
from ..stores import get_history_store, get_preferences_store
from . import editor_backend as _editor_backend_runtime
from .editor_backend_services.contracts import JsonMap
from .editor_backend_services.protocols import EditorLike
from .editor_backend_services.preferences_routes_service import (
    BroadcastCacheStateFn,
    handle_update_preference,
)
from .editor_ws import editor_runtime_emit_room_event

NormalizeRelPathFn = Callable[[Path, str], str]
ResolveFontScaleFn = Callable[[object | None], float]
CurrentDiffBaseFn = Callable[[str | None], str]
CollectDiffFn = Callable[[Path, str, str], dict[str, object]]

_history_store = get_history_store()
_preferences_store = get_preferences_store()
_normalize_rel_path = cast(NormalizeRelPathFn, getattr(_file_ops, "_normalize_rel_path"))
_broadcast_cache_state = cast(
    BroadcastCacheStateFn,
    getattr(_editor_backend_runtime, "_broadcast_cache_state"),
)
_current_diff_base = cast(
    CurrentDiffBaseFn,
    getattr(_editor_backend_runtime, "_current_diff_base"),
)
_get_view_state_dict = cast(
    Callable[[], JsonMap],
    getattr(_editor_backend_runtime, "_get_view_state_dict"),
)
_refresh_active_diffs = cast(
    Callable[[], None],
    getattr(_editor_backend_runtime, "_refresh_active_diffs"),
)
_resolve_font_scale = cast(
    ResolveFontScaleFn,
    getattr(_editor_backend_runtime, "_resolve_font_scale"),
)
_get_active_editors = cast(
    Callable[[], list[EditorLike]],
    getattr(_editor_backend_runtime, "get_active_editors"),
)
_get_current_file = cast(
    Callable[[], str | None],
    getattr(_editor_backend_runtime, "get_current_file"),
)
THEME_MAP = cast(dict[str, str], getattr(_editor_backend_runtime, "THEME_MAP"))
_collect_diff_impl = cast(CollectDiffFn, getattr(_diff_helper, "collect_diff"))


async def handle_editor_preference_update_request(
    data: Mapping[str, object],
    *,
    source_client: str | None = None,
) -> JsonMap:
    payload: JsonMap = dict(data)
    if source_client and "nicegui_client_id" not in payload:
        payload["nicegui_client_id"] = source_client

    def _collect_diff(project_root: Path, rel_path: str, base_ref: str) -> dict[str, object]:
        return _collect_diff_impl(project_root, rel_path, base_ref)

    def _emit_preferences_changed(
        project_path: str,
        key: str,
        value: object,
        view_state: JsonMap,
        preferences: dict[str, object],
        request_source_client: str | None,
    ) -> None:
        room_payload: JsonMap = {
            "project_path": project_path,
            "key": key,
            "value": value,
            "view_state": view_state,
            "preferences": preferences,
            "source_client": request_source_client or source_client,
        }
        asyncio.create_task(
            editor_runtime_emit_room_event(
                "editor:prefs_changed",
                room_payload,
            )
        )
        try:
            from ..ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification
            from ..ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED

            asyncio.create_task(
                emit_ui_ipc_rpc_notification(
                    UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED,
                    room_payload,
                )
            )
        except Exception:
            pass

    return await handle_update_preference(
        payload,
        editors=_get_active_editors(),
        preferences_store=_preferences_store,
        history_store=_history_store,
        get_project_root=_file_ops.get_project_root,
        get_current_file=_get_current_file,
        resolve_font_scale=_resolve_font_scale,
        normalize_rel_path=_normalize_rel_path,
        collect_diff=_collect_diff,
        current_diff_base=_current_diff_base,
        broadcast_cache_state=_broadcast_cache_state,
        refresh_active_diffs=_refresh_active_diffs,
        build_view_state_dict=_get_view_state_dict,
        theme_map=THEME_MAP,
        emit_preferences_changed=_emit_preferences_changed,
    )
