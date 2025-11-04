# app/apps/file_editor_cm6/terminal_shell.py

import os
from app.libs.framework_shells import _manager

def create_editor_shell(cwd=None, shell_cmd=None):
    """
    Create a new PTY-backed shell session for the code editor terminal drawer.
    
    Args:
        cwd: Working directory for the shell (defaults to current project or home)
        shell_cmd: Custom shell command (defaults to bash -l -i)
    
    Returns:
        dict: Shell session info including ID
    """
    mgr = _manager()
    
    if shell_cmd is None:
        shell_cmd = ['bash', '-l', '-i']
    
    if cwd is None:
        cwd = os.path.expanduser('~')
    
    # Create PTY-backed shell using spawn_shell_pty
    rec = mgr.spawn_shell_pty(
        shell_cmd,
        label='code-editor-terminal',
        cwd=cwd
    )
    
    return mgr.describe(rec)


def destroy_editor_shell(shell_id):
    """
    Terminate and remove a shell session, cleaning up PTY and logs.
    Called when user clicks the X button to permanently close the terminal.
    
    Args:
        shell_id: Shell session ID to destroy
    
    Returns:
        bool: True if successfully removed
    """
    mgr = _manager()
    try:
        # Force termination and remove metadata/logs
        mgr.remove_shell(shell_id, force=True)
        return True
    except Exception:
        return False


def resize_editor_shell(shell_id, cols, rows):
    """
    Resize the terminal PTY.
    
    Args:
        shell_id: Shell session ID
        cols: Terminal columns
        rows: Terminal rows
    """
    mgr = _manager()
    try:
        mgr.resize_pty(shell_id, cols, rows)
        return True
    except Exception:
        return False


def get_shell_info(shell_id):
    """
    Get shell session information.
    
    Args:
        shell_id: Shell session ID
    
    Returns:
        dict: Shell metadata or None if not found
    """
    mgr = _manager()
    rec = mgr.get_shell(shell_id)
    if not rec:
        return None
    return mgr.describe(rec)
