# app/apps/file_editor_cm6/terminal_shell.py

import os
import hashlib
from pathlib import Path

from framework_shells import get_manager as _manager


def _terminal_subgroups(project_path: str | None) -> list[str]:
    """App-defined framework shell subgroups for sessions grouping.

    Convention:
    - index 0: app umbrella group
    - index 1+: optional subgroups (e.g., per-project)
    """
    groups: list[str] = ["file_editor_cm6"]
    if not project_path:
        return groups
    try:
        norm = str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        norm = project_path
    digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:8]
    base = Path(norm).name or "project"
    groups.append(f"project:{base}:{digest}")
    return groups


def _terminal_label(project_path: str | None, sequence: int | None = None) -> str:
    """Stable per-project label for editor terminals.

    When sequence is provided, appends a numeric suffix so multiple shells
    can coexist per project.
    """
    if not project_path:
        return "code-editor-terminal"
    try:
        norm = str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        norm = project_path
    digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:8]
    base = Path(norm).name or "project"
    label = f"code-editor-terminal:{base}:{digest}"
    if sequence is not None:
        try:
            seq = int(sequence)
        except Exception:
            seq = None
        if seq and seq > 0:
            label = f"{label}:{seq}"
    return label


async def create_editor_shell(cwd=None, shell_cmd=None, project_path: str | None = None, sequence: int | None = None):
    """
    Create a new PTY-backed shell session for the code editor terminal drawer.
    
    Args:
        cwd: Working directory for the shell (defaults to current project or home)
        shell_cmd: Custom shell command (defaults to bash -l -i)
    
    Returns:
        dict: Shell session info including ID
    """
    mgr = await _manager()
    
    if shell_cmd is None:
        shell_cmd = ['bash', '-l', '-i']
    
    if cwd is None:
        cwd = os.path.expanduser('~')
    
    label = _terminal_label(project_path, sequence=sequence)

    # Check if a shell with this label already exists and is running
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        return await mgr.describe(existing)

    # Create dtach-backed shell for persistence
    subgroups = _terminal_subgroups(project_path)
    rec = await mgr.spawn_shell_dtach(
        shell_cmd,
        label=label,
        subgroups=subgroups,
        cwd=cwd
    )
    
    return await mgr.describe(rec)


async def destroy_editor_shell(shell_id):
    """
    Terminate and remove a shell session, cleaning up PTY and logs.
    Called when user clicks the X button to permanently close the terminal.
    
    Args:
        shell_id: Shell session ID to destroy
    
    Returns:
        bool: True if successfully removed
    """
    mgr = await _manager()
    try:
        # Force termination and remove metadata/logs
        await mgr.remove_shell(shell_id, force=True)
        return True
    except Exception:
        return False


async def resize_editor_shell(shell_id, cols, rows):
    """
    Resize the terminal PTY.
    
    Args:
        shell_id: Shell session ID
        cols: Terminal columns
        rows: Terminal rows
    """
    mgr = await _manager()
    try:
        await mgr.resize_pty(shell_id, cols, rows)
        return True
    except Exception:
        return False
