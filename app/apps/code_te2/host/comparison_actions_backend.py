"""Host-owned comparison commands; baseline reads remain runtime-independent."""
from __future__ import annotations

import asyncio
from pathlib import Path

from ..comparison_backend import comparison_state
from ..stores import get_history_store
from ..worker_services import git_service


async def handle_comparison_request(data: dict[str, object], source_client: str) -> dict[str, object]:
    from ..explorer.services.state_facts import publish_git_diff_base_changed
    from ..monaco_editor.editor_preferences_backend import handle_editor_preference_update_request
    from ..monaco_editor.editor_ws import editor_runtime_active_project

    project = editor_runtime_active_project()
    if not project or data.get("projectPath") != project:
        raise ValueError("stale_project_path")
    ref = data.get("ref")
    if ref is not None:
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError("invalid comparison ref")
        commit = await asyncio.to_thread(git_service.get_commit_info, Path(project), ref)
        if not commit:
            raise ValueError("comparison commit not found")
        if editor_runtime_active_project() != project:
            raise ValueError("stale_project_path")
        ref = "HEAD" if ref == "HEAD" else commit.hash
        _ = get_history_store().set_diff_base(project, ref)
        await publish_git_diff_base_changed(project, ref=ref, refresh=True, source="host_comparison")
    mode = data.get("mode")
    if mode is not None:
        if editor_runtime_active_project() != project:
            raise ValueError("stale_project_path")
        if mode not in ("plain", "commit", "disk"):
            raise ValueError("invalid comparison mode")
        _ = await handle_editor_preference_update_request(
            {"key": "comparisonMode", "value": mode}, source_client=source_client,
        )
    return await asyncio.to_thread(comparison_state, project, commits=data.get("commits") is True)
