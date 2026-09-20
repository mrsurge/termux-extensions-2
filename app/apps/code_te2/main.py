# /data/data/com.termux/files/home/mrselect/app/apps/code_te2/main.py

import sys
import os
import json
import faulthandler
import threading
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast
from urllib import request as urllib_request
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query
from fastapi.responses import FileResponse
import asyncio
from .history_store import HistoryStore
from .explorer.services.file_ops import (
    _normalize_rel_path as _file_ops_normalize_rel_path,
    get_project_root,
    set_project_root,
)
from .code_server_runtime_hooks import set_code_server_runtime_primer
from . import edit_tracker
from .diff_helper import invalidate_diff_cache
from .worker_services import git_service as worker_git_service
from .core_read import subscribe, unsubscribe
from .core_write import FileMeta
from .project_sidecar import ProjectSidecar, cleanup_orphaned_sidecars
from .code_te2_paths import code_te2_paths
from .main_page.backend.state_payload import (
    StatePayloadDeps,
    build_state_payload,
    expand_and_validate_path,
    get_runtime_metadata,
    resolve_diff_base,
)
from .stores import get_history_store, get_preferences_store

IGNORE_PATTERNS = [
    '.git', '__pycache__', 'node_modules', '.venv', 'venv',
    '.pytest_cache', '.mypy_cache', '.tox', 'dist', 'build',
    '*.egg-info', '.DS_Store'
]

_CODE_TE2_PATHS = code_te2_paths()
AGENT_ICON_DIR = _CODE_TE2_PATHS.agent_icons_dir
JsonDict = dict[str, object]
APP_ID = str(os.environ.get("TE_APP_ID") or "code_te2").strip() or "code_te2"

if TYPE_CHECKING:
    from app.libs.pipe_protocol import PipeEnvelope


def _json_object(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _json_list(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def _str_value(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def te2_pipe_dispatch(envelope: "PipeEnvelope") -> JsonDict | None:
    del envelope
    return None


class ReadableResponse(Protocol):
    def read(self) -> bytes: ...

    def close(self) -> None: ...


class NormalizeRelPathFn(Protocol):
    def __call__(self, project_root: Path, raw_path: str) -> str: ...


class CollectDiffFn(Protocol):
    def __call__(self, project_root: Path, rel_path: str, *, base_ref: str | None = None) -> object: ...


class ComputeDraftDiffFn(Protocol):
    def __call__(self, file_path: str, draft_content: str, disk_content: str) -> object: ...


class EditTrackerSubscribeFn(Protocol):
    def __call__(self, callback: Callable[[JsonDict], None]) -> str: ...


class EditTrackerStatusFn(Protocol):
    def __call__(self) -> object: ...


def _normalize_rel_path(project_root: Path, raw_path: str) -> str:
    fn = cast(NormalizeRelPathFn, cast(object, _file_ops_normalize_rel_path))
    return fn(project_root, raw_path)


def _get_file_meta(path: Path) -> FileMeta:
    from . import core_write as _core_write

    fn = cast(Callable[[Path], FileMeta], cast(object, getattr(_core_write, "_get_file_meta")))
    return fn(path)


def _collect_diff(project_root: Path, rel_path: str, *, base_ref: str | None = None) -> JsonDict:
    from . import diff_helper as _diff_helper

    fn = cast(CollectDiffFn, cast(object, getattr(_diff_helper, "collect_diff")))
    return _json_object(fn(project_root, rel_path, base_ref=base_ref))


def _compute_draft_diff(file_path: str, draft_content: str, disk_content: str) -> JsonDict:
    from . import draft_diff_helper as _draft_diff_helper

    fn = cast(ComputeDraftDiffFn, cast(object, getattr(_draft_diff_helper, "compute_draft_diff")))
    return _json_object(fn(file_path, draft_content, disk_content))


def _edit_tracker_status() -> JsonDict:
    fn = cast(EditTrackerStatusFn, cast(object, getattr(edit_tracker, "get_tracking_status")))
    return _json_object(fn())


def _edit_tracker_subscribe(callback: Callable[[JsonDict], None]) -> str:
    fn = cast(EditTrackerSubscribeFn, cast(object, getattr(edit_tracker, "subscribe")))
    return fn(callback)


def _install_crash_diagnostics() -> None:
    try:
        faulthandler.enable(file=sys.stderr, all_threads=True)
    except Exception as exc:
        print(f"[code_te2][crash_diag] faulthandler enable failed: {exc!r}", file=sys.stderr, flush=True)

    def _thread_excepthook(args: threading.ExceptHookArgs) -> None:
        try:
            print(
                f"[code_te2][crash_diag] unhandled thread exception "
                f"thread={getattr(args.thread, 'name', None)} exc={args.exc_type.__name__}: {args.exc_value}",
                file=sys.stderr,
                flush=True,
            )
            traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback, file=sys.stderr)
        except Exception:
            pass

    threading.excepthook = _thread_excepthook


def _install_loop_exception_handler() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    previous_handler = loop.get_exception_handler()

    def _handle_loop_exception(loop: asyncio.AbstractEventLoop, context: dict[str, object]) -> None:
        try:
            message = context.get("message")
            exception = context.get("exception")
            task = context.get("task") or context.get("future")
            print(
                f"[code_te2][crash_diag] asyncio exception message={message!r} "
                f"task={task!r} exception={exception!r}",
                file=sys.stderr,
                flush=True,
            )
            if isinstance(exception, BaseException):
                traceback.print_exception(type(exception), exception, exception.__traceback__, file=sys.stderr)
        except Exception:
            pass
        if previous_handler is not None:
            previous_handler(loop, context)
        else:
            loop.default_exception_handler(context)

    loop.set_exception_handler(_handle_loop_exception)


_install_crash_diagnostics()


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_serving_readiness() -> None:
    body = {
        "app_id": APP_ID,
        "status": "ready",
        "phase": "serving",
        "source": "code_te2_backend",
    }
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = cast(ReadableResponse, urllib_request.urlopen(req, timeout=5))
    try:
        resp.read()
    finally:
        resp.close()


async def te2_app_backend_serving() -> None:
    try:
        await asyncio.to_thread(_post_serving_readiness)
    except Exception as exc:
        print(f"[code_te2] readiness post failed: {exc}", flush=True)

code_te2_bp = APIRouter()
TE2_APP_ROUTER = code_te2_bp
# sock = Sock()

# # Register terminal routes and WebSocket handler
# register_terminal_routes(code_te2_bp, sock)

# Serve static files (JS, CSS, etc.)
@code_te2_bp.get("/static/{file_path:path}")
async def serve_static(file_path: str):
    """Serve static files from the app's static directory"""
    static_dir = Path(__file__).parent / "static"
    file = static_dir / file_path
    if not file.exists() or not file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file)

@code_te2_bp.get("/agent_icons/{name}")
async def serve_agent_icon(name: str):
    safe = Path(name).name
    if not safe or safe != name:
        raise HTTPException(status_code=400, detail="Invalid icon name")
    file = (AGENT_ICON_DIR / safe)
    if not file.exists() or not file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file)

