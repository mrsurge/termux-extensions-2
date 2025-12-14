"""Core-managed framework shell orchestration.

This module exposes a FastAPI APIRouter plus a light manager that can spawn,
inspect, and control long-running background processes ("framework shells").
The shells inherit `TE_SESSION_TYPE=framework`, keeping them out of the
interactive Sessions UI while allowing extensions to manage supporting
services such as aria2 RPC, container helpers, or LLM runtimes.
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import json
import os
import pty
import select
import shlex
import shutil
import signal
import struct
import subprocess
import termios
import time
import uuid
from asyncio import Lock as AsyncLock
from asyncio import Queue as AsyncQueue
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional

import aiofiles
from fastapi import APIRouter, Depends, Request, HTTPException, Header, Body, Query

framework_shells_bp = APIRouter()



try:  # Optional dependency for richer process metrics.
    import psutil  # type: ignore
except Exception:  # pragma: no cover - psutil may be unavailable.
    psutil = None  # type: ignore

HOME_DIR = Path(os.path.expanduser("~"))
DEFAULT_BASE_DIR = HOME_DIR / ".cache" / "te_framework"
DEFAULT_MAX_SHELLS = 5
LOG_TAIL_BYTES = 4096
LOG_TAIL_LINES = 200

def _shell_debug(stage: str, message: str) -> None:
    print(f"[PTY][{stage}] {message}")


@dataclass
class ShellRecord:
    """Serializable metadata describing a framework shell."""

    id: str
    command: List[str]
    label: Optional[str]
    cwd: str
    env_overrides: Dict[str, str]
    pid: Optional[int]
    status: str
    created_at: float
    updated_at: float
    autostart: bool
    stdout_log: str
    stderr_log: str
    exit_code: Optional[int] = None
    subgroups: List[str] = field(default_factory=list)
    ui: Dict[str, Any] = field(default_factory=dict)
    run_id: Optional[str] = None
    launcher_pid: Optional[int] = None
    adopted: bool = False
    uses_pty: bool = False
    uses_pipes: bool = False

    def to_payload(self, *, include_env: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "command": list(self.command),
            "label": self.label,
            "subgroups": list(self.subgroups or []),
            "ui": dict(self.ui or {}),
            "cwd": self.cwd,
            "pid": self.pid,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "autostart": self.autostart,
            "stdout_log": self.stdout_log,
            "stderr_log": self.stderr_log,
            "exit_code": self.exit_code,
            "env_keys": sorted(self.env_overrides.keys()),
            "run_id": self.run_id,
            "launcher_pid": self.launcher_pid,
            "adopted": self.adopted,
            "uses_pty": self.uses_pty,
            "uses_pipes": self.uses_pipes,
        }
        if include_env:
            payload["env_overrides"] = dict(self.env_overrides)
        return payload


@dataclass
class PTYState:
    master_fd: int
    label: Optional[str] = None
    shell_id: Optional[str] = None
    subscribers: List["AsyncQueue[str]"] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader: Optional[asyncio.Task] = None


@dataclass
class PipeState:
    """State for shells with live stdin/stdout pipes (for LSP, etc.)."""
    process: asyncio.subprocess.Process
    label: Optional[str] = None
    shell_id: Optional[str] = None
    stop: asyncio.Event = field(default_factory=asyncio.Event)


class FrameworkShellManager:
    """Creates and tracks background framework shells."""

    def __init__(
        self,
        *,
        base_dir: Optional[Path] = None,
        max_app_shells: Optional[int] = None,
        max_service_shells: Optional[int] = None,
        auth_token: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> None:
        self.base_dir = base_dir or DEFAULT_BASE_DIR
        self.metadata_dir = self.base_dir / "meta"
        self.logs_dir = self.base_dir / "logs"
        self.sockets_dir = self.base_dir / "sockets"
        for directory in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.max_app_shells = max_app_shells if max_app_shells is not None else 5
        self.max_service_shells = max_service_shells if max_service_shells is not None else 5
        self.auth_token = auth_token or os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
        self.run_id = run_id or os.getenv("TE_RUN_ID")
        self.launcher_pid = os.getpid()
        self.started_at = time.time()
        self._pty: Dict[str, PTYState] = {}
        self._pipes: Dict[str, PipeState] = {}

    def _get_lock(self):
        """Get or create the instance lock (lazy initialization)."""
        if not hasattr(self, '_lock_instance'):
            self._lock_instance = asyncio.Lock()
        return self._lock_instance

    # ------------------------------------------------------------------
    # Adoption and helpers

    async def _adopt_orphaned_shells(self) -> None:
        """Reclaim shells from previous runs and purge stale metadata."""
        stale_records: List[ShellRecord] = []
        updated = 0
        async with self._get_lock():
            async for record in self._aiter_records():
                alive = bool(record.pid) and await self._is_pid_alive(record.pid)
                if record.pid and not alive:
                    exit_code = record.exit_code or await self._collect_exit_code(record.pid)
                    await self._mark_exited(record, exit_code)
                    record.pid = None
                    record.status = "exited"
                    stale_records.append(record)
                    continue
                if not alive:
                    stale_records.append(record)
                    continue
                if not self.run_id:
                    continue
                mutated = False
                if not record.run_id or record.run_id != self.run_id:
                    record.run_id = self.run_id
                    mutated = True
                if record.launcher_pid != self.launcher_pid:
                    record.launcher_pid = self.launcher_pid
                    mutated = True
                if mutated:
                    record.adopted = True
                    await self._save_record(record)
                    updated += 1
            for record in stale_records:
                await self._stop_pty(record.id)
                await self._purge_record_files(record)
                print(f"[FrameworkShells] Cleaned orphaned shell {record.id} (stale metadata removed)")
        if updated:
            print(f"[FrameworkShells] Adopted {updated} running shell(s) from previous run")

    async def list_active_pids(self) -> List[int]:
        async with self._get_lock():
            pids: List[int] = []
            async for record in self._aiter_records():
                if record.pid and await self._is_pid_alive(record.pid):
                    pids.append(record.pid)
            return pids

    async def aggregate_resource_stats(self) -> Dict[str, Any]:
        async with self._get_lock():
            now = time.time()
            stats: Dict[str, Any] = {
                "run_id": self.run_id,
                "launcher_pid": self.launcher_pid,
                "started_at": self.started_at,
                "uptime": max(0.0, now - self.started_at),
                "num_shells": 0,
                "num_running": 0,
                "num_adopted": 0,
                "cpu_percent": 0.0,
                "memory_rss": 0,
                "pids": [],
                "has_psutil": bool(psutil),
            }
            running_records: List[ShellRecord] = []
            adopted_count = 0
            async for record in self._aiter_records():
                stats["num_shells"] += 1
                if getattr(record, "adopted", False):
                    adopted_count += 1
                if record.pid and await self._is_pid_alive(record.pid):
                    stats["num_running"] += 1
                    stats["pids"].append(record.pid)
                    running_records.append(record)
            stats["num_adopted"] = adopted_count
            if psutil:
                cpu_total = 0.0
                rss_total = 0
                for rec in running_records:
                    try:
                        proc = await asyncio.to_thread(psutil.Process, rec.pid)  # type: ignore[arg-type]
                        with proc.oneshot():
                            cpu_total += proc.cpu_percent(interval=0.0)
                            rss_total += proc.memory_info().rss
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                stats["cpu_percent"] = cpu_total
                stats["memory_rss"] = rss_total
            else:
                for rec in running_records:
                    try:
                        ps_output = await asyncio.to_thread(
                            subprocess.run,
                            [
                                "ps",
                                "-p",
                                str(rec.pid),
                                "-o",
                                "%cpu=,%mem=,rss=",
                            ],
                            capture_output=True,
                            text=True,
                            check=True,
                        )
                        parts = ps_output.stdout.strip().split()
                        if len(parts) >= 3:
                            cpu_val = float(parts[0])
                            rss_kb = float(parts[2])
                            stats["cpu_percent"] += cpu_val
                            stats["memory_rss"] += int(rss_kb * 1024)
                    except Exception:
                        continue
            return stats

    # ------------------------------------------------------------------
    # Record persistence helpers

    async def _aiter_records(self) -> AsyncIterator[ShellRecord]:
        meta_paths = sorted(self.metadata_dir.glob("*/meta.json"))
        for meta in meta_paths:
            record = await self._load_record(meta.parent.name)
            if record:
                yield record

    async def _load_record(self, shell_id: str) -> Optional[ShellRecord]:
        meta_path = self.metadata_dir / shell_id / "meta.json"
        if not meta_path.exists():
            return None
        try:
            async with aiofiles.open(meta_path, "r", encoding="utf-8") as fh:
                content = await fh.read()
                data = json.loads(content)
        except Exception:
            return None
        try:
            raw_subgroups = data.get("subgroups") or []
            if not isinstance(raw_subgroups, list):
                raw_subgroups = []
            subgroups = [str(v) for v in raw_subgroups if isinstance(v, (str, int, float)) and str(v).strip()]
            ui = data.get("ui") or {}
            if not isinstance(ui, dict):
                ui = {}
            return ShellRecord(
                id=data.get("id", shell_id),
                command=list(data.get("command") or []),
                label=data.get("label"),
                subgroups=subgroups,
                ui=ui,
                cwd=data.get("cwd", str(HOME_DIR)),
                env_overrides=dict(data.get("env_overrides") or {}),
                pid=data.get("pid"),
                status=data.get("status", "unknown"),
                created_at=float(data.get("created_at", time.time())),
                updated_at=float(data.get("updated_at", time.time())),
                autostart=bool(data.get("autostart", False)),
                stdout_log=data.get(
                    "stdout_log",
                    str(self.logs_dir / f'{data.get("id", shell_id)}.stdout.log'),
                ),
                stderr_log=data.get(
                    "stderr_log",
                    str(self.logs_dir / f'{data.get("id", shell_id)}.stderr.log'),
                ),
                exit_code=data.get("exit_code"),
                run_id=data.get("run_id"),
                launcher_pid=data.get("launcher_pid"),
                adopted=bool(data.get("adopted", False)),
                uses_pty=bool(data.get("uses_pty", False)),
                uses_pipes=bool(data.get("uses_pipes", False)),
            )
        except Exception:
            return None

    async def _save_record(self, record: ShellRecord) -> None:
        record_dir = self.metadata_dir / record.id
        await asyncio.to_thread(record_dir.mkdir, parents=True, exist_ok=True)
        tmp_path = record_dir / "meta.json.tmp"
        meta_path = record_dir / "meta.json"
        data = {
            "id": record.id,
            "command": record.command,
            "label": record.label,
            "subgroups": list(record.subgroups or []),
            "ui": dict(record.ui or {}),
            "cwd": record.cwd,
            "env_overrides": record.env_overrides,
            "pid": record.pid,
            "status": record.status,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "autostart": record.autostart,
            "stdout_log": record.stdout_log,
            "stderr_log": record.stderr_log,
            "exit_code": record.exit_code,
            "run_id": record.run_id,
            "launcher_pid": record.launcher_pid,
            "adopted": record.adopted,
            "uses_pty": record.uses_pty,
            "uses_pipes": record.uses_pipes,
        }
        async with aiofiles.open(tmp_path, "w", encoding="utf-8") as fh:
            await fh.write(json.dumps(data, indent=2))
        await asyncio.to_thread(tmp_path.replace, meta_path)

    # ------------------------------------------------------------------
    # Core helpers

    def _normalize_command(self, command: Iterable[str]) -> List[str]:
        if isinstance(command, str):  # pragma: no cover - defensive fallback
            command = shlex.split(command)
        cmd_list = [str(part) for part in command]
        if not cmd_list:
            raise ValueError("command must contain at least one argument")
        return cmd_list

    def _resolve_cwd(self, cwd: Optional[str]) -> str:
        target = Path(os.path.expanduser(cwd or str(HOME_DIR))).resolve()
        if not str(target).startswith(str(HOME_DIR)):
            raise ValueError("cwd must remain inside the user home directory")
        if not target.exists():
            target.mkdir(parents=True, exist_ok=True)
        return str(target)

    def _prepare_env(self, record: ShellRecord) -> Dict[str, str]:
        env = os.environ.copy()
        run_id = record.run_id or os.environ.get("TE_RUN_ID", "")
        if run_id:
            env.setdefault("TE_RUN_ID", run_id)
            env.setdefault("TE_FRAMEWORK_SHELL_RUN_ID", str(run_id))
        launcher_pid = record.launcher_pid or getattr(self, "launcher_pid", None) or os.getpid()
        env.setdefault("TE_FRAMEWORK_LAUNCHER_PID", str(launcher_pid))
        env.setdefault("TE_FRAMEWORK_SHELL_LAUNCHER_PID", str(launcher_pid))
        env.update(record.env_overrides)
        env.setdefault("TE_SESSION_TYPE", "framework")
        env.setdefault("TE_FRAMEWORK_SHELL_ID", record.id)
        env.setdefault("TE_FRAMEWORK_SHELL_ADOPTED", "1" if getattr(record, "adopted", False) else "0")
        return env

    def _create_record(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str],
        env: Optional[Dict[str, str]],
        label: Optional[str],
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool,
        uses_pty: bool = False,
        uses_pipes: bool = False,
    ) -> ShellRecord:
        shell_id = f"fs_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        command_list = self._normalize_command(command)
        cwd_path = self._resolve_cwd(cwd)
        overrides = dict(env or {})
        run_id = self.run_id or os.environ.get("TE_RUN_ID")
        if run_id:
            overrides.setdefault("TE_RUN_ID", run_id)
        overrides.setdefault("TE_SPAWNED_BY", "framework_shell_manager")
        now = time.time()
        normalized_subgroups = []
        for value in (subgroups or []):
            try:
                text = str(value).strip()
            except Exception:
                continue
            if text:
                normalized_subgroups.append(text)

        normalized_ui: Dict[str, Any] = {}
        if isinstance(ui, dict) and ui:
            # Ensure UI metadata is JSON-serializable and safe to persist.
            try:
                normalized_ui = json.loads(json.dumps(ui))
                if not isinstance(normalized_ui, dict):
                    normalized_ui = {}
            except Exception:
                normalized_ui = {}
        return ShellRecord(
            id=shell_id,
            command=command_list,
            label=label,
            subgroups=normalized_subgroups,
            ui=normalized_ui,
            cwd=cwd_path,
            env_overrides=overrides,
            pid=None,
            status="pending",
            created_at=now,
            updated_at=now,
            autostart=autostart,
            stdout_log=str(self.logs_dir / f"{shell_id}.stdout.log"),
            stderr_log=str(self.logs_dir / f"{shell_id}.stderr.log"),
            exit_code=None,
            run_id=run_id,
            launcher_pid=self.launcher_pid,
            adopted=False,
            uses_pty=uses_pty,
            uses_pipes=uses_pipes,
        )

    async def _launch(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = False
        env = self._prepare_env(record)
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        await asyncio.to_thread(stdout_path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(stderr_path.parent.mkdir, parents=True, exist_ok=True)
        
        # Open files in binary append mode
        stdout_fh = await asyncio.to_thread(open, stdout_path, "ab")
        stderr_fh = await asyncio.to_thread(open, stderr_path, "ab")
        
        try:
            proc = await asyncio.create_subprocess_exec(
                *record.command,
                cwd=record.cwd,
                env=env,
                stdout=stdout_fh,
                stderr=stderr_fh,
                start_new_session=True,
            )
            record.pid = proc.pid
            record.status = "running"
            record.exit_code = None
            record.updated_at = time.time()
            await self._save_record(record)
            
            # Register with IPC
            from app.ipc.client import register_process
            shell_type = "worker" if (record.label or "").startswith("app-worker:") else "shell"
            register_process(
                pid=record.pid,
                type=shell_type,
                label=record.label,
                parent_pid=os.getpid(),
                metadata={
                    "shell_id": record.id,
                    "command": " ".join(record.command),
                    "cwd": record.cwd,
                }
            )
            
            return record
        finally:
            await asyncio.to_thread(stdout_fh.close)
            await asyncio.to_thread(stderr_fh.close)

    async def _launch_pty(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = True
        master_fd, slave_fd = await asyncio.to_thread(pty.openpty)
        envp = self._prepare_env(record)
        envp.setdefault("TERM", "xterm-256color")
        envp.setdefault("TE_TTY", "pty")
        
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        await asyncio.to_thread(stdout_path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(stdout_path.touch, exist_ok=True)
        await asyncio.to_thread(stderr_path.touch, exist_ok=True)
        
        # Configure PTY to raw mode to avoid 4096-byte line limit (ICANON)
        try:
            attrs = termios.tcgetattr(slave_fd)
            # iflag: Clear ICRNL (translate CR to NL), IXON (flow control)
            attrs[0] = attrs[0] & ~(termios.ICRNL | termios.IXON)
            # oflag: Clear OPOST (output processing)
            attrs[1] = attrs[1] & ~termios.OPOST
            # lflag: Clear ICANON (canonical mode), ECHO (local echo), ISIG (signals)
            attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO | termios.ISIG)
            # cc: Set VMIN=1, VTIME=0 (blocking read)
            attrs[6][termios.VMIN] = 1
            attrs[6][termios.VTIME] = 0
            termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
        except termios.error:
            _shell_debug("PTY launch", "Failed to set termios attributes (raw mode)")

        try:
            proc = await asyncio.create_subprocess_exec(
                *record.command,
                cwd=record.cwd,
                env=envp,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
            )
        finally:
            await asyncio.to_thread(os.close, slave_fd)
        
        record.pid = proc.pid
        record.status = "running"
        record.exit_code = None
        record.updated_at = time.time()
        await self._save_record(record)
        
        # Register with IPC
        from app.ipc.client import register_process
        shell_type = "worker" if (record.label or "").startswith("app-worker:") else "shell"
        register_process(
            pid=record.pid,
            type=shell_type,
            label=record.label,
            parent_pid=os.getpid(),
            metadata={
                "shell_id": record.id,
                "command": " ".join(record.command),
                "cwd": record.cwd,
                "uses_pty": True,
            }
        )
        
        state = PTYState(
            master_fd=master_fd,
            label=record.label,
            shell_id=record.id,
        )
        
        async def _async_reader() -> None:
            log_path = Path(record.stdout_log)
            async with aiofiles.open(log_path, "ab") as log_fh:
                while not state.stop.is_set():
                    try:
                        # Use asyncio event loop to read from FD
                        ready = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(
                                None, 
                                lambda: select.select([master_fd], [], [], 0.5)
                            ),
                            timeout=0.6
                        )
                        rlist, _, _ = ready
                        if not rlist:
                            continue
                        data = await asyncio.to_thread(os.read, master_fd, 4096)
                        if not data:
                            await asyncio.sleep(0.05)
                            continue
                    except asyncio.TimeoutError:
                        # Executor/select may occasionally exceed the timeout on busy systems.
                        # Treat as "no data yet" instead of tearing down the PTY.
                        continue
                    except OSError as exc:
                        _shell_debug("PTY recv", f"select/read error shell={record.id}: {exc}")
                        break
                    
                    try:
                        await log_fh.write(data)
                        await log_fh.flush()
                    except Exception:
                        pass
                    
                    text = data.decode("utf-8", errors="replace")
                    preview = text.strip().replace("\n", "\\n")
                    if preview:
                        _shell_debug(
                            "PTY recv",
                            f"shell={record.id} label={record.label} chunk={preview[:200]}"
                        )
                    subscribers = list(state.subscribers)
                    for q in subscribers:
                        try:
                            await q.put(text)
                        except Exception:
                            pass
            
            try:
                await asyncio.to_thread(os.close, master_fd)
            except Exception:
                pass
        
        reader_task = asyncio.create_task(_async_reader())
        state.reader = reader_task
        self._pty[record.id] = state
        return record

    async def _launch_pipe(self, record: ShellRecord) -> ShellRecord:
        """Launch shell with live stdin/stdout pipes for bidirectional streaming."""
        record.uses_pipes = True
        record.uses_pty = False
        env = self._prepare_env(record)
        
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        await asyncio.to_thread(stdout_path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(stdout_path.touch, exist_ok=True)
        await asyncio.to_thread(stderr_path.touch, exist_ok=True)
        
        # Spawn with PIPE for stdin/stdout, stderr to log file
        stderr_fh = await asyncio.to_thread(open, stderr_path, "ab")
        try:
            proc = await asyncio.create_subprocess_exec(
                *record.command,
                cwd=record.cwd,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=stderr_fh,
                start_new_session=True,
            )
        finally:
            await asyncio.to_thread(stderr_fh.close)
        
        record.pid = proc.pid
        record.status = "running"
        record.exit_code = None
        record.updated_at = time.time()
        await self._save_record(record)
        
        # Register with IPC
        from app.ipc.client import register_process
        register_process(
            pid=record.pid,
            type="shell",
            label=record.label,
            parent_pid=os.getpid(),
            metadata={
                "shell_id": record.id,
                "command": " ".join(record.command),
                "cwd": record.cwd,
                "uses_pipes": True,
            }
        )
        
        state = PipeState(
            process=proc,
            label=record.label,
            shell_id=record.id,
        )
        self._pipes[record.id] = state
        return record

    async def _is_pid_alive(self, pid: Optional[int]) -> bool:
        if not pid:
            return False
        try:
            await asyncio.to_thread(os.kill, pid, 0)
        except PermissionError:
            return True
        except OSError as exc:  # includes ProcessLookupError
            if getattr(exc, "errno", None) == errno.EPERM:
                return True
            return False
        return True

    async def _collect_exit_code(self, pid: Optional[int]) -> Optional[int]:
        if not pid:
            return None
        try:
            waited_pid, status = await asyncio.to_thread(os.waitpid, pid, os.WNOHANG)
            if waited_pid == 0:
                return None
            if os.WIFEXITED(status):
                return os.WEXITSTATUS(status)
            if os.WIFSIGNALED(status):
                return -os.WTERMSIG(status)
        except ChildProcessError:
            return None
        except OSError:
            return None
        return None

    async def _mark_exited(self, record: ShellRecord, exit_code: Optional[int]) -> None:
        record.pid = None
        record.status = "exited"
        record.exit_code = exit_code
        record.updated_at = time.time()
        await self._save_record(record)

    async def _active_shell_count(self, app_shell: bool = False) -> int:
        count = 0
        async for r in self._aiter_records():
            if r.status == "running" and (r.label or "").startswith("app-worker:") == app_shell:
                count += 1
        return count

    async def _stop_pty(self, shell_id: str) -> None:
        state = self._pty.pop(shell_id, None)
        if not state:
            return
        state.stop.set()
        if state.reader:
            state.reader.cancel()
            try:
                await state.reader
            except asyncio.CancelledError:
                pass
        try:
            await asyncio.to_thread(os.close, state.master_fd)
        except Exception:
            pass

    async def _stop_pipe(self, shell_id: str) -> None:
        state = self._pipes.pop(shell_id, None)
        if not state:
            return
        state.stop.set()
        proc = state.process
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.close()
            try:
                await proc.stdin.wait_closed()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Public manager API

    async def list_shells(self) -> List[ShellRecord]:
        async with self._get_lock():
            await self.sweep()
            records = []
            async for record in self._aiter_records():
                records.append(record)
            return sorted(records, key=lambda rec: rec.created_at)

    async def get_shell(self, shell_id: str) -> Optional[ShellRecord]:
        async with self._get_lock():
            await self.sweep()
            return await self._load_record(shell_id)

    async def _find_shell_by_label_unlocked(self, label: str, status: Optional[str]) -> Optional[ShellRecord]:
        if not label:
            return None
        async for record in self._aiter_records():
            if record.label != label:
                continue
            if status and record.status != status:
                continue
            if status == "running" and not await self._is_pid_alive(record.pid):
                continue
            return record
        return None

    async def find_shell_by_label(self, label: str, status: Optional[str] = "running") -> Optional[ShellRecord]:
        """Find the first shell matching the given label and optional status."""
        if not label:
            return None
        async with self._get_lock():
            await self.sweep()
            return await self._find_shell_by_label_unlocked(label, status)

    async def spawn_shell(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = False,
    ) -> ShellRecord:
        async with self._get_lock():
            from app.libs import app_lifecycle
            await self.sweep()
            if label:
                existing = await self._find_shell_by_label_unlocked(label, status="running")
                if existing:
                    return existing
            is_app_worker = (label or "").startswith("app-worker:")
            limit = self.max_app_shells if is_app_worker else self.max_service_shells
            if limit and await self._active_shell_count(app_shell=is_app_worker) >= limit:
                if is_app_worker:
                    # Attempt to clean up the oldest unlocked app
                    running_apps = await app_lifecycle.get_running_apps(self)
                    unlocked_apps = [app for app in running_apps if not app.get("locked")]
                    if unlocked_apps:
                        oldest_app = unlocked_apps[0]
                        print(f"[FrameworkShells] Max app shells reached. Terminating oldest unlocked app: {oldest_app.get('app_id')}")
                        await app_lifecycle.terminate_app(self, oldest_app["shell_id"])
                        await asyncio.sleep(0.5)
                        if await self._active_shell_count(app_shell=True) >= self.max_app_shells:
                            raise RuntimeError("Maximum app shell count reached and could not free a slot.")
                    else:
                        raise RuntimeError("Maximum app shell count reached and all running apps are locked.")
                else:
                    raise RuntimeError(f"Maximum service shell count ({self.max_service_shells}) reached.")

            record = self._create_record(
                command,
                cwd=cwd,
                env=env,
                label=label,
                subgroups=subgroups,
                ui=ui,
                autostart=autostart,
            )
            return await self._launch(record)

    async def spawn_shell_pty(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = True,
    ) -> ShellRecord:
        async with self._get_lock():
            from app.libs import app_lifecycle
            await self.sweep()
            if label:
                existing = await self._find_shell_by_label_unlocked(label, status="running")
                if existing:
                    return existing
            is_app_worker = (label or "").startswith("app-worker:")
            limit = self.max_app_shells if is_app_worker else self.max_service_shells
            if limit and await self._active_shell_count(app_shell=is_app_worker) >= limit:
                if is_app_worker:
                    running_apps = await app_lifecycle.get_running_apps(self)
                    unlocked_apps = [app for app in running_apps if not app.get("locked")]
                    if unlocked_apps:
                        oldest_app = unlocked_apps[0]
                        print(f"[FrameworkShells] Max app shells reached. Terminating oldest unlocked app: {oldest_app.get('app_id')}")
                        await app_lifecycle.terminate_app(self, oldest_app["shell_id"])
                        await asyncio.sleep(0.5)
                        if await self._active_shell_count(app_shell=True) >= self.max_app_shells:
                            raise RuntimeError("Maximum app shell count reached and could not free a slot.")
                    else:
                        raise RuntimeError("Maximum app shell count reached and all running apps are locked.")
                else:
                    raise RuntimeError(f"Maximum service shell count ({self.max_service_shells}) reached.")

            record = self._create_record(
                command,
                cwd=cwd,
                env=env,
                label=label,
                subgroups=subgroups,
                ui=ui,
                autostart=autostart,
                uses_pty=True,
            )
            return await self._launch_pty(record)

    async def spawn_shell_pipe(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = False,
    ) -> ShellRecord:
        """Spawn shell with live stdin/stdout pipes for bidirectional streaming (LSP, etc.)."""
        async with self._get_lock():
            await self.sweep()
            if label:
                existing = await self._find_shell_by_label_unlocked(label, status="running")
                if existing:
                    return existing
            is_app_worker = (label or "").startswith("app-worker:")
            limit = self.max_app_shells if is_app_worker else self.max_service_shells
            if limit and await self._active_shell_count(app_shell=is_app_worker) >= limit:
                raise RuntimeError(f"Maximum shell count reached.")

            record = self._create_record(
                command,
                cwd=cwd,
                env=env,
                label=label,
                subgroups=subgroups,
                ui=ui,
                autostart=autostart,
                uses_pipes=True,
            )
            return await self._launch_pipe(record)

    def get_pipe_state(self, shell_id: str) -> Optional[PipeState]:
        """Get pipe state for direct stdin/stdout access (no lock, caller manages)."""
        return self._pipes.get(shell_id)

    async def write_to_pty(self, shell_id: str, data: bytes | str) -> None:
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            payload = data.encode("utf-8") if isinstance(data, str) else data
            preview = payload[:200].decode("utf-8", errors="replace")
            _shell_debug(
                "PTY write",
                f"shell={shell_id} label={state.label} bytes={len(payload)} data={preview}"
            )
            try:
                # Chunk writes to handle PTY buffer limits (typically 4096 bytes)
                # and partial writes. os.write returns bytes written.
                offset = 0
                total = len(payload)
                while offset < total:
                    # Write in chunks of 4096 to be safe and efficient with PTY interactions
                    chunk = payload[offset:offset + 4096]
                    written = await asyncio.to_thread(os.write, state.master_fd, chunk)
                    if written == 0:
                        _shell_debug("PTY write", f"zero write shell={shell_id}")
                        # Avoid infinite loop if PTY is in a weird state
                        break
                    offset += written
            except OSError as exc:
                _shell_debug("PTY write", f"error shell={shell_id}: {exc}")
                raise
            else:
                _shell_debug("PTY write", f"complete shell={shell_id} bytes={total}")

    async def subscribe_output(self, shell_id: str) -> "AsyncQueue[str]":
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            q: "AsyncQueue[str]" = AsyncQueue()
            state.subscribers.append(q)
            return q

    async def unsubscribe_output(self, shell_id: str, q: "AsyncQueue[str]") -> None:
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                return
            try:
                state.subscribers.remove(q)
            except ValueError:
                pass

    async def resize_pty(self, shell_id: str, cols: int, rows: int) -> None:
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            winsz = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
            try:
                await asyncio.to_thread(fcntl.ioctl, state.master_fd, termios.TIOCSWINSZ, winsz)
            except Exception:
                pass

    async def terminate_shell(self, shell_id: str, *, force: bool = False, timeout: float = 5.0) -> ShellRecord:
        async with self._get_lock():
            record = await self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            if not record.pid or not await self._is_pid_alive(record.pid):
                exit_code = record.exit_code or await self._collect_exit_code(record.pid)
                await self._mark_exited(record, exit_code)
                await self._stop_pty(shell_id)
                await self._stop_pipe(shell_id)
                return record
            
            # Unregister from IPC before killing
            from app.ipc.client import unregister_process
            unregister_process(record.pid)
            
            sig = signal.SIGKILL if force else signal.SIGTERM
            
            try:
                await asyncio.to_thread(os.killpg, record.pid, sig)
            except ProcessLookupError:
                exit_code = record.exit_code or await self._collect_exit_code(record.pid)
                await self._mark_exited(record, exit_code)
                await self._stop_pty(shell_id)
                await self._stop_pipe(shell_id)
                return record
            
            if not force:
                deadline = time.time() + max(0.0, timeout)
                while time.time() < deadline:
                    if not await self._is_pid_alive(record.pid):
                        break
                    await asyncio.sleep(0.1)
                if await self._is_pid_alive(record.pid):
                    try:
                        await asyncio.to_thread(os.killpg, record.pid, signal.SIGKILL)
                    except (ProcessLookupError, OSError):
                        pass
            
            exit_code = await self._collect_exit_code(record.pid)
            await self._mark_exited(record, exit_code)
            await self._stop_pty(shell_id)
            await self._stop_pipe(shell_id)
            return record

    async def restart_shell(self, shell_id: str) -> ShellRecord:
        async with self._get_lock():
            record = await self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            await self.terminate_shell(shell_id, force=True)
            now = time.time()
            record.created_at = now
            record.updated_at = now
            record.exit_code = None
            record.status = "pending"
            await self._save_record(record)
            if record.uses_pty:
                return await self._launch_pty(record)
            if record.uses_pipes:
                return await self._launch_pipe(record)
            return await self._launch(record)

    async def remove_shell(self, shell_id: str, *, force: bool = False) -> None:
        # NOTE: terminate_shell() acquires the same manager lock.
        # Do not call it while holding _get_lock(), or we deadlock.
        async with self._get_lock():
            record = await self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            pid = record.pid

        # Unregister from IPC (defensive - should already be unregistered by terminate_shell)
        if pid:
            try:
                from app.ipc.client import unregister_process
                unregister_process(pid)
            except Exception:
                pass

        if pid and await self._is_pid_alive(pid):
            # Terminate outside lock to avoid deadlock.
            await self.terminate_shell(shell_id, force=force)

        async with self._get_lock():
            # Reload record in case terminate_shell mutated it.
            record = await self._load_record(shell_id)
            if not record:
                return
            await self._stop_pty(shell_id)
            await self._stop_pipe(shell_id)
            await self._purge_record_files(record)

    async def _purge_record_files(self, record: ShellRecord) -> None:
        """Delete metadata and log files for a shell record."""
        await asyncio.to_thread(shutil.rmtree, self.metadata_dir / record.id, ignore_errors=True)
        for log_path in (record.stdout_log, record.stderr_log):
            if not log_path:
                continue
            try:
                await asyncio.to_thread(Path(log_path).unlink)
            except FileNotFoundError:
                pass
            except IsADirectoryError:
                await asyncio.to_thread(shutil.rmtree, Path(log_path), ignore_errors=True)

    async def sweep(self) -> None:
        records = []
        async for record in self._aiter_records():
            records.append(record)
        for record in records:
            if record.pid and not await self._is_pid_alive(record.pid):
                exit_code = record.exit_code or await self._collect_exit_code(record.pid)
                await self._mark_exited(record, exit_code)

    async def describe(
        self,
        record: ShellRecord,
        *,
        include_logs: bool = False,
        tail_lines: int = 0,
    ) -> Dict[str, Any]:
        payload = record.to_payload()
        payload["stats"] = await self._process_stats(record)
        if include_logs:
            payload["logs"] = {
                "stdout_tail": await self._read_log_tail(Path(record.stdout_log), tail_lines),
                "stderr_tail": await self._read_log_tail(Path(record.stderr_log), tail_lines),
            }
        return payload

    async def _process_stats(self, record: ShellRecord) -> Dict[str, Any]:
        stats: Dict[str, Any] = {
            "alive": False,
            "uptime": None,
        }
        if record.pid:
            alive = await self._is_pid_alive(record.pid)
            stats["alive"] = alive
            if alive:
                stats["uptime"] = max(0.0, time.time() - record.created_at)
                if psutil:
                    try:
                        proc = await asyncio.to_thread(psutil.Process, record.pid)  # type: ignore[arg-type]
                        with proc.oneshot():
                            stats["cpu_percent"] = proc.cpu_percent(interval=0.0)
                            stats["memory_rss"] = proc.memory_info().rss
                            stats["num_threads"] = proc.num_threads()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                else:
                    try:
                        ps_output = await asyncio.to_thread(
                            subprocess.run,
                            [
                                "ps",
                                "-p",
                                str(record.pid),
                                "-o",
                                "%cpu=,%mem=,rss=,nlwp=",
                            ],
                            capture_output=True,
                            text=True,
                            check=True,
                        )
                        parts = ps_output.stdout.strip().split()
                        if len(parts) >= 4:
                            cpu = float(parts[0])
                            rss_kb = float(parts[2])
                            threads = int(parts[3])
                            stats["cpu_percent"] = cpu
                            stats["memory_rss"] = int(rss_kb * 1024)
                            stats["num_threads"] = threads
                    except Exception:
                        pass
        return stats

    async def _read_log_tail(self, path: Path, lines: int) -> List[str]:
        if lines <= 0 or not path.exists():
            return []
        size = await asyncio.to_thread(path.stat)
        to_read = min(size.st_size, LOG_TAIL_BYTES)
        async with aiofiles.open(path, "rb") as fh:
            await fh.seek(-to_read, os.SEEK_END)
            data = await fh.read()
            decoded_data = data.decode("utf-8", errors="replace")
        # Use splitlines(keepends=True) to preserve line terminators
        return decoded_data.splitlines(keepends=True)[-lines:]


# ----------------------------------------------------------------------


# FastAPI blueprint

from app.libs.shell_groups import terminate_group

_manager_instance: Optional[FrameworkShellManager] = None

async def get_manager() -> FrameworkShellManager:
    global _manager_instance
    if _manager_instance is None:
        # Ensure we're in async context
        loop = asyncio.get_running_loop()  # Raises RuntimeError if no loop
        
        # Create lock on-demand
        if not hasattr(get_manager, '_lock'):
            get_manager._lock = asyncio.Lock()
        
        async with get_manager._lock:
            if _manager_instance is None:
                base_dir_setting = os.getenv("TE_FRAMEWORK_SHELL_DIR")
                base_dir = Path(base_dir_setting) if base_dir_setting else None
                # Try to get from settings file first, then fall back to env vars
                try:
                    from app.main import get_setting
                    max_app_shells = get_setting("TE_MAX_APP_SHELLS")
                    max_service_shells = get_setting("TE_MAX_SERVICE_SHELLS")
                except Exception:
                    max_app_shells = None
                    max_service_shells = None
                
                # Fall back to environment variables
                if max_app_shells is None:
                    max_app_shells_setting = os.getenv("TE_MAX_APP_SHELLS")
                    max_app_shells = int(max_app_shells_setting) if max_app_shells_setting else 5
                else:
                    max_app_shells = int(max_app_shells)
                    
                if max_service_shells is None:
                    max_service_shells_setting = os.getenv("TE_MAX_SERVICE_SHELLS")
                    max_service_shells = int(max_service_shells_setting) if max_service_shells_setting else 5
                else:
                    max_service_shells = int(max_service_shells)
                token = os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
                run_id = os.getenv("TE_RUN_ID")
                
                # Create the instance
                instance = FrameworkShellManager(
                    base_dir=base_dir,
                    max_app_shells=max_app_shells,
                    max_service_shells=max_service_shells,
                    auth_token=token,
                    run_id=run_id,
                )
                # Call the async adoption method
                await instance._adopt_orphaned_shells()
                _manager_instance = instance

    return _manager_instance

@framework_shells_bp.get("/api/framework_shells")
async def list_framework_shells(mgr: FrameworkShellManager = Depends(get_manager)) -> Any:
    records = [await mgr.describe(record) for record in await mgr.list_shells()]
    return {"ok": True, "data": records}


@framework_shells_bp.post("/api/framework_shells")
async def create_framework_shell(mgr: FrameworkShellManager = Depends(get_manager), x_framework_key: Optional[str] = Header(None), payload: dict = Body(...)) -> Any:
    if mgr.auth_token and x_framework_key != mgr.auth_token:
        raise HTTPException(status_code=403, detail="Forbidden: invalid framework shell token")
    command = payload.get("command")
    if isinstance(command, str):
        command = shlex.split(command)
    if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
        raise HTTPException(status_code=400, detail="command must be a list of strings (or string)")
    env = payload.get("env") or {}
    if not isinstance(env, dict):
        raise HTTPException(status_code=400, detail="env must be an object")
    label = payload.get("label")
    subgroups = payload.get("subgroups") or []
    if subgroups is None:
        subgroups = []
    if not isinstance(subgroups, list) or not all(isinstance(item, str) and item.strip() for item in subgroups):
        raise HTTPException(status_code=400, detail="subgroups must be a list of non-empty strings")
    autostart = bool(payload.get("autostart", False))
    cwd = payload.get("cwd")
    try:
        record = await mgr.spawn_shell(command, cwd=cwd, env=env, label=label, subgroups=subgroups, autostart=autostart)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to spawn shell: {exc}")
    return {"ok": True, "data": await mgr.describe(record)}


@framework_shells_bp.get("/api/framework_shells/{shell_id}")
async def get_framework_shell(shell_id: str, mgr: FrameworkShellManager = Depends(get_manager), tail: int = Query(LOG_TAIL_LINES), logs: bool = Query(False)) -> Any:
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(status_code=404, detail="Shell not found")
    return {"ok": True, "data": await mgr.describe(record, include_logs=logs, tail_lines=tail)}


@framework_shells_bp.delete("/api/framework_shells/{shell_id}")
async def delete_framework_shell(shell_id: str, mgr: FrameworkShellManager = Depends(get_manager), x_framework_key: Optional[str] = Header(None), force: bool = Query(False)) -> Any:
    if mgr.auth_token and x_framework_key != mgr.auth_token:
        raise HTTPException(status_code=403, detail="Forbidden: invalid framework shell token")
    try:
        await mgr.remove_shell(shell_id, force=force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Shell not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove shell: {exc}")
    return {"ok": True, "data": {"id": shell_id}}


@framework_shells_bp.post("/api/framework_shells/{shell_id}/action")
async def framework_shell_action(shell_id: str, mgr: FrameworkShellManager = Depends(get_manager), x_framework_key: Optional[str] = Header(None), payload: dict = Body(...)) -> Any:
    if mgr.auth_token and x_framework_key != mgr.auth_token:
        raise HTTPException(status_code=403, detail="Forbidden: invalid framework shell token")
    action = (payload.get("action") or "").lower()
    try:
        if action in {"stop", "terminate"}:
            record = await mgr.terminate_shell(shell_id, force=False)
        elif action in {"kill", "force"}:
            record = await mgr.terminate_shell(shell_id, force=True)
            try:
                await mgr.remove_shell(shell_id, force=True)
            except Exception:
                pass
        elif action == "restart":
            record = await mgr.restart_shell(shell_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported action '{action}'")
    except KeyError:
        raise HTTPException(status_code=404, detail="Shell not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shell action failed: {exc}")
    return {"ok": True, "data": await mgr.describe(record)}


@framework_shells_bp.post("/api/framework_shells/terminate_group")
async def terminate_shell_group(mgr: FrameworkShellManager = Depends(get_manager), x_framework_key: Optional[str] = Header(None), payload: dict = Body(...)) -> Any:
    if mgr.auth_token and x_framework_key != mgr.auth_token:
        raise HTTPException(status_code=403, detail="Forbidden: invalid framework shell token")
    group = payload.get("group")
    if not isinstance(group, str) or not group:
        raise HTTPException(status_code=400, detail="group must be a non-empty string")
    try:
        count = await terminate_group(mgr, group)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to terminate group: {exc}")
    return {"ok": True, "data": {"terminated_count": count}}
