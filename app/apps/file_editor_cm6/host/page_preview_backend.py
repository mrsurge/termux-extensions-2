# pyright: strict
from __future__ import annotations

from pathlib import Path

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..runner_profiles import (
    install_default_page_preview_profile,
)
from ..stores import get_history_store


async def handle_host_page_preview_template_install_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    project_root = _active_project()
    if not project_root:
        return {"ok": False, "error": "No active project selected"}
    try:
        result = install_default_page_preview_profile(
            project_root,
            current_file=_request_path(data),
        )
    except Exception as exc:
        return {"ok": False, "error": f"Failed to install Page Preview profile: {exc}"}
    return {"ok": True, "data": result}


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    root = Path(value).expanduser().resolve(strict=False)
    return str(root)


def _request_path(data: dict[str, object]) -> str | None:
    value = data.get("path")
    return value if isinstance(value, str) and value.strip() else None
