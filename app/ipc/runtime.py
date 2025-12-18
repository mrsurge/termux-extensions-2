"""Runtime helpers for orchestrating the IPC microservice."""

from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import List

IPC_MODULE = "app.ipc.server"
DEFAULT_PORT = 9099


def ipc_command(extra_args: List[str] | None = None) -> List[str]:
    """Return the command list used to launch the IPC server."""
    virtual_env = os.environ.get("VIRTUAL_ENV")
    if virtual_env:
        python_path = Path(virtual_env) / "bin" / "python"
        python = str(python_path)
    else:
        python = "python"
    args = [python, "-m", IPC_MODULE, "--port", str(DEFAULT_PORT)]
    if extra_args:
        args.extend(extra_args)
    return args


def format_command(command: List[str]) -> str:
    """Return a shell-safe string representation for logging."""
    return " ".join(shlex.quote(part) for part in command)
