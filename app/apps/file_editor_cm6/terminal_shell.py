# app/apps/file_editor_cm6/terminal_shell.py

import os
import hashlib
import shlex
import signal
from pathlib import Path
from typing import cast

from framework_shells import get_manager as _manager
from framework_shells.orchestrator import Orchestrator

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
    mgr = await _manager()
    orch = Orchestrator(mgr)
    
    shell_cmd_value: ShellCommand = shell_cmd if shell_cmd is not None else ['bash', '-l', '-i']
    cwd_value = cwd or os.path.expanduser('~')
    
    label = _terminal_label(project_path, sequence=sequence)

    # Check if a shell with this label already exists and is running
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        return _json_object(cast(object, await mgr.describe(existing)))

    # Create dtach-backed shell for persistence
    subgroups = _terminal_subgroups(project_path)
    rec = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "CWD": cwd_value,
            "SHELL_CMD": _shell_cmd_string(shell_cmd_value),
        },
        label=label,
        wait_ready=False,
        subgroups_overrides=subgroups,
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
    mgr = await _manager()
    try:
        # Force termination and remove metadata/logs
        await mgr.remove_shell(shell_id, force=True)
        return True
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
    mgr = await _manager()
    try:
        await mgr.resize_pty(shell_id, cols, rows)

        # Ensure dtach attach proxy + interactive shells observe the resize.
        # Without SIGWINCH reaching the "front" process, readline can keep an
        # old column count and you'll see wrap/overwrite glitches in xterm.
        try:
            proxy_pid: int | None = None
            pty_map = cast(dict[str, object] | None, getattr(cast(object, mgr), "_pty", None))
            pty_state = pty_map.get(shell_id) if pty_map is not None else None
            if pty_state is not None:
                proxy_pid_obj = cast(object, getattr(pty_state, "proxy_pid", None))
                proxy_pid = proxy_pid_obj if isinstance(proxy_pid_obj, int) else None
            if proxy_pid:
                try:
                    os.killpg(os.getpgid(proxy_pid), signal.SIGWINCH)
                except Exception:
                    try:
                        os.kill(proxy_pid, signal.SIGWINCH)
                    except Exception:
                        pass
        except Exception:
            pass

        try:
            rec = await mgr.get_shell(shell_id)
        except Exception:
            rec = None
        pid = rec.pid if rec and isinstance(rec.pid, int) else None
        if pid is not None:
            try:
                os.killpg(os.getpgid(pid), signal.SIGWINCH)
            except Exception:
                try:
                    os.kill(pid, signal.SIGWINCH)
                except Exception:
                    pass
        return True
    except Exception:
        return False
