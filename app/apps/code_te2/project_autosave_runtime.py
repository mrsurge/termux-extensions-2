# pyright: strict
"""Per-file autosave admission over persisted mirrors, never active-tab snapshots.

Pending entries coalesce before execution. Accepted writes are owned to completion
and never replayed; a failure leaves recoverable content and returns to Draft Mode.
"""
from __future__ import annotations

import asyncio
import time
import logging
from dataclasses import dataclass
from pathlib import Path

from .project_sidecar import ProjectSidecar
from .project_autosave import project_write, require_project_idle, _active
from .worker_services.event_bus import current_project_generation

DELAY = 0.45


@dataclass(frozen=True)
class Pending:
    mode_revision: int
    generation: int | None
    due: float


_pending: dict[str, dict[str, Pending]] = {}
_tasks: dict[str, asyncio.Task[None]] = {}
_blocked: dict[str, int] = {}
_commits: dict[tuple[str, str], tuple[int, int | None, tuple[str, ...], str]] = {}
logger = logging.getLogger(__name__)


class AdmissionBusy(Exception):
    """Another operation won admission before this task issued a write."""


def record_commit(project: str, path: str, base: str, digest: str, revision: int) -> None:
    key = (str(Path(project).resolve()), str(Path(path).resolve()))
    generation = current_project_generation(project)
    previous = _commits.get(key)
    ancestors = previous[2] if previous and previous[0] == revision and previous[1] == generation and previous[3] == base else ()
    lineage: tuple[str, ...] = (*ancestors, base)
    _commits[key] = (revision, generation, lineage[-8:], digest)
    if len(_commits) > 256:
        _commits.pop(next(iter(_commits)))


def rebase_mirror(project: str, path: str, base: str, disk_sha: object, revision: int) -> str:
    """A delayed mirror may precede our own committed save acknowledgement.

    Adopt only a known same-mode/generation ancestor, with exact live disk proof;
    unrelated external writes never enter this lineage.
    """
    previous = _commits.get((str(Path(project).resolve()), str(Path(path).resolve())))
    if previous and previous[0] == revision and previous[1] == current_project_generation(project) and base in previous[2] and disk_sha == previous[3]:
        return previous[3]
    return base


def schedule(project: str, path: str, revision: int) -> None:
    project = str(Path(project).resolve())
    path = str(Path(path).resolve())
    Path(path).relative_to(project)
    if _blocked.get(project) == revision:
        return
    _pending.setdefault(project, {})[path] = Pending(revision, current_project_generation(project), time.monotonic() + DELAY)
    if project not in _tasks:
        _tasks[project] = asyncio.create_task(_run(project), name="code_te2_project_autosave")


async def _run(project: str) -> None:
    try:
        while _pending.get(project):
            def due(item: tuple[str, Pending]) -> float:
                return item[1].due

            path, pending = min(_pending[project].items(), key=due)
            delay = pending.due - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
                continue
            try:
                require_project_idle(project)
            except ValueError:
                # Wait only for admission, before any write has been issued.
                await asyncio.sleep(0.05)
                continue
            if _pending[project].get(path) is not pending:
                continue
            _pending[project].pop(path)
            enabled, revision = ProjectSidecar.load_or_create(project).get_autosave_state()
            if not enabled or revision != pending.mode_revision:
                continue
            try:
                _active(project, pending.generation)
            except ValueError:
                continue  # Explicit project switch already resolved its buffers.
            task = asyncio.create_task(_write(project, path, pending))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
            except AdmissionBusy:
                # Queue admission only: this attempt has issued no write.
                _pending.setdefault(project, {}).setdefault(path, Pending(pending.mode_revision, pending.generation, time.monotonic() + 0.05))
            except Exception as exc:
                _pending.pop(project, None)
                _blocked[project] = pending.mode_revision
                try:
                    await _failed(project, str(exc))
                except Exception:
                    logger.exception("Autosave stopped; failed to publish Draft Mode recovery")
    finally:
        _pending.pop(project, None)
        _tasks.pop(project, None)


def _draft(project: str, path: str) -> dict[str, object] | None:
    _, drafts = ProjectSidecar.load_or_create(project).read_review_snapshot()
    return next((draft for draft in drafts if draft.get("file_path") == path), None)


