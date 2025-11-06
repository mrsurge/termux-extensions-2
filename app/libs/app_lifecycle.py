import asyncio
import time
from typing import Dict, List, Optional

# A simple in-memory store for the state of running apps.
_running_apps: Dict[str, Dict] = {}
_lock: Optional[asyncio.Lock] = None

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
    from app.libs.framework_shells import get_manager as get_framework_shell_manager
    from app.main import get_setting
    
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        manager = await get_framework_shell_manager()
        app_ttl_seconds = get_setting("APP_TTL_SECONDS", DEFAULT_APP_TTL_SECONDS)
        if app_ttl_seconds is not None:
            app_ttl_seconds = int(app_ttl_seconds)
        else:
            app_ttl_seconds = DEFAULT_APP_TTL_SECONDS
        
        async with _get_lock():
            now = time.time()
            stale_apps = []
            for shell_id, app_info in list(_running_apps.items()):
                if not app_info.get("locked"):
                    age = now - app_info.get("created_at", now)
                    if age > app_ttl_seconds:
                        stale_apps.append(shell_id)
            
            if stale_apps:
                print(f"[AppLifecycle] Cleaning up {len(stale_apps)} stale app(s) (TTL: {app_ttl_seconds}s)...")
                for shell_id in stale_apps:
                    await terminate_app(manager, shell_id)

def start_background_tasks():
    # Start the background task when the module is loaded.
    asyncio.create_task(_background_cleanup())

# --- Public API for the Library ---
async def register_app(app_id: str, shell_id: str, port: int):
    """
    Called by the app launcher when a new app worker shell is spawned.
    """
    async with _get_lock():
        _running_apps[shell_id] = {
            "app_id": app_id,
            "shell_id": shell_id,
            "port": port,
            "created_at": time.time(),
            "locked": False,
        }

async def unregister_app(shell_id: str):
    """
    Removes an app from tracking when it is terminated.
    """
    async with _get_lock():
        _running_apps.pop(shell_id, None)

async def get_running_apps(manager) -> List[Dict]:
    """
    Returns a list of all tracked running apps with their current stats.
    This will be used by the 'Recents' UI.
    """
    apps_with_stats = []
    async with _get_lock():
        # Iterate over a copy of the items to avoid issues if the dict changes
        for shell_id, app_info in list(_running_apps.items()):
            shell_record = await manager.get_shell(shell_id)
            if not shell_record or shell_record.status != 'running':
                # Clean up stale entries
                _running_apps.pop(shell_id, None)
                continue

            stats = (await manager.describe(shell_record)).get("stats", {})
            apps_with_stats.append({
                **app_info,
                "uptime": time.time() - app_info["created_at"],
                "cpu": stats.get("cpu_percent", 0),
                "ram": stats.get("memory_rss", 0),
            })
    # Sort by creation time, oldest first
    return sorted(apps_with_stats, key=lambda x: x["created_at"])

async def set_lock_state(shell_id: str, locked: bool) -> Optional[Dict]:
    """
    Sets the 'locked' status for a given app shell.
    """
    async with _get_lock():
        if shell_id in _running_apps:
            _running_apps[shell_id]["locked"] = locked
            return _running_apps[shell_id]
        return None

async def terminate_app(manager, shell_id: str) -> bool:
    """
    The unified function to terminate an app. It finds the shell and uses the
    FrameworkShellManager to stop it.
    """
    try:
        # We use force=True to ensure the entire process group is killed.
        await manager.terminate_shell(shell_id, force=True)
        await unregister_app(shell_id)
        return True
    except (KeyError, Exception):
        # If termination fails, at least remove it from our tracking
        await unregister_app(shell_id)
        return False

# --- End of Public API ---
