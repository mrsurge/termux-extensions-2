"""Request-bound, nonpersistent forwarding of framework directory usage jobs."""
from __future__ import annotations

import asyncio
import queue
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, cast

import msgspec

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope
from .tab_store import object_map

PREFIX = 'fs.directoryUsage.'


class Entry(msgspec.Struct, forbid_unknown_fields=True):
    path: str
    name: str
    type: Literal['file', 'directory', 'symlink', 'other', 'unknown']
    bytes: int
    complete: bool


class Error(msgspec.Struct, forbid_unknown_fields=True):
    path: str
    message: str


class Update(msgspec.Struct, forbid_unknown_fields=True):
    scanId: str
    path: str
    status: Literal['running', 'complete', 'partial', 'cancelled', 'error']
    mode: Literal['allocated', 'apparent']
    totalBytes: int
    entriesVisited: int
    entries: list[Entry]
    complete: bool
    errorCount: int
    errors: list[Error]
    reason: str | None = None


def decode_update(value: object) -> Update:
    update = msgspec.convert(value, type=Update, strict=True)
    if (min(update.totalBytes, update.entriesVisited, update.errorCount) < 0
            or len(update.entries) > 10000 or len(update.errors) > 32
            or any(entry.bytes < 0 for entry in update.entries)
            or update.complete != (update.status == 'complete')):
        raise ValueError('Invalid directory usage update')
    return update


class Inbox:
    """Thread-safe bounded mailbox; pipe-reader callbacks never block."""
    def __init__(self, scan_id: str) -> None:
        self.scan_id = scan_id
        self.queue: queue.Queue[PipeEnvelope] = queue.Queue(maxsize=8)
        self.loop = asyncio.get_running_loop()
        self.ready = asyncio.Event()
        self.wake_lock = threading.Lock()
        self.wake_pending = False

    def wake(self) -> None:
        with self.wake_lock:
            self.wake_pending = False
        self.ready.set()

    async def get(self) -> PipeEnvelope:
        while True:
            # Clear before checking the queue. A concurrent producer either
            # supplies this get or schedules a wake after the empty check.
            self.ready.clear()
            try:
                return self.queue.get_nowait()
            except queue.Empty:
                await self.ready.wait()

    def put_nowait(self, item: PipeEnvelope) -> None:
        if item.origin_name != 'service.fs' or item.origin_nid != 2100:
            return
        try:
            if object_map(item.params).get('scanId') != self.scan_id:
                return
        except ValueError:
            return
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            # Newest snapshots supersede old progress, including final results.
            try:
                self.queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.queue.put_nowait(item)
            except queue.Full:
                pass
        with self.wake_lock:
            if not self.wake_pending:
                self.wake_pending = True
                try:
                    self.loop.call_soon_threadsafe(self.wake)
                except RuntimeError:
                    self.wake_pending = False  # Worker loop already closed.


@dataclass
class Job:
    sid: str
    tab_id: str
    path: str
    scan_id: str
    inbox: Inbox
    listener: pipe_runtime.PipeNotificationListener
    task: asyncio.Task[None] | None = None


class UsageService:
    def __init__(self, deliver: Callable[[Job, dict[str, object]], Awaitable[None]]) -> None:
        self.deliver = deliver
        self.jobs: dict[str, Job] = {}
        self.retired: set[str] = set()
        self.cancellations: set[asyncio.Task[None]] = set()

    def prepare(self, sid: str, tab_id: str, path: str, scan_id: str) -> Job:
        if scan_id in self.retired or any(job.scan_id == scan_id for job in self.jobs.values()):
            raise ValueError('Scan identity already used')
        if len(self.jobs) >= 128 or len(self.cancellations) >= 128 or len(self.retired) >= 100000:
            raise ValueError('Directory usage request limit reached')
        self.cancel(sid)
        inbox = Inbox(scan_id)
        listener = pipe_runtime.add_notification_listener(inbox, methods={PREFIX + 'progress', PREFIX + 'result'})
        job = Job(sid, tab_id, path, scan_id, inbox, listener)
        self.jobs[sid] = job
        job.task = asyncio.create_task(self.observe(job))
        return job

    async def remote_cancel(self, scan_id: str) -> None:
        try:
            await pipe_runtime.call_async(PREFIX + 'cancel', {'scanId': scan_id},
                target_name='service.fs', target_nid=2100, timeout_seconds=5)
        except Exception:
            pass  # Uncertain cancellation is never retried or replayed.

    def cancel(self, sid: str, scan_id: str | None = None) -> bool:
        job = self.jobs.get(sid)
        if job is None or (scan_id is not None and job.scan_id != scan_id):
            return False
        self.release(job)
        task = asyncio.create_task(self.remote_cancel(job.scan_id))
        self.cancellations.add(task)
        task.add_done_callback(self.cancellations.discard)
        return True

    def release(self, job: Job) -> None:
        if self.jobs.get(job.sid) is job:
            del self.jobs[job.sid]
        self.retired.add(job.scan_id)
        pipe_runtime.remove_notification_listener(job.listener)
        if job.task is not None and job.task is not asyncio.current_task():
            job.task.cancel()

    async def start(self, job: Job) -> dict[str, object]:
        try:
            result = object_map(await pipe_runtime.call_async(PREFIX + 'start',
                {'root': '/', 'path': job.path, 'scanId': job.scan_id},
                target_name='service.fs', target_nid=2100, workspace_root='/', timeout_seconds=10))
            if (set(result) != {'scanId', 'accepted'} or result.get('scanId') != job.scan_id
                    or result.get('accepted') is not True):
                raise ValueError('Invalid directory usage start response')
            if self.jobs.get(job.sid) is not job:
                # A detach can race the start response; cancel again after admission.
                await self.remote_cancel(job.scan_id)
            return result
        except BaseException:
            self.release(job)
            await self.remote_cancel(job.scan_id)
            raise

    async def observe(self, job: Job) -> None:
        try:
            async with asyncio.timeout(130):
                while self.jobs.get(job.sid) is job:
                    envelope = await job.inbox.get()
                    try:
                        update = decode_update(envelope.params)
                    except (ValueError, msgspec.ValidationError):
                        await self.fail(job, 'Malformed directory usage update')
                        return
                    if update.scanId != job.scan_id or update.path != job.path:
                        await self.fail(job, 'Directory usage identity mismatch')
                        return
                    if (envelope.method == PREFIX + 'progress') != (update.status == 'running'):
                        await self.fail(job, 'Directory usage event/status mismatch')
                        return
                    await self.deliver(job, cast(dict[str, object], msgspec.to_builtins(update)))
                    if update.status != 'running':
                        return
        except TimeoutError:
            await self.fail(job, 'Local observation deadline exceeded')
        finally:
            self.release(job)

    async def fail(self, job: Job, reason: str) -> None:
        await self.deliver(job, {'scanId': job.scan_id, 'path': job.path,
            'status': 'error', 'mode': 'allocated', 'totalBytes': 0,
            'entriesVisited': 0, 'entries': [], 'complete': False,
            'errorCount': 1, 'errors': [{'path': job.path, 'message': reason}], 'reason': reason})
        self.cancel(job.sid, job.scan_id)

    async def shutdown(self) -> None:
        observers = [job.task for job in self.jobs.values() if job.task is not None]
        for sid in list(self.jobs):
            self.cancel(sid)
        await asyncio.gather(*observers, *self.cancellations, return_exceptions=True)
