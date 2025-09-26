"""Core-managed framework shell orchestration.

This module exposes a Flask blueprint plus a light manager that can spawn,
inspect, and control long-running background processes ("framework shells").
The shells inherit `TE_SESSION_TYPE=framework`, keeping them out of the
interactive Sessions UI while allowing extensions to manage supporting
services such as aria2 RPC, container helpers, or LLM runtimes.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import signal
import subprocess
import threading
import time
import uuid
import select
import queue
import pty
import fcntl
import termios
import struct
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
    ) -> None:
        self.base_dir = base_dir or DEFAULT_BASE_DIR
        self.metadata_dir = self.base_dir / "meta"
        self.logs_dir = self.base_dir / "logs"
        self.sockets_dir = self.base_dir / "sockets"
        for directory in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.max_shells = max_shells if max_shells is not None else DEFAULT_MAX_SHELLS
        self.auth_token = auth_token or os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
        self._lock = threading.RLock()
        # In-memory PTY tracking for interactive shells
        self._pty: Dict[str, PTYState] = {}

    # ------------------------------------------------------------------
    # Internal helpers

    def _meta_path(self, shell_id: str) -> Path:
        return self.metadata_dir / shell_id / "meta.json"

    def _load_record(self, shell_id: str) -> Optional[ShellRecord]:
        meta_path = self._meta_path(shell_id)
        if not meta_path.exists():
            return None
        try:
            data = json.loads(meta_path.read_text())
            return ShellRecord(
                id=data["id"],
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
                    str(self.logs_dir / f"{data.get('id', 'shell')}.stdout.log"),
                ),
                stderr_log=data.get(
                    "stderr_log",
                    str(self.logs_dir / f"{data.get('id', 'shell')}.stderr.log"),
                ),
                exit_code=data.get("exit_code"),
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
        }
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        tmp_path.replace(meta_path)

    def _iter_records(self) -> Iterable[ShellRecord]:
        for meta in self.metadata_dir.glob("*/meta.json"):
            record = self._load_record(meta.parent.name)
            if record:
                yield record

    def _is_pid_alive(self, pid: Optional[int]) -> bool:
        if not pid:
            return False
        try:
            os.kill(pid, 0)
        except OSError:
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

    def _resolve_cwd(self, cwd: Optional[str]) -> str:
        target = Path(os.path.expanduser(cwd or str(HOME_DIR))).resolve()
        if not str(target).startswith(str(HOME_DIR)):
            raise ValueError("cwd must remain inside the user home directory")
        if not target.exists():
            target.mkdir(parents=True, exist_ok=True)
        return str(target)

    def _normalize_command(self, command: Iterable[str]) -> List[str]:
        if isinstance(command, str):  # pragma: no cover - defensive fallback
            command = shlex.split(command)
        cmd_list = [str(part) for part in command]
        if not cmd_list:
            raise ValueError("command must contain at least one argument")
        return cmd_list

    def _prepare_env(self, record: ShellRecord) -> Dict[str, str]:
        env = os.environ.copy()
        env.update(record.env_overrides)
        env.setdefault("TE_SESSION_TYPE", "framework")
        env.setdefault("TE_FRAMEWORK_SHELL_ID", record.id)
        return env

    def _launch(self, record: ShellRecord) -> ShellRecord:
        env = self._prepare_env(record)
        cwd = record.cwd
        stdout_path = Path(record.stdout_log)
        stderr_path = Path(record.stderr_log)
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        with stdout_path.open("ab") as stdout_fh, stderr_path.open("ab") as stderr_fh:
            proc = subprocess.Popen(
                record.command,
                cwd=cwd,
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

    def _mark_exited(self, record: ShellRecord, exit_code: Optional[int]) -> None:
        record.pid = None
        record.status = "exited"
        record.exit_code = exit_code
        record.updated_at = time.time()
        self._save_record(record)

    def _active_shell_count(self) -> int:
        return sum(1 for r in self._iter_records() if self._is_pid_alive(r.pid))

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
            shell_id = f"fs_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            command_list = self._normalize_command(command)
            cwd_path = self._resolve_cwd(cwd)
            overrides = dict(env or {})
            now = time.time()
            record = ShellRecord(
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
            )
            self._launch(record)
            return record

    def spawn_shell_pty(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        autostart: bool = True,
    ) -> ShellRecord:
        """Spawn an interactive shell attached to a PTY and stream its output.

        The PTY master is kept in-memory and fanned out to subscribers; output is also
        appended to the stdout log for later inspection.
        """
        with self._lock:
            self.sweep()
            if self.max_shells and self._active_shell_count() >= self.max_shells:
                raise RuntimeError("Maximum framework shell count reached")
            shell_id = f"fs_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            command_list = self._normalize_command(command)
            cwd_path = self._resolve_cwd(cwd)
            overrides = dict(env or {})
            now = time.time()
            record = ShellRecord(
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
            )
            # Create PTY
            master_fd, slave_fd = pty.openpty()
            # Prepare env with framework session markers
            envp = self._prepare_env(record)
            envp.setdefault("TERM", "xterm-256color")
            envp.setdefault("TE_TTY", "pty")
            # Launch process attached to PTY
            with open(record.stdout_log, "ab") as _:
                pass  # ensure file exists
            try:
                proc = subprocess.Popen(
                    command_list,
                    cwd=cwd_path,
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
            # Start reader thread to tee PTY master into log and subscribers
            state = PTYState(master_fd=master_fd)
            def _reader():
                log_path = Path(record.stdout_log)
                with log_path.open("ab") as log_fh:
                    while not state.stop.is_set():
                        try:
                            r, _, _ = select.select([master_fd], [], [], 0.5)
                            if not r:
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
                        # Snapshot subscribers to avoid holding lock during send
                        subs = list(state.subscribers)
                        for q in subs:
                            try:
                                q.put_nowait(text)
                            except Exception:
                                pass
                # Attempt to close master when stopping
                try:
                    os.close(master_fd)
                except Exception:
                    pass
            t = threading.Thread(target=_reader, daemon=True)
            state.reader = t
            self._pty[shell_id] = state
            t.start()
            return record

    def write_to_pty(self, shell_id: str, data: bytes | str) -> None:
        with self._lock:
            state = self._pty.get(shell_id)
            if not state:
                raise KeyError("No PTY for this shell")
            payload = data.encode("utf-8") if isinstance(data, str) else data
            os.write(state.master_fd, payload)

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
                exit_code = record.exit_code
                if not exit_code:
                    exit_code = self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)
                return record
            sig = signal.SIGKILL if force else signal.SIGTERM
            try:
                os.kill(record.pid, sig)
            except OSError:
                exit_code = self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)
                return record
            if not force:
                deadline = time.time() + timeout
                while time.time() < deadline:
                    if not self._is_pid_alive(record.pid):
                        exit_code = self._collect_exit_code(record.pid)
                        self._mark_exited(record, exit_code)
                        return record
                    time.sleep(0.2)
                # escalate to SIGKILL if still running
                try:
                    os.kill(record.pid, signal.SIGKILL)
                except OSError:
                    pass
            # final state
            exit_code = self._collect_exit_code(record.pid)
            self._mark_exited(record, exit_code)
            # cleanup PTY resources if any
            state = self._pty.pop(shell_id, None)
            if state:
                state.stop.set()
                try:
                    if state.reader:
                        state.reader.join(timeout=1.0)
                except Exception:
                    pass
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
            self._save_record(record)
            return self._launch(record)

    def remove_shell(self, shell_id: str, *, force: bool = False) -> None:
        with self._lock:
            record = self._load_record(shell_id)
            if not record:
                raise KeyError("Shell not found")
            if record.pid and self._is_pid_alive(record.pid):
                self.terminate_shell(shell_id, force=force)
            shutil.rmtree(self.metadata_dir / shell_id, ignore_errors=True)
            # cleanup PTY if any
            state = self._pty.pop(shell_id, None)
            if state:
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
            for log_path in (record.stdout_log, record.stderr_log):
                try:
                    Path(log_path).unlink()
                except FileNotFoundError:
                    pass

    def sweep(self) -> None:
        """Update metadata for processes that have exited."""
        for record in list(self._iter_records()):
            if record.pid and not self._is_pid_alive(record.pid):
                exit_code = record.exit_code or self._collect_exit_code(record.pid)
                self._mark_exited(record, exit_code)

    def describe(self, record: ShellRecord, *, include_logs: bool = False, tail_lines: int = 0) -> Dict[str, Any]:
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
                        proc = psutil.Process(record.pid)
                        with proc.oneshot():
                            stats["cpu_percent"] = proc.cpu_percent(interval=0.0)
                            stats["memory_rss"] = proc.memory_info().rss
                            stats["num_threads"] = proc.num_threads()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
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
    mgr = current_app.config.get("TE_FRAMEWORK_SHELL_MANAGER")
    if not isinstance(mgr, FrameworkShellManager):
        mgr = FrameworkShellManager(base_dir=base_dir, max_shells=max_shells, auth_token=token)
        current_app.config["TE_FRAMEWORK_SHELL_MANAGER"] = mgr
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
