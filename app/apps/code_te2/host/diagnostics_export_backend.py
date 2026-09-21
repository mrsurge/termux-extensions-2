# pyright: strict
"""Host-owned diagnostic export over RPC; no editor-buffer or HTTP fallback."""
import asyncio
from pathlib import Path
from ..core_write import write_full, BaseMismatchError
from ..core_read import push_save_ack, emit_diff_changed
from ..diff_helper import invalidate_diff_cache
from ..explorer.services.file_ops import mark_git_cache_dirty
from ..stores import get_history_store


async def handle_diagnostics_export(data: dict[str, object], *, source_name: str) -> dict[str, object]:
    project = get_history_store().get_active_project()
    if not project:
        raise ValueError("No active project")
    root = Path(project).resolve()
    directory = root / ".code_te2" / "diagnostics"
    action = data.get("action", "write")
    if action in ("directory", "mkdir"):
        if not directory.resolve().is_relative_to(root):
            raise ValueError("Diagnostic directory is outside the project")
        if action == "mkdir":
            await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
        return {"exists": await asyncio.to_thread(directory.is_dir), "path": str(directory)}
    if action != "write":
        raise ValueError("Unknown diagnostic export action")
    path, content = data.get("path"), data.get("content")
    if not isinstance(path, str) or not path or not isinstance(content, str):
        raise ValueError("path and content are required")
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError("Export path is outside the project")
    if get_history_store().get_cached_document(project, str(target)):
        return {"ok": False, "error": "DRAFT_EXISTS"}
    rel = str(target.relative_to(root))
    op = data.get("op_id")
    if not isinstance(op, str):
        raise ValueError("op_id is required")
    def write() -> dict[str, object]:
        mode = target.stat().st_mode & 0o777 if target.is_file() else None
        return dict(write_full(root, rel, content, mode=mode))
    try:
        meta = await asyncio.to_thread(write)
    except BaseMismatchError as exc:
        return {"ok": False, "error": "BASE_MISMATCH", "data": {"current": exc.current_meta}}
    # Reuse canonical mutation notifications; never silently discard a draft.
    push_save_ack(rel, op, source_name, meta)
    sha = meta.get("sha256")
    emit_diff_changed(rel, sha if isinstance(sha, str) else "")
    mark_git_cache_dirty(root)
    invalidate_diff_cache(root, rel)
    return {"ok": True, "data": meta}
