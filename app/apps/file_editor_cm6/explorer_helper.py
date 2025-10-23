from __future__ import annotations
from pathlib import Path
import os
import stat

# Global project root for this app (default: HOME)
_PROJECT_ROOT = Path.home()


def set_project_root(path: str) -> Path:
    """Set the project root directory after validation."""
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        raise ValueError("project path must be an existing directory")
    global _PROJECT_ROOT
    _PROJECT_ROOT = p
    return _PROJECT_ROOT


def get_project_root() -> Path:
    """Get the current project root directory."""
    return _PROJECT_ROOT


def list_dir(rel: str = '.') -> dict:
    """
    List directory contents relative to project root.

    Returns a dict suitable for UI rendering with:
    - cwd: current working directory relative to project root
    - entries: list of file/dir entries with metadata
    """
    root = get_project_root()
    base = (root / rel).resolve()

    # Security check: ensure path is within project root
    if not str(base).startswith(str(root.resolve())):
        raise ValueError("dir outside project root")

    if not base.exists() or not base.is_dir():
        raise ValueError("not a directory")

    entries = []
    with os.scandir(base) as it:
        for e in it:
            try:
                info = e.stat(follow_symlinks=False)
                mode = stat.S_IMODE(info.st_mode)
                ext = ''

                if e.is_file(follow_symlinks=False):
                    ext = Path(e.name).suffix.lstrip('.')

                entries.append({
                    'name': e.name,
                    'rel': str((base / e.name).relative_to(root)),
                    'kind': 'dir' if e.is_dir(follow_symlinks=False) else 'file',
                    'mtime': int(info.st_mtime),
                    'size': int(info.st_size),
                    'mode': oct(mode),
                    'ext': ext,
                })
            except Exception:
                # Skip files we can't access
                continue

    # Sort: directories first, then files, case-insensitive
    entries.sort(key=lambda x: (x['kind'] != 'dir', x['name'].lower()))

    return {
        'cwd': str(base.relative_to(root)) if base != root else '.',
        'entries': entries
    }
