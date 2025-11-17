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


def write_full(project_root: Path, path: str, content: str, *, 
               base_sha256: str | None = None,
               mode: int | None = None) -> dict:
    # Edit 2025-11-17T00:13:07+00:00: This function performs the core atomic file write operation.
    # It was updated to accept an optional 'mode' parameter to explicitly set file permissions
    # on the temporary file before moving it, which is crucial for preserving the executable bit.
    """
    Performs an atomic write, optionally checking for a base SHA256 match.
    
    Args:
        mode: Optional file permissions (0-777 octal). If None and file exists,
              permissions are preserved via os.replace(). If None for new files,
              uses umask default.
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
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', 
                                        dir=target_path.parent, delete=False) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        
        # NEW: Apply explicit mode if provided
        if mode is not None:
            try:
                os.chmod(tmp_path, mode)
            except OSError as e:
                # Log warning but continue - save is more important than mode
                import sys
                print(f"[SAVE] Warning: Failed to chmod temp file: {e}", file=sys.stderr)
        
        os.replace(tmp_path, target_path)
        
        # fsync directory
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
