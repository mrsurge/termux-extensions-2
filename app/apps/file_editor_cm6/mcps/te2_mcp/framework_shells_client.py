from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any

from framework_shells import get_manager


@dataclass(slots=True)
class FrameworkShellsClient:
    """Direct in-process framework-shells adapter for worker-owned MCP."""

    async def get_running(self) -> dict[str, Any]:
        mgr = await get_manager()
        shells = await mgr.list_shells()
        return {
            "ok": True,
            "data": [self._shell_payload(shell) for shell in shells if self._shell_is_running(shell)],
            "source": "framework_shells.direct",
        }

    async def get_shell(self, shell_id: str) -> dict[str, Any]:
        mgr = await get_manager()
        shell = await mgr.get_shell(str(shell_id or "").strip())
        if not shell:
            return {"ok": False, "error": f"Shell not found: {shell_id}"}
        return {
            "ok": True,
            "data": self._shell_payload(shell),
            "source": "framework_shells.direct",
        }

    async def get_log_tail(self, shell_id: str, *, stream: str = "both", lines: int = 200) -> dict[str, Any]:
        mgr = await get_manager()
        data = await mgr.get_log_tail(str(shell_id or "").strip(), stream=stream, lines=lines)
        return {"ok": True, "data": data, "source": "framework_shells.direct"}

    async def search_logs(
        self,
        shell_id: str,
        *,
        stream: str = "both",
        query: str,
        limit: int = 100,
        regex: bool = False,
        ignore_case: bool = False,
    ) -> dict[str, Any]:
        mgr = await get_manager()
        data = await mgr.search_logs(
            str(shell_id or "").strip(),
            stream=stream,
            query=str(query or ""),
            limit=limit,
            regex=regex,
            ignore_case=ignore_case,
        )
        return {"ok": True, "data": data, "source": "framework_shells.direct"}

    @staticmethod
    def _shell_payload(shell: Any) -> dict[str, Any]:
        if hasattr(shell, "to_payload"):
            return shell.to_payload()
        if isinstance(shell, dict):
            return dict(shell)
        raise TypeError("Unsupported shell payload type")

    @staticmethod
    def _shell_attr(shell: Any, key: str, default: Any = None) -> Any:
        if isinstance(shell, dict):
            return shell.get(key, default)
        return getattr(shell, key, default)

    @classmethod
    def _shell_is_running(cls, shell: Any) -> bool:
        if str(cls._shell_attr(shell, "status", "")).strip().lower() != "running":
            return False

        pid = cls._shell_attr(shell, "pid")
        try:
            pid_int = int(pid)
        except (TypeError, ValueError):
            return False
        if pid_int <= 0:
            return False

        try:
            os.kill(pid_int, 0)
        except PermissionError:
            return True
        except OSError:
            return False
        return True
