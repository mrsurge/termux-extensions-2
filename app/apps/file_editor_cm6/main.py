# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.py

import sys
import os
import json
import time
import shutil
from pathlib import Path
from typing import Any
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query
from fastapi.responses import JSONResponse, FileResponse, Response
import asyncio
from anyio import to_thread
from .history_store import HistoryStore
from .explorer.services.file_ops import get_project_root, set_project_root, mark_git_cache_dirty, list_dir, _normalize_rel_path
from .code_server_shell_manager import ensure_code_server_shell
from .git_helper import (
    GitError,
    list_branches as git_list_branches,
    checkout_branch as git_checkout_branch,
    create_branch as git_create_branch_helper,
    get_status as git_get_status,
    stage_all as git_stage_all,
    unstage_all as git_unstage_all,
    commit_changes as git_commit_changes,
    push_changes as git_push_changes,
    pull_changes as git_pull_changes,
    stage_paths,
    unstage_paths,
    get_commits_for_path,
    restore_path,
    get_commits,
    reset_hard,
    is_git_repository,
    init_repository,
    get_worktree_changes,
    get_commit_info,
)
from . import edit_tracker
from .diff_helper import invalidate_diff_cache, collect_diff
from .draft_diff_helper import compute_draft_diff
from .core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe, unsubscribe
from .explorer.transport.connection_manager import manager as explorer_manager
from .core_write import write_full, BaseMismatchError, _get_file_meta
from .project_sidecar import ProjectSidecar, cleanup_orphaned_sidecars
from .explorer import search as explorer_search_module
from .main_page.backend.state_payload import (
    StatePayloadDeps,
    build_diff_base_payload,
    build_state_payload,
    expand_and_validate_path,
    get_runtime_metadata,
    resolve_diff_base,
    status_to_payload,
)
from .main_page.backend.workbench_routes import WorkbenchRoutesDeps, create_workbench_router
from .main_page.backend.project_routes import ProjectRoutesDeps, create_project_router

IGNORE_PATTERNS = [
    '.git', '__pycache__', 'node_modules', '.venv', 'venv',
    '.pytest_cache', '.mypy_cache', '.tox', 'dist', 'build',
    '*.egg-info', '.DS_Store'
]

AGENT_ICON_DIR = Path.home() / ".local" / "share" / "termux-extensions-2" / "agent_icons"
JsonDict = dict[str, Any]

CHANGE_RESULT_LIMIT = 40
STATUS_TEXT_MAP = {
    'M': 'Modified',
    'A': 'Added',
    'D': 'Deleted',
    'R': 'Renamed',
    'C': 'Copied',
    'U': 'Conflict',
    '?': 'Untracked',
    '!': 'Ignored',
}

async def _search_by_name(root: Path, query: str) -> JsonDict:
    """Search files/folders by name."""
    return await explorer_search_module.search_by_name(root, query)

async def _search_by_content(root: Path, query: str) -> JsonDict:
    """Search file contents using ripgrep or fallback."""
    rg_path = shutil.which('rg')
    if rg_path:
        return await _search_with_ripgrep(root, query, rg_path)
    else:
        return await _search_with_python(root, query)

async def _search_with_ripgrep(root: Path, query: str, rg_path: str) -> JsonDict:
    """Use ripgrep for fast content search."""
    cmd = [
        rg_path,
        '--json',
        '--line-number',
        '--column',
        '--max-count', '5',  # Max 5 matches per file
        '--max-filesize', '1M',  # Skip large files
        '--',
        query,
        str(root)
    ]
    
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        
        # Parse ripgrep JSON output
        results_by_file = {}
        for line in stdout.decode('utf-8').splitlines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                if obj.get('type') == 'match':
                    data = obj['data']
                    path_str = data['path']['text']
                    path = Path(path_str)
                    rel = str(path.relative_to(root))
                    
                    if rel not in results_by_file:
                        results_by_file[rel] = {
                            "path": path_str,
                            "rel": rel,
                            "matches": []
                        }
                    
                    line_num = data['line_number']
                    line_text = data['lines']['text'].rstrip('\n')
                    
                    # Extract snippet around match
                    submatch = data['submatches'][0] if data['submatches'] else {}
                    col = submatch.get('start', 0)
                    match_text = submatch.get('match', {}).get('text', query)
                    
                    # Create snippet (75 chars before/after)
                    start = max(0, col - 75)
                    end = min(len(line_text), col + len(match_text) + 75)
                    snippet = line_text[start:end]
                    
                    results_by_file[rel]["matches"].append({
                        "line": line_num,
                        "column": col,
                        "text": line_text,
                        "snippet": snippet
                    })
            except (json.JSONDecodeError, KeyError):
                continue
        
        results = list(results_by_file.values())[:50]  # Max 50 files
        match_count = sum(len(r["matches"]) for r in results)
        
        return {
            "mode": "content",
            "query": query,
            "results": results,
            "truncated": len(results_by_file) > 50,
            "file_count": len(results),
            "match_count": match_count
        }
        
    except asyncio.TimeoutError:
        raise TimeoutError("Ripgrep search timed out")

async def _search_with_python(root: Path, query: str) -> JsonDict:
    """Fallback Python content search."""
    results_by_file = {}
    query_lower = query.lower()
    file_count = 0
    max_files = 50
    
    def is_binary(path: Path) -> bool:
        try:
            with path.open('rb') as f:
                return b'\x00' in f.read(8192)
        except:
            return True
    
    def should_ignore(path: Path) -> bool:
        for part in path.parts:
            if part in IGNORE_PATTERNS or part.startswith('.'):
                return True
        return False
    
    for item in root.rglob('*'):
        if not item.is_file() or file_count >= max_files:
            break
        if should_ignore(item.relative_to(root)) or is_binary(item):
            continue
        
        try:
            content = item.read_text(encoding='utf-8', errors='ignore')
            lines = content.splitlines()
            matches = []
            
            for line_num, line_text in enumerate(lines, 1):
                if query_lower in line_text.lower():
                    col = line_text.lower().find(query_lower)
                    start = max(0, col - 75)
                    end = min(len(line_text), col + len(query) + 75)
                    
                    matches.append({
                        "line": line_num,
                        "column": col,
                        "text": line_text,
                        "snippet": line_text[start:end]
                    })
                    
                    if len(matches) >= 5:  # Max 5 per file
                        break
            
            if matches:
                rel = str(item.relative_to(root))
                results_by_file[rel] = {
                    "path": str(item),
                    "rel": rel,
                    "matches": matches
                }
                file_count += 1
                
        except Exception:
            continue
    
    results = list(results_by_file.values())
    match_count = sum(len(r["matches"]) for r in results)
    
    return {
        "mode": "content",
        "query": query,
        "results": results,
        "truncated": file_count >= max_files,
        "file_count": len(results),
        "match_count": match_count
    }


