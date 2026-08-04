
import sys
import time
from pathlib import Path
from typing import Callable, Protocol, cast

from anyio import to_thread
from .services.file_ops import mark_git_cache_dirty
from ..core_read import push_save_ack, emit_diff_changed
from ..core_write import FileMeta, write_full
from ..diff_helper import invalidate_diff_cache
from ..file_save_events import publish_file_saved
from ..stores import get_history_store

JsonDict = dict[str, object]

_history_store = get_history_store()


class ComputeDraftDiffFn(Protocol):
    def __call__(self, file_path: str, draft_content: str, disk_content: str) -> object: ...


def _json_object(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _json_list(value: object) -> list[object]:
    return cast(list[object], value if isinstance(value, list) else [])


def _file_meta_json(meta: FileMeta) -> JsonDict:
    return dict(meta)


def _meta_sha256(meta: FileMeta) -> str:
    value = meta.get("sha256")
    return value if isinstance(value, str) else ""


def _get_file_meta(path: Path) -> FileMeta:
    from .. import core_write as _core_write

    fn = cast(Callable[[Path], FileMeta], cast(object, getattr(_core_write, "_get_file_meta")))
    return fn(path)


def _compute_draft_diff(file_path: str, draft_content: str, disk_content: str) -> JsonDict:
    from .. import draft_diff_helper as _draft_diff_helper

    fn = cast(ComputeDraftDiffFn, cast(object, getattr(_draft_diff_helper, "compute_draft_diff")))
    return _json_object(fn(file_path, draft_content, disk_content))

async def list_reviews(project_root: Path, lightweight: bool = False) -> list[dict[str, object]]:
    """Get list of files with unsaved drafts."""
    if not project_root or not project_root.exists():
        return []
    
    root_path = project_root
    results: list[dict[str, object]] = []
    
    try:
        drafts = _history_store.list_project_drafts(str(project_root))
        for draft in drafts:
            file_path = draft.get('file_path')
            if not isinstance(file_path, str) or not file_path:
                continue
            abs_path = Path(file_path)
            try:
                rel_path = str(abs_path.relative_to(root_path))
            except ValueError:
                continue 
            
            hunks: list[object] = []
            if not lightweight:
                try:
                    draft_content = str(draft.get('content') or '')
                    if abs_path.exists():
                        disk_content = abs_path.read_text(encoding='utf-8', errors='replace')
                    else:
                        disk_content = ''
                    
                    diff_data = _compute_draft_diff(str(abs_path), draft_content, disk_content)
                    hunks = _json_list(diff_data.get('hunks'))
                except Exception as e:
                    print(f"[REVIEW] Diff computation failed for {rel_path}: {e}", file=sys.stderr)

            results.append({
                "path": str(abs_path),
                "rel": rel_path,
                "has_draft": True,
                "timestamp": draft.get('updated_at'),
                "hunks": hunks
            })
            
    except Exception as e:
        print(f"[REVIEW] Draft list failed: {e}", file=sys.stderr)
        
    return results

async def save_reviews(
    project_root: Path,
    files: list[str],
    *,
    client_id: str = "review_panel",
    op_prefix: str = "review_save",
) -> dict[str, object]:
    """Save selected files from drafts to disk."""
    if not files:
        return {"saved_count": 0}
        
    root_path = project_root
    saved_count = 0
    errors: list[str] = []
    
    for rel_path in files:
        try:
            abs_path = root_path / rel_path
            cached = _history_store.get_cached_document(str(project_root), str(abs_path))
            if not cached:
                continue
                
            content = str(cached.get('content') or '')
            base_sha_raw = cached.get('base_sha256')
            base_sha = str(base_sha_raw) if isinstance(base_sha_raw, str) else None
            
            orig_mode = None
            if abs_path.exists():
                try:
                    orig_mode = abs_path.stat().st_mode & 0o777
                except OSError:
                    pass
            
            _ = await to_thread.run_sync(
                lambda: write_full(root_path, rel_path, content, 
                                 base_sha256=base_sha, mode=orig_mode)
            )
            
            file_meta = _get_file_meta(abs_path)
            op_id = f"{op_prefix}_{int(time.time())}"
            push_save_ack(str(rel_path), op_id, client_id, _file_meta_json(file_meta))
            emit_diff_changed(str(rel_path), _meta_sha256(file_meta))
            invalidate_diff_cache(root_path, str(rel_path))
            
            _ = _history_store.clear_cached_document(str(project_root), str(abs_path))
            saved_count += 1
            publish_file_saved(
                project_root=root_path,
                path=abs_path,
                source=op_prefix,
                sha256=_meta_sha256(file_meta),
            )
            
        except Exception as e:
            errors.append(f"{rel_path}: {str(e)}")
            
    mark_git_cache_dirty(root_path)
    
    return {"saved_count": saved_count, "errors": errors}

async def discard_reviews(project_root: Path, files: list[str]) -> dict[str, object]:
    """Discard drafts for selected files."""
    if not files:
        return {"discarded_count": 0}
        
    discarded_count = 0
    
    for rel_path in files:
        abs_path = project_root / rel_path
        if _history_store.clear_cached_document(str(project_root), str(abs_path)):
            discarded_count += 1
            
    return {"discarded_count": discarded_count}
