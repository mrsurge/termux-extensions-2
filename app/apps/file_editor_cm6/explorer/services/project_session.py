# pyright: strict
from __future__ import annotations

import logging
import os
from pathlib import Path

from .file_ops import get_project_root
from ...project_sidecar import ProjectSidecar
from ...stores import get_history_store
from .runtime_notifications import notify_draft_state_changed

logger = logging.getLogger(__name__)


async def reset_project_session(new_project_path: str) -> bool:
    """Set the active project on explicit project switch."""
    normalized_path = os.path.abspath(os.path.expanduser(str(new_project_path)))
    history_store = get_history_store()
    history_store.set_active_project(normalized_path)
    history_store.update_session_state(
        {
            "activeProject": normalized_path,
            "currentPath": None,
            "lastSha256": None,
            "unsaved": False,
        }
    )

    was_new_sidecar = not ProjectSidecar.sidecar_exists(normalized_path)
    sidecar = ProjectSidecar.load_or_create(normalized_path)
    sidecar.get_or_create_lsp_project_id()
    removed_clean = sidecar.prune_clean_drafts()
    sidecar.save()
    if removed_clean:
        try:
            from .file_ops import mark_draft_cache_dirty

            mark_draft_cache_dirty(Path(normalized_path))
        except Exception:
            pass
        try:
            notify_draft_state_changed(normalized_path)
        except Exception:
            pass

    try:
        from ...terminal_backend import close_active_terminal_sockets

        await close_active_terminal_sockets()
    except Exception:
        pass

    try:
        from ...wba_event_bridge import reset_wba_project_event_state

        reset_wba_project_event_state()
        print("[reset_project_session] WBA project event state reset", flush=True)
    except Exception:
        pass

    try:
        from ...diff_helper import invalidate_diff_cache

        invalidate_diff_cache()
    except Exception:
        pass

    try:
        from ...change_ledger import clear as clear_ledger

        clear_ledger()
    except Exception:
        pass

    try:
        from ... import edit_tracker

        edit_tracker.set_project_root(get_project_root())
    except Exception:
        pass

    try:
        from ...ui_ipc import sidebar_ws

        await sidebar_ws.emit_sidebar_cwd_set_global(reason="project_switch")
    except Exception as exc:
        logger.warning("[reset_project_session] sidebar cwd emit failed: %s", exc)

    return was_new_sidecar
