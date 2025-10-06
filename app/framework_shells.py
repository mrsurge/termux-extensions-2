"""Core-managed framework shell orchestration.

This module exposes a Flask blueprint plus a light manager that can spawn,
inspect, and control long-running background processes ("framework shells").
The shells inherit `TE_SESSION_TYPE=framework`, keeping them out of the
interactive Sessions UI while allowing extensions to manage supporting
services such as aria2 RPC, container helpers, or LLM runtimes.
"""

from __future__ import annotations

import errno
import fcntl
import json
import os
import pty
import queue
import select
import shlex
import shutil
import signal
import struct
import subprocess
import threading
import termios
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from flask import Blueprint, current_app, jsonify, request

try:  # Optional dependency for richer process metrics.
    import psutil  # type: ignore
except Exception:  # pragma: no cover - psutil may be unavailable.
    psutil = None  # type: ignore

HOME_DIR = Path(os.path.expanduser("~"))
DEFAULT_BASE_DIR = HOME_DIR / ".cache" / "te_framework"
DEFAULT_MAX_SHELLS = 5
LOG_TAIL_BYTES = 4096
LOG_TAIL_LINES = 200


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
    run_id: Optional[str] = None
    launcher_pid: Optional[int] = None
    adopted: bool = False
    uses_pty: bool = False

    def to_payload(self, *, include_env: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "command": list(self.command),
            "label": self.label,
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
        }
        if include_env:
            payload["env_overrides"] = dict(self.env_overrides)
        return payload


@dataclass
class PTYState:
    master_fd: int
    subscribers: List["queue.Queue[str]"] = field(default_factory=list)
    stop: threading.Event = field(default_factory=threading.Event)
    reader: Optional[threading.Thread] = None


