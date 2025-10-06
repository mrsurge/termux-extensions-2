from __future__ import annotations

import json
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from flask import Blueprint, Response, jsonify, request, stream_with_context

__all__ = ["jobs_bp", "register_job_handler"]

_JOBS_DIR = Path.home() / ".cache" / "termux_extensions"
_JOBS_FILE = _JOBS_DIR / "jobs.json"

jobs_bp = Blueprint("jobs", __name__)


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobCancelled(Exception):
    """Raised inside a job handler when cancellation is requested."""


@dataclass
class Job:
    job_type: str
    params: Dict[str, Any]
    id: str = field(default_factory=lambda: f"job-{uuid.uuid4().hex[:8]}")
    status: str = JobStatus.PENDING
    message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress: Optional[Dict[str, Any]] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    _cancel_requested: bool = field(default=False, init=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)
    _process: Optional[subprocess.Popen] = field(default=None, init=False, repr=False)

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.job_type,
            "status": self.status,
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    def to_state_dict(self) -> Dict[str, Any]:
        data = self.to_public_dict()
        data["params"] = self.params
        return data

    @classmethod
    def from_state_dict(cls, data: Dict[str, Any]) -> "Job":
        job = cls(job_type=data.get("type", "unknown"), params=data.get("params") or {}, id=data.get("id", f"job-{uuid.uuid4().hex[:8]}"))
        job.status = data.get("status", JobStatus.PENDING)
        job.message = data.get("message")
        job.result = data.get("result")
        job.error = data.get("error")
        job.progress = data.get("progress")
        job.created_at = data.get("created_at", time.time())
        job.started_at = data.get("started_at")
        job.finished_at = data.get("finished_at")
        return job

    def request_cancel(self) -> None:
        with self._lock:
            self._cancel_requested = True
            proc = self._process
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass

    def cancel_requested(self) -> bool:
        with self._lock:
            return self._cancel_requested

    # --- lifecycle helpers -------------------------------------------------
    def mark_running(self, message: Optional[str] = None) -> None:
        with self._lock:
            self.status = JobStatus.RUNNING
            self.message = message
            self.started_at = self.started_at or time.time()

    def mark_succeeded(self, result: Optional[Dict[str, Any]] = None, message: Optional[str] = None) -> None:
        with self._lock:
            self.status = JobStatus.SUCCEEDED
            self.result = result
            if message is not None:
                self.message = message
            self.finished_at = time.time()

    def mark_failed(self, error: str) -> None:
        with self._lock:
            self.status = JobStatus.FAILED
            self.error = error
            self.finished_at = time.time()

    def mark_cancelled(self, message: Optional[str] = None) -> None:
        with self._lock:
            self.status = JobStatus.CANCELLED
            self.message = message
            self.finished_at = time.time()

    def update_progress(self, *, completed: Optional[int] = None, total: Optional[int] = None, detail: Optional[str] = None) -> None:
        with self._lock:
            progress = self.progress or {}
            if completed is not None:
                progress["completed"] = completed
            if total is not None:
                progress["total"] = total
            if detail is not None:
                progress["detail"] = detail
            self.progress = progress


class JobContext:
    """Helper passed to job handlers."""

    def __init__(self, job: Job, manager: "JobManager") -> None:
        self.job = job
        self.manager = manager

    def check_cancelled(self) -> None:
        if self.job.cancel_requested():
            raise JobCancelled()

    def set_message(self, message: str) -> None:
        self.job.message = message
        self.manager.save_state_async()
        self.manager.notify_job_update(self.job)

    def set_progress(self, completed: Optional[int] = None, total: Optional[int] = None, detail: Optional[str] = None) -> None:
        self.job.update_progress(completed=completed, total=total, detail=detail)
        self.manager.save_state_async()
        self.manager.notify_job_update(self.job)

    def finish(self, message: Optional[str] = None, result: Optional[Dict[str, Any]] = None) -> None:
        self.job.mark_succeeded(result=result, message=message)
        self.manager.save_state_async()
        self.manager.notify_job_update(self.job)

    def attach_process(self, proc: subprocess.Popen) -> None:
        self.job._process = proc

    def detach_process(self) -> None:
        self.job._process = None