async def _write(project: str, path: str, pending: Pending) -> None:
    from .monaco_editor.editor_backend_services.save_service import write_editor_file, _typed_get_file_meta
    from .monaco_editor.editor_ws import editor_runtime_emit_room_event, editor_runtime_notify_draft_state_changed, editor_runtime_record_save_sha
    from .explorer.services.file_ops import mark_git_cache_dirty, mark_draft_cache_dirty
    from .file_save_events import publish_file_saved
    try:
        require_project_idle(project)
    except ValueError as exc:
        raise AdmissionBusy from exc
    with project_write(project):
        _active(project, pending.generation)
        sidecar = ProjectSidecar.load_or_create(project)
        if sidecar.get_autosave_state() != (True, pending.mode_revision):
            return
        draft = _draft(project, path)
        if draft is None:
            return
        content, digest, base = draft.get("content"), draft.get("content_sha256"), draft.get("base_sha256")
        if not isinstance(content, str) or not isinstance(digest, str) or not isinstance(base, str) or len(base) != 64:
            raise ValueError("Pending autosave has no valid disk base")
        disk_meta = await asyncio.to_thread(_typed_get_file_meta, Path(path))
        if disk_meta.get("sha256") not in {base, digest}:
            raise ValueError("File changed or disappeared outside the editor")
        if disk_meta.get("sha256") != digest:
            mode = Path(path).stat().st_mode & 0o777
            await write_editor_file(Path(project), str(Path(path).relative_to(project)), content,
                                    base_sha256=base, mode=mode, record_save_sha=editor_runtime_record_save_sha)
        else:
            editor_runtime_record_save_sha(path, digest)
        record_commit(project, path, base, digest, pending.mode_revision)
        latest = _draft(project, path)
        if latest is None:
            raise ValueError("File was saved, but its pending buffer changed during reconciliation")
        latest_revision = latest.get("document_revision")
        latest_content, latest_sha = latest.get("content"), latest.get("content_sha256")
        if not isinstance(latest_revision, int) or not isinstance(latest_content, str) or not isinstance(latest_sha, str):
            raise ValueError("Invalid pending buffer after save")
        if latest_sha == digest:
            sidecar.evict_review_draft(path, latest_revision, latest_sha)
            unsaved = False
        elif latest.get("base_sha256") == base:
            # Typing during an accepted disk write is retained and rebased,
            # never cleared merely because the previous snapshot was saved.
            sidecar.replace_review_draft(path, latest_revision, latest_sha, latest_content, digest, advance_base=True)
            unsaved = True
            schedule(project, path, pending.mode_revision)
        else:
            raise ValueError("File was saved, but its pending base changed; inspect before retrying")
        revision = sidecar.get_document_revision(path)
        mark_git_cache_dirty(Path(project))
        mark_draft_cache_dirty(Path(project))
        from .draft_index_sidecar import DraftIndexSidecar
        try:
            DraftIndexSidecar.load_or_create(project).update_from_abs_file(path, unsaved=unsaved)
        except Exception:
            pass  # Sidecar content, not the lightweight decoration index, is authority.
        editor_runtime_notify_draft_state_changed(project)
        publish_file_saved(project_root=project, path=path, source="project_autosave", sha256=digest, document_revision=revision)
        await editor_runtime_emit_room_event("editor:mirror", {
            "path": path, "content": latest_content, "expected_content_sha256": latest_sha,
            "content_sha256": latest_sha, "base_sha256": digest, "unsaved": unsaved,
            "document_revision": revision, "source_client": "project_autosave", "project_path": project,
        })


async def _failed(project: str, message: str) -> None:
    from .monaco_editor.editor_ws import editor_runtime_emit_room_event
    from .monaco_editor.editor_backend import _get_view_state_dict
    from .stores import get_preferences_store, get_history_store
    from .ui_ipc.notifications import emit_ui_ipc_rpc_notification
    from .ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED
    sidecar = ProjectSidecar.load_or_create(project)
    _, revision = sidecar.get_autosave_state()
    sidecar.set_autosave_mode(False, revision)
    active = get_history_store().get_active_project()
    display_project = active if active and str(Path(active).resolve()) == project else project
    preferences = get_preferences_store().get_preferences(display_project)
    view_state = _get_view_state_dict()
    view_state.update(autoSave=False, autosaveProject=display_project, autosaveRevision=sidecar.get_autosave_state()[1])
    payload: dict[str, object] = {"project_path": project, "view_state": view_state, "preferences": preferences}
    await editor_runtime_emit_room_event("editor:prefs_changed", payload)
    await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED, payload)
    await editor_runtime_emit_room_event("editor:notify", {
        "message": f"Autosave stopped: {message}. Unsaved content is retained in Draft Mode.", "timeout": 7000,
    })


async def stop(project: str, revision: int, message: str) -> None:
    """Stop admission after a failed switch flush; never replay its outcome."""
    _blocked[project] = revision
    _pending.pop(project, None)
    await _failed(project, message)
