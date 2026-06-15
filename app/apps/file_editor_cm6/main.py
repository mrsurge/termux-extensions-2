# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.py

import sys
import os
import json
import time
import faulthandler
import threading
import traceback
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Protocol, cast
from urllib import request as urllib_request
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query
from fastapi.responses import JSONResponse, FileResponse
import asyncio
from anyio import to_thread
from .history_store import HistoryStore
from .explorer.services import file_ops as _file_ops
from .explorer.services.file_ops import get_project_root, set_project_root, mark_git_cache_dirty, list_dir
from .code_server_shell_manager import ensure_code_server_shell
from .git_helper import (
    GitError,
    is_git_repository,
    get_commit_info,
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
    init_repository,
    add_remote as git_add_remote,
    get_origin_url as git_get_origin_url,
)
from . import edit_tracker
from .diff_helper import invalidate_diff_cache
from .core_read import push_save_ack, emit_diff_changed, subscribe, unsubscribe
from .core_write import FileMeta, write_full, BaseMismatchError
from .project_sidecar import ProjectSidecar, cleanup_orphaned_sidecars
from .explorer import search as explorer_search_module
from .explorer.search import SearchContentOptionsParams
from .main_page.backend.state_payload import (
    StatePayloadDeps,
    build_diff_base_payload,
    build_state_payload,
    expand_and_validate_path,
    get_runtime_metadata,
    resolve_diff_base,
    status_to_payload,
)
from .main_page.backend.workbench_routes import (
    CodeServerConnectionTargetFn,
    EnsureCodeServerShellFn,
    EnsureWorkbenchAdapterShellFn,
    HistoryStoreLike as WorkbenchHistoryStoreLike,
    ShellRecordLike,
    WorkbenchRoutesDeps,
    create_workbench_router,
)
from .main_page.backend.project_routes import ProjectRoutesDeps, create_project_router
from .main_page.backend.git_routes import GitRoutesDeps, create_git_router
from .main_page.backend.history_routes import HistoryRoutesDeps, create_history_router
from .stores import get_history_store, get_preferences_store

IGNORE_PATTERNS = [
    '.git', '__pycache__', 'node_modules', '.venv', 'venv',
    '.pytest_cache', '.mypy_cache', '.tox', 'dist', 'build',
    '*.egg-info', '.DS_Store'
]

AGENT_ICON_DIR = Path.home() / ".local" / "share" / "termux-extensions-2" / "agent_icons"
JsonDict = dict[str, object]
APP_ID = str(os.environ.get("TE_APP_ID") or "file_editor_cm6").strip() or "file_editor_cm6"


