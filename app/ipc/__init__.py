"""IPC support package."""

from importlib import import_module
from typing import Optional

IPC_APP_PATH = "app.ipc.server:app"


def get_ipc_app() -> Optional[object]:
    """Lazy-import and return the IPC web application if available."""
    try:
        module, attr = IPC_APP_PATH.split(":", 1)
        app_module = import_module(module)
        return getattr(app_module, attr)
    except Exception:
        return None
