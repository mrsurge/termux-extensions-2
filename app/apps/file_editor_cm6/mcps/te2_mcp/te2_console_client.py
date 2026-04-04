from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.te2_console_runtime import list_console_workers, request_console_eval


@dataclass(slots=True)
class Te2ConsoleClient:
    """Direct in-process console adapter for the framework-owned console runtime."""

    async def list_workers(self) -> list[str]:
        return list_console_workers()

    async def eval_in_worker(
        self,
        target_worker_id: str,
        code: str,
        *,
        timeout_seconds: float = 20.0,
    ) -> dict[str, Any]:
        return await request_console_eval(
            target_worker_id=target_worker_id,
            code=code,
            timeout_seconds=timeout_seconds,
        )
