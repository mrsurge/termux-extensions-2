from __future__ import annotations

import asyncio
import os
from typing import Optional

from framework_shells import ShellLifecycleHooks
from framework_shells.record import ShellRecord

from app.ipc.client import register_process, unregister_process


def build_ipc_shell_hooks() -> ShellLifecycleHooks:
    async def on_shell_running(record: ShellRecord) -> None:
        pid = record.pid
        if not pid:
            return
        await asyncio.to_thread(
            register_process,
            pid=pid,
            type="shell",
            label=record.label or record.id,
            parent_pid=record.launcher_pid or int(os.getpid()),
            metadata={
                "shell_id": record.id,
                "uses_dtach": bool(getattr(record, "uses_dtach", False)),
                "uses_pipes": bool(getattr(record, "uses_pipes", False)),
                "uses_pty": bool(getattr(record, "uses_pty", False)),
                "run_id": record.run_id,
            },
        )

    async def on_shell_adopted(record: ShellRecord) -> None:
        # Treat adoption as “(re)register running shell”.
        await on_shell_running(record)

    async def on_shell_exited(record: ShellRecord, last_pid: Optional[int]) -> None:
        if not last_pid:
            return
        await asyncio.to_thread(unregister_process, last_pid)

    return ShellLifecycleHooks(
        on_shell_running=on_shell_running,
        on_shell_adopted=on_shell_adopted,
        on_shell_exited=on_shell_exited,
    )
