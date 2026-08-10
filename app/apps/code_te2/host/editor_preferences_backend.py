# pyright: strict
from __future__ import annotations

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..monaco_editor.editor_preferences_backend import (
    handle_editor_preference_update_request,
)


async def handle_host_editor_preference_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    source_client_obj = data.get("nicegui_client_id") or data.get("source_client")
    source_client = (
        source_client_obj
        if isinstance(source_client_obj, str) and source_client_obj
        else source_name
    )
    return await handle_editor_preference_update_request(
        data,
        source_client=source_client,
    )
