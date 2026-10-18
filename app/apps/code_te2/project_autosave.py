# pyright: strict
"""Project-owned, consent-bound autosave transitions; no mutation replay."""
from __future__ import annotations

import asyncio
import hashlib
import secrets
import time
from contextlib import contextmanager
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path

from .project_sidecar import ProjectSidecar
from .worker_services.event_bus import current_project_generation

Json = dict[str, object]
_busy: set[str] = set()
_writes: dict[str, int] = {}
_switching = False
_held: dict[str, str] = {}


def require_project_idle(project: str) -> None:
    normalized = str(Path(project).resolve())
    if _switching or normalized in _busy or _writes.get(normalized, 0):
        raise ValueError("Project save or mode transition is in progress; retry after it finishes")


def require_no_transition(project: str) -> None:
    if str(Path(project).resolve()) in _busy:
        raise ValueError("Project autosave transition is in progress")


@contextmanager
def project_write(project: str) -> Generator[None]:
    require_project_idle(project)
    project = str(Path(project).resolve())
    _writes[project] = _writes.get(project, 0) + 1
    try:
        yield
    finally:
        _writes[project] -= 1
        if not _writes[project]:
            _writes.pop(project)


@contextmanager
def project_switch(previous: str | None, destination: str, token: str | None = None) -> Generator[None]:
    global _switching
    if token and previous and _held.get(token) == str(Path(previous).resolve()):
        _busy.discard(str(Path(previous).resolve()))
    if previous:
        require_project_idle(previous)
    require_project_idle(destination)
    _switching = True
    try:
        yield
    finally:
        _switching = False


def require_draft_writable(project: str) -> None:
    require_no_transition(project)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _disk_text(path: Path) -> str:
    # Preserve CRLF and Unicode exactly, just like the full-model draft.
    return path.read_bytes().decode("utf-8")


def _active(project: str, generation: int | None) -> None:
    from .stores import get_history_store
    active = get_history_store().get_active_project()
    if not active or Path(active).resolve() != Path(project) or current_project_generation(project) != generation:
        raise ValueError("Project changed; open the autosave dialog again")


async def _clients(freeze: str | None = None, release: str | None = None) -> dict[str, Json]:
    from .monaco_editor.editor_client_registry import connected_editor_client_instance_ids
    from .monaco_editor.editor_ws import editor_runtime_request_save_snapshot
    result: dict[str, Json] = {}
    async def one(client: str) -> None:
        try:
            snapshot = await editor_runtime_request_save_snapshot(
                f"autosave_{secrets.token_hex(12)}", client_instance_id=client,
                extra={"autosaveFreeze": freeze, "autosaveRelease": release},
            )
        except TimeoutError as exc:
            raise ValueError(f"Editor {client} did not answer the snapshot request within 3 seconds") from exc
        except Exception as exc:
            raise ValueError(f"Editor {client} snapshot failed ({type(exc).__name__}): {str(exc) or repr(exc)}") from exc
        if freeze is not None and snapshot.get("autosaveFreeze") != freeze:
            raise ValueError(f"Editor {client} did not acknowledge the temporary editing pause; all connected editors must support it")
        if snapshot.get("error") == "missing_path":
            return
        if snapshot.get("error"):
            raise ValueError(f"Editor snapshot failed: {snapshot['error']}")
        path, content = snapshot.get("path"), snapshot.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            raise ValueError("Invalid editor snapshot")
        result[client] = {"path": path, "sha": _sha(content), "content": content,
                          "base": snapshot.get("base_sha256")}
    results = await asyncio.gather(*(one(client) for client in connected_editor_client_instance_ids()), return_exceptions=True)
    for result_item in results:
        if isinstance(result_item, BaseException):
            raise ValueError(f"Editor snapshot failed: {result_item}")
    return result


@dataclass
class Receipt:
    project: str
    generation: int | None
    mode_revision: int
    watermark: int
    clients: dict[str, Json]
    drafts: list[Json]
    expires: float


_receipts: dict[str, Receipt] = {}


def _drafts_with_clients(project: str, drafts: list[Json], clients: dict[str, Json]) -> list[Json]:
    by_path = {str(d["file_path"]): dict(d) for d in drafts}
    live: dict[str, str] = {}
    for snapshot in clients.values():
        path, content = str(snapshot["path"]), str(snapshot["content"])
        candidate = Path(path).resolve()
        candidate.relative_to(Path(project))
        if path in live and live[path] != content:
            raise ValueError("Editors disagree about unsaved content; synchronize before changing mode")
        live[path] = content
        if snapshot["sha"] == snapshot.get("base"):
            if path in by_path and by_path[path].get("content_sha256") != snapshot["sha"]:
                raise ValueError("Editor and stored draft disagree; reopen the draft before changing mode")
            continue
        previous = by_path.get(path, {})
        by_path[path] = {**previous, "stored_sha": previous.get("content_sha256"), "file_path": path, "content": content,
                         "base_sha256": snapshot.get("base"), "content_sha256": _sha(content)}
    return list(by_path.values())