JobHandler = Callable[[JobContext, Dict[str, Any]], None]
_JOB_HANDLERS: Dict[str, JobHandler] = {}


def register_job_handler(job_type: str) -> Callable[[JobHandler], JobHandler]:
    """Decorator used by apps to register job handlers."""

    def decorator(func: JobHandler) -> JobHandler:
        _JOB_HANDLERS[job_type] = func
        return func

    return decorator


class JobManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.RLock()
        self._save_lock = threading.Lock()
        self._listeners: List[Tuple[Queue, Optional[Set[str]]]] = []
        self._load_state()

    # --- persistence -------------------------------------------------------
    def _load_state(self) -> None:
        if not _JOBS_FILE.exists():
            return
        try:
            data = json.loads(_JOBS_FILE.read_text())
        except Exception:
            _JOBS_FILE.unlink(missing_ok=True)
            return
        now = time.time()
        for job_id, record in data.items():
            job = Job.from_state_dict(record)
            # mark in-flight jobs as failed because the process was restarted
            if job.status in {JobStatus.PENDING, JobStatus.RUNNING}:
                job.status = JobStatus.FAILED
                job.error = "Job interrupted by restart"
                job.finished_at = now
            self._jobs[job_id] = job

    def save_state_async(self) -> None:
        threading.Thread(target=self._save_state, daemon=True).start()

    def _save_state(self) -> None:
        with self._save_lock:
            _JOBS_DIR.mkdir(parents=True, exist_ok=True)
            snapshot = {job_id: job.to_state_dict() for job_id, job in self._jobs.items()}
            tmp = _JOBS_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(snapshot, indent=2))
            tmp.replace(_JOBS_FILE)

    # --- listeners ---------------------------------------------------------
    def add_listener(self, queue: Queue, job_ids: Optional[Iterable[str]] = None) -> Tuple[Queue, Optional[Set[str]]]:
        job_filter = set(job_ids) if job_ids else None
        listener: Tuple[Queue, Optional[Set[str]]] = (queue, job_filter)
        with self._lock:
            self._listeners.append(listener)
            snapshot = [
                job.to_public_dict()
                for job in self._jobs.values()
                if job_filter is None or job.id in job_filter
            ]
        if snapshot:
            try:
                queue.put_nowait({"jobs": snapshot, "partial": False})
            except Exception:
                pass
        return listener

    def remove_listener(self, listener: Tuple[Queue, Optional[Set[str]]]) -> None:
        with self._lock:
            if listener in self._listeners:
                self._listeners.remove(listener)

    def _broadcast_job(self, job: Job, *, partial: bool = True) -> None:
        payload = {"jobs": [job.to_public_dict()], "partial": partial}
        with self._lock:
            listeners = [
                queue
                for queue, job_filter in self._listeners
                if job_filter is None or job.id in job_filter
            ]
        for queue in listeners:
            try:
                queue.put_nowait(payload)
            except Exception:
                pass

    def notify_job_update(self, job: Job, *, partial: bool = True) -> None:
        self._broadcast_job(job, partial=partial)

    # --- CRUD --------------------------------------------------------------
    def create_job(self, job_type: str, params: Dict[str, Any]) -> Job:
        if job_type not in _JOB_HANDLERS:
            raise ValueError(f"Unknown job type: {job_type}")
        job = Job(job_type=job_type, params=params)
        with self._lock:
            self._jobs[job.id] = job
            self._spawn(job)
            self._prune_finished(max_items=200)
        self.save_state_async()
        self.notify_job_update(job)
        return job

    def list_jobs(self) -> Dict[str, Job]:
        with self._lock:
            return dict(self._jobs)

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel_job(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            job.request_cancel()
            return job

    def delete_job(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.status in {JobStatus.RUNNING, JobStatus.PENDING}:
                return False
            del self._jobs[job_id]
        self.save_state_async()
        return True

    # --- helpers -----------------------------------------------------------
    def _spawn(self, job: Job) -> None:
        thread = threading.Thread(target=self._run_job, args=(job,), daemon=True)
        thread.start()

    def _run_job(self, job: Job) -> None:
        handler = _JOB_HANDLERS.get(job.job_type)
        if not handler:
            job.mark_failed("No handler registered")
            self.save_state_async()
            self.notify_job_update(job)
            return
        job.mark_running()
        self.save_state_async()
        self.notify_job_update(job)
        ctx = JobContext(job, self)
        try:
            handler(ctx, job.params)
            if job.status == JobStatus.RUNNING:
                job.mark_succeeded(message=job.message)
                self.notify_job_update(job)
        except JobCancelled:
            job.mark_cancelled(job.message or "Job cancelled")
            self.notify_job_update(job)
        except Exception as exc:  # pylint: disable=broad-except
            job.mark_failed(str(exc) or "Job failed")
            self.notify_job_update(job)
        finally:
            job._process = None
            self.save_state_async()

    def _prune_finished(self, *, max_items: int) -> None:
        finished = [job_id for job_id, job in self._jobs.items() if job.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}]
        if len(finished) <= max_items:
            return
        finished.sort(key=lambda jid: self._jobs[jid].finished_at or 0)
        for job_id in finished[:-max_items]:
            self._jobs.pop(job_id, None)


manager = JobManager()


@register_job_handler("noop")
def _noop_handler(ctx: JobContext, params: Dict[str, Any]) -> None:
    """Simple no-op job for testing."""
    duration = float(params.get("duration", 0))
    interval = 0.2
    steps = int(max(1, duration / interval))
    for step in range(steps):
        ctx.check_cancelled()
        ctx.set_message(params.get("message", "Working"))
        ctx.set_progress(completed=step + 1, total=steps)
        time.sleep(interval)
    ctx.finish(message=params.get("message", "Completed"))


# ---------------------------------------------------------------------------
# Blueprint routes
# ---------------------------------------------------------------------------


@jobs_bp.route("/jobs", methods=["POST"])
def create_job_route():
    payload = request.get_json(silent=True) or {}
    job_type = payload.get("type")
    params = payload.get("params") or {}
    if not isinstance(job_type, str) or not job_type:
        return jsonify({"ok": False, "error": "Job type is required"}), 400
    try:
        job = manager.create_job(job_type, params)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "data": job.to_public_dict()}), 202


