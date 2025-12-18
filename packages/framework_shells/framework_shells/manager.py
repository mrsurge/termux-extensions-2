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
import socket
import inspect
from asyncio import Lock as AsyncLock
from asyncio import Queue as AsyncQueue
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional

import aiofiles

from .store import RuntimeStore
from .record import ShellRecord
from .pty import PTYState, PipeState
from .events import get_event_bus, ShellEvent, EventType
from .hooks import ShellLifecycleHooks
from .process_snapshot import (
    ExternalProcessProvider,
    ProcfsProcessProvider,
    ProcessRecord,
    ProcessSnapshot,
    collect_external_processes,
)

try:
    import psutil  # type: ignore
except Exception:
    psutil = None

HOME_DIR = Path(os.path.expanduser("~"))

def _shell_debug(stage: str, message: str) -> None:
    # TODO: proper logging
    print(f"[PTY][{stage}] {message}")

class FrameworkShellManager:
    """Creates and tracks background framework shells with runtime isolation."""

    def __init__(
        self,
        *,
        store: Optional[RuntimeStore] = None,
        max_app_shells: Optional[int] = None,
        max_service_shells: Optional[int] = None,
        run_id: Optional[str] = None,
        enable_dtach_proxy: bool = True,
        process_hooks: Optional[ShellLifecycleHooks] = None,
        external_process_provider: Optional[ExternalProcessProvider] = None,
        enable_procfs_process_discovery: bool = True,
    ) -> None:
        self.store = store or RuntimeStore()
        self.metadata_dir = self.store.metadata_dir
        self.logs_dir = self.store.logs_dir
        self.sockets_dir = self.store.sockets_dir
        
        self.max_app_shells = max_app_shells if max_app_shells is not None else 5
        self.max_service_shells = max_service_shells if max_service_shells is not None else 5
        self.run_id = run_id
        self.launcher_pid = os.getpid()
        self.started_at = time.time()
        self._pty: Dict[str, PTYState] = {}
        self._pipes: Dict[str, PipeState] = {}
        
        self._event_bus = get_event_bus()
        self._dtach_bin = shutil.which("dtach")
        self._enable_dtach_proxy = bool(enable_dtach_proxy)
        self._hooks = process_hooks
        self.external_process_provider = external_process_provider
        self._procfs_provider = ProcfsProcessProvider() if enable_procfs_process_discovery else None

    async def build_process_snapshot(
        self,
        *,
        shells: Optional[List[ShellRecord]] = None,
        include_procfs_descendants: bool = True,
    ) -> ProcessSnapshot:
        """Build a best-effort process snapshot for UI and shutdown planning.

        The snapshot is intentionally host-agnostic. If a host provides an
        `external_process_provider`, those processes are merged in. A procfs
        provider may also be used to discover descendants of managed shells so
        standalone usage still has a tree.

        Merge priority (highest wins on PID collisions):
          1) managed shells
          2) host-provided external process provider
          3) procfs-derived process discovery
        """
        shells = shells or await self.list_shells()
        root_pids = [rec.pid for rec in shells if rec.pid and rec.status == "running"]

        procfs: List[ProcessRecord] = []
        if include_procfs_descendants and self._procfs_provider:
            try:
                procfs = await asyncio.to_thread(self._procfs_provider.list_processes, root_pids=root_pids)
            except Exception:
                procfs = []

        external: List[ProcessRecord] = []
        if self.external_process_provider:
            try:
                external = await collect_external_processes(self.external_process_provider, root_pids=root_pids)
            except Exception:
                external = []

        processes: Dict[int, ProcessRecord] = {}
        for rec in procfs:
            processes[rec.pid] = rec
        for rec in external:
            processes[rec.pid] = rec

        for shell in shells:
            if not shell.pid:
                continue
            processes[shell.pid] = ProcessRecord(
                pid=shell.pid,
                parent_pid=shell.launcher_pid,
                type="shell",
                label=shell.label or shell.id,
                metadata={
                    "shell_id": shell.id,
                    "run_id": shell.run_id,
                    "uses_dtach": bool(getattr(shell, "uses_dtach", False)),
                    "uses_pipes": bool(getattr(shell, "uses_pipes", False)),
                    "uses_pty": bool(getattr(shell, "uses_pty", False)),
                },
                shell_id=shell.id,
            )

        return ProcessSnapshot(captured_at=time.time(), processes=processes)

    def _fire_hook(self, result: Any) -> None:
        """Best-effort hook execution; never blocks core flow."""
        if result is None:
            return
        if not inspect.isawaitable(result):
            return
        try:
            asyncio.create_task(result)
        except Exception:
            return

    def _run_hook_running(self, record: ShellRecord) -> None:
        hook = self._hooks.on_shell_running if self._hooks else None
        if not hook:
            return
        try:
            self._fire_hook(hook(record))
        except Exception:
            return

    def _run_hook_adopted(self, record: ShellRecord) -> None:
        hook = self._hooks.on_shell_adopted if self._hooks else None
        if not hook:
            return
        try:
            self._fire_hook(hook(record))
        except Exception:
            return

    def _run_hook_exited(self, record: ShellRecord, last_pid: Optional[int]) -> None:
        hook = self._hooks.on_shell_exited if self._hooks else None
        if not hook:
            return
        try:
            self._fire_hook(hook(record, last_pid))
        except Exception:
            return

    def _get_lock(self):
        if not hasattr(self, '_lock_instance'):
            self._lock_instance = asyncio.Lock()
        return self._lock_instance

    async def _emit(self, event_type: EventType, record: ShellRecord, **extra):
        event = ShellEvent(
            type=event_type,
            shell_id=record.id,
            data={**record.to_payload(), **extra},
            app_id=record.app_id or record.derive_app_id(),
            parent_shell_id=record.parent_shell_id,
            is_app_worker=record.is_app_worker,
        )
        await self._event_bus.publish(event)

    # ------------------------------------------------------------------
    # Adoption and helpers

    async def _adopt_orphaned_shells(self) -> None:
        """Adopt shells from previous runs. Caller must hold the lock."""
        stale_records: List[ShellRecord] = []
        updated = 0
        async for record in self._aiter_records():
            alive = bool(record.pid) and await self._is_pid_alive(record.pid)
            
            # Special check for dtach: process might be alive even if we aren't attached
            # But record.pid tracks the actual shell inside dtach.
            
            if record.pid and not alive:
                exit_code = record.exit_code or await self._collect_exit_code(record.pid)
                await self._mark_exited(record, exit_code)
                record.pid = None
                record.status = "exited"
                stale_records.append(record)
                continue
            if not alive and not (record.uses_dtach and record.status == "running"):
                # If dead and not dtach (or dtach assumed dead), clean up
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
            
            if self._enable_dtach_proxy and record.uses_dtach and record.id not in self._pty and alive:
                # Re-attach logic for dtach
                try:
                    await self._attach_dtach_proxy(record)
                    mutated = True  # Considered adoption action
                except Exception:
                    pass

            if mutated:
                record.adopted = True
                await self._save_record(record)
                if alive and record.status == "running":
                    self._run_hook_adopted(record)
                updated += 1
        
        for record in stale_records:
            await self._stop_pty(record.id)
            # Cleanup omitted for safety

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
            return stats

    # ------------------------------------------------------------------
    # Persistence

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

        # Verify signature using on-disk payload (forward-compatible with added fields).
        try:
            from .auth import derive_runtime_id, verify_record

            if data.get("runtime_id") != derive_runtime_id(self.store.secret):
                return None
            if not verify_record(self.store.secret, data):
                return None
        except Exception:
            return None
        
        try:
            def get_list(k): return data.get(k) if isinstance(data.get(k), list) else []
            def get_dict(k): return data.get(k) if isinstance(data.get(k), dict) else {}

            record = ShellRecord(
                id=data.get("id", shell_id),
                command=list(data.get("command") or []),
                label=data.get("label"),
                subgroups=get_list("subgroups"),
                ui=get_dict("ui"),
                cwd=data.get("cwd", str(HOME_DIR)),
                env_overrides=dict(get_dict("env_overrides")),
                pid=data.get("pid"),
                status=data.get("status", "unknown"),
                created_at=float(data.get("created_at", time.time())),
                updated_at=float(data.get("updated_at", time.time())),
                autostart=bool(data.get("autostart", False)),
                stdout_log=data.get("stdout_log", str(self.logs_dir / f'{data.get("id", shell_id)}.stdout.log')),
                stderr_log=data.get("stderr_log", str(self.logs_dir / f'{data.get("id", shell_id)}.stderr.log')),
                spec_id=data.get("spec_id"),
                exit_code=data.get("exit_code"),
                run_id=data.get("run_id"),
                launcher_pid=data.get("launcher_pid"),
                adopted=bool(data.get("adopted", False)),
                uses_pty=bool(data.get("uses_pty", False)),
                uses_pipes=bool(data.get("uses_pipes", False)),
                uses_dtach=bool(data.get("uses_dtach", False)),
                runtime_id=data.get("runtime_id"),
                signature=data.get("signature"),
                app_id=data.get("app_id"),
                parent_shell_id=data.get("parent_shell_id"),
                is_app_worker=bool(data.get("is_app_worker", False)),
            )
            return record
        except Exception:
            return None

    async def _save_record(self, record: ShellRecord) -> None:
        record.sign(self.store.secret)
        record_dir = self.metadata_dir / record.id
        await asyncio.to_thread(record_dir.mkdir, parents=True, exist_ok=True)
        tmp_path = record_dir / "meta.json.tmp"
        meta_path = record_dir / "meta.json"
        
        data = record.to_dict()
        async with aiofiles.open(tmp_path, "w", encoding="utf-8") as fh:
            await fh.write(json.dumps(data, indent=2))
        await asyncio.to_thread(tmp_path.replace, meta_path)

    # ------------------------------------------------------------------
    # Core

    def _normalize_command(self, command: Iterable[str]) -> List[str]:
        if isinstance(command, str): command = shlex.split(command)
        cmd_list = [str(part) for part in command]
        if not cmd_list: raise ValueError("command must contain at least one argument")
        return cmd_list

    def _resolve_cwd(self, cwd: Optional[str]) -> str:
        target = Path(os.path.expanduser(cwd or str(HOME_DIR))).resolve()
        if not target.exists(): target.mkdir(parents=True, exist_ok=True)
        return str(target)

    def _prepare_env(self, record: ShellRecord) -> Dict[str, str]:
        env = os.environ.copy()
        env.update(record.env_overrides)
        return env

    def _create_record(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str],
        env: Optional[Dict[str, str]],
        label: Optional[str],
        spec_id: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool,
        uses_pty: bool = False,
        uses_pipes: bool = False,
        uses_dtach: bool = False,
        parent_shell_id: Optional[str] = None,
    ) -> ShellRecord:
        shell_id = f"fs_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        command_list = self._normalize_command(command)
        cwd_path = self._resolve_cwd(cwd)
        overrides = dict(env or {})
        normalized_subgroups = [str(v).strip() for v in (subgroups or []) if str(v).strip()]
        
        record = ShellRecord(
            id=shell_id,
            command=command_list,
            label=label,
            subgroups=normalized_subgroups,
            ui=ui or {},
            cwd=cwd_path,
            env_overrides=overrides,
            pid=None,
            status="pending",
            created_at=time.time(),
            updated_at=time.time(),
            autostart=autostart,
            stdout_log=str(self.logs_dir / f"{shell_id}.stdout.log"),
            stderr_log=str(self.logs_dir / f"{shell_id}.stderr.log"),
            spec_id=spec_id,
            exit_code=None,
            run_id=self.run_id,
            launcher_pid=self.launcher_pid,
            adopted=False,
            uses_pty=uses_pty,
            uses_pipes=uses_pipes,
            uses_dtach=uses_dtach,
            parent_shell_id=parent_shell_id
        )
        record.app_id = record.derive_app_id()
        record.is_app_worker = (record.label or "").startswith("app-worker:")
        return record

    async def _launch(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = False
        env = self._prepare_env(record)
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        
        stdout_fh = await asyncio.to_thread(open, stdout_path, "ab")
        stderr_fh = await asyncio.to_thread(open, stderr_path, "ab")
        
        await self._emit(EventType.SHELL_CREATED, record)

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
            record.updated_at = time.time()
            await self._save_record(record)
            
            await self._emit(EventType.SHELL_SPAWNED, record)
            self._run_hook_running(record)
            return record
        finally:
            await asyncio.to_thread(stdout_fh.close)
            await asyncio.to_thread(stderr_fh.close)

    async def _launch_dtach(self, record: ShellRecord) -> ShellRecord:
        if not self._dtach_bin:
             raise RuntimeError("dtach binary not found")
        
        record.uses_dtach = True
        record.uses_pty = True
        socket_path = self.sockets_dir / f"{record.id}.sock"
        pid_file = self.sockets_dir / f"{record.id}.pid"
        
        # Cleanup stale
        if socket_path.exists():
             socket_path.unlink()
        
        cmd_str = ' '.join(shlex.quote(x) for x in record.command)
        # Use a wrapper to capture PID of the shell inside dtach
        wrapper_cmd = f"echo $$ > {shlex.quote(str(pid_file))}; exec {cmd_str}"
        
        dtach_cmd = [
            self._dtach_bin,
            "-n", str(socket_path),
            "sh", "-c", wrapper_cmd
        ]
        
        # Launch dtach daemon (it exits immediately)
        env = self._prepare_env(record)
        
        await self._emit(EventType.SHELL_CREATED, record)

        # We run this sync/async but dtach -n returns instantly
        proc = await asyncio.create_subprocess_exec(
            *dtach_cmd,
            cwd=record.cwd,
            env=env,
            start_new_session=True
        )
        await proc.wait()
        
        # Poll for pidfile
        start_time = time.time()
        found_pid = None
        while time.time() - start_time < 5.0:
            if pid_file.exists():
                try:
                    async with aiofiles.open(pid_file, "r") as f:
                        content = await f.read()
                        if content.strip():
                             found_pid = int(content.strip())
                             break
                except Exception:
                    pass
            await asyncio.sleep(0.1)
        
        if not found_pid:
            raise RuntimeError("Failed to capture PID from dtach session")

        record.pid = found_pid
        record.status = "running"
        record.updated_at = time.time()
        await self._save_record(record)
        await self._emit(EventType.SHELL_SPAWNED, record)
        self._run_hook_running(record)

        # Attach proxy
        await self._attach_dtach_proxy(record)
        return record

    async def _attach_dtach_proxy(self, record: ShellRecord) -> None:
        """Spawn a local dtach -a process to proxy I/O."""
        socket_path = self.sockets_dir / f"{record.id}.sock"
        if not socket_path.exists():
            return # Cannot attach
            
        master_fd, slave_fd = await asyncio.to_thread(pty.openpty)
        
        try:
            attrs = termios.tcgetattr(slave_fd)
            attrs[0] = attrs[0] & ~(termios.ICRNL | termios.IXON)
            attrs[1] = attrs[1] & ~termios.OPOST
            attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO | termios.ISIG)
            attrs[6][termios.VMIN] = 1
            attrs[6][termios.VTIME] = 0
            termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
        except Exception:
            pass

        # dtach -a <socket>
        # Note: dtach -a expects a terminal. We give it slave_fd.
        cmd = [self._dtach_bin or "dtach", "-a", str(socket_path)]
        
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        
        # IMPORTANT: We need to handle dtach escape key so it doesn't conflict?
        # dtach default detach key is '^\'. 
        return_code = 0
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=slave_fd,
            stdin=slave_fd,
            stderr=slave_fd,
            cwd=record.cwd,
            env=env,
            start_new_session=True
        )
        
        await asyncio.to_thread(os.close, slave_fd)
        
        state = PTYState(
            master_fd=master_fd,
            label=record.label,
            shell_id=record.id,
            proxy_pid=proc.pid # Store proxy PID
        )
        
        state.reader = asyncio.create_task(self._pty_reader(record, state))
        self._pty[record.id] = state

    async def _launch_pty(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = True
        master_fd, slave_fd = await asyncio.to_thread(pty.openpty)
        envp = self._prepare_env(record)
        envp.setdefault("TERM", "xterm-256color")
        
        try:
            attrs = termios.tcgetattr(slave_fd)
            attrs[0] = attrs[0] & ~(termios.ICRNL | termios.IXON)
            attrs[1] = attrs[1] & ~termios.OPOST
            attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO | termios.ISIG)
            attrs[6][termios.VMIN] = 1
            attrs[6][termios.VTIME] = 0
            termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
        except Exception:
            pass

        await self._emit(EventType.SHELL_CREATED, record)

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
        record.updated_at = time.time()
        await self._save_record(record)
        
        await self._emit(EventType.SHELL_SPAWNED, record)
        self._run_hook_running(record)
        
        state = PTYState(
            master_fd=master_fd,
            label=record.label,
            shell_id=record.id,
        )
        
        state.reader = asyncio.create_task(self._pty_reader(record, state))
        self._pty[record.id] = state
        return record

    async def _pty_reader(self, record: ShellRecord, state: PTYState) -> None:
        log_path = Path(record.stdout_log)
        async with aiofiles.open(log_path, "ab") as log_fh:
            while not state.stop.is_set():
                try:
                    ready = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, 
                            lambda: select.select([state.master_fd], [], [], 0.5)
                        ),
                        timeout=0.6
                    )
                    rlist, _, _ = ready
                    if not rlist:
                        continue
                    
                    data = await asyncio.to_thread(os.read, state.master_fd, 4096)
                    if not data:
                        break
                    
                    await log_fh.write(data)
                    await log_fh.flush()
                    
                    text = data.decode("utf-8", errors="replace")
    
                    if True:
                        event = ShellEvent(
                           type=EventType.PTY_CHUNK,
                           shell_id=record.id,
                           data={"chunk": text}
                        )
                        await self._event_bus.publish(event)

                    for q in list(state.subscribers):
                        try:
                            await q.put(text)
                        except Exception:
                            pass
                            
                except asyncio.TimeoutError:
                    continue
                except OSError:
                    break
                except Exception:
                    break
        
        try:
            await asyncio.to_thread(os.close, state.master_fd)
        except Exception:
            pass

    async def _is_pid_alive(self, pid: Optional[int]) -> bool:
        if not pid: return False
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    async def _mark_exited(self, record: ShellRecord, exit_code: Optional[int]) -> None:
        last_pid = record.pid
        record.pid = None
        record.status = "exited"
        record.exit_code = exit_code
        record.updated_at = time.time()
        await self._save_record(record)
        await self._emit(EventType.SHELL_EXITED, record, exit_code=exit_code)
        self._run_hook_exited(record, last_pid)

    async def _collect_exit_code(self, pid: Optional[int]) -> Optional[int]:
        if not pid: return None
        try:
            waited_pid, status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == 0: return None
            if os.WIFEXITED(status): return os.WEXITSTATUS(status)
            if os.WIFSIGNALED(status): return -os.WTERMSIG(status)
        except Exception:
            return None
        return None

    async def _stop_pty(self, shell_id: str) -> None:
        state = self._pty.pop(shell_id, None)
        if not state: return
        state.stop.set()
        if state.reader:
            state.reader.cancel()
        
        # If proxy pid exists, kill it (detach)
        if state.proxy_pid:
            try:
                os.kill(state.proxy_pid, signal.SIGTERM)
            except Exception:
                pass

    async def _launch_pipe(self, record: ShellRecord) -> ShellRecord:
        """Launch shell with live stdin/stdout pipes for bidirectional streaming."""
        record.uses_pipes = True
        record.uses_pty = False
        env = self._prepare_env(record)
        
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        
        # open stderr for logging
        stderr_fh = await asyncio.to_thread(open, stderr_path, "ab")
        
        await self._emit(EventType.SHELL_CREATED, record)

        try:
            # We use pipes for stdin/stdout, but file for stderr
            proc = await asyncio.create_subprocess_exec(
                *record.command,
                cwd=record.cwd,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=stderr_fh,
                start_new_session=True,
            )
            
            record.pid = proc.pid
            record.status = "running"
            record.updated_at = time.time()
            await self._save_record(record)
            await self._emit(EventType.SHELL_SPAWNED, record)
            self._run_hook_running(record)
            
            state = PipeState(
                process=proc,
                label=record.label,
                shell_id=record.id,
            )
            self._pipes[record.id] = state
            return record
            
        finally:
            await asyncio.to_thread(stderr_fh.close)

    async def _stop_pipe(self, shell_id: str) -> None:
        state = self._pipes.pop(shell_id, None)
        if not state: return
        state.stop.set()
        proc = state.process
        # Close stdin to signal EOF
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.close()
            try:
                await proc.stdin.wait_closed()
            except Exception:
                pass


    # Public methods
    
    async def spawn_shell(
        self,
        command: Iterable[str],
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        spec_id: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = True,
    ) -> ShellRecord:
        record = self._create_record(
            command, cwd=cwd, env=env, label=label,
            spec_id=spec_id, subgroups=subgroups, ui=ui, autostart=autostart,
            uses_pty=False
        )
        if autostart:
            await self._launch(record)
        else:
            await self._save_record(record)
            await self._emit(EventType.SHELL_CREATED, record)
        return record

    async def spawn_shell_pty(
        self,
        command: Iterable[str],
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        spec_id: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = True,
        parent_shell_id: Optional[str] = None,
    ) -> ShellRecord:
        record = self._create_record(
            command, cwd=cwd, env=env, label=label,
            spec_id=spec_id, subgroups=subgroups, ui=ui, autostart=autostart,
            uses_pty=True, parent_shell_id=parent_shell_id
        )
        if autostart:
            await self._launch_pty(record)
        else:
            await self._save_record(record)
            await self._emit(EventType.SHELL_CREATED, record)
        return record

    async def spawn_shell_pipe(
        self,
        command: Iterable[str],
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        spec_id: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = True,
        parent_shell_id: Optional[str] = None,
    ) -> ShellRecord:
        record = self._create_record(
            command, cwd=cwd, env=env, label=label,
            spec_id=spec_id, subgroups=subgroups, ui=ui, autostart=autostart,
            uses_pty=False, uses_pipes=True,
            parent_shell_id=parent_shell_id
        )
        if autostart:
            await self._launch_pipe(record)
        else:
            await self._save_record(record)
            await self._emit(EventType.SHELL_CREATED, record)
        return record
    
    async def spawn_shell_dtach(
        self,
        command: Iterable[str],
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        spec_id: Optional[str] = None,
        subgroups: Optional[List[str]] = None,
        ui: Optional[Dict[str, Any]] = None,
        autostart: bool = True,
        parent_shell_id: Optional[str] = None,
    ) -> ShellRecord:
        record = self._create_record(
            command, cwd=cwd, env=env, label=label,
            spec_id=spec_id, subgroups=subgroups, ui=ui, autostart=autostart,
            uses_pty=True,
            uses_dtach=True, 
            parent_shell_id=parent_shell_id
        )
        if autostart:
             # Logic to check if dtach is available is inside _launch_dtach
             await self._launch_dtach(record)
        else:
             await self._save_record(record)
             await self._emit(EventType.SHELL_CREATED, record)
        return record

    async def list_shells(self) -> List[ShellRecord]:
        async with self._get_lock():
            await self._adopt_orphaned_shells()
            records = []
            async for record in self._aiter_records():
                records.append(record)
            return sorted(records, key=lambda rec: rec.created_at)

    async def get_shell(self, shell_id: str) -> Optional[ShellRecord]:
        async with self._get_lock():
            await self._adopt_orphaned_shells()
            return await self._load_record(shell_id)

    async def find_shell_by_label(self, label: str, status: Optional[str] = "running") -> Optional[ShellRecord]:
        if not label: return None
        async with self._get_lock():
            await self._adopt_orphaned_shells()
            async for record in self._aiter_records():
                if record.label != label: continue
                if status and record.status != status: continue
                if status == "running" and not await self._is_pid_alive(record.pid): continue
                return record
        return None

    async def terminate_shell(self, shell_id: str, force: bool = False) -> None:
        rec = await self._load_record(shell_id)
        if not rec: return
        
        # Dtach shells need SIGKILL - bash inside dtach ignores SIGTERM
        if rec.uses_dtach:
            force = True
        
        sig = signal.SIGKILL if force else signal.SIGTERM
        
        # For dtach shells, we need to kill the dtach master process
        # The socket file tells us if dtach is involved
        if rec.uses_dtach:
            socket_path = self.sockets_dir / f"{shell_id}.sock"
            pid_file = self.sockets_dir / f"{shell_id}.pid"
            
            # Kill the shell process inside dtach
            if rec.pid:
                try:
                    os.kill(rec.pid, sig)
                except ProcessLookupError:
                    pass
            
            # Find and kill dtach master by checking who owns the socket
            # Or just remove the socket to force dtach to exit
            if socket_path.exists():
                try:
                    socket_path.unlink()
                except Exception:
                    pass
            if pid_file.exists():
                try:
                    pid_file.unlink()
                except Exception:
                    pass
        elif rec.pid:
            # Regular process - just kill it
            try:
                os.kill(rec.pid, sig)
            except ProcessLookupError:
                pass
        
        # Stop any PTY/pipe proxies we're running
        await self._stop_pty(shell_id)
        await self._stop_pipe(shell_id)
        
        await asyncio.sleep(0.1)
        if rec.pid and not await self._is_pid_alive(rec.pid):
             code = await self._collect_exit_code(rec.pid)
             await self._mark_exited(rec, code)

    async def remove_shell(self, shell_id: str, force: bool = False) -> bool:
        """Terminate shell and remove its metadata/logs."""
        rec = await self._load_record(shell_id)
        await self.terminate_shell(shell_id, force=force)
        
        # Remove metadata
        meta_dir = self.metadata_dir / shell_id
        if meta_dir.exists():
            await asyncio.to_thread(shutil.rmtree, meta_dir, ignore_errors=True)
        
        # Remove logs
        if rec:
            for log_path in [rec.stdout_log, rec.stderr_log]:
                p = Path(log_path)
                if p.exists():
                    try:
                        await asyncio.to_thread(p.unlink)
                    except Exception:
                        pass
            # Emit removed event
            await self._emit(EventType.SHELL_REMOVED, rec)
        
        return True

    # ------------------------------------------------------------------
    # Describe / stats

    LOG_TAIL_BYTES = 4096

    async def describe(
        self,
        record: ShellRecord,
        *,
        include_logs: bool = False,
        tail_lines: int = 0,
    ) -> Dict[str, Any]:
        """Return a dict with shell payload, stats, and optionally logs."""
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
                        proc = await asyncio.to_thread(psutil.Process, record.pid)
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
                            ["ps", "-p", str(record.pid), "-o", "%cpu=,%mem=,rss=,nlwp="],
                            capture_output=True,
                            text=True,
                            check=True,
                        )
                        parts = ps_output.stdout.strip().split()
                        if len(parts) >= 4:
                            stats["cpu_percent"] = float(parts[0])
                            stats["memory_rss"] = int(float(parts[2]) * 1024)
                            stats["num_threads"] = int(parts[3])
                    except Exception:
                        pass
        return stats

    async def _read_log_tail(self, path: Path, lines: int) -> List[str]:
        if lines <= 0 or not path.exists():
            return []
        size = await asyncio.to_thread(path.stat)
        to_read = min(size.st_size, self.LOG_TAIL_BYTES)
        async with aiofiles.open(path, "rb") as fh:
            await fh.seek(-to_read, os.SEEK_END)
            data = await fh.read()
            decoded_data = data.decode("utf-8", errors="replace")
        return decoded_data.splitlines(keepends=True)[-lines:]

    # ------------------------------------------------------------------
    # PTY / pipe I/O methods

    def get_pipe_state(self, shell_id: str) -> Optional[PipeState]:
        """Return the live PipeState for a running pipe-backed shell, if present.

        Note: pipe shells cannot be re-attached across process restarts, so this
        will only be available in the process that spawned the pipe shell.
        """
        return self._pipes.get(shell_id)


    async def subscribe_output(self, shell_id: str) -> AsyncQueue[str]:
        """Subscribe to PTY output for a shell. Returns an AsyncQueue."""
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError(f"No PTY for shell {shell_id}")
            q: AsyncQueue[str] = AsyncQueue()
            state.subscribers.append(q)
            return q

    async def unsubscribe_output(self, shell_id: str, q: AsyncQueue[str]) -> None:
        """Unsubscribe from PTY output."""
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                return
            try:
                state.subscribers.remove(q)
            except ValueError:
                pass

    async def write_to_pty(self, shell_id: str, data: str) -> None:
        """Write data to a shell's PTY."""
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError(f"No PTY for shell {shell_id}")
            encoded = data.encode("utf-8")
            await asyncio.to_thread(os.write, state.master_fd, encoded)

    async def resize_pty(self, shell_id: str, cols: int, rows: int) -> None:
        """Resize a shell's PTY."""
        async with self._get_lock():
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError(f"No PTY for shell {shell_id}")
            winsz = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
            try:
                await asyncio.to_thread(fcntl.ioctl, state.master_fd, termios.TIOCSWINSZ, winsz)
            except Exception:
                pass