def _status_meta_from_code(code: str) -> tuple[str, str]:
    if not code:
        return '', STATUS_TEXT_MAP['?']
    if code in ('??', '!!'):
        key = '?' if code == '??' else '!'
        short = '?' if code == '??' else '!'
        return short, STATUS_TEXT_MAP[key]
    compact = code.replace(' ', '')
    primary = compact[0] if compact else '?'
    key = primary if primary in STATUS_TEXT_MAP else '?'
    return primary, STATUS_TEXT_MAP[key]


def _search_by_changes(project_root: Path) -> JsonDict:
    project_path = _history_store.get_active_project()
    if not project_path:
        return {
            "mode": "changes",
            "git": False,
            "base": _diff_base_payload(None),
            "changes": [],
            "truncated": False,
            "count": 0,
        }
    if not is_git_repository(project_root):
        return {
            "mode": "changes",
            "git": False,
            "base": _diff_base_payload(project_path),
            "changes": [],
            "truncated": False,
            "count": 0,
        }

    try:
        base_ref = _resolve_diff_base(project_path)
        entries = get_worktree_changes(project_root, base_ref)
    except GitError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    truncated = len(entries) > CHANGE_RESULT_LIMIT
    selected = entries[:CHANGE_RESULT_LIMIT]
    changes = []

    for entry in selected:
        rel_path = entry.path.replace('\\', '/')
        diff_payload = collect_diff(project_root, rel_path, base_ref=base_ref)
        status_short, status_text = _status_meta_from_code(entry.code)
        summary = diff_payload.get("summary", {"added": 0, "deleted": 0, "tracked": False})

        change = {
            "rel": rel_path,
            "path": str((project_root / rel_path).resolve()),
            "label": Path(rel_path).name,
            "status": status_short,
            "statusCode": entry.code,
            "statusText": status_text,
            "summary": summary,
            "hunks": diff_payload.get("hunks", []),
            "isTracked": summary.get("tracked", True),
        }
        if entry.original_path:
            change["renamedFrom"] = entry.original_path
        if "error" in diff_payload:
            change["error"] = diff_payload["error"]
        changes.append(change)

    base_info = _diff_base_payload(project_path)

    return {
        "mode": "changes",
        "git": True,
        "base": base_info,
        "changes": changes,
        "truncated": truncated,
        "count": len(changes),
        "total": len(entries),
    }

file_editor_cm6_bp = APIRouter()
# sock = Sock()

# # Register terminal routes and WebSocket handler
# register_terminal_routes(file_editor_cm6_bp, sock)

# Serve static files (JS, CSS, etc.)
@file_editor_cm6_bp.get("/static/{file_path:path}")
async def serve_static(file_path: str):
    """Serve static files from the app's static directory"""
    static_dir = Path(__file__).parent / "static"
    file = static_dir / file_path
    if not file.exists() or not file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file)

@file_editor_cm6_bp.get("/agent_icons/{name}")
async def serve_agent_icon(name: str):
    safe = Path(name).name
    if not safe or safe != name:
        raise HTTPException(status_code=400, detail="Invalid icon name")
    file = (AGENT_ICON_DIR / safe)
    if not file.exists() or not file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file)

# Register terminal routes, (and give me a new reason to make a commit)
from .terminal_backend import terminal_router
file_editor_cm6_bp.include_router(terminal_router)

# Include the self-contained editor routes
from .monaco_editor.editor_backend import editor_router
from .monaco_editor import register_monaco_editor_routes
from .editor_discard import handle_external_discard
file_editor_cm6_bp.include_router(editor_router)
register_monaco_editor_routes(file_editor_cm6_bp, mount_path="/ui")

# --- Code TE2 Socket.IO (worker-owned) ---
# The main framework process still proxies the current physical paths to this
# one worker endpoint. Logical namespaces stay owned by their existing handlers.
from app.apps.file_editor_cm6.socketio_gateway import FILE_EDITOR_CM6_ASGI_APP