async def transition(data: Json) -> Json:
    from .stores import get_history_store
    project = get_history_store().get_active_project()
    if not project:
        raise ValueError("No active project")
    project = str(Path(project).resolve())
    require_project_idle(project)
    sidecar = ProjectSidecar.load_or_create(project)
    enabled, mode_revision = sidecar.get_autosave_state()
    expected_project = data.get("project")
    if not isinstance(expected_project, str) or str(Path(expected_project).expanduser().resolve()) != project:
        raise ValueError("Project changed; refresh the editor")
    if data.get("value") is False:
        if type(data.get("expected_revision")) is not int or data["expected_revision"] != mode_revision:
            raise ValueError("Project mode changed; refresh before changing it")
        sidecar.set_autosave_mode(False, mode_revision)
        return {"ok": True}
    if data.get("value") is not True:
        raise ValueError("autoSave must be a boolean")
    generation = current_project_generation(project)
    if data.get("stage") == "preview":
        clients = await _clients()
        _active(project, generation)
        require_project_idle(project)
        watermark, drafts = sidecar.read_review_snapshot()
        combined = _drafts_with_clients(project, drafts, clients)
        for stored_token, stored_receipt in list(_receipts.items()):
            if stored_receipt.expires < time.monotonic() or stored_receipt.project == project:
                _receipts.pop(stored_token)
        if len(_receipts) >= 8:
            raise ValueError("Too many pending mode confirmations")
        preview_token = secrets.token_urlsafe(24)
        _receipts[preview_token] = Receipt(project, generation, mode_revision, watermark, clients, combined, time.monotonic() + 120)
        asyncio.get_running_loop().call_later(120, _receipts.pop, preview_token, None)
        return {"ok": True, "preview": {"project": expected_project, "count": len(combined), "token": preview_token, "enabled": enabled}}
    token = data.get("token")
    choice = data.get("choice")
    if not isinstance(token, str) or not isinstance(choice, str) or choice not in {"save", "discard"}:
        raise ValueError("Choose Save All, Discard All or Cancel before enabling autosave")
    receipt = _receipts.pop(token, None)
    if receipt is None or receipt.project != project or receipt.expires < time.monotonic():
        raise ValueError("Autosave confirmation expired; open the dialog again")
    _active(project, receipt.generation)
    if sidecar.get_autosave_state()[1] != receipt.mode_revision:
        raise ValueError("Project mode changed; confirm again")
    _busy.add(project)
    # Own the accepted mutation to completion despite RPC caller cancellation.
    task = asyncio.create_task(_execute(receipt, token, str(choice)))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


async def flush_before_project_switch(project: str | None) -> str | None:
    """Autosave consent covers pending live edits, never other projects' drafts.

    Draft Mode switches do not save anything. Autosave switches resolve the
    captured old-project buffers before changing root; conflicts stop the switch.
    """
    if not project:
        return None
    project = str(Path(project).resolve())
    require_project_idle(project)
    sidecar = ProjectSidecar.load_or_create(project)
    enabled, revision = sidecar.get_autosave_state()
    if not enabled:
        return None
    generation = current_project_generation(project)
    clients = await _clients()
    _active(project, generation)
    require_project_idle(project)
    watermark, drafts = sidecar.read_review_snapshot()
    combined = _drafts_with_clients(project, drafts, clients)
    _busy.add(project)
    receipt = Receipt(project, generation, revision, watermark, clients, combined, time.monotonic() + 120)
    token = secrets.token_urlsafe(24)
    task = asyncio.create_task(_execute(receipt, token, "save", hold=True))
    try:
        result = await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        await release_project_switch(token)
        raise
    if result.get("ok") is not True:
        raise ValueError(str(result.get("message") or result.get("error")))
    return token


async def release_project_switch(token: str | None) -> None:
    if token is None:
        return
    project = _held.pop(token, None)
    if project:
        _busy.discard(project)
    try:
        await _clients(release=token)
    except Exception:
        pass


