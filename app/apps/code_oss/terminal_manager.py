from __future__ import annotations

import json
import os
import shlex
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict

from app.libs.framework_shells import _manager


@dataclass
class TerminalSession:
    """Represents a terminal session tied to a project."""

    id: str
    project_path: str
    shell_id: str
    title: str
    created_at: float
    last_accessed: float
    cols: int = 80
    rows: int = 24
    active: bool = True


class TerminalManager:
    """Manages terminal sessions for Code-OSS projects."""

    def __init__(self, storage_path: Optional[Path] = None):
        self._storage_path = (
            storage_path
            or Path.home() / ".local/share/termux-extensions-2/code_oss_terminals.json"
        )
        self._sessions: Dict[str, TerminalSession] = {}
        self._lock = threading.Lock()
        self._load_sessions()
        self._cleanup_orphaned()

    def _load_sessions(self) -> None:
        """Load persisted terminal sessions from disk."""
        if not self._storage_path.exists():
            return

        try:
            with open(self._storage_path, "r") as f:
                data = json.load(f)
                for session_data in data.get("sessions", []):
                    session = TerminalSession(**session_data)
                    self._sessions[session.id] = session
        except Exception:
            # If loading fails, start fresh
            self._sessions = {}

    def _save_sessions(self) -> None:
        """Persist terminal sessions to disk."""
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)

        data = {"version": 1, "sessions": [asdict(s) for s in self._sessions.values()]}

        tmp_path = self._storage_path.with_suffix(".tmp")
        try:
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)
            tmp_path.replace(self._storage_path)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

    def _cleanup_orphaned(self) -> None:
        """Remove sessions for shells that no longer exist."""
        mgr = _manager()
        if not mgr:
            return

        with self._lock:
            to_remove = []
            for session_id, session in self._sessions.items():
                shell = mgr.get_shell(session.shell_id)
                if not shell or shell.status != "running":
                    to_remove.append(session_id)

            for session_id in to_remove:
                del self._sessions[session_id]

            if to_remove:
                self._save_sessions()

    def _get_default_shell_command(self) -> List[str]:
        """Get the default shell command for new terminals."""
        # Prefer bash with login+interactive; fallback to sh -i
        if os.path.basename((os.environ.get("SHELL") or "")).endswith(
            "bash"
        ) or shutil.which("bash"):
            return ["bash", "-l", "-i"]
        return ["sh", "-i"]

    def create_terminal(
        self,
        project_path: str,
        shell_cmd: Optional[List[str]] = None,
        title: Optional[str] = None,
        cols: int = 80,
        rows: int = 24,
    ) -> Dict[str, Any]:
        """Create a new terminal session for a project.

        Args:
            project_path: Absolute path to the project directory
            shell_cmd: Optional shell command to run
            title: Optional terminal title
            cols: Terminal columns
            rows: Terminal rows

        Returns:
            Terminal session info including ID and connection details
        """
        mgr = _manager()
        if not mgr:
            raise RuntimeError("Framework shell manager not available")

        if not shell_cmd:
            shell_cmd = self._get_default_shell_command()

        # Normalize project path
        project_path = str(Path(project_path).expanduser().resolve())

        # Generate terminal ID
        terminal_id = f"term_{int(time.time() * 1000)}_{os.urandom(4).hex()}"

        # Prepare environment with IDE context
        env = {
            "IDE_CONTEXT": "code-oss",
            "IDE_PROJECT_PATH": project_path,
            "IDE_TERMINAL_ID": terminal_id,
        }

        # Spawn the framework shell
        try:
            shell_record = mgr.spawn_shell_pty(
                shell_cmd,
                cwd=project_path,
                env=env,
                label=f"code-oss-terminal:{terminal_id}",
                autostart=True,
            )
        except Exception as e:
            raise RuntimeError(f"Failed to spawn terminal: {e}")

        # Create and store session
        session = TerminalSession(
            id=terminal_id,
            project_path=project_path,
            shell_id=shell_record.id,
            title=title or f"Terminal {len(self._sessions) + 1}",
            created_at=time.time(),
            last_accessed=time.time(),
            cols=cols,
            rows=rows,
            active=True,
        )

        with self._lock:
            self._sessions[terminal_id] = session
            self._save_sessions()

        return {
            "id": session.id,
            "shell_id": session.shell_id,
            "title": session.title,
            "project_path": session.project_path,
            "cols": session.cols,
            "rows": session.rows,
            "created_at": session.created_at,
        }

    def list_terminals(
        self, project_path: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List terminal sessions, optionally filtered by project.

        Args:
            project_path: Optional project path to filter by

        Returns:
            List of terminal session info
        """
        mgr = _manager()
        if not mgr:
            return []

        with self._lock:
            sessions = list(self._sessions.values())

        if project_path:
            project_path = str(Path(project_path).expanduser().resolve())
            sessions = [s for s in sessions if s.project_path == project_path]

        # Verify shells are still running
        result = []
        for session in sessions:
            shell = mgr.get_shell(session.shell_id)
            if shell and shell.status == "running":
                result.append(
                    {
                        "id": session.id,
                        "shell_id": session.shell_id,
                        "title": session.title,
                        "project_path": session.project_path,
                        "cols": session.cols,
                        "rows": session.rows,
                        "created_at": session.created_at,
                        "last_accessed": session.last_accessed,
                        "active": session.active,
                    }
                )

        return result

    def get_terminal(self, terminal_id: str) -> Optional[Dict[str, Any]]:
        """Get info for a specific terminal session.

        Args:
            terminal_id: Terminal session ID

        Returns:
            Terminal info or None if not found
        """
        with self._lock:
            session = self._sessions.get(terminal_id)

        if not session:
            return None

        mgr = _manager()
        if not mgr:
            return None

        shell = mgr.get_shell(session.shell_id)
        if not shell or shell.status != "running":
            return None

        # Update last accessed
        with self._lock:
            session.last_accessed = time.time()
            self._save_sessions()

        return {
            "id": session.id,
            "shell_id": session.shell_id,
            "title": session.title,
            "project_path": session.project_path,
            "cols": session.cols,
            "rows": session.rows,
            "created_at": session.created_at,
            "last_accessed": session.last_accessed,
            "active": session.active,
        }

    def resize_terminal(self, terminal_id: str, cols: int, rows: int) -> bool:
        """Resize a terminal session.

        Args:
            terminal_id: Terminal session ID
            cols: New column count
            rows: New row count

        Returns:
            True if successful
        """
        with self._lock:
            session = self._sessions.get(terminal_id)

        if not session:
            return False

        mgr = _manager()
        if not mgr:
            return False

        # Send resize command to PTY
        try:
            mgr.resize_pty(session.shell_id, cols, rows)
        except Exception:
            return False

        # Update session
        with self._lock:
            session.cols = cols
            session.rows = rows
            session.last_accessed = time.time()
            self._save_sessions()

        return True

    def destroy_terminal(self, terminal_id: str) -> bool:
        """Destroy a terminal session.

        Args:
            terminal_id: Terminal session ID

        Returns:
            True if successful
        """
        with self._lock:
            session = self._sessions.get(terminal_id)
            if not session:
                return False

        mgr = _manager()
        if not mgr:
            return False

        # Terminate the shell
        try:
            shell = mgr.get_shell(session.shell_id)
            if shell:
                mgr.terminate(session.shell_id, force=True)
        except Exception:
            pass

        # Remove session
        with self._lock:
            del self._sessions[terminal_id]
            self._save_sessions()

        return True

    def destroy_project_terminals(self, project_path: str) -> int:
        """Destroy all terminals for a project.

        Args:
            project_path: Project path

        Returns:
            Number of terminals destroyed
        """
        project_path = str(Path(project_path).expanduser().resolve())
        terminals = self.list_terminals(project_path)

        count = 0
        for terminal in terminals:
            if self.destroy_terminal(terminal["id"]):
                count += 1

        return count

    def update_terminal_title(self, terminal_id: str, title: str) -> bool:
        """Update a terminal's title.

        Args:
            terminal_id: Terminal session ID
            title: New title

        Returns:
            True if successful
        """
        with self._lock:
            session = self._sessions.get(terminal_id)
            if not session:
                return False

            session.title = title
            session.last_accessed = time.time()
            self._save_sessions()

        return True

    def set_terminal_active(self, terminal_id: str, active: bool = True) -> bool:
        """Set a terminal's active state.

        Args:
            terminal_id: Terminal session ID
            active: Whether terminal is active

        Returns:
            True if successful
        """
        with self._lock:
            session = self._sessions.get(terminal_id)
            if not session:
                return False

            session.active = active
            session.last_accessed = time.time()
            self._save_sessions()

        return True


# Global instance
_terminal_manager: Optional[TerminalManager] = None
_terminal_manager_lock = threading.Lock()


def get_terminal_manager() -> TerminalManager:
    """Get or create the global terminal manager instance."""
    global _terminal_manager
    with _terminal_manager_lock:
        if _terminal_manager is None:
            _terminal_manager = TerminalManager()
        return _terminal_manager