SUBAPPS = [
    ("/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/editor_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/explorer_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/ui_ipc_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/terminal_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
]

# Import singleton store instances
from .stores import _history_store, _preferences_store

_STATE_PAYLOAD_DEPS = StatePayloadDeps(
    history=_history_store,
    preferences=_preferences_store,
    set_project_root=set_project_root,
    is_git_repository=is_git_repository,
    get_commit_info=get_commit_info,
    format_label=HistoryStore.format_label,
)


async def _get_framework_shell_by_id(shell_id: str):
    from .workbench_adapter_shell_manager import get_shell_record

    return await get_shell_record(shell_id)


async def _ensure_workbench_adapter_shell_for_routes(
    project_root: str,
    *,
    code_server_http: str,
    code_server_socket_path: str | None,
):
    from .workbench_adapter_shell_manager import ensure_workbench_adapter_shell

    return await ensure_workbench_adapter_shell(
        project_root,
        code_server_http=code_server_http,
        code_server_socket_path=code_server_socket_path,
    )


def _code_server_connection_target_for_routes(record):
    from .code_server_shell_manager import code_server_connection_target

    return code_server_connection_target(record)


async def _nudge_diagnostics_for_file_for_routes(path: str) -> bool:
    from .diagnostics_bridge import nudge_diagnostics_for_file

    return await nudge_diagnostics_for_file(path)


_WORKBENCH_ROUTES_DEPS = WorkbenchRoutesDeps(
    history=_history_store,
    get_project_root=get_project_root,
    ensure_code_server_shell=ensure_code_server_shell,
    ensure_workbench_adapter_shell=_ensure_workbench_adapter_shell_for_routes,
    code_server_connection_target=_code_server_connection_target_for_routes,
    nudge_diagnostics_for_file=_nudge_diagnostics_for_file_for_routes,
    get_shell_by_id=_get_framework_shell_by_id,
)
file_editor_cm6_bp.include_router(create_workbench_router(_WORKBENCH_ROUTES_DEPS))


def initialize_project_session() -> ProjectSidecar | None:
    """Called once at editor worker boot to bump the project session counter.

    IMPORTANT:
    - This function must NOT clear session_cache or tracked_jobs.
      Clearing per-project state happens only on explicit project switches
      in reset_project_session() (explorer/services/project_session.py), so that a plain worker
      restart for the same project never wipes drafts.
    """
    project_path = _history_store.get_active_project()
    if not project_path or not Path(project_path).exists():
        return None

    sidecar = ProjectSidecar.load_or_create(project_path)
    sidecar.increment_session()
    sidecar.prune_clean_drafts()

    sidecar.save()
    return sidecar

def _ensure_project_root_synced() -> Path:
    """Ensure the in-memory project root matches the persisted active project."""
    stored = _history_store.get_active_project()
    if stored:
        stored_path = Path(stored)
        if stored_path.is_dir():
            current = get_project_root()
            try:
                if stored_path.resolve() != current.resolve():
                    new_root = set_project_root(stored)
                    invalidate_diff_cache(new_root)
                    return new_root
            except Exception:
                pass
            return stored_path
    return get_project_root()

# Sync the initial project root on module import.
try:
    project_root = _ensure_project_root_synced()
    edit_tracker.set_project_root(project_root)
except Exception:
    project_root = get_project_root()

# Housekeeping for per-project sidecars and session counters.
try:
    cleanup_orphaned_sidecars()
except Exception:
    # Sidecar cleanup is best-effort; failures should not block editor startup.
    pass

try:
    _active_project_sidecar = initialize_project_session()
except Exception:
    _active_project_sidecar = None


def _ensure_workbench_json_sync(project_root_str: str) -> None:
    """Sync code-server User/settings.json watcher exclusion at boot."""
    try:
        from .project_sidecar import ProjectSidecar
        from .code_server_shell_manager import sync_vscode_watcher_settings
        sc = ProjectSidecar.load_or_create(project_root_str)
        wmode = sc._data.get("watcher", {}).get("mode", "ipc")
        sync_vscode_watcher_settings(wmode)
    except Exception as exc:
        print(f"[file_editor_cm6] workbench json sync failed (non-fatal): {exc}", flush=True)


async def _eager_start_code_server():
    """Best-effort eager start of code-server at worker boot.

    Only starts code-server (the extension host backend). The workbench adapter
    is launched later, triggered by the frontend readiness chain:
    editor iframe ready -> code-server confirmed -> adapter launch -> baton fan-out.
    """
    try:
        pr = _history_store.get_active_project() or str(get_project_root())
        if not pr:
            return
        # Sync watcher settings BEFORE code-server launches
        _ensure_workbench_json_sync(pr)
        cs = await ensure_code_server_shell(pr)
        cs_env = (cs.env_overrides or {})
        pr = str(cs_env.get("PROJECT_ROOT") or pr)
        print(f"[file_editor_cm6] eager code-server startup OK (project={pr})", flush=True)
    except Exception as exc:
        print(f"[file_editor_cm6] eager code-server startup failed: {exc}", flush=True)


@file_editor_cm6_bp.on_event("startup")
async def _on_startup():
    asyncio.ensure_future(_eager_start_code_server())


def _get_active_project_root() -> Path:
    project_path = _history_store.get_active_project()
    if not project_path:
        raise GitError('No project selected')
    project = Path(project_path)
    if not project.exists():
        raise GitError(f'Project "{project_path}" not found')
    set_project_root(project_path)
    return project


def _resolve_diff_base(project_path: str | None) -> str:
    return resolve_diff_base(_STATE_PAYLOAD_DEPS, project_path)


def _diff_base_payload(project_path: str | None) -> JsonDict:
    return build_diff_base_payload(_STATE_PAYLOAD_DEPS, project_path)



def _status_to_payload(status: Any) -> JsonDict:
    return status_to_payload(status)

def _get_runtime_metadata() -> JsonDict:
    return get_runtime_metadata()

def _build_state_payload() -> JsonDict:
    return build_state_payload(_STATE_PAYLOAD_DEPS)

def _expand_and_validate_path(path: str) -> tuple[str | None, str | None]:
    return expand_and_validate_path(path)


async def _close_active_terminal_sockets_for_project_routes() -> None:
    from .terminal_backend import close_active_terminal_sockets

    await close_active_terminal_sockets()


def _stop_diagnostics_bridge_for_project_routes() -> None:
    from .diagnostics_bridge import stop_bridge

    stop_bridge()


async def _terminate_adapter_shell_for_project_routes() -> bool:
    from .workbench_adapter_shell_manager import terminate_adapter_shell

    return await terminate_adapter_shell()


def _clear_change_ledger_for_project_routes() -> None:
    from .change_ledger import clear as clear_ledger

    clear_ledger()


async def _emit_sidebar_cwd_set_for_project_routes(reason: str) -> None:
    from .ui_ipc import sidebar_ws

    await sidebar_ws.emit_sidebar_cwd_set_global(reason=reason)


def _create_project_for_project_routes(parent_path: str, name: str) -> dict[str, object]:
    from .explorer.services.file_ops import create_project

    result = create_project(parent_path, name)
    return {str(key): value for key, value in result.items()}


_PROJECT_ROUTES_DEPS = ProjectRoutesDeps(
    history=_history_store,
    get_project_root=get_project_root,
    set_project_root=set_project_root,
    invalidate_diff_cache=invalidate_diff_cache,
    set_edit_tracker_project_root=edit_tracker.set_project_root,
    close_active_terminal_sockets=_close_active_terminal_sockets_for_project_routes,
    stop_diagnostics_bridge=_stop_diagnostics_bridge_for_project_routes,
    terminate_adapter_shell=_terminate_adapter_shell_for_project_routes,
    clear_change_ledger=_clear_change_ledger_for_project_routes,
    emit_sidebar_cwd_set=_emit_sidebar_cwd_set_for_project_routes,
    build_state_payload=_build_state_payload,
    create_project=_create_project_for_project_routes,
)
file_editor_cm6_bp.include_router(create_project_router(_PROJECT_ROUTES_DEPS))

@file_editor_cm6_bp.get('/')
def status_root():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}

@file_editor_cm6_bp.get('/status')
def status():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}


@file_editor_cm6_bp.get('/session_cache')
def get_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Retrieve cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err or expanded_project is None:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err or expanded_path is None:
        raise HTTPException(status_code=403, detail=err)
    
    cached = _history_store.get_cached_document(expanded_project, expanded_path)
    
    if not cached:
        return {"ok": True, "data": None}
    
    # Determine state: crashed vs mid-session vs clean
    runtime_meta = _get_runtime_metadata()
    current_run_id = runtime_meta["run_id"]
    cached_run_id = cached.get("run_id", "unknown")
    unsaved = cached.get("unsaved", False)
    
    if not unsaved:
        state = "clean"
    else:
        state = "mid_session" if current_run_id == cached_run_id else "crashed"
    
    return {
        "ok": True,
        "data": {
            "state": state,
            "content": cached["content"],
            "content_sha256": cached["content_sha256"],
            "base_sha256": cached["base_sha256"],
            "unsaved": unsaved,
            "run_id": cached_run_id,
            "updated_at": cached["updated_at"],
            "current_run_id": current_run_id,
        }
    }


@file_editor_cm6_bp.delete('/session_cache')
def delete_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Discard cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err or expanded_project is None:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err or expanded_path is None:
        raise HTTPException(status_code=403, detail=err)
    
    existed = _history_store.clear_cached_document(expanded_project, expanded_path)
    
    # Notify explorer of draft state change
    if existed:
        try:
            from .explorer.services.runtime_notifications import notify_draft_state_changed
            notify_draft_state_changed(expanded_project)
        except Exception:
            pass
    
    return {
        "ok": True,
        "data": {
            "cleared": existed
        }
    }


