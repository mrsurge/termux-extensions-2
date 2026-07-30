# pyright: strict
from __future__ import annotations

import asyncio
from pathlib import Path

from ..code_server_bootstrap import (
    inspect_code_server_prerequisite,
    install_code_server_installation,
)
from ..code_server_runtime_hooks import prime_code_server_runtime
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..stores import get_history_store


async def handle_host_code_server_install_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    if data.get("confirmed") is not True:
        return {"ok": False, "error": "Code Server installation was not confirmed."}

    try:
        installation = await asyncio.to_thread(install_code_server_installation)
    except Exception as exc:
        return {"ok": False, "error": f"Code Server installation failed: {exc}"}

    project_root = _active_project()
    if project_root is not None:
        try:
            await prime_code_server_runtime(project_root)
        except Exception as exc:
            return {
                "ok": False,
                "error": (
                    "Code Server was installed, but its extension host failed to start: "
                    f"{exc}"
                ),
                "data": inspect_code_server_prerequisite().payload(),
            }

    return {
        "ok": True,
        "data": {
            **inspect_code_server_prerequisite().payload(),
            "executable": str(installation.executable),
        },
    }


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    return str(Path(value).expanduser().resolve(strict=False))
