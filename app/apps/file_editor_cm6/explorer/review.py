
import asyncio
import json
import sys
import time
import anyio
from pathlib import Path
from typing import List, Dict, Any, Optional

from ..explorer_helper import mark_git_cache_dirty
from ..core_read import init_watcher, push_save_ack, emit_diff_changed
from ..core_write import write_full, _get_file_meta
from ..diff_helper import invalidate_diff_cache
from ..draft_diff_helper import compute_draft_diff
from ..stores import _history_store
from ..nicegui_editor.editor_app import handle_external_discard

async def list_reviews(project_root: Path, lightweight: bool = False) -> List[Dict[str, Any]]:
    """Get list of files with unsaved drafts."""
    if not project_root or not project_root.exists():
        return []
    
    root_path = project_root
    results = []
    
    try:
        drafts = _history_store.list_project_drafts(str(project_root))
        for draft in drafts:
            abs_path = Path(draft['file_path'])
            try:
                rel_path = str(abs_path.relative_to(root_path))
            except ValueError:
                continue 
            
            hunks = []
            if not lightweight:
                try:
                    draft_content = draft.get('content', '')
                    if abs_path.exists():
                        disk_content = abs_path.read_text(encoding='utf-8', errors='replace')
                    else:
                        disk_content = ''
                    
                    diff_data = compute_draft_diff(str(abs_path), draft_content, disk_content)
                    hunks = diff_data.get('hunks', [])
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

async def save_reviews(project_root: Path, files: List[str]) -> Dict[str, Any]:
    """Save selected files from drafts to disk."""
    if not files:
        return {"saved_count": 0}
        
    root_path = project_root
    saved_count = 0
    errors = []
    
    init_watcher(root_path)
    
    for rel_path in files:
        try:
            abs_path = root_path / rel_path
            cached = _history_store.get_cached_document(str(project_root), str(abs_path))
            if not cached:
                continue
                
            content = cached.get('content', '')
            base_sha = cached.get('base_sha256')
            
            orig_mode = None
            if abs_path.exists():
                try:
                    orig_mode = abs_path.stat().st_mode & 0o777
                except OSError:
                    pass
            
            await anyio.to_thread.run_sync(
                lambda: write_full(root_path, rel_path, content, 
                                 base_sha256=base_sha, mode=orig_mode)
            )
            
            file_meta = _get_file_meta(abs_path)
            op_id = f"review_save_{int(time.time())}"
            push_save_ack(str(rel_path), op_id, "review_panel", file_meta)
            emit_diff_changed(str(rel_path), file_meta["sha256"])
            invalidate_diff_cache(root_path, str(rel_path))
            
            _history_store.clear_cached_document(str(project_root), str(abs_path))
            saved_count += 1
            
        except Exception as e:
            errors.append(f"{rel_path}: {str(e)}")
            
    mark_git_cache_dirty(root_path)
    
    return {"saved_count": saved_count, "errors": errors}

async def discard_reviews(project_root: Path, files: List[str]) -> Dict[str, Any]:
    """Discard drafts for selected files."""
    if not files:
        return {"discarded_count": 0}
        
    discarded_count = 0
    
    for rel_path in files:
        abs_path = project_root / rel_path
        if _history_store.clear_cached_document(str(project_root), str(abs_path)):
            discarded_count += 1
            # Revert the active editor if this file is open
            handle_external_discard(str(project_root), str(abs_path))
            
    return {"discarded_count": discarded_count}
