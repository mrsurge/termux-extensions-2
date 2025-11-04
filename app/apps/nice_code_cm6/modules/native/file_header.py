"""Top file/path header module."""

from nicegui import ui

from ...core.module import Module
from ...helpers.explorer_backend import get_explorer_state


class FileHeaderModule(Module):
    def __init__(self) -> None:
        self._label = None

    @property
    def key(self) -> str:
        return "file_header"

    @property
    def label(self) -> str:
        return "File Header"

    def _compute_text(self) -> str:
        try:
            import subprocess, os
            state = get_explorer_state()
            root = state.get_project()
            status = state.get_git_status()

            repo_name = None
            try:
                # Try to read origin URL and derive repo basename sans .git
                result = subprocess.run(
                    ["git", "-C", str(root), "config", "--get", "remote.origin.url"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                url = (result.stdout or "").strip()
                if result.returncode == 0 and url:
                    # Handle both https://.../owner/repo.git and git@host:owner/repo.git
                    tail = url.rsplit("/", 1)[-1]
                    tail = tail.rsplit(":", 1)[-1]
                    repo_name = tail[:-4] if tail.endswith(".git") else tail
            except Exception:
                repo_name = None

            branch = None
            if status and getattr(status, "branch", None):
                branch = status.branch

            if repo_name:
                return f"{repo_name} • {branch}" if branch else repo_name
            # Fallback: project directory name, include branch if available
            label = root.name
            return f"{label} • {branch}" if branch else label
        except Exception:
            return "Project"

    def update_project_label(self) -> None:
        if self._label:
            self._label.text = self._compute_text()

    def render(self, container: ui.element) -> None:
        with container:
            self._label = ui.label(self._compute_text()).classes("text-xs text-slate-300 truncate")