# Resource HTTP is separate from editor state/control, which uses socket RPC.
from .monaco_editor.editor_asset_routes import register_monaco_editor_routes
register_monaco_editor_routes(code_te2_bp, "/ui")

# --- Code TE2 Socket.IO (worker-owned) ---
# The main framework process still proxies the current physical paths to this
# one worker endpoint. Logical namespaces stay owned by their existing handlers.
from app.apps.code_te2.socketio_gateway import CODE_TE2_ASGI_APP

SUBAPPS = [
    ("/socket.io", CODE_TE2_ASGI_APP),
    ("/editor_ws/socket.io", CODE_TE2_ASGI_APP),
    ("/explorer_ws/socket.io", CODE_TE2_ASGI_APP),
    ("/ui_ipc_ws/socket.io", CODE_TE2_ASGI_APP),
    ("/terminal_ws/socket.io", CODE_TE2_ASGI_APP),
]

_history_store = get_history_store()
_preferences_store = get_preferences_store()

_STATE_PAYLOAD_DEPS = StatePayloadDeps(
    history=_history_store,
    preferences=_preferences_store,
    set_project_root=set_project_root,
    is_git_repository=worker_git_service.is_git_repository,
    get_commit_info=worker_git_service.get_commit_info,
    format_label=HistoryStore.format_label,
)


# Worker lifecycle and boot-snapshot RPC share this primer. WBA startup/control
# does not use an HTTP discovery, launch or command-proxy route.
async def _prime_code_server_runtime(project_root: str) -> None:
    from .intelligence_startup import prime_intelligence_runtime

    await prime_intelligence_runtime(project_root)


set_code_server_runtime_primer(_prime_code_server_runtime)


from .boot_snapshot_backend import configure_boot_snapshot_dependencies
from .monaco_editor.editor_ws import editor_runtime_build_connect_snapshot
from .watchexec_shell_manager import is_watchexec_available

configure_boot_snapshot_dependencies(
    editor_snapshot_builder=editor_runtime_build_connect_snapshot,
    watcher_availability=is_watchexec_available,
)


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

def _initialize_application_project() -> None:
    # Project/session mutation belongs to application startup, not route imports.
    try:
        project_root = _ensure_project_root_synced()
        edit_tracker.set_project_root(project_root)
    except Exception:
        pass
    try:
        cleanup_orphaned_sidecars()
    except Exception:
        pass
    try:
        _ = initialize_project_session()
    except Exception:
        pass


def _ensure_workbench_json_sync(project_root_str: str) -> None:
    """Sync code-server User/settings.json watcher exclusion at boot."""
    try:
        from .project_sidecar import ProjectSidecar
        from .code_server_shell_manager import sync_vscode_watcher_settings
        sc = ProjectSidecar.load_or_create(project_root_str)
        watcher = _json_object(sc.dump_raw().get("watcher"))
        wmode = _str_value(watcher.get("mode"), "ipc")
        sync_vscode_watcher_settings(wmode)
    except Exception as exc:
        print(f"[code_te2] workbench json sync failed (non-fatal): {exc}", flush=True)