@jobs_bp.route("/jobs", methods=["GET"])
def list_jobs_route():
    jobs = [job.to_public_dict() for job in manager.list_jobs().values()]
    return jsonify({"ok": True, "data": jobs})


@jobs_bp.route("/jobs/<job_id>", methods=["GET"])
def get_job_route(job_id: str):
    job = manager.get_job(job_id)
    if not job:
        return jsonify({"ok": False, "error": "Job not found"}), 404
    return jsonify({"ok": True, "data": job.to_public_dict()})


@jobs_bp.route("/jobs/<job_id>/cancel", methods=["POST"])
def cancel_job_route(job_id: str):
    try:
        job = manager.cancel_job(job_id)
    except KeyError:
        return jsonify({"ok": False, "error": "Job not found"}), 404
    return jsonify({"ok": True, "data": job.to_public_dict()})


@jobs_bp.route("/jobs/<job_id>", methods=["DELETE"])
def delete_job_route(job_id: str):
    removed = manager.delete_job(job_id)
    if not removed:
        return jsonify({"ok": False, "error": "Job is running or not found"}), 400
    return jsonify({"ok": True, "data": None})


@jobs_bp.route("/jobs/events", methods=["GET"])
def jobs_events_stream():
    job_id = request.args.get("job_id")
    job_ids = [job_id] if job_id else None
    queue: Queue = Queue()
    listener = manager.add_listener(queue, job_ids)

    def generate():
        try:
            while True:
                try:
                    payload = queue.get(timeout=25)
                except Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            manager.remove_listener(listener)

    response = Response(stream_with_context(generate()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response
