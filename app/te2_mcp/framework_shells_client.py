from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any

from framework_shells import get_manager

try:
    from framework_shells.log_inspection import inspect_log_file
except Exception:  # pragma: no cover - compatibility fallback for older framework_shells builds.
    inspect_log_file = None

from .fws_log_analysis import build_inspect_result


@dataclass(slots=True)
class FrameworkShellsClient:
    """Direct in-process framework-shells adapter for the runtime-owned TE2 MCP."""

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

    async def inspect_logs(
        self,
        shell_id: str,
        *,
        stream: str = "both",
        query: str | None = None,
        lines: int = 200,
        limit: int = 100,
        regex: bool = False,
        ignore_case: bool = False,
        format: str | None = None,
        signature: str | None = None,
        exclude_query: str | None = None,
        exclude_signature: str | None = None,
    ) -> dict[str, Any]:
        mgr = await get_manager()
        normalized_shell_id = str(shell_id or "").strip()
        if query:
            data = await mgr.search_logs(
                normalized_shell_id,
                stream=stream,
                query=str(query),
                limit=limit,
                regex=regex,
                ignore_case=ignore_case,
            )
            mode = "search"
        else:
            if inspect_log_file is None:
                data = await mgr.get_log_tail(normalized_shell_id, stream=stream, lines=lines)
            else:
                data = await self._inspect_tail_logs(
                    mgr,
                    normalized_shell_id,
                    stream=stream,
                    lines=lines,
                    regex=regex,
                    ignore_case=ignore_case,
                    format=format,
                    signature=signature,
                    exclude_query=exclude_query,
                    exclude_signature=exclude_signature,
                )
            mode = "tail"
        result = build_inspect_result(
            shell_id=normalized_shell_id,
            status=str(data.get("status") or ""),
            payload=data,
            mode=mode,
            query=str(query) if query else None,
            format_filter=str(format or "").strip() or None,
            signature_filter=str(signature or "").strip() or None,
            regex=regex,
            ignore_case=ignore_case,
            exclude_query=str(exclude_query or "").strip() or None,
            exclude_signature=str(exclude_signature or "").strip() or None,
        )
        return {"ok": True, "data": result.model_dump(mode="json"), "source": "framework_shells.direct"}

    async def _inspect_tail_logs(
        self,
        mgr: Any,
        shell_id: str,
        *,
        stream: str,
        lines: int,
        regex: bool,
        ignore_case: bool,
        format: str | None,
        signature: str | None,
        exclude_query: str | None,
        exclude_signature: str | None,
    ) -> dict[str, Any]:
        if inspect_log_file is None:
            raise RuntimeError("framework_shells.log_inspection.inspect_log_file is unavailable")
        shell = await mgr.get_shell(shell_id)
        if not shell:
            raise KeyError(f"Shell not found: {shell_id}")

        stream_name = (stream or "both").strip().lower()
        if stream_name not in {"stdout", "stderr", "both"}:
            raise ValueError(f"Invalid stream: {stream}")

        result: dict[str, Any] = {
            "shell_id": shell_id,
            "created_at": self._shell_attr(shell, "created_at"),
            "updated_at": self._shell_attr(shell, "updated_at"),
            "status": str(self._shell_attr(shell, "status", "") or ""),
        }

        if stream_name in {"stdout", "both"}:
            result["stdout"] = await self._inspect_stream_payload(
                mgr,
                path=Path(str(self._shell_attr(shell, "stdout_log", "") or "")),
                stream="stdout",
                lines=lines,
                regex=regex,
                ignore_case=ignore_case,
                format=format,
                signature=signature,
                exclude_query=exclude_query,
                exclude_signature=exclude_signature,
            )

        if stream_name in {"stderr", "both"}:
            result["stderr"] = await self._inspect_stream_payload(
                mgr,
                path=Path(str(self._shell_attr(shell, "stderr_log", "") or "")),
                stream="stderr",
                lines=lines,
                regex=regex,
                ignore_case=ignore_case,
                format=format,
                signature=signature,
                exclude_query=exclude_query,
                exclude_signature=exclude_signature,
            )

        return result

    async def _inspect_stream_payload(
        self,
        mgr: Any,
        *,
        path: Path,
        stream: str,
        lines: int,
        regex: bool,
        ignore_case: bool,
        format: str | None,
        signature: str | None,
        exclude_query: str | None,
        exclude_signature: str | None,
    ) -> dict[str, Any]:
        inspection = await inspect_log_file(
            path,
            stream=stream,
            lines=max(0, int(lines)),
            max_bytes=int(getattr(mgr, "LOG_TAIL_BYTES", 4096)),
            query=None,
            exclude_query=str(exclude_query or "").strip() or None,
            regex=regex,
            ignore_case=ignore_case,
            format_filter=str(format or "").strip().lower() or None,
            signature_filter=str(signature or "").strip() or None,
            exclude_signature=str(exclude_signature or "").strip() or None,
        )
        return await mgr._log_stream_payload(path, extra=inspection)

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