async def _eager_start_code_server() -> None:
    """Prepare the complete intelligence runtime without waiting for a browser.

    The worker loop/pipe must exist first. Import-time spawning would bypass
    lifecycle ownership, preferences and the settings preparation below.
    """
    try:
        ui_prefs = _json_object(_preferences_store.get_preferences().get("ui"))
        if ui_prefs.get("webWorkersEnabled") is True:
            print(
                "[code_te2] eager code-server startup skipped: Monaco web-worker mode is active",
                flush=True,
            )
            return
        pr = _history_store.get_active_project() or str(get_project_root())
        if not pr:
            return
        # Sync watcher settings BEFORE code-server launches
        await asyncio.to_thread(_ensure_workbench_json_sync, pr)
        await _prime_code_server_runtime(pr)
        print(f"[code_te2] eager intelligence startup OK (project={pr})", flush=True)
    except Exception as exc:
        print(f"[code_te2] eager intelligence startup failed: {exc}", flush=True)


async def te2_app_start() -> None:
    _install_loop_exception_handler()
    from .worker_services.runtime import start_worker_runtime

    await start_worker_runtime(_initialize_application_project, _eager_start_code_server)


async def te2_app_stop() -> None:
    from .worker_services.runtime import stop_worker_runtime

    await stop_worker_runtime()


def _resolve_diff_base(project_path: str | None) -> str:
    return resolve_diff_base(_STATE_PAYLOAD_DEPS, project_path)


def _get_runtime_metadata() -> JsonDict:
    return get_runtime_metadata()

def _build_state_payload() -> JsonDict:
    return build_state_payload(_STATE_PAYLOAD_DEPS)

def _expand_and_validate_path(path: str) -> tuple[str | None, str | None]:
    return expand_and_validate_path(path)


# Git/project intents are owned by host/Explorer/Sidebar RPC services.
# Do not reintroduce parallel HTTP mutation paths that bypass those guards.
@code_te2_bp.get('/')
def status_root():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}

@code_te2_bp.get('/status')
def status():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}


@code_te2_bp.get('/read')
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

@code_te2_bp.websocket('/ws/read')
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

    # Subscribe to file changes
    event_queue: asyncio.Queue[JsonDict] = asyncio.Queue()
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
        async for _msg in websocket.iter_text():
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

@code_te2_bp.get('/state')
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
            if worker_git_service.is_git_repository(Path(active_project)):
                project_origin = worker_git_service.get_origin_url(Path(active_project))
                history.set_project_origin(active_project, project_origin)
            else:
                history.set_project_origin(active_project, None)
        except Exception:
            pass
    else:
        project_origin = history.get_project_origin(active_project)

    session_state = history.get_session_state()
    open_file = payload.get("lastFile")
    payload.update({
        "projectOrigin": project_origin,
        "currentPath": open_file if isinstance(open_file, str) else None,
        "unsaved": session_state.get("unsaved"),
        "editorState": session_state,
    })

    return {"ok": True, "data": payload}

@code_te2_bp.get('/diff')
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
    payload = _collect_diff(project_root, rel, base_ref=base_ref)
    return {"ok": True, "data": payload}

@code_te2_bp.get('/review/list')
async def review_list(lightweight: bool = Query(False)) -> JsonDict:
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
            
            hunks: list[object] = []
            if not lightweight:
                # Compute diff
                try:
                    draft_content_value = draft.get('content', '')
                    draft_content = draft_content_value if isinstance(draft_content_value, str) else ''
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
        
    return {"ok": True, "data": results}

@code_te2_bp.get('/edit_tracker/status')
def get_edit_tracker_status():
    """Get current edit tracker status."""
    try:
        status = _edit_tracker_status()
        return {"ok": True, "data": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@code_te2_bp.websocket('/ws/edit_tracker')
async def edit_tracker_ws(websocket: WebSocket):
    """WebSocket endpoint for edit tracking events."""
    await websocket.accept()
    
    event_queue: asyncio.Queue[JsonDict] = asyncio.Queue()
    
    def queue_callback(event: JsonDict) -> None:
        try:
            event_queue.put_nowait(event)
        except Exception:
            pass
    
    token = _edit_tracker_subscribe(queue_callback)
    
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
        async for _msg in websocket.iter_text():
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
_debug_log_path = _CODE_TE2_PATHS.browser_console_log_path

@code_te2_bp.websocket('/ws/debug_console')
async def debug_console_ws(websocket: WebSocket):
    """WebSocket endpoint for browser console log forwarding."""
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

@code_te2_bp.post('/editor/update_diffs')
async def update_diffs(data: JsonDict = Body(...)):
    """Update diff hunks in editor state - for testing inline diffs"""
