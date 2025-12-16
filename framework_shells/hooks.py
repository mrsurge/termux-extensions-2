from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from .record import ShellRecord


MaybeAwaitable = Any


@dataclass(frozen=True)
class ShellLifecycleHooks:
    """Optional callbacks for integrating FrameworkShellManager with host systems.

    This is intentionally generic (no IPC, no FastAPI, no repo-specific imports).
    Callbacks may be sync or async; exceptions are swallowed (best-effort).
    """

    # Called after a shell is confirmed running and persisted.
    on_shell_running: Optional[Callable[[ShellRecord], MaybeAwaitable]] = None

    # Called when a running shell from a previous run is adopted.
    on_shell_adopted: Optional[Callable[[ShellRecord], MaybeAwaitable]] = None

    # Called when a shell is marked exited (often discovered during adoption).
    # `last_pid` is the PID that was previously associated with the shell.
    on_shell_exited: Optional[Callable[[ShellRecord, Optional[int]], MaybeAwaitable]] = None
