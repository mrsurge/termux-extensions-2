# app/apps/code_te2/terminal_shell.py

import os
import hashlib
import shlex
from pathlib import Path
from typing import cast

SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "terminal.yaml#terminal"

JsonObject = dict[str, object]
ShellCommand = list[str] | tuple[str, ...] | str


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _terminal_subgroups(project_path: str | None) -> list[str]:
    """App-defined framework shell subgroups for sessions grouping.

    Convention:
    - index 0: app umbrella group
    - index 1+: optional subgroups (e.g., per-project)
    """
    groups: list[str] = ["code_te2"]
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


def _shell_cmd_string(shell_cmd: ShellCommand) -> str:
    if isinstance(shell_cmd, str):
        return shell_cmd
    return shlex.join([str(part) for part in shell_cmd])


async def create_editor_shell(
    cwd: str | None = None,
    shell_cmd: ShellCommand | None = None,
    project_path: str | None = None,
    sequence: int | None = None,
) -> JsonObject:
    """
    Create a new PTY-backed shell session for the code editor terminal drawer.
    
    Args:
        cwd: Working directory for the shell (defaults to current project or home)
        shell_cmd: Custom shell command (defaults to bash -l -i)
    
    Returns:
        dict: Shell session info including ID
    """
    # Shell launch dependencies must not gate editor/router startup.
    from .native_shells import get_manager

    mgr = await get_manager()
    
    shell_cmd_value: ShellCommand = shell_cmd if shell_cmd is not None else ['bash', '-l', '-i']
    cwd_value = cwd or os.path.expanduser('~')
    
    label = _terminal_label(project_path, sequence=sequence)

    # Check if a shell with this label already exists and is running
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        return _json_object(cast(object, await mgr.describe(existing)))

    # Framework-Shells owns the persistent interactive PTY session.
    subgroups = _terminal_subgroups(project_path)
    filename, entry = SHELLSPEC_REF.split("#", 1)
    rec = await mgr.spawn_terminal(
        SHELLSPEC_DIR / filename, entry,
        ctx={
            "CWD": cwd_value,
            "SHELL_CMD": _shell_cmd_string(shell_cmd_value),
        },
        label=label,
        subgroups=subgroups,
    )
    
    return _json_object(cast(object, await mgr.describe(rec)))


async def destroy_editor_shell(shell_id: str) -> bool:
    """
    Terminate and remove a shell session, cleaning up PTY and logs.
    Called when user clicks the X button to permanently close the terminal.
    
    Args:
        shell_id: Shell session ID to destroy
    
    Returns:
        bool: True if successfully removed
    """
    from .native_shells import get_manager

    mgr = await get_manager()
    try:
        # Force termination and remove metadata/logs
        return await mgr.remove_shell(shell_id, force=True)
    except Exception:
        return False


async def resize_editor_shell(shell_id: str, cols: int, rows: int) -> bool:
    """
    Resize the terminal PTY.
    
    Args:
        shell_id: Shell session ID
        cols: Terminal columns
        rows: Terminal rows
    """
    from .native_shells import get_manager

    mgr = await get_manager()
    try:
        await mgr.resize_pty(shell_id, cols, rows)

        # The native PTY owns its controlling terminal; TIOCSWINSZ notifies
        # the actual foreground job, without guessing process groups here.
        return True
    except Exception:
        return False
