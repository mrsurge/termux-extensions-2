import time
import threading
from typing import Dict, List, Optional

# A simple in-memory store for the state of running apps.
_running_apps: Dict[str, Dict] = {}
_lock = threading.RLock()

# --- Lifecycle Configuration ---
DEFAULT_APP_TTL_SECONDS = 1800  # 30 minutes default
CLEANUP_INTERVAL_SECONDS = 60  # 1 minute

# --- Background Cleanup Thread ---

def _background_cleanup(app):
    """Periodically checks for and terminates old, unlocked apps."""
    with app.app_context():
        from app.libs.framework_shells import _manager as get_framework_shell_manager
        from flask import current_app
        while True:
            time.sleep(CLEANUP_INTERVAL_SECONDS)
            manager = get_framework_shell_manager()
            app_ttl_seconds = current_app.config.get("APP_TTL_SECONDS", DEFAULT_APP_TTL_SECONDS)
            with _lock:
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
                        terminate_app(manager, shell_id)


def start_background_tasks(app):
    # Start the background thread when the module is loaded.
    _cleanup_thread = threading.Thread(target=_background_cleanup, args=(app,), daemon=True)
    _cleanup_thread.start()

# --- Public API for the Library ---
def register_app(app_id: str, shell_id: str, port: int):
    """
    Called by the app launcher when a new app worker shell is spawned.
    """
    with _lock:
        _running_apps[shell_id] = {
            "app_id": app_id,
            "shell_id": shell_id,
            "port": port,
            "created_at": time.time(),
            "locked": False,
        }

def unregister_app(shell_id: str):
    """
    Removes an app from tracking when it is terminated.
    """
    with _lock:
        _running_apps.pop(shell_id, None)

def get_running_apps(manager) -> List[Dict]:
    """
    Returns a list of all tracked running apps with their current stats.
    This will be used by the 'Recents' UI.
    """
    apps_with_stats = []
    with _lock:
        # Iterate over a copy of the items to avoid issues if the dict changes
        for shell_id, app_info in list(_running_apps.items()):
            shell_record = manager.get_shell(shell_id)
            if not shell_record or shell_record.status != 'running':
                # Clean up stale entries
                _running_apps.pop(shell_id, None)
                continue

            stats = manager.describe(shell_record).get("stats", {})
            apps_with_stats.append({
                **app_info,
                "uptime": time.time() - app_info["created_at"],
                "cpu": stats.get("cpu_percent", 0),
                "ram": stats.get("memory_rss", 0),
            })
    # Sort by creation time, oldest first
    return sorted(apps_with_stats, key=lambda x: x["created_at"])

def set_lock_state(shell_id: str, locked: bool) -> Optional[Dict]:
    """
    Sets the 'locked' status for a given app shell.
    """
    with _lock:
        if shell_id in _running_apps:
            _running_apps[shell_id]["locked"] = locked
            return _running_apps[shell_id]
        return None

def terminate_app(manager, shell_id: str) -> bool:
    """
    The unified function to terminate an app. It finds the shell and uses the
    FrameworkShellManager to stop it.
    """
    try:
        # We use force=True to ensure the entire process group is killed.
        manager.terminate_shell(shell_id, force=True)
        unregister_app(shell_id)
        return True
    except (KeyError, Exception):
        # If termination fails, at least remove it from our tracking
        unregister_app(shell_id)
        return False

# --- End of Public API ---
