"""Select the user's interactive shell without assuming a platform prefix."""
import os
import shutil


def system_shell_command(path: str | None = None) -> list[str]:
    preferred = os.environ.get("SHELL", "")
    executable = shutil.which(preferred, path=path) if preferred else None
    executable = executable or shutil.which("bash", path=path) or shutil.which("sh", path=path) or "sh"
    name = os.path.basename(executable)
    if name in {"bash", "zsh", "fish"}:
        return [executable, "-l", "-i"]
    return [executable, "-i"] if name in {"sh", "dash", "ash", "ksh"} else [executable]