def _json_object(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _json_list(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def _str_value(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _str_list(value: object) -> list[str]:
    return [item for item in _json_list(value) if isinstance(item, str)]


def _file_meta_json(meta: dict[str, str | int | None]) -> JsonDict:
    return {key: value for key, value in meta.items()}


def _meta_sha256(meta: dict[str, str | int | None]) -> str:
    value = meta.get("sha256")
    return value if isinstance(value, str) else ""


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
    fn = cast(NormalizeRelPathFn, cast(object, getattr(_file_ops, "_normalize_rel_path")))
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
        print(f"[file_editor_cm6][crash_diag] faulthandler enable failed: {exc!r}", file=sys.stderr, flush=True)

    def _thread_excepthook(args: threading.ExceptHookArgs) -> None:
        try:
            print(
                f"[file_editor_cm6][crash_diag] unhandled thread exception "
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
                f"[file_editor_cm6][crash_diag] asyncio exception message={message!r} "
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
        "source": "file_editor_cm6_backend",
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
        print(f"[file_editor_cm6] readiness post failed: {exc}", flush=True)

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
file_editor_cm6_bp.include_router(editor_router)
_register_monaco_editor_routes = cast(
    Callable[[APIRouter, str], None],
    cast(object, import_module("app.apps.file_editor_cm6.monaco_editor").__dict__["register_monaco_editor_routes"]),
)
_register_monaco_editor_routes(file_editor_cm6_bp, "/ui")

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

_history_store = get_history_store()
_preferences_store = get_preferences_store()

_STATE_PAYLOAD_DEPS = StatePayloadDeps(
    history=_history_store,
    preferences=_preferences_store,
    set_project_root=set_project_root,
    is_git_repository=is_git_repository,
    get_commit_info=get_commit_info,
    format_label=HistoryStore.format_label,
)


async def _get_framework_shell_by_id(shell_id: str) -> ShellRecordLike | None:
    from .workbench_adapter_shell_manager import get_shell_record

    return cast(ShellRecordLike | None, await get_shell_record(shell_id))


async def _ensure_workbench_adapter_shell_for_routes(
    project_root: str,
    *,
    code_server_http: str,
    code_server_socket_path: str | None,
)-> ShellRecordLike:
    from .workbench_adapter_shell_manager import ensure_workbench_adapter_shell

    return cast(ShellRecordLike, await ensure_workbench_adapter_shell(
        project_root,
        code_server_http=code_server_http,
        code_server_socket_path=code_server_socket_path,
    ))


def _code_server_connection_target_for_routes(record: ShellRecordLike) -> tuple[str, str | None]:
    from .code_server_shell_manager import ShellRecord as CodeServerShellRecord
    from .code_server_shell_manager import code_server_connection_target

    return code_server_connection_target(cast(CodeServerShellRecord, record))


async def _nudge_diagnostics_for_file_for_routes(path: str) -> bool:
    from .diagnostics_bridge import nudge_diagnostics_for_file

    return await nudge_diagnostics_for_file(path)


_WORKBENCH_ROUTES_DEPS = WorkbenchRoutesDeps(
    history=cast(WorkbenchHistoryStoreLike, _history_store),
    get_project_root=get_project_root,
    ensure_code_server_shell=cast(EnsureCodeServerShellFn, ensure_code_server_shell),
    ensure_workbench_adapter_shell=cast(EnsureWorkbenchAdapterShellFn, _ensure_workbench_adapter_shell_for_routes),
    code_server_connection_target=cast(CodeServerConnectionTargetFn, _code_server_connection_target_for_routes),
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
        watcher = _json_object(sc.dump_raw().get("watcher"))
        wmode = _str_value(watcher.get("mode"), "ipc")
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
        cs_env = _json_object(cs.env_overrides)
        pr = str(cs_env.get("PROJECT_ROOT") or pr)
        print(f"[file_editor_cm6] eager code-server startup OK (project={pr})", flush=True)
    except Exception as exc:
        print(f"[file_editor_cm6] eager code-server startup failed: {exc}", flush=True)


@file_editor_cm6_bp.on_event("startup")  # pyright: ignore[reportDeprecated]
async def _on_startup():  # pyright: ignore[reportUnusedFunction]
    _install_loop_exception_handler()
    from .worker_services.runtime import bootstrap_worker_runtime

    bootstrap_worker_runtime(asyncio.get_running_loop())
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



def _status_to_payload(status: object) -> JsonDict:
    from .git_helper import GitStatus

    return status_to_payload(cast(GitStatus, status))

def _get_runtime_metadata() -> JsonDict:
    return get_runtime_metadata()

def _build_state_payload() -> JsonDict:
    return build_state_payload(_STATE_PAYLOAD_DEPS)

def _expand_and_validate_path(path: str) -> tuple[str | None, str | None]:
    return expand_and_validate_path(path)


_GIT_ROUTES_DEPS = GitRoutesDeps(
    history=_history_store,
    get_active_project_root=_get_active_project_root,
    get_project_root=get_project_root,
    list_branches=git_list_branches,
    checkout_branch=git_checkout_branch,
    create_branch=git_create_branch_helper,
    get_status=git_get_status,
    stage_all=git_stage_all,
    unstage_all=git_unstage_all,
    commit_changes=git_commit_changes,
    push_changes=git_push_changes,
    pull_changes=git_pull_changes,
    stage_paths=stage_paths,
    unstage_paths=unstage_paths,
    get_commits_for_path=get_commits_for_path,
    restore_path=restore_path,
    get_commits=get_commits,
    reset_hard=reset_hard,
    is_git_repository=is_git_repository,
    init_repository=init_repository,
    get_commit_info=get_commit_info,
    add_remote=git_add_remote,
    get_origin_url=git_get_origin_url,
    status_to_payload=_status_to_payload,
    diff_base_payload=_diff_base_payload,
    invalidate_diff_cache=invalidate_diff_cache,
    mark_git_cache_dirty=mark_git_cache_dirty,
)
file_editor_cm6_bp.include_router(create_git_router(_GIT_ROUTES_DEPS))


async def _close_active_terminal_sockets_for_project_routes() -> None:
    from .terminal_backend import close_active_terminal_sockets

    await close_active_terminal_sockets()


def _stop_diagnostics_bridge_for_project_routes() -> None:
    from .wba_event_bridge import reset_wba_project_event_state

    reset_wba_project_event_state()


async def _terminate_adapter_shell_for_project_routes() -> bool:
    from .workbench_adapter_shell_manager import terminate_adapter_shell

    return await terminate_adapter_shell()


def _clear_change_ledger_for_project_routes() -> None:
    from .change_ledger import clear as clear_ledger

    clear_ledger()


async def _emit_sidebar_cwd_set_for_project_routes(reason: str) -> None:
    from .ui_ipc import sidebar_ws

    await sidebar_ws.emit_sidebar_cwd_set_global(reason=reason)


async def _emit_explorer_project_opened_for_project_routes(payload: dict[str, object]) -> None:
    from .explorer.transport.rpc_emit import emit_explorer_rpc_notification

    await emit_explorer_rpc_notification("explorer.project.opened", payload)


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
    format_label=HistoryStore.format_label,
    get_sidecar_path=ProjectSidecar.get_sidecar_path,
    emit_explorer_project_opened=_emit_explorer_project_opened_for_project_routes,
)
file_editor_cm6_bp.include_router(create_project_router(_PROJECT_ROUTES_DEPS))

_HISTORY_ROUTES_DEPS = HistoryRoutesDeps(
    history=_history_store,
    get_project_root=get_project_root,
    format_label=HistoryStore.format_label,
    get_sidecar_path=ProjectSidecar.get_sidecar_path,
    load_sidecar=ProjectSidecar.load_or_create,
)
file_editor_cm6_bp.include_router(create_history_router(_HISTORY_ROUTES_DEPS))

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
async def delete_session_cache(
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
        try:
            from .monaco_editor.editor_ws import (
                editor_runtime_emit_room_event,
                editor_runtime_reload_disk_content_if_active,
            )

            await editor_runtime_emit_room_event(
                "editor:cache_state",
                {
                    "path": expanded_path,
                    "state": "clean",
                    "unsaved": False,
                    "reason": "discard_external",
                },
            )
            await editor_runtime_reload_disk_content_if_active(
                expanded_path,
                source="legacy_session_cache_delete",
                request_id=f"session_cache_delete_{int(time.time() * 1000)}",
            )
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
    path = _str_value(data.get('path')) or None
    content_value = data.get('content')
    content = content_value if isinstance(content_value, str) else None
    client_id = _str_value(data.get('client_id'), 'unknown')
    op_id = _str_value(data.get('op_id'))
    base_sha256: str | None = None

    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    if content is None:
        raise HTTPException(status_code=400, detail="Content is required")

    base_obj = _json_object(data.get('base'))
    base_sha_obj = base_obj.get('sha256')
    if isinstance(base_sha_obj, str):
        base_sha256 = base_sha_obj

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
        push_save_ack(str(rel_path), op_id, client_id, _file_meta_json(file_meta))

        # Notify diff subscribers of change
        emit_diff_changed(str(rel_path), _meta_sha256(file_meta))

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
    open_file = payload.get("lastFile")
    payload.update({
        "projectOrigin": project_origin,
        "currentPath": open_file if isinstance(open_file, str) else None,
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
    editor = _json_object(payload.get('editor')) or None
    ui = _json_object(payload.get('ui')) or None
    project: JsonDict | None = _json_object(payload.get('project')) or None

    active_project = _history_store.get_active_project()
    if project is None and active_project:
        project = cast(JsonDict, {"path": active_project})
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
    payload = _collect_diff(project_root, rel, base_ref=base_ref)
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
    mode = _str_value(data.get('mode'), 'name')
    query = _str_value(data.get('query')).strip()
    
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
            results = await explorer_search_module.search_by_name(root_path, query)
        elif mode == 'content':
            results = await explorer_search_module.search_by_content(root_path, cast(SearchContentOptionsParams, data))
        elif mode == 'changes':
            results = explorer_search_module.search_by_changes(root_path)
        else:
            raise HTTPException(status_code=400, detail="Invalid mode")
        
        return {"ok": True, "data": results}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Search timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.get('/review/list')
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

@file_editor_cm6_bp.post('/review/save')
async def review_save(data: JsonDict = Body(...)) -> JsonDict:
    """Save selected files from drafts to disk with full lifecycle notifications."""
    files = _str_list(data.get('files'))
    if not files:
        return {"ok": True, "saved_count": 0}
        
    project_root = _history_store.get_active_project()
    if not project_root:
        raise HTTPException(status_code=400, detail="No active project")
    
    root_path = Path(project_root)
    saved_count = 0
    errors: list[str] = []
    
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
            push_save_ack(str(rel_path), op_id, "review_panel", _file_meta_json(file_meta))
            emit_diff_changed(str(rel_path), _meta_sha256(file_meta))
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
async def review_discard(data: JsonDict = Body(...)) -> JsonDict:
    """Discard drafts for selected files."""
    files = _str_list(data.get('files'))
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
            try:
                from .monaco_editor.editor_ws import (
                    editor_runtime_emit_room_event,
                    editor_runtime_reload_disk_content_if_active,
                )

                await editor_runtime_emit_room_event(
                    "editor:cache_state",
                    {
                        "path": str(abs_path),
                        "state": "clean",
                        "unsaved": False,
                        "reason": "discard_external",
                    },
                )
                await editor_runtime_reload_disk_content_if_active(
                    str(abs_path),
                    source="legacy_review_discard",
                    request_id=f"legacy_review_discard_{int(time.time() * 1000)}",
                )
            except Exception:
                pass
    
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
    parent_rel = _str_value(data.get('parent_rel'), '.')
    name = _str_value(data.get('name')).strip()
    
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
    parent_rel = _str_value(data.get('parent_rel'), '.')
    name = _str_value(data.get('name')).strip()
      
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
    rel = _str_value(data.get('rel'))
    new_name = _str_value(data.get('new_name')).strip()
    
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
    rel = _str_value(data.get('rel'))
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
    rels = _str_list(data.get('rels'))
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
    rel = _str_value(data.get('rel'))
    dest_path = _str_value(data.get('dest_path'))
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
    rel = _str_value(data.get('rel'))
    dest_path = _str_value(data.get('dest_path'))
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
    rels = _str_list(data.get('rels'))
    dest_path = _str_value(data.get('dest_path'))
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
    rels = _str_list(data.get('rels'))
    dest_path = _str_value(data.get('dest_path'))
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
    source_path = _str_value(data.get('source_path'))
    dest_rel = _str_value(data.get('dest_rel'))
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
    source_path = _str_value(data.get('source_path'))
    dest_rel = _str_value(data.get('dest_rel'))
    if not source_path or not dest_rel:
        raise HTTPException(status_code=400, detail="Source path and destination relative path required")
    try:
        from .explorer.services.file_ops import move_entry_inbound
        result = move_entry_inbound(source_path, dest_rel)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.get('/edit_tracker/status')
def get_edit_tracker_status():
    """Get current edit tracker status."""
    try:
        status = _edit_tracker_status()
        return {"ok": True, "data": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.websocket('/ws/edit_tracker')
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
