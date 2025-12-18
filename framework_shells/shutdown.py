from __future__ import annotations

import os
import signal
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from .manager import FrameworkShellManager
from .process_snapshot import ProcessRecord, ProcessSnapshot


@dataclass(frozen=True)
class ShutdownPolicy:
    sigterm_timeout_s: float = 2.0
    sigkill_timeout_s: float = 2.0
    poll_interval_s: float = 0.1
    types_last: List[str] = field(default_factory=list)


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _is_zombie(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="replace") as fh:
            stat = fh.read()
        fields = stat.split()
        if len(fields) < 3:
            return False
        return fields[2] == "Z"
    except Exception:
        return False


def _wait_pid_exit(pid: int, *, timeout_s: float, poll_interval_s: float) -> bool:
    start = time.time()
    while time.time() - start < timeout_s:
        if not _is_pid_alive(pid):
            return True
        if _is_zombie(pid):
            return True
        time.sleep(poll_interval_s)
    return not _is_pid_alive(pid)


def plan_shutdown(
    processes: Iterable[ProcessRecord],
    *,
    policy: Optional[ShutdownPolicy] = None,
) -> List[ProcessRecord]:
    """Return processes in dependency order: children first, parents last.

    The planner is host-agnostic. Hosts may supply semantics via `type` and
    `policy.types_last` (e.g. kill "framework" last).
    """
    policy = policy or ShutdownPolicy()
    by_pid: Dict[int, ProcessRecord] = {rec.pid: rec for rec in processes if rec and rec.pid}
    depth_cache: Dict[int, int] = {}

    def depth(pid: int, visiting: Optional[Set[int]] = None) -> int:
        if pid in depth_cache:
            return depth_cache[pid]
        visiting = visiting or set()
        if pid in visiting:
            depth_cache[pid] = 0
            return 0
        visiting.add(pid)
        rec = by_pid.get(pid)
        if not rec or not rec.parent_pid:
            depth_cache[pid] = 0
            return 0
        parent = by_pid.get(rec.parent_pid)
        if not parent:
            depth_cache[pid] = 0
            return 0
        d = 1 + depth(parent.pid, visiting)
        depth_cache[pid] = d
        return d

    types_last = set(policy.types_last or [])

    def type_priority(rec: ProcessRecord) -> int:
        return 1 if rec.type in types_last else 0

    return sorted(
        by_pid.values(),
        key=lambda rec: (type_priority(rec), -depth(rec.pid), rec.type, rec.pid),
    )


def collect_descendants(
    snapshot: ProcessSnapshot,
    *,
    root_pids: Iterable[int],
) -> Set[int]:
    children_by_parent: Dict[int, List[int]] = {}
    for rec in snapshot.processes.values():
        if not rec.parent_pid:
            continue
        children_by_parent.setdefault(rec.parent_pid, []).append(rec.pid)

    out: Set[int] = set()
    queue: List[int] = []
    for root in root_pids:
        try:
            pid = int(root)
        except Exception:
            continue
        queue.append(pid)

    while queue:
        pid = queue.pop(0)
        if pid in out:
            continue
        out.add(pid)
        for child in children_by_parent.get(pid, []):
            queue.append(child)

    return out


async def execute_shutdown_plan(
    plan: List[ProcessRecord],
    *,
    manager: Optional[FrameworkShellManager] = None,
    policy: Optional[ShutdownPolicy] = None,
    exclude_pids: Optional[Set[int]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    policy = policy or ShutdownPolicy()
    exclude_pids = exclude_pids or set()

    stats: Dict[str, Any] = {
        "total": len(plan),
        "terminated": 0,
        "clean_exits": 0,
        "force_killed": 0,
        "errors": [],
    }

    def _log(msg: str) -> None:
        if log:
            try:
                log(msg)
            except Exception:
                pass

    for rec in plan:
        pid = rec.pid
        if not pid or pid in exclude_pids:
            continue

        if manager and rec.shell_id:
            try:
                _log(f"terminate shell {rec.shell_id} (pid={pid})")
                await manager.terminate_shell(rec.shell_id, force=True)
            except Exception as exc:
                stats["errors"].append(f"shell {rec.shell_id}: {exc}")
        else:
            try:
                _log(f"terminate pid={pid} type={rec.type}")
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except Exception as exc:
                stats["errors"].append(f"PID {pid}: {exc}")

        # Wait for clean exit.
        clean = _wait_pid_exit(pid, timeout_s=policy.sigterm_timeout_s, poll_interval_s=policy.poll_interval_s)
        if clean:
            stats["clean_exits"] += 1
            stats["terminated"] += 1
            continue

        # Escalate.
        try:
            _log(f"sigkill pid={pid}")
            os.kill(pid, signal.SIGKILL)
            stats["force_killed"] += 1
        except ProcessLookupError:
            stats["clean_exits"] += 1
        except Exception as exc:
            stats["errors"].append(f"PID {pid} SIGKILL: {exc}")

        _wait_pid_exit(pid, timeout_s=policy.sigkill_timeout_s, poll_interval_s=policy.poll_interval_s)
        stats["terminated"] += 1

    return stats


async def shutdown_snapshot(
    snapshot: ProcessSnapshot,
    *,
    manager: Optional[FrameworkShellManager] = None,
    policy: Optional[ShutdownPolicy] = None,
    root_pids: Optional[Iterable[int]] = None,
    exclude_pids: Optional[Set[int]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Plan and execute a shutdown against a snapshot.

    If `root_pids` is provided, only that subtree is shut down.
    """
    policy = policy or ShutdownPolicy()
    processes = list(snapshot.processes.values())
    if root_pids is not None:
        keep = collect_descendants(snapshot, root_pids=root_pids)
        processes = [p for p in processes if p.pid in keep]
    plan = plan_shutdown(processes, policy=policy)
    return await execute_shutdown_plan(plan, manager=manager, policy=policy, exclude_pids=exclude_pids, log=log)