async def _execute(receipt: Receipt, token: str, choice: str, *, hold: bool = False) -> Json:
    from .monaco_editor.editor_backend_services.save_service import write_editor_file, _typed_get_file_meta
    from .monaco_editor.editor_ws import editor_runtime_emit_room_event, editor_runtime_notify_draft_state_changed, editor_runtime_record_save_sha
    sidecar = ProjectSidecar.load_or_create(receipt.project)
    completed: list[str] = []
    mutation_attempted = False
    expected_clients = {key: dict(value) for key, value in receipt.clients.items()}
    try:
        clients = await _clients(freeze=token)
        if clients != receipt.clients:
            raise ValueError("Editor content or connected clients changed; confirm again")
        _active(receipt.project, receipt.generation)
        watermark, _ = sidecar.read_review_snapshot()
        if watermark != receipt.watermark:
            raise ValueError("Drafts changed; confirm again")
        for draft in receipt.drafts:
            path = Path(str(draft["file_path"]))
            content = str(draft["content"])
            before_sha = _sha(content)
            _active(receipt.project, receipt.generation)
            if choice == "save":
                base = draft.get("base_sha256")
                if not isinstance(base, str) or len(base) != 64:
                    raise ValueError("Draft has no valid disk base; save it explicitly first")
                disk_meta = await asyncio.to_thread(_typed_get_file_meta, path)
                if disk_meta.get("sha256") != base:
                    raise ValueError(f"Disk changed or disappeared: {path}")
                _active(receipt.project, receipt.generation)
                mode = path.stat().st_mode & 0o777 if path.exists() else None
                mutation_attempted = True
                meta = await write_editor_file(Path(receipt.project),
                    str(path.relative_to(receipt.project)), content,
                    base_sha256=base, mode=mode, record_save_sha=editor_runtime_record_save_sha)
                disk_sha = str(meta["sha256"])
            else:
                content = await asyncio.to_thread(_disk_text, path)
                disk_sha = _sha(content)
            for snapshot in expected_clients.values():
                if snapshot["path"] == str(path):
                    snapshot.update(content=content, sha=disk_sha, base=disk_sha)
            # Only remove the exact draft included in the confirmation. A live
            # buffer not yet persisted has no sidecar entry to remove.
            revision = draft.get("document_revision")
            mutation_attempted = True
            if isinstance(revision, int):
                stored_sha = draft.get("stored_sha") or before_sha
                sidecar.evict_review_draft(str(path), revision, str(stored_sha))
            else:
                sidecar.advance_document_revision(str(path))
                sidecar.save()
            completed.append(str(path))
            from .draft_index_sidecar import DraftIndexSidecar
            try:
                DraftIndexSidecar.load_or_create(receipt.project).remove_abs_file(str(path))
            except Exception:
                pass
            from .explorer.services.file_ops import mark_git_cache_dirty, mark_draft_cache_dirty
            mark_git_cache_dirty(Path(receipt.project))
            mark_draft_cache_dirty(Path(receipt.project))
            if choice == "save":
                from .file_save_events import publish_file_saved
                publish_file_saved(project_root=Path(receipt.project), path=str(path),
                                   source="project_autosave", sha256=disk_sha,
                                   document_revision=sidecar.get_document_revision(str(path)))
            await editor_runtime_emit_room_event("editor:mirror", {
                "path": str(path), "content": content, "expected_content_sha256": before_sha,
                "content_sha256": disk_sha, "base_sha256": disk_sha, "unsaved": False,
                "document_revision": sidecar.get_document_revision(str(path)),
                "source_client": "project_autosave", "project_path": receipt.project,
            })
        _active(receipt.project, receipt.generation)
        if await _clients(freeze=token) != expected_clients:
            raise ValueError("Editor reconciliation changed; autosave was not enabled")
        _active(receipt.project, receipt.generation)
        sidecar.set_autosave_mode(True, receipt.mode_revision)
        if hold:
            _held[token] = receipt.project
        return {"ok": True, "resolved": completed}
    except Exception as exc:
        # A multi-file write isn't a transaction. Never lie about rollback or
        # replay a write whose outcome may already be committed.
        if hold:
            from .project_autosave_runtime import stop
            await stop(receipt.project, receipt.mode_revision, str(exc))
        outcome = ("Some files may already have been resolved; inspect before retrying."
                   if mutation_attempted else "No files were changed.")
        return {"ok": False, "error": str(exc), "resolved": completed,
                "message": f"Autosave was not enabled: {str(exc) or type(exc).__name__}. {outcome}"}
    finally:
        try:
            editor_runtime_notify_draft_state_changed(receipt.project)
        except Exception:
            pass
        if token not in _held:
            try:
                await _clients(release=token)
            except Exception:
                pass
            _busy.discard(receipt.project)