class FrameworkShellManager:
    """Creates and tracks background framework shells."""

    def __init__(
        self,
        *,
        base_dir: Optional[Path] = None,
        max_shells: Optional[int] = None,
        auth_token: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> None:
        self.base_dir = base_dir or DEFAULT_BASE_DIR
        self.metadata_dir = self.base_dir / "meta"
        self.logs_dir = self.base_dir / "logs"
        self.sockets_dir = self.base_dir / "sockets"
        for directory in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.max_shells = max_shells if max_shells is not None else DEFAULT_MAX_SHELLS
        self.auth_token = auth_token or os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
        self.run_id = run_id or os.getenv("TE_RUN_ID")
        self.launcher_pid = os.getpid()
        self.started_at = time.time()
        self._lock = threading.RLock()
        self._pty: Dict[str, PTYState] = {}
        self._adopt_orphaned_shells()

    # ------------------------------------------------------------------
    # Adoption and helpers

    def _adopt_orphaned_shells(self) -> None:
        with self._lock:
            for record in self._iter_records():
                if record.pid and not self._is_pid_alive(record.pid):
                    exit_code = record.exit_code or self._collect_exit_code(record.pid)
                    self._mark_exited(record, exit_code)
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
                    self._save_record(record)

    def list_active_pids(self) -> List[int]:
        with self._lock:
            pids: List[int] = []
            for record in self._iter_records():
                if record.pid and self._is_pid_alive(record.pid):
                    pids.append(record.pid)
            return pids

    def aggregate_resource_stats(self) -> Dict[str, Any]:
        with self._lock:
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
            for record in self._iter_records():
                stats["num_shells"] += 1
                if getattr(record, "adopted", False):
                    adopted_count += 1
                if record.pid and self._is_pid_alive(record.pid):
                    stats["num_running"] += 1
                    stats["pids"].append(record.pid)
                    running_records.append(record)
            stats["num_adopted"] = adopted_count
            if psutil:
                cpu_total = 0.0
                rss_total = 0
                for rec in running_records:
                    try:
                        proc = psutil.Process(rec.pid)  # type: ignore[arg-type]
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
                        ps_output = subprocess.run(
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

    def _iter_records(self) -> Iterable[ShellRecord]:
        for meta in sorted(self.metadata_dir.glob("*/meta.json")):
            record = self._load_record(meta.parent.name)
            if record:
                yield record

    def _load_record(self, shell_id: str) -> Optional[ShellRecord]:
        meta_path = self.metadata_dir / shell_id / "meta.json"
        if not meta_path.exists():
            return None
        try:
            with meta_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            return None
        try:
            return ShellRecord(
                id=data.get("id", shell_id),
                command=list(data.get("command") or []),
                label=data.get("label"),
                cwd=data.get("cwd", str(HOME_DIR)),
                env_overrides=dict(data.get("env_overrides") or {}),
                pid=data.get("pid"),
                status=data.get("status", "unknown"),
                created_at=float(data.get("created_at", time.time())),
                updated_at=float(data.get("updated_at", time.time())),
                autostart=bool(data.get("autostart", False)),
                stdout_log=data.get(
                    "stdout_log",
                    str(self.logs_dir / f"{data.get('id', shell_id)}.stdout.log"),
                ),
                stderr_log=data.get(
                    "stderr_log",
                    str(self.logs_dir / f"{data.get('id', shell_id)}.stderr.log"),
                ),
                exit_code=data.get("exit_code"),
                run_id=data.get("run_id"),
                launcher_pid=data.get("launcher_pid"),
                adopted=bool(data.get("adopted", False)),
                uses_pty=bool(data.get("uses_pty", False)),
            )
        except Exception:
            return None

    def _save_record(self, record: ShellRecord) -> None:
        record_dir = self.metadata_dir / record.id
        record_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = record_dir / "meta.json.tmp"
        meta_path = record_dir / "meta.json"
        data = {
            "id": record.id,
            "command": record.command,
            "label": record.label,
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
        }
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        tmp_path.replace(meta_path)

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
        autostart: bool,
        uses_pty: bool = False,
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
        return ShellRecord(
            id=shell_id,
            command=command_list,
            label=label,
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
        )

    def _launch(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = False
        env = self._prepare_env(record)
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        with stdout_path.open("ab") as stdout_fh, stderr_path.open("ab") as stderr_fh:
            proc = subprocess.Popen(
                record.command,
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
        self._save_record(record)
        return record

    def _launch_pty(self, record: ShellRecord) -> ShellRecord:
        record.uses_pty = True
        master_fd, slave_fd = pty.openpty()
        envp = self._prepare_env(record)
        envp.setdefault("TERM", "xterm-256color")
        envp.setdefault("TE_TTY", "pty")
        for path_str in (record.stdout_log, record.stderr_log):
            Path(path_str).parent.mkdir(parents=True, exist_ok=True)
            Path(path_str).touch(exist_ok=True)
        try:
            proc = subprocess.Popen(
                record.command,
                cwd=record.cwd,
                env=envp,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
                close_fds=True,
            )
        finally:
            try:
                os.close(slave_fd)
            except Exception:
                pass
        record.pid = proc.pid
        record.status = "running"
        record.exit_code = None
        record.updated_at = time.time()
        self._save_record(record)

        state = PTYState(master_fd=master_fd)

        def _reader() -> None:
            log_path = Path(record.stdout_log)
            with log_path.open("ab") as log_fh:
                while not state.stop.is_set():
                    try:
                        rlist, _, _ = select.select([master_fd], [], [], 0.5)
                        if not rlist:
                            continue
                        data = os.read(master_fd, 4096)
                        if not data:
                            time.sleep(0.05)
                            continue
                    except OSError:
                        break
                    try:
                        log_fh.write(data)
                        log_fh.flush()
                    except Exception:
                        pass
                    text = data.decode("utf-8", errors="replace")
                    subscribers = list(state.subscribers)
                    for q in subscribers:
                        try:
                            q.put_nowait(text)
                        except Exception:
                            pass
            try:
                os.close(master_fd)
            except Exception:
                pass

        reader_thread = threading.Thread(target=_reader, daemon=True)
        state.reader = reader_thread
        self._pty[record.id] = state
        reader_thread.start()
        return record

    def _is_pid_alive(self, pid: Optional[int]) -> bool:
        if not pid:
            return False
        try:
            os.kill(pid, 0)
        except PermissionError:
            return True
        except OSError as exc:  # includes ProcessLookupError
            if getattr(exc, "errno", None) == errno.EPERM:
                return True
            return False
        return True

    def _collect_exit_code(self, pid: Optional[int]) -> Optional[int]:
        if not pid:
            return None
        try:
            waited_pid, status = os.waitpid(pid, os.WNOHANG)
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

    def _mark_exited(self, record: ShellRecord, exit_code: Optional[int]) -> None:
        record.pid = None
        record.status = "exited"
        record.exit_code = exit_code
        record.updated_at = time.time()
        self._save_record(record)

    def _active_shell_count(self) -> int:
        return sum(1 for r in self._iter_records() if self._is_pid_alive(r.pid))

    def _stop_pty(self, shell_id: str) -> None:
        state = self._pty.pop(shell_id, None)
        if not state:
            return
        state.stop.set()
        try:
            if state.reader:
                state.reader.join(timeout=1.0)
        except Exception:
            pass
        try:
            os.close(state.master_fd)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Public manager API

    def list_shells(self) -> List[ShellRecord]:
        with self._lock:
            self.sweep()
            return sorted(self._iter_records(), key=lambda rec: rec.created_at)

    def get_shell(self, shell_id: str) -> Optional[ShellRecord]:
        with self._lock:
            self.sweep()
            return self._load_record(shell_id)

    def spawn_shell(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        autostart: bool = False,
    ) -> ShellRecord:
        with self._lock:
            self.sweep()
            if self.max_shells and self._active_shell_count() >= self.max_shells:
                raise RuntimeError("Maximum framework shell count reached")
            record = self._create_record(
                command,
                cwd=cwd,
                env=env,
                label=label,
                autostart=autostart,
            )
            return self._launch(record)

    def spawn_shell_pty(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        autostart: bool = True,
    ) -> ShellRecord:
        with self._lock:
            self.sweep()
            if self.max_shells and self._active_shell_count() >= self.max_shells:
                raise RuntimeError("Maximum framework shell count reached")
            record = self._create_record(
                command,
                cwd=cwd,
                env=env,
                label=label,
                autostart=autostart,
                uses_pty=True,
            )
            return self._launch_pty(record)

    def write_to_pty(self, shell_id: str, data: bytes | str) -> None:
        with self._lock:
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            payload = data.encode("utf-8") if isinstance(data, str) else data
            try:
                os.write(state.master_fd, payload)
            except OSError:
                raise

    def subscribe_output(self, shell_id: str) -> "queue.Queue[str]":
        with self._lock:
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            q: "queue.Queue[str]" = queue.Queue()
            state.subscribers.append(q)
            return q

    def unsubscribe_output(self, shell_id: str, q: "queue.Queue[str]") -> None:
        with self._lock:
            state = self._pty.get(shell_id)
            if not state:
                return
            try:
                state.subscribers.remove(q)
            except ValueError:
                pass

    def resize_pty(self, shell_id: str, cols: int, rows: int) -> None:
        with self._lock:
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            winsz = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
            try:
                fcntl.ioctl(state.master_fd, termios.TIOCSWINSZ, winsz)
            except Exception:
                pass

    def terminate_shell(self, shell_id: str, *, force: bool = False, timeout: float = 5.0) -> ShellRecord:
        with self._lock:
            record = self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            if not record.pid or not self._is_pid_alive(record.pid):
                exit_code = record.exit_code or self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)
                self._stop_pty(shell_id)
                return record
            sig = signal.SIGKILL if force else signal.SIGTERM
            try:
                os.kill(record.pid, sig)
            except ProcessLookupError:
                exit_code = record.exit_code or self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)
                self._stop_pty(shell_id)
                return record
            if not force:
                deadline = time.time() + max(0.0, timeout)
                while time.time() < deadline:
                    if not self._is_pid_alive(record.pid):
                        break
                    time.sleep(0.1)
                if self._is_pid_alive(record.pid):
                    try:
                        os.kill(record.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            exit_code = self._collect_exit_code(record.pid)
            self._mark_exited(record, exit_code)
            self._stop_pty(shell_id)
            return record

    def restart_shell(self, shell_id: str) -> ShellRecord:
        with self._lock:
            record = self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            self.terminate_shell(shell_id, force=True)
            now = time.time()
            record.created_at = now
            record.updated_at = now
            record.exit_code = None
            record.status = "pending"
            self._save_record(record)
            if record.uses_pty:
                return self._launch_pty(record)
            return self._launch(record)

    def remove_shell(self, shell_id: str, *, force: bool = False) -> None:
        with self._lock:
            record = self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            if record.pid and self._is_pid_alive(record.pid):
                self.terminate_shell(shell_id, force=force)
            self._stop_pty(shell_id)
            shutil.rmtree(self.metadata_dir / shell_id, ignore_errors=True)
            for log_path in (record.stdout_log, record.stderr_log):
                try:
                    Path(log_path).unlink()
                except FileNotFoundError:
                    pass

    def sweep(self) -> None:
        for record in list(self._iter_records()):
            if record.pid and not self._is_pid_alive(record.pid):
                exit_code = record.exit_code or self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)

    def describe(
        self,
        record: ShellRecord,
        *,
        include_logs: bool = False,
        tail_lines: int = 0,
    ) -> Dict[str, Any]:
        payload = record.to_payload()
        payload["stats"] = self._process_stats(record)
        if include_logs:
            payload["logs"] = {
                "stdout_tail": self._read_log_tail(Path(record.stdout_log), tail_lines),
                "stderr_tail": self._read_log_tail(Path(record.stderr_log), tail_lines),
            }
        return payload

    def _process_stats(self, record: ShellRecord) -> Dict[str, Any]:
        stats: Dict[str, Any] = {
            "alive": False,
            "uptime": None,
        }
        if record.pid:
            alive = self._is_pid_alive(record.pid)
            stats["alive"] = alive
            if alive:
                stats["uptime"] = max(0.0, time.time() - record.created_at)
                if psutil:
                    try:
                        proc = psutil.Process(record.pid)  # type: ignore[arg-type]
                        with proc.oneshot():
                            stats["cpu_percent"] = proc.cpu_percent(interval=0.0)
                            stats["memory_rss"] = proc.memory_info().rss
                            stats["num_threads"] = proc.num_threads()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                else:
                    try:
                        ps_output = subprocess.run(
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

    def _read_log_tail(self, path: Path, lines: int) -> List[str]:
        if lines <= 0 or not path.exists():
            return []
        size = path.stat().st_size
        to_read = min(size, LOG_TAIL_BYTES)
        with path.open("rb") as fh:
            fh.seek(-to_read, os.SEEK_END)
            data = fh.read().decode("utf-8", errors="replace")
        return data.splitlines()[-lines:]


# ----------------------------------------------------------------------
# Flask blueprint

framework_shells_bp = Blueprint("framework_shells", __name__)


def _manager() -> FrameworkShellManager:
    cfg = current_app.config
    base_dir_setting = cfg.get("TE_FRAMEWORK_SHELL_DIR") or os.getenv("TE_FRAMEWORK_SHELL_DIR")
    base_dir = Path(base_dir_setting) if base_dir_setting else None
    max_shells_setting = cfg.get("TE_FRAMEWORK_SHELL_MAX") or os.getenv("TE_FRAMEWORK_SHELL_MAX")
    max_shells = int(max_shells_setting) if max_shells_setting else None
    token = cfg.get("TE_FRAMEWORK_SHELL_TOKEN") or os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
    run_id = cfg.get("TE_RUN_ID") or os.getenv("TE_RUN_ID")
    mgr = current_app.config.get("TE_FRAMEWORK_SHELL_MANAGER")
    if not isinstance(mgr, FrameworkShellManager):
        mgr = FrameworkShellManager(
            base_dir=base_dir,
            max_shells=max_shells,
            auth_token=token,
            run_id=run_id,
        )
        current_app.config["TE_FRAMEWORK_SHELL_MANAGER"] = mgr
    else:
        if run_id and mgr.run_id != run_id:
            mgr.run_id = run_id
            mgr.launcher_pid = os.getpid()
            mgr._adopt_orphaned_shells()
    return mgr


def _check_mutation_auth() -> Optional[str]:
    mgr = _manager()
    if not mgr.auth_token:
        return None
    provided = request.headers.get("X-Framework-Key")
    if provided == mgr.auth_token:
        return None
    return "Forbidden: invalid framework shell token"


def _parse_tail_lines(default: int = LOG_TAIL_LINES) -> int:
    try:
        value = request.args.get("tail")
        return max(0, int(value)) if value is not None else default
    except ValueError:
        return default


@framework_shells_bp.route("/api/framework_shells", methods=["GET"])
def list_framework_shells() -> Any:
    mgr = _manager()
    records = [mgr.describe(record) for record in mgr.list_shells()]
    return jsonify({"ok": True, "data": records})


@framework_shells_bp.route("/api/framework_shells", methods=["POST"])
def create_framework_shell() -> Any:
    error = _check_mutation_auth()
    if error:
        return jsonify({"ok": False, "error": error}), 403
    payload = request.get_json(silent=True) or {}
    command = payload.get("command")
    if isinstance(command, str):
        command = shlex.split(command)
    if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
        return jsonify({"ok": False, "error": "command must be a list of strings (or string)"}), 400
    env = payload.get("env") or {}
    if not isinstance(env, dict):
        return jsonify({"ok": False, "error": "env must be an object"}), 400
    label = payload.get("label")
    autostart = bool(payload.get("autostart", False))
    cwd = payload.get("cwd")
    mgr = _manager()
    try:
        record = mgr.spawn_shell(command, cwd=cwd, env=env, label=label, autostart=autostart)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Failed to spawn shell: {exc}"}), 500
    return jsonify({"ok": True, "data": mgr.describe(record)}), 201


@framework_shells_bp.route("/api/framework_shells/<shell_id>", methods=["GET"])
def get_framework_shell(shell_id: str) -> Any:
    mgr = _manager()
    record = mgr.get_shell(shell_id)
    if not record:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    tail_lines = _parse_tail_lines()
    include_logs = request.args.get("logs", "false").lower() in {"1", "true", "yes"}
    return jsonify({"ok": True, "data": mgr.describe(record, include_logs=include_logs, tail_lines=tail_lines)})


@framework_shells_bp.route("/api/framework_shells/<shell_id>", methods=["DELETE"])
def delete_framework_shell(shell_id: str) -> Any:
    error = _check_mutation_auth()
    if error:
        return jsonify({"ok": False, "error": error}), 403
    force = request.args.get("force", "false").lower() in {"1", "true", "yes"}
    mgr = _manager()
    try:
        mgr.remove_shell(shell_id, force=force)
    except KeyError:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Failed to remove shell: {exc}"}), 500
    return jsonify({"ok": True, "data": {"id": shell_id}})


@framework_shells_bp.route("/api/framework_shells/<shell_id>/action", methods=["POST"])
def framework_shell_action(shell_id: str) -> Any:
    error = _check_mutation_auth()
    if error:
        return jsonify({"ok": False, "error": error}), 403
    payload = request.get_json(silent=True) or {}
    action = (payload.get("action") or "").lower()
    mgr = _manager()
    try:
        if action in {"stop", "terminate"}:
            record = mgr.terminate_shell(shell_id, force=False)
        elif action in {"kill", "force"}:
            record = mgr.terminate_shell(shell_id, force=True)
            try:
                mgr.remove_shell(shell_id, force=True)
            except Exception:
                pass
        elif action == "restart":
            record = mgr.restart_shell(shell_id)
        else:
            return jsonify({"ok": False, "error": f"Unsupported action '{action}'"}), 400
    except KeyError:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Shell action failed: {exc}"}), 500
    return jsonify({"ok": True, "data": mgr.describe(record)})
