from __future__ import annotations
import os
import hashlib
import tempfile
from pathlib import Path
import stat

class BaseMismatchError(Exception):
    """Raised when the base SHA256 does not match the current file."""
    def __init__(self, message, current_meta):
        super().__init__(message)
        self.current_meta = current_meta

def _get_file_meta(path: Path) -> dict:
    """Computes SHA256 and other metadata for a file."""
    if not path.is_file():
        return {"sha256": None, "size": 0, "mtime": 0}
    
    h = hashlib.sha256()
    size = 0
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(4096)
                if not chunk:
                    break
                h.update(chunk)
                size += len(chunk)
        
        mtime = path.stat().st_mtime_ns
        return {"sha256": h.hexdigest(), "size": size, "mtime": mtime}
    except FileNotFoundError:
        return {"sha256": None, "size": 0, "mtime": 0}


def write_full(project_root: Path, path: str, content: str, *, base_sha256: str | None = None) -> dict:
    """
    Performs an atomic write, optionally checking for a base SHA256 match.

    Returns:
        A dictionary with mtime, size, and sha256 of the new file.
    Raises:
        PermissionError: If the path is outside the project root.
        BaseMismatchError: If base_sha256 is provided and doesn't match.
        IOError: For other file-related errors.
    """
    try:
        target_path = project_root.joinpath(path).resolve()
        if not str(target_path).startswith(str(project_root.resolve())):
            raise PermissionError("File path is outside the project root.")

        if target_path.is_symlink() or os.path.lexists(target_path) and not target_path.is_file():
             raise PermissionError("Writing to symlinks or non-regular files is not allowed.")

    except Exception as e:
        raise PermissionError(f"Invalid path: {path}") from e

    if base_sha256:
        current_meta = _get_file_meta(target_path)
        current_sha = current_meta.get("sha256")
        if current_sha and current_sha != base_sha256:
            raise BaseMismatchError("Base SHA256 mismatch", current_meta)

    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target_path.parent, delete=False) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())

        os.replace(tmp_path, target_path)

        # fsync the directory to ensure the rename is persisted
        dir_fd = os.open(target_path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

    except Exception as e:
        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink()
        raise IOError(f"Failed to write file atomically: {path}") from e

    return _get_file_meta(target_path)