@file_editor_cm6_bp.get('/read')
def read_file(path: str = Query(...)):
    expanded, err = _expand_and_validate_path(path)
    if err or expanded is None:
        raise HTTPException(status_code=403, detail=err)
    if not os.path.isfile(expanded):
        raise HTTPException(status_code=404, detail='File not found')
    try:
        with open(expanded, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        meta = _get_file_meta(Path(expanded))
        return {"ok": True, "data": {"path": expanded, "content": content, "sha256": meta.get("sha256")}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/write')
async def write_file_route(data: JsonDict = Body(...)):
    # Edit 2025-11-17T00:13:07+00:00: This is the legacy write endpoint.
    # It was updated to capture the original file's mode before writing and
    # pass it to the `write_full` function to preserve permissions.
    path_value = data.get('path')
    content_value = data.get('content')
    path = path_value if isinstance(path_value, str) else None
    content = content_value if isinstance(content_value, str) else None
    client_id_value = data.get('client_id', 'unknown')
    client_id = client_id_value if isinstance(client_id_value, str) else 'unknown'
    op_id_value = data.get('op_id', '')
    op_id = op_id_value if isinstance(op_id_value, str) else ''
    base_sha256 = None

    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    if content is None:
        raise HTTPException(status_code=400, detail="Content is required")

    if data.get('base') and isinstance(data['base'], dict):
        base_sha256 = data['base'].get('sha256')

    project_root = get_project_root()
    try:
        rel_path = _normalize_rel_path(project_root, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    # NEW: Capture original mode before write
    target_path = project_root.joinpath(rel_path).resolve()
    orig_mode = None
    if target_path.exists() and target_path.is_file():
        try:
            orig_mode = target_path.stat().st_mode & 0o777
        except OSError:
            pass  # Proceed without mode preservation
    
    try:
        # Initialize watcher if not already running
        try:
            init_watcher(project_root)
        except Exception as e:
            await _broadcast_watcher_error(project_root, str(e))

        # NEW: Pass mode to write_full
        file_meta = await to_thread.run_sync(
            lambda: write_full(project_root, str(rel_path), content, 
                             base_sha256=base_sha256, mode=orig_mode)
        )
        
        # NEW: Purge cache entry on successful save
        project_path = _history_store.get_active_project()
        if project_path:
            _history_store.clear_cached_document(project_path, path)
            removed_clean = _history_store.prune_clean_drafts(project_path)
            if removed_clean:
                try:
                    from .explorer.services.runtime_notifications import notify_draft_state_changed
                    notify_draft_state_changed(project_path)
                except Exception:
                    pass

        # Send save acknowledgement to prevent self-echo
        push_save_ack(str(rel_path), op_id, client_id, file_meta)

        # Notify diff subscribers of change
        emit_diff_changed(str(rel_path), file_meta["sha256"])

        # Refresh caches so explorer + diff stay accurate
        mark_git_cache_dirty(project_root)
        invalidate_diff_cache(project_root, str(rel_path))

        return {
            "ok": True,
            "data": {
                "mtime": file_meta["mtime"],
                "size": file_meta["size"],
                "sha256": file_meta["sha256"]
            }
        }
    except BaseMismatchError as e:
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "BASE_MISMATCH",
            "data": {
                "current": e.current_meta
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import asyncio

async def _broadcast_watcher_error(project_root: Path | str, message: str) -> None:
    try:
        project_path = str(project_root)
        from app.apps.file_editor_cm6.explorer.transport.rpc_emit import (
            emit_project_explorer_rpc_notification,
        )
        payload: dict[str, object] = {
            "message": message,
            "limit": 524288,
            "command": "sudo sysctl -w fs.inotify.max_user_watches=524288",
        }
        await emit_project_explorer_rpc_notification(
            project_path,
            "explorer.watcher.error",
            payload,
        )
    except Exception:
        # Avoid cascading failures from watcher error notifications
        pass

@file_editor_cm6_bp.websocket('/ws/read')
async def ws_read(websocket: WebSocket):
    """WebSocket endpoint for file change notifications."""
    await websocket.accept()
    path = websocket.query_params.get('path')
    client_id = websocket.query_params.get('client_id', 'unknown')

    if not path:
        await websocket.close(reason='Missing path parameter')
        return

    project_root = get_project_root()
    try:
        rel_path = _normalize_rel_path(project_root, path)
    except ValueError:
        await websocket.close(reason='Path outside project root')
        return

    # Initialize watcher if not already running
    try:
        init_watcher(project_root)
    except Exception as e:
        await _broadcast_watcher_error(project_root, str(e))

    # Subscribe to file changes
    event_queue = asyncio.Queue()
    token = subscribe(str(rel_path), client_id, lambda event: event_queue.put_nowait(event))

    async def forward_events():
        while True:
            try:
                event = await event_queue.get()
                await websocket.send_text(json.dumps(event))
            except asyncio.CancelledError:
                print(f"[ws/read] forward_events cancelled path={path} client={client_id}", file=sys.stderr)
                break
            except Exception as e:
                print(f"[ws/read] forward_events error path={path} client={client_id} err={e}", file=sys.stderr)
                break

    forward_task = asyncio.create_task(forward_events())

    try:
        # Keep connection alive and ignore incoming messages
        async for msg in websocket.iter_text():
            pass
    except Exception as e:
        print(f"[ws/read] iter_text error path={path} client={client_id} err={e}", file=sys.stderr)
    finally:
        try:
            if websocket.client_state.value != 3:  # not DISCONNECTED
                await websocket.close()
        except Exception:
            pass
        forward_task.cancel()
        unsubscribe(token)
        print(f"[ws/read] closed path={path} client={client_id}", file=sys.stderr)

@file_editor_cm6_bp.get('/git/branches')
def git_branches():
    try:
        project_root = _get_active_project_root()
        info = git_list_branches(project_root)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/checkout')
async def git_checkout_route(data: JsonDict = Body(...)):
    name = (data.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="Branch name required")
    try:
        project_root = _get_active_project_root()
        info = git_checkout_branch(project_root, name)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/branch')
async def git_create_branch_route(data: JsonDict = Body(...)):
    name = (data.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="Branch name required")
    try:
        project_root = _get_active_project_root()
        info = git_create_branch_helper(project_root, name)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/git/status')
def git_status_route():
    try:
        project_root = _get_active_project_root()
        status = git_get_status(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.get('/git/diff_base')
def git_diff_base_route():
    project_path = _history_store.get_active_project()
    return {"ok": True, "data": _diff_base_payload(project_path)}


@file_editor_cm6_bp.post('/git/diff_base')
def git_set_diff_base_route(payload: JsonDict = Body(...)):
    project_path = _history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    ref = (payload.get('ref') or 'HEAD').strip() or 'HEAD'
    project_root = _get_active_project_root()
    if not is_git_repository(project_root):
        raise HTTPException(status_code=400, detail="Not a git repository")

    if ref != 'HEAD':
        try:
            commit = get_commit_info(project_root, ref)
        except GitError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not commit:
            raise HTTPException(status_code=400, detail="Commit not found")

    _history_store.set_diff_base(project_path, ref)
    invalidate_diff_cache(project_root)
    mark_git_cache_dirty(project_root)
    return {"ok": True, "data": _diff_base_payload(project_path)}


@file_editor_cm6_bp.post('/git/stage_all')
def git_stage_all_route():
    try:
        project_root = _get_active_project_root()
        status = git_stage_all(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/unstage_all')
def git_unstage_all_route():
    try:
        project_root = _get_active_project_root()
        status = git_unstage_all(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/commit')
async def git_commit_route(data: JsonDict = Body(...)):
    message = (data.get('message') or '').strip()
    amend = bool(data.get('amend'))
    if not message:
        raise HTTPException(status_code=400, detail="Commit message required")
    try:
        project_root = _get_active_project_root()
        status = git_commit_changes(project_root, message, amend=amend)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/push')
async def git_push_route(data: JsonDict = Body(...)):
    remote = (data.get('remote') or '').strip() or None
    branch = (data.get('branch') or '').strip() or None
    force = bool(data.get('force'))
    try:
        project_root = _get_active_project_root()
        status = git_push_changes(project_root, remote=remote, branch=branch, force=force)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/pull')
async def git_pull_route(data: JsonDict = Body(...)):
    remote = (data.get('remote') or '').strip() or None
    branch = (data.get('branch') or '').strip() or None
    rebase = bool(data.get('rebase'))
    try:
        project_root = _get_active_project_root()
        status = git_pull_changes(project_root, remote=remote, branch=branch, rebase=rebase)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.get('/debug/projects')
def debug_projects():
    """Return recent projects plus associated sidecar metadata (debugging helper)."""
    try:
        projects = _history_store.list_projects()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read recent projects: {exc}")

    active_project = _history_store.get_active_project()

    results: list[JsonDict] = []
    for entry in projects:
        project_path = entry.get("path")
        project_path_str = project_path if isinstance(project_path, str) else None
        label = entry.get("label") or HistoryStore.format_label(project_path_str)
        opened_at = entry.get("opened_at")

        sidecar_path = None
        sidecar_exists = False
        session_count = None
        last_boot_at = None
        draft_count = 0

        if project_path_str:
            try:
                sc_path = ProjectSidecar.get_sidecar_path(project_path_str)
                sidecar_path = str(sc_path)
                sidecar_exists = sc_path.exists()
                if sidecar_exists:
                    sc = ProjectSidecar.load_or_create(project_path_str)
                    session_count = sc.session_count
                    last_boot_at = sc.last_boot_at
                    draft_count = sc.get_draft_count()
            except Exception:
                # Sidecar issues should not block listing history.
                pass

        is_active = bool(
            project_path_str
            and active_project
            and str(project_path_str) == str(active_project)
        )

        results.append(
            {
                "path": project_path_str,
                "label": label,
                "opened_at": opened_at,
                "sidecar_path": sidecar_path,
                "sidecar_exists": sidecar_exists,
                "session_count": session_count,
                "last_boot_at": last_boot_at,
                "draft_count": draft_count,
                "is_active": is_active,
            }
        )

    return {"ok": True, "data": results}


@file_editor_cm6_bp.delete('/debug/projects')
def debug_delete_project(payload: JsonDict = Body(...)):
    """Delete or reset a project entry from history and its sidecar (debugging helper).

    Semantics:
    - If the project is NOT the active project:
        * Remove it from HistoryStore (projects + recent_projects).
        * Delete its sidecar file entirely.
    - If the project IS the active project:
        * Reset its per-project history (files, last_file, diff_base, origin).
        * Clear its session_cache and tracked_jobs in the sidecar and reset diff_base.
        * Keep the sidecar file and the project entry so the app still \"knows\" about it.
    """
    project_path = (payload or {}).get("path")
    if not project_path:
        raise HTTPException(status_code=400, detail="path is required")

    active_project = _history_store.get_active_project()
    is_active = bool(
        project_path
        and active_project
        and str(project_path) == str(active_project)
    )

    removed = False
    sidecar_deleted = False
    history_reset = False

    if is_active:
        # Do not remove the active project; instead reset its history + sidecar
        try:
            history_reset = _history_store.reset_project_history(project_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to reset project history: {exc}")

        try:
            sidecar = ProjectSidecar.load_or_create(project_path)
            sidecar.clear_session_cache()
            sidecar.clear_tracked_jobs()
            sidecar.set_diff_base("HEAD")
            sidecar.save()
        except Exception:
            # Sidecar failures are non-fatal for debug tooling.
            pass
    else:
        # Non-active projects are fully removed along with their sidecars.
        try:
            removed = _history_store.remove_project(project_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to remove project: {exc}")

        try:
            sc_path = ProjectSidecar.get_sidecar_path(project_path)
            if sc_path.exists():
                sc_path.unlink()
                sidecar_deleted = True
        except Exception:
            # Sidecar deletion failures are non-fatal for a debug endpoint.
            sidecar_deleted = False

    return {
        "ok": True,
        "data": {
            "removed": removed,
            "sidecar_deleted": sidecar_deleted,
            "history_reset": history_reset,
            "is_active": is_active,
        },
    }

@file_editor_cm6_bp.post('/git/stage')
async def git_stage_route(data: JsonDict = Body(...)):
    paths = data.get('paths', [])
    if not paths:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        project_root = _get_active_project_root()
        status = stage_paths(project_root, paths)
        mark_git_cache_dirty(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/git/unstage')
async def git_unstage_route(data: JsonDict = Body(...)):
    paths = data.get('paths', [])
    if not paths:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        project_root = _get_active_project_root()
        status = unstage_paths(project_root, paths)
        mark_git_cache_dirty(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/git/commits_for_path')
async def git_commits_for_path(path: str = Query(...), limit: int = Query(20)):
    try:
        project_root = _get_active_project_root()
        commits = get_commits_for_path(project_root, path, limit)
        return {"ok": True, "data": [
            {
                "hash": c.hash,
                "short_hash": c.short_hash,
                "summary": c.summary,
                "author": c.author,
                "date": c.date
            }
            for c in commits
        ]}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/git/restore')
async def git_restore_route(data: JsonDict = Body(...)):
    path = data.get('path')
    commit = data.get('commit', 'HEAD')
    if not path:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        project_root = _get_active_project_root()
        restore_path(project_root, path, commit)
        mark_git_cache_dirty(project_root)
        invalidate_diff_cache(project_root, path)
        return {"ok": True, "data": {"path": path, "commit": commit}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/git/commits')
async def git_commits():
    try:
        project_root = _get_active_project_root()
        commits = get_commits(project_root, limit=50)
        return {"ok": True, "data": [
            {
                "hash": c.hash,
                "short_hash": c.short_hash,
                "summary": c.summary,
                "author": c.author,
                "date": c.date
            }
            for c in commits
        ]}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/git/reset_hard')
async def git_reset_hard_route(data: JsonDict = Body(...)):
    commit = data.get('commit', 'HEAD')
    try:
        project_root = _get_active_project_root()
        status = reset_hard(project_root, commit)
        mark_git_cache_dirty(project_root)
        invalidate_diff_cache(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/git/is_repo')
async def git_is_repo():
    try:
        project_root = _get_active_project_root()
        is_repo = is_git_repository(project_root)
        return {"ok": True, "data": {"is_repo": is_repo}}
    except Exception as exc:
        return {"ok": True, "data": {"is_repo": False}}

@file_editor_cm6_bp.post('/git/init')
async def git_init_route():
    try:
        project_root = _get_active_project_root()
        status = init_repository(project_root)
        mark_git_cache_dirty(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    state = history.get_session_state()
    
    # If we have an active project, check/refresh its origin cache
    active_project_path = history.get_active_project()
    project_origin = None
    if active_project_path and os.path.isdir(active_project_path):
        try:
            from . import git_helper
            if git_helper.is_git_repository(Path(active_project_path)):
                project_origin = git_helper.get_origin_url(Path(active_project_path))
                history.set_project_origin(active_project_path, project_origin)
            else:
                history.set_project_origin(active_project_path, None)
        except Exception:
            pass
    else:
        project_origin = history.get_project_origin(active_project_path)

    return {
        "ok": True,
        "data": {
            "activeProject": history.get_active_project(),
            "activeProjectExists": bool(history.get_active_project() and os.path.isdir(history.get_active_project())),
            "activeProjectLabel": HistoryStore.format_label(history.get_active_project()),
            "projectOrigin": project_origin,
            "currentPath": state.get("currentPath"),
            "unsaved": state.get("unsaved"),
            "recents": history.list_files(history.get_active_project()) if history.get_active_project() else [],
            "gitDiffBase": diff_base_info,
            "editorState": state,
        }
    }

@file_editor_cm6_bp.post('/git/remote/add')
async def add_git_remote(data: JsonDict = Body(...)):
    name = data.get('name')
    url = data.get('url')
    if not name or not url:
        raise HTTPException(status_code=400, detail="Name and URL required")
    
    root = get_project_root()
    try:
        from . import git_helper
        git_helper.add_remote(root, name, url)
        
        # Refresh cache
        history = _history_store
        origin = git_helper.get_origin_url(root)
        history.set_project_origin(str(root), origin)
        
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.get('/state')
async def get_editor_state_deprecated():
    """
    Combined state endpoint for the frontend (files + project + git base).
    Now also returns 'projectOrigin'.
    """
    history = _history_store
    payload = _build_state_payload()

    active_project = history.get_active_project()

    # If we have an active project, check/refresh its origin cache
    project_origin = None
    if active_project and os.path.isdir(active_project):
        try:
            from . import git_helper
            if git_helper.is_git_repository(Path(active_project)):
                project_origin = git_helper.get_origin_url(Path(active_project))
                history.set_project_origin(active_project, project_origin)
            else:
                history.set_project_origin(active_project, None)
        except Exception:
            pass
    else:
        project_origin = history.get_project_origin(active_project)

    session_state = history.get_session_state()
    payload.update({
        "projectOrigin": project_origin,
        "currentPath": session_state.get("currentPath"),
        "unsaved": session_state.get("unsaved"),
        "editorState": session_state,
    })

    return {"ok": True, "data": payload}

@file_editor_cm6_bp.get('/session_state')
def get_session_state():
    """Return last-known editor session telemetry."""
    state = _history_store.get_session_state()
    return {"ok": True, "data": state}

@file_editor_cm6_bp.post('/session_state')
def update_session_state(payload: JsonDict = Body(...)):
    """Persist lightweight session telemetry for crash/reconnect recovery."""
    state = _history_store.update_session_state(payload or {})
    return {"ok": True, "data": state}


@file_editor_cm6_bp.get('/preferences')
def get_preferences():
    """Return persisted editor/UI preferences."""
    project_path = _history_store.get_active_project()
    prefs = _preferences_store.get_preferences(project_path)
    return {"ok": True, "data": prefs}


@file_editor_cm6_bp.post('/preferences')
async def update_preferences(payload: JsonDict = Body(...)):
    """Persist editor/UI preference changes."""
    editor = payload.get('editor')
    ui = payload.get('ui')
    project = payload.get('project')

    active_project = _history_store.get_active_project()
    if project is None and active_project:
        project = {"path": active_project}
    elif project and not project.get('path') and active_project:
        project['path'] = active_project

    try:
        print(f"[PREFERENCES] Incoming preferences payload={payload}", file=sys.stderr)
        updated = _preferences_store.update_preferences(
            editor=editor,
            ui=ui,
            project=project,
        )
        # Return a fresh snapshot for convenience
        snapshot = _preferences_store.get_preferences(active_project)
        return {"ok": True, "data": snapshot, "updated": updated}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/state/file_activity')
async def record_file_activity(data: JsonDict = Body(...)):
    """Persist last-opened file and recents for the active project."""
    path = data.get('path')
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    project_path = data.get('project') or _history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    scroll_line = data.get('scroll_line') or data.get('scrollLine')
    if scroll_line is not None:
        try:
            scroll_line = float(scroll_line)
        except (TypeError, ValueError):
            scroll_line = None

    try:
        project_root_path = Path(project_path).expanduser().resolve()
        candidate_path = Path(path).expanduser().resolve()
        if not str(candidate_path).startswith(str(project_root_path)):
            raise HTTPException(status_code=400, detail="File is outside the project root")

        entry = _history_store.record_file_activity(project_path, str(candidate_path), scroll_line=scroll_line)
        state = _build_state_payload()
        return {"ok": True, "data": {"entry": entry, "state": state}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.post('/state/file_scroll')
async def update_file_scroll(data: JsonDict = Body(...)):
    """Update just the scroll position for a file (debounced from frontend)."""
    path = data.get('path')
    scroll_line = data.get('scroll_line') or data.get('scrollLine')
    
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    if scroll_line is None:
        raise HTTPException(status_code=400, detail="scroll_line is required")

    try:
        scroll_line = float(scroll_line)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="scroll_line must be a number")

    project_path = data.get('project') or _history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    try:
        updated = _history_store.update_file_scroll_line(project_path, path, scroll_line)
        return {"ok": True, "data": {"updated": updated}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.get('/diff')
def get_diff(path: str = Query(...)):
    """Return git diff hunks for the requested file."""
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    project_path = _history_store.get_active_project() or str(get_project_root())
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    project_root = Path(project_path).expanduser()
    if not project_root.exists():
        raise HTTPException(status_code=404, detail="Project directory not available")

    try:
        rel = _normalize_rel_path(project_root, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    base_ref = _resolve_diff_base(project_path)
    payload = collect_diff(project_root, rel, base_ref=base_ref)
    return {"ok": True, "data": payload}

@file_editor_cm6_bp.get('/explorer/list')
def explorer_list(rel: str = Query('.')):
    """List directory contents for the file explorer."""
    try:
        return {"ok": True, "data": list_dir(rel)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/explorer/search')
async def explorer_search(data: JsonDict = Body(...)):
    """Search files by name or content within project."""
    mode = data.get('mode', 'name')
    query = (data.get('query') or '').strip()
    
    # Get project root
    project_root = _history_store.get_active_project()
    if not project_root or not Path(project_root).exists():
        raise HTTPException(status_code=400, detail="No project open")
    root_path = Path(project_root)

    if mode in ('name', 'content'):
        if not query:
            raise HTTPException(status_code=400, detail="Query required")
        if len(query) < 2:
            raise HTTPException(status_code=400, detail="Query too short (min 2 chars)")
        if len(query) > 200:
            raise HTTPException(status_code=400, detail="Query too long (max 200 chars)")
    
    try:
        if mode == 'name':
            results = await _search_by_name(root_path, query)
        elif mode == 'content':
            results = await _search_by_content(root_path, query)
        elif mode == 'changes':
            results = _search_by_changes(root_path)
        else:
            raise HTTPException(status_code=400, detail="Invalid mode")
        
        return {"ok": True, "data": results}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Search timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.get('/review/list')
async def review_list(lightweight: bool = Query(False)):
    """
    Get list of files with unsaved drafts.
    If lightweight=True, skips diff computation and returns only metadata.
    """
    project_root = _history_store.get_active_project()
    if not project_root or not Path(project_root).exists():
        return {"ok": True, "data": []}
    
    root_path = Path(project_root)
    results: list[JsonDict] = []
    
    try:
        drafts = _history_store.list_project_drafts(project_root)
        for draft in drafts:
            # draft entry contains 'file_path' (abs)
            file_path_value = draft.get('file_path')
            if not isinstance(file_path_value, str) or not file_path_value:
                continue
            abs_path = Path(file_path_value)
            try:
                rel_path = str(abs_path.relative_to(root_path))
            except ValueError:
                continue # Skip files outside project
            
            hunks = []
            if not lightweight:
                # Compute diff
                try:
                    draft_content_value = draft.get('content', '')
                    draft_content = draft_content_value if isinstance(draft_content_value, str) else ''
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
        
    return {"ok": True, "data": results}

@file_editor_cm6_bp.post('/review/save')
async def review_save(data: JsonDict = Body(...)):
    """Save selected files from drafts to disk with full lifecycle notifications."""
    files = data.get('files', [])
    if not files:
        return {"ok": True, "saved_count": 0}
        
    project_root = _history_store.get_active_project()
    if not project_root:
        raise HTTPException(status_code=400, detail="No active project")
    
    root_path = Path(project_root)
    saved_count = 0
    errors = []
    
    # Init watcher once
    try:
        init_watcher(root_path)
    except Exception as e:
        await _broadcast_watcher_error(root_path, str(e))
    
    import time # Ensure time is available
    
    for rel_path in files:
        try:
            abs_path = root_path / rel_path
            # Get draft content
            cached = _history_store.get_cached_document(project_root, str(abs_path))
            if not cached:
                continue
                
            content_value = cached.get('content', '')
            content = content_value if isinstance(content_value, str) else ''
            base_sha_value = cached.get('base_sha256')
            base_sha = base_sha_value if isinstance(base_sha_value, str) else None
            
            # Check original mode
            orig_mode = None
            if abs_path.exists():
                try:
                    orig_mode = abs_path.stat().st_mode & 0o777
                except OSError:
                    pass
            
            # Write to disk
            await to_thread.run_sync(
                lambda: write_full(root_path, rel_path, content, 
                                 base_sha256=base_sha, mode=orig_mode)
            )
            
            # Lifecycle notifications
            file_meta = _get_file_meta(abs_path)
            op_id = f"review_save_{int(time.time())}"
            push_save_ack(str(rel_path), op_id, "review_panel", file_meta)
            emit_diff_changed(str(rel_path), file_meta["sha256"])
            invalidate_diff_cache(root_path, str(rel_path))
            
            # Clear draft
            _history_store.clear_cached_document(project_root, str(abs_path))
            saved_count += 1
            
        except Exception as e:
            errors.append(f"{rel_path}: {str(e)}")
            
    _history_store.prune_clean_drafts(project_root)

    # Refresh git status cache and draft cache
    mark_git_cache_dirty(root_path)
    from .explorer.services.file_ops import mark_draft_cache_dirty
    mark_draft_cache_dirty(root_path)
    
    # Notify explorer of draft state change
    try:
        from .explorer.services.runtime_notifications import notify_draft_state_changed
        notify_draft_state_changed(project_root)
    except Exception:
        pass
    
    return {"ok": True, "saved_count": saved_count, "errors": errors}

@file_editor_cm6_bp.post('/review/discard')
async def review_discard(data: JsonDict = Body(...)):
    """Discard drafts for selected files."""
    files = data.get('files', [])
    if not files:
        return {"ok": True, "discarded_count": 0}
        
    project_root = _history_store.get_active_project()
    if not project_root:
        raise HTTPException(status_code=400, detail="No active project")
        
    root_path = Path(project_root)
    discarded_count = 0
    
    for rel_path in files:
        abs_path = root_path / rel_path
        if _history_store.clear_cached_document(project_root, str(abs_path)):
            discarded_count += 1
            handle_external_discard(project_root, str(abs_path))
    
    # Invalidate draft cache
    from .explorer.services.file_ops import mark_draft_cache_dirty
    mark_draft_cache_dirty(root_path)
    
    # Notify explorer of draft state change
    try:
        from .explorer.services.runtime_notifications import notify_draft_state_changed
        notify_draft_state_changed(project_root)
    except Exception:
        pass
            
    return {"ok": True, "discarded_count": discarded_count}

@file_editor_cm6_bp.post('/explorer/mkdir')
async def explorer_mkdir(data: JsonDict = Body(...)):
    project = data.get('project')
    parent_rel = data.get('parent_rel', '.')
    name = data.get('name', '').strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    
    try:
        from .explorer.services.file_ops import create_directory
        result = create_directory(parent_rel, name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/touch')
async def explorer_touch(data: JsonDict = Body(...)):
    project = data.get('project')
    parent_rel = data.get('parent_rel', '.')
    name = data.get('name', '').strip()
      
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="Invalid name")
      
    try:
        from .explorer.services.file_ops import create_file
        result = create_file(parent_rel, name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/rename')
async def explorer_rename(data: JsonDict = Body(...)):
    rel = data.get('rel')
    new_name = data.get('new_name', '').strip()
    
    if not rel:
        raise HTTPException(status_code=400, detail="Path required")
    if not new_name:
        raise HTTPException(status_code=400, detail="New name required")
    if '/' in new_name or '\\' in new_name:
        raise HTTPException(status_code=400, detail="Invalid name")
    
    try:
        from .explorer.services.file_ops import rename_entry
        result = rename_entry(rel, new_name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/delete')
async def explorer_delete(data: JsonDict = Body(...)):
    rel = data.get('rel')
    if not rel:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer.services.file_ops import delete_entry
        result = delete_entry(rel)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_delete')
async def explorer_batch_delete(data: JsonDict = Body(...)):
    rels = data.get('rels', [])
    if not rels:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        from .explorer.services.file_ops import batch_delete
        result = batch_delete(rels)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/copy')
async def explorer_copy(data: JsonDict = Body(...)):
    rel = data.get('rel')
    dest_path = data.get('dest_path')
    if not rel or not dest_path:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer.services.file_ops import copy_entry
        result = copy_entry(rel, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/move')
async def explorer_move(data: JsonDict = Body(...)):
    rel = data.get('rel')
    dest_path = data.get('dest_path')
    if not rel or not dest_path:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer.services.file_ops import move_entry
        result = move_entry(rel, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_copy')
async def explorer_batch_copy(data: JsonDict = Body(...)):
    rels = data.get('rels', [])
    dest_path = data.get('dest_path')
    if not rels or not dest_path:
        raise HTTPException(status_code=400, detail="Paths and destination required")
    try:
        from .explorer.services.file_ops import batch_copy
        result = batch_copy(rels, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_move')
async def explorer_batch_move(data: JsonDict = Body(...)):
    rels = data.get('rels', [])
    dest_path = data.get('dest_path')
    if not rels or not dest_path:
        raise HTTPException(status_code=400, detail="Paths and destination required")
    try:
        from .explorer.services.file_ops import batch_move
        result = batch_move(rels, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/copy_from')
async def explorer_copy_from(data: JsonDict = Body(...)):
    """Import (copy) a file/folder from an absolute path into the project."""
    source_path = data.get('source_path')
    dest_rel = data.get('dest_rel')
    if not source_path or not dest_rel:
        raise HTTPException(status_code=400, detail="Source path and destination relative path required")
    try:
        from .explorer.services.file_ops import copy_entry_inbound
        result = copy_entry_inbound(source_path, dest_rel)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/move_from')
async def explorer_move_from(data: JsonDict = Body(...)):
    """Import (move) a file/folder from an absolute path into the project."""
    source_path = data.get('source_path')
    dest_rel = data.get('dest_rel')
    if not source_path or not dest_rel:
        raise HTTPException(status_code=400, detail="Source path and destination relative path required")
    try:
        from .explorer.services.file_ops import move_entry_inbound
        result = move_entry_inbound(source_path, dest_rel)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.get('/history/files')
def get_recent_files():
    """Get recent files for the current project."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        files_raw = _history_store.list_files(str(project_root))
        files: list[JsonDict] = []
        for entry in files_raw:
            entry_path = entry.get("path")
            entry_path_str = entry_path if isinstance(entry_path, str) else None
            files.append({
                **entry,
                "exists": bool(entry_path_str and Path(entry_path_str).is_file()),
            })
        return {"ok": True, "data": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.get('/history/raw')
def get_history_raw():
    """Return raw HistoryStore state (debug)."""
    try:
        return {"ok": True, "data": _history_store.dump_raw()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.get('/project/sidecar/raw')
def get_project_sidecar_raw():
    """Return raw ProjectSidecar state for the active project (debug)."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        return {"ok": True, "data": sidecar.dump_raw()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.get('/debug/state/raw')
def get_debug_state_raw():
    """Return raw history + raw sidecar for the active project (debug)."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        return {
            "ok": True,
            "data": {
                "history": _history_store.dump_raw(),
                "sidecar": sidecar.dump_raw(),
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/history/touch')
async def touch_file_history(data: JsonDict = Body(...)):
    """Add a file to the recent files list."""
    path_value = data.get('path')
    path = path_value if isinstance(path_value, str) else None
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        entry = _history_store.record_file_activity(str(project_root), path)
        return {"ok": True, "data": entry}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.delete('/history/file')
def remove_file_history(path: str = Query(...)):
    """Remove a file from the recent files list."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        removed = _history_store.remove_file(str(project_root), path)
        return {"ok": True, "data": {"removed": removed}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.delete('/history/files/all')
def clear_all_file_history():
    """Clear all recent files for the active project."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        cleared = _history_store.clear_all_files(str(project_root))
        return {"ok": True, "data": {"cleared": cleared}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.get('/edit_tracker/status')
def get_edit_tracker_status():
    """Get current edit tracker status."""
    try:
        status = edit_tracker.get_tracking_status()
        return {"ok": True, "data": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.websocket('/ws/edit_tracker')
async def edit_tracker_ws(websocket: WebSocket):
    """WebSocket endpoint for edit tracking events."""
    await websocket.accept()
    
    event_queue = asyncio.Queue()
    
    def queue_callback(event):
        try:
            event_queue.put_nowait(event)
        except Exception:
            pass
    
    token = edit_tracker.subscribe(queue_callback)
    
    async def forward_events_to_ws():
        """Forward edit tracker events to WebSocket"""
        while True:
            try:
                event = await event_queue.get()
                await websocket.send_text(json.dumps(event))
            except asyncio.CancelledError:
                break
            except Exception:
                break
    
    forward_task = asyncio.create_task(forward_events_to_ws())
    
    try:
        # Keep connection alive (receive ping/pong)
        async for msg in websocket.iter_text():
            pass
    finally:
        # Clean up
        forward_task.cancel()
        try:
            edit_tracker.unsubscribe(token)
        except Exception:
            pass

# =============================================================================
# Debug Console WebSocket
# =============================================================================
_debug_log_path = Path(os.path.expanduser('~/.tmp/browser_console.log'))

@file_editor_cm6_bp.websocket('/ws/debug_console')
async def debug_console_ws(websocket: WebSocket):
    """WebSocket endpoint for browser console log forwarding. Writes to ~/.tmp/browser_console.log."""
    await websocket.accept()
    # Ensure directory exists
    _debug_log_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        async for msg in websocket.iter_text():
            try:
                # Append to log file silently
                with open(_debug_log_path, 'a') as f:
                    f.write(msg + '\n')
            except Exception:
                pass  # Stay silent
    except Exception:
        pass  # Stay silent on disconnect too

@file_editor_cm6_bp.post('/editor/update_diffs')
async def update_diffs(data: JsonDict = Body(...)):
    """Update diff hunks in editor state - for testing inline diffs"""
