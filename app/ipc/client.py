"""IPC client helper for framework/workers to register with IPC."""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

import requests

IPC_URL = f"http://{os.environ.get('TE_IPC_HOST', '127.0.0.1')}:{os.environ.get('TE_IPC_PORT', '9123')}"


def register_process(
    pid: int,
    type: str,
    label: Optional[str] = None,
    parent_pid: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
    retries: int = 5,
    backoff: float = 0.2,
) -> bool:
    """Register this process with IPC server.
    
    Retries with exponential backoff to handle IPC server startup race.
    """
    payload = {
        "pid": pid,
        "type": type,
        "label": label,
        "parent_pid": parent_pid,
        "metadata": metadata or {},
    }
    
    for attempt in range(retries):
        try:
            resp = requests.post(
                f"{IPC_URL}/processes/register",
                json=payload,
                timeout=2.0,
            )
            if resp.status_code == 200:
                return True
        except (requests.ConnectionError, requests.Timeout):
            # IPC server not ready yet, retry
            if attempt < retries - 1:
                time.sleep(backoff * (2 ** attempt))  # Exponential backoff
                continue
        except Exception:
            return False
    
    return False


def unregister_process(pid: int) -> bool:
    """Unregister this process from IPC."""
    try:
        resp = requests.post(
            f"{IPC_URL}/processes/unregister",
            json={"pid": pid},
            timeout=2.0,
        )
        return resp.status_code == 200
    except Exception:
        return False


def ping_ipc(pid: int) -> bool:
    """Send health ping to IPC."""
    try:
        resp = requests.post(
            f"{IPC_URL}/processes/ping",
            json={"pid": pid},
            timeout=1.0,
        )
        return resp.status_code == 200
    except Exception:
        return False

