# /data/data/com.termux/files/home/mrselect/app/apps/code_te2/main.py

import sys
import os
import json
import faulthandler
import threading
import traceback
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast
from urllib import request as urllib_request
from urllib.parse import quote
import asyncio
from .explorer.services.file_ops import (
    get_project_root,
    set_project_root,
)
from .code_server_runtime_hooks import set_code_server_runtime_primer
from . import edit_tracker
from .diff_helper import invalidate_diff_cache
from .project_sidecar import ProjectSidecar, cleanup_orphaned_sidecars
from .code_te2_paths import code_te2_paths
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


def _str_value(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def te2_pipe_dispatch(envelope: "PipeEnvelope") -> JsonDict | None:
    del envelope
    return None


class ReadableResponse(Protocol):
    def read(self) -> bytes: ...

    def close(self) -> None: ...


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

# The native app owns resource routes and socket mounts, never worker services.
# app_worker wraps this export with readiness/debug lifespan and invokes our
# existing te2_app_start/stop hooks around Uvicorn on the same event loop.
from .http_app import build_code_te2_asgi_app
from .socketio_gateway import CODE_TE2_ASGI_APP

TE2_ASGI_APP = build_code_te2_asgi_app(
    static_dir=Path(__file__).parent / "static",
    agent_icon_dir=AGENT_ICON_DIR,
    socket_app=CODE_TE2_ASGI_APP,
)

_history_store = get_history_store()
_preferences_store = get_preferences_store()

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
