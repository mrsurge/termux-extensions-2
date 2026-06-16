import asyncio
import contextlib
import time
from typing import Any, Dict, List, Optional

# A simple in-memory store for the state of running apps.
_running_apps: Dict[str, Dict] = {}
_app_readiness: Dict[str, Dict[str, Any]] = {}
_lock: Optional[asyncio.Lock] = None
_cleanup_task: Optional[asyncio.Task] = None

def _get_lock():
    """Get or create module-level lock (lazy initialization)."""
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock

# --- Lifecycle Configuration ---
DEFAULT_APP_TTL_SECONDS = 1800  # 30 minutes default
CLEANUP_INTERVAL_SECONDS = 60  # 1 minute

# --- Background Cleanup Task ---

async def _background_cleanup():
    """Periodically checks for and terminates old, unlocked apps."""
    from framework_shells import get_manager as get_framework_shell_manager
    from app.main import get_setting

    tick = 0
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        tick += 1
        manager = await get_framework_shell_manager()
        app_ttl_seconds = get_setting("APP_TTL_SECONDS", DEFAULT_APP_TTL_SECONDS)
        if app_ttl_seconds is not None:
            app_ttl_seconds = int(app_ttl_seconds)
        else:
            app_ttl_seconds = DEFAULT_APP_TTL_SECONDS

        async with _get_lock():
            now = time.time()
            stale_apps = []
            tracked_count = len(_running_apps)
            for shell_id, app_info in list(_running_apps.items()):
                if app_info.get("locked"):
                    continue
                age = now - app_info.get("created_at", now)
                if age > app_ttl_seconds:
                    stale_apps.append(shell_id)

        if stale_apps:
            print(
                f"[AppLifecycle] Cleanup tick {tick}: cleaning up {len(stale_apps)} stale app(s) "
                f"(tracking {tracked_count}; TTL: {app_ttl_seconds}s)..."
            )
            for shell_id in stale_apps:
                await terminate_app(manager, shell_id)

