from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Protocol


@dataclass(frozen=True)
class ProcessRecord:
    """A generic process record for building trees and shutdown plans.

    This is intentionally host-agnostic. Hosts may use `type` + `metadata` to
    encode semantics (e.g. "framework", "shell", "worker", "agent").
    """

    pid: int
    parent_pid: Optional[int] = None
    type: str = "process"
    label: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    shell_id: Optional[str] = None


@dataclass(frozen=True)
class ProcessSnapshot:
    captured_at: float
    processes: Dict[int, ProcessRecord]


class ExternalProcessProvider(Protocol):
    """Optional host-provided provider for non-shell processes.

    Implementations may be sync or async.
    """

    def list_processes(self, *, root_pids: List[int]) -> Any:  # pragma: no cover
        raise NotImplementedError


async def _maybe_await(value: Any) -> Any:
    if asyncio.iscoroutine(value) or asyncio.isfuture(value):
        return await value
    return value


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except Exception:
        return None


def _children_of(pid: int) -> List[int]:
    # Prefer /proc/<pid>/task/<pid>/children (fast).
    txt = _read_text(f"/proc/{pid}/task/{pid}/children")
    if txt is not None:
        txt = txt.strip()
        if not txt:
            return []
        out: List[int] = []
        for part in txt.split():
            try:
                out.append(int(part))
            except Exception:
                continue
        return out

    # Fallback: scan /proc for ppid matches (slow).
    out = []
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            child_pid = int(entry)
            stat = _read_text(f"/proc/{child_pid}/stat")
            if not stat:
                continue
            rparen = stat.rfind(")")
            if rparen == -1:
                continue
            fields = stat[rparen + 2 :].split()
            if len(fields) < 2:
                continue
            try:
                ppid = int(fields[1])
            except Exception:
                continue
            if ppid == pid:
                out.append(child_pid)
    except Exception:
        return []
    return out


def _read_comm(pid: int) -> Optional[str]:
    txt = _read_text(f"/proc/{pid}/comm")
    if not txt:
        return None
    return txt.strip() or None


def _read_cmdline(pid: int) -> Optional[str]:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            raw = fh.read()
        parts = [p.decode("utf-8", "ignore") for p in raw.split(b"\x00") if p]
        if not parts:
            return None
        return " ".join(parts)
    except Exception:
        return None


class ProcfsProcessProvider:
    """Best-effort process discovery using /proc.

    This is useful for standalone usage where no external registry exists.
    It discovers descendants under the provided `root_pids`.
    """

    def __init__(self, *, max_depth: int = 8, max_processes: int = 4096) -> None:
        self._max_depth = max_depth
        self._max_processes = max_processes

    def list_processes(self, *, root_pids: List[int]) -> List[ProcessRecord]:
        visited: set[int] = set()
        out: List[ProcessRecord] = []

        queue: List[tuple[int, int]] = []
        for root in root_pids:
            try:
                root_pid = int(root)
            except Exception:
                continue
            if root_pid <= 1:
                continue
            if not _is_pid_alive(root_pid):
                continue
            queue.append((root_pid, 0))

        while queue:
            parent_pid, depth = queue.pop(0)
            if depth >= self._max_depth:
                continue

            children = _children_of(parent_pid)
            for child_pid in children:
                if child_pid in visited:
                    continue
                visited.add(child_pid)
                if child_pid <= 1:
                    continue
                if len(out) >= self._max_processes:
                    return out

                label = _read_cmdline(child_pid) or _read_comm(child_pid) or str(child_pid)
                out.append(
                    ProcessRecord(
                        pid=child_pid,
                        parent_pid=parent_pid,
                        type="process",
                        label=label,
                        metadata={},
                    )
                )
                queue.append((child_pid, depth + 1))

        return out


async def collect_external_processes(
    provider: ExternalProcessProvider,
    *,
    root_pids: List[int],
) -> List[ProcessRecord]:
    """Call a provider that may be sync or async."""
    value = provider.list_processes(root_pids=root_pids)
    processes = await _maybe_await(value)
    if not isinstance(processes, list):
        return []
    out: List[ProcessRecord] = []
    for item in processes:
        if isinstance(item, ProcessRecord):
            out.append(item)
    return out

