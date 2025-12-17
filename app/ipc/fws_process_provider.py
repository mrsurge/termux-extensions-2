from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

from framework_shells.process_snapshot import ProcessRecord


class IpcProcessProvider:
    """TE2 integration: expose IPC process registry as an ExternalProcessProvider.

    This lives in TE2 (not in framework_shells) so the framework_shells module
    stays platform-agnostic.
    """

    def __init__(
        self,
        *,
        ipc_host: Optional[str] = None,
        ipc_port: Optional[str] = None,
        timeout_s: float = 2.0,
    ) -> None:
        self._ipc_host = ipc_host or os.environ.get("TE_IPC_HOST", "127.0.0.1")
        self._ipc_port = ipc_port or os.environ.get("TE_IPC_PORT", "9099")
        self._timeout_s = float(timeout_s)

    async def list_processes(self, *, root_pids: List[int]) -> List[ProcessRecord]:
        ipc_url = f"http://{self._ipc_host}:{self._ipc_port}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.get(f"{ipc_url}/processes/list")
            if resp.status_code != 200:
                return []
            payload = resp.json()
        except Exception:
            return []

        raw = payload.get("data", {}).get("processes", [])
        if not isinstance(raw, list):
            return []

        root_set = set(int(p) for p in (root_pids or []) if isinstance(p, int) or str(p).isdigit())

        # Index for ancestor filtering.
        by_pid: Dict[int, Dict[str, Any]] = {}
        for item in raw:
            if not isinstance(item, dict):
                continue
            pid = item.get("pid")
            try:
                pid_int = int(pid)
            except Exception:
                continue
            by_pid[pid_int] = item

        def in_any_root(pid: int) -> bool:
            if not root_set:
                return True
            seen: set[int] = set()
            cur = pid
            while True:
                if cur in root_set:
                    return True
                if cur in seen:
                    return False
                seen.add(cur)
                item = by_pid.get(cur)
                if not item:
                    return False
                parent_pid = item.get("parent_pid")
                if parent_pid is None:
                    return False
                try:
                    cur = int(parent_pid)
                except Exception:
                    return False

        out: List[ProcessRecord] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            pid = item.get("pid")
            try:
                pid_int = int(pid)
            except Exception:
                continue
            if not in_any_root(pid_int):
                continue

            parent_pid_raw = item.get("parent_pid")
            parent_pid: Optional[int]
            try:
                parent_pid = int(parent_pid_raw) if parent_pid_raw is not None else None
            except Exception:
                parent_pid = None

            proc_type = str(item.get("type") or "process")
            label = item.get("label")
            label_str = str(label) if label is not None else None
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            shell_id = meta.get("shell_id") if isinstance(meta, dict) else None
            shell_id_str = str(shell_id) if shell_id else None

            out.append(
                ProcessRecord(
                    pid=pid_int,
                    parent_pid=parent_pid,
                    type=proc_type,
                    label=label_str,
                    metadata=dict(meta) if isinstance(meta, dict) else {},
                    shell_id=shell_id_str,
                )
            )

        return out