def start_background_tasks():
    """Kick off background lifecycle tasks inside the current event loop."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        return
    _cleanup_task = asyncio.create_task(_background_cleanup())


async def stop_background_tasks():
    """Cancel the background cleanup task if it is running."""
    global _cleanup_task
    if _cleanup_task is None:
        print("[AppLifecycle] No background task to stop")
        return
    print("[AppLifecycle] Stopping background cleanup task")
    _cleanup_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _cleanup_task
    _cleanup_task = None
    print("[AppLifecycle] Background cleanup task stopped")

# --- Public API for the Library ---
async def register_app(app_id: str, shell_id: str, port: int, *, readiness_support: bool = False):
    """
    Called by the app launcher when a new app worker shell is spawned.
    """
    print(f"[AppLifecycle] Registering app_id={app_id} shell_id={shell_id} port={port}")
    safe_app_id = str(app_id or "").strip()
    async with _get_lock():
        existing = _running_apps.get(shell_id, {})
        _running_apps[shell_id] = {
            "app_id": app_id,
            "shell_id": shell_id,
            "port": port,
            "created_at": existing.get("created_at", time.time()),
            "locked": bool(existing.get("locked", False)),
            "readiness_support": bool(readiness_support),
        }
        if not readiness_support:
            _app_readiness.pop(safe_app_id, None)
            return
        existing_readiness = _app_readiness.get(safe_app_id)
        existing_status = str((existing_readiness or {}).get("status") or "").strip().lower()
        if existing_status not in {"ready", "starting"}:
            _app_readiness[safe_app_id] = {
                "app_id": safe_app_id,
                "status": "starting",
                "updated_at": time.time(),
            }

async def unregister_app(shell_id: str):
    """
    Removes an app from tracking when it is terminated.
    """
    print(f"[AppLifecycle] Unregistering shell_id={shell_id}")
    async with _get_lock():
        app_info = _running_apps.pop(shell_id, None)
        app_id = str((app_info or {}).get("app_id") or "").strip()
        if app_id and not any(info.get("app_id") == app_id for info in _running_apps.values()):
            _app_readiness.pop(app_id, None)


async def unregister_app_group(app_id: str):
    """Remove all tracked entries for an app without issuing shutdown."""
    print(f"[AppLifecycle] Unregistering app group app_id={app_id}")
    async with _get_lock():
        to_remove = [shell_id for shell_id, info in _running_apps.items() if info.get("app_id") == app_id]
        for shell_id in to_remove:
            _running_apps.pop(shell_id, None)
        _app_readiness.pop(str(app_id or "").strip(), None)


def _normalize_readiness_payload(app_id: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    raw = payload if isinstance(payload, dict) else {}
    status = str(raw.get("status") or raw.get("phase") or "").strip().lower() or "ready"
    if status == "loading":
        status = "starting"
    if status not in {"starting", "ready", "error", "stopped"}:
        status = "ready" if status in {"ok", "up", "serving"} else "error"
    normalized: Dict[str, Any] = {
        "app_id": str(app_id or "").strip(),
        "status": status,
        "updated_at": time.time(),
    }
    for key in (
        "phase",
        "message",
        "source",
    ):
        value = raw.get(key)
        if value is None:
            continue
        normalized[key] = value
    details = raw.get("details")
    if isinstance(details, dict):
        normalized["details"] = dict(details)
    return normalized


async def set_app_readiness(app_id: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    safe_app_id = str(app_id or "").strip()
    if not safe_app_id:
        raise ValueError("app_id is required")
    readiness = _normalize_readiness_payload(safe_app_id, payload)
    async with _get_lock():
        _app_readiness[safe_app_id] = readiness
    return dict(readiness)


async def get_app_readiness(app_id: str) -> Dict[str, Any] | None:
    safe_app_id = str(app_id or "").strip()
    if not safe_app_id:
        return None
    async with _get_lock():
        value = _app_readiness.get(safe_app_id)
        return dict(value) if isinstance(value, dict) else None


async def get_all_app_readiness() -> Dict[str, Dict[str, Any]]:
    async with _get_lock():
        return {app_id: dict(value) for app_id, value in _app_readiness.items() if isinstance(value, dict)}

async def get_running_apps(manager) -> List[Dict]:
    """
    Returns a list of all tracked running apps with their current stats.
    This will be used by the 'Recents' UI.
    """
    apps_with_stats = []
    stale_shell_ids = []

    # Take a fast snapshot under lock, then do shell-manager I/O without holding it.
    async with _get_lock():
        tracked_items = list(_running_apps.items())

    for shell_id, app_info in tracked_items:
        shell_record = await manager.get_shell(shell_id)
        if not shell_record or shell_record.status != 'running':
            stale_shell_ids.append(shell_id)
            continue

        stats = (await manager.describe(shell_record)).get("stats", {})
        apps_with_stats.append({
            **app_info,
            "uptime": time.time() - app_info["created_at"],
            "cpu": stats.get("cpu_percent", 0),
            "ram": stats.get("memory_rss", 0),
            "readiness": dict(_app_readiness.get(str(app_info.get("app_id") or "").strip()) or {}),
        })

    if stale_shell_ids:
        async with _get_lock():
            for shell_id in stale_shell_ids:
                _running_apps.pop(shell_id, None)
    # Sort by creation time, oldest first
    return sorted(apps_with_stats, key=lambda x: x["created_at"])

async def set_lock_state(shell_id: str, locked: bool) -> Optional[Dict]:
    """
    Sets the 'locked' status for a given app shell.
    """
    async with _get_lock():
        if shell_id in _running_apps:
            _running_apps[shell_id]["locked"] = locked
            app_id = str(_running_apps[shell_id].get("app_id") or "").strip()
            if app_id:
                _running_apps[shell_id]["readiness"] = dict(_app_readiness.get(app_id) or {})
            return _running_apps[shell_id]
        return None

async def terminate_app(manager, shell_id: str) -> bool:
    """
    The unified function to terminate an app. It finds the shell and uses the
    FrameworkShellManager to stop it.
    """
    print(f"[AppLifecycle] Terminating shell_id={shell_id}")
    try:
        # We use force=True to ensure the entire process group is killed.
        await manager.terminate_shell(shell_id, force=True)
        await unregister_app(shell_id)
        print(f"[AppLifecycle] Terminated shell_id={shell_id}")
        return True
    except (KeyError, Exception):
        # If termination fails, at least remove it from our tracking
        await unregister_app(shell_id)
        print(f"[AppLifecycle] Failed to terminate shell_id={shell_id}, unregistered tracking entry")
        return False

async def terminate_app_group(manager, app_id: str) -> Dict:
    """
    Terminate all shells for an app_id using FrameworkShellManager group shutdown.
    Mirrors framework_shells app shutdown-group semantics and then reconciles local tracking.
    """
    print(f"[AppLifecycle] Terminating app group app_id={app_id}")
    result: Dict = {"ok": False, "data": {"root_pids": [], "stats": {}}}
    try:
        result = await manager.shutdown_app_group(app_id)
    except Exception as exc:
        print(f"[AppLifecycle] shutdown_app_group failed for app_id={app_id}: {exc}")
        result = {"ok": False, "error": str(exc), "data": {"root_pids": [], "stats": {}}}

    async with _get_lock():
        to_remove = [shell_id for shell_id, info in _running_apps.items() if info.get("app_id") == app_id]
        for shell_id in to_remove:
            _running_apps.pop(shell_id, None)
        _app_readiness.pop(str(app_id or "").strip(), None)
    if to_remove:
        print(f"[AppLifecycle] Unregistered {len(to_remove)} tracked shell(s) for app_id={app_id}")
    else:
        print(f"[AppLifecycle] No tracked shells to unregister for app_id={app_id}")
    return result

async def terminate_all_apps(manager) -> None:
    """Terminate every tracked app shell."""
    async with _get_lock():
        shell_ids = list(_running_apps.keys())
    print(f"[AppLifecycle] Terminating all apps ({len(shell_ids)})")
    for shell_id in shell_ids:
        await terminate_app(manager, shell_id)


async def shutdown_lifecycle(manager) -> None:
    """Gracefully stop lifecycle background tasks and running apps."""
    print("[AppLifecycle] Shutting down lifecycle services...")
    await terminate_all_apps(manager)
    await stop_background_tasks()
    print("[AppLifecycle] Lifecycle shutdown complete.")

# --- End of Public API ---
