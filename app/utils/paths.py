from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

HOME_DIR = Path(os.path.expanduser("~")).resolve()

def _resolve_user_path(raw: Optional[str], *, must_exist: bool = True) -> Path:
    if not raw:
        raw = "~"
    expanded = os.path.expanduser(raw)
    candidate = Path(expanded)
    try:
        resolved = candidate.resolve(strict=False)
    except Exception:
        resolved = candidate.absolute()
    if not str(resolved).startswith(str(HOME_DIR)):
        raise PermissionError(f"Access denied: {raw}")
    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path not found: {resolved}")
    return resolved
