"""App-owned job admission/projection; never a framework-global registry."""
from __future__ import annotations

import asyncio
import threading
from typing import cast

import msgspec
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope

from app.libs.jobs import JobManager
from app.libs.te2_asgi import read_json_object, require_method
from app.te2_paths import te2_app_data_home


class JobRequest(msgspec.Struct, forbid_unknown_fields=True):
    type: str
    params: dict[str, object]


class AppJobs:
    def __init__(self, app_id: str, allowed: frozenset[str]) -> None:
        self.app_id = app_id
        self.allowed = allowed
        self._manager: JobManager | None = None
        self._lock = threading.Lock()

    @property
    def manager(self) -> JobManager:
        with self._lock:
            if self._manager is None:
                self._manager = JobManager(te2_app_data_home(self.app_id) / 'jobs.json')
            return self._manager

    def create(self, kind: str, params: dict[str, object]) -> dict[str, object]:
        if kind not in self.allowed:
            raise HTTPException(422, 'Unsupported job type for this app')
        if kind in {'create_archive', 'test_archive'}:
            from app.libs.archive_operations import create_params, test_params
            params = create_params(params) if kind == 'create_archive' else test_params(params)
        elif kind == 'extract_archive':
            from app.libs.archiver_service import extraction_params
            params = extraction_params(params)
        try:
            return cast(dict[str, object], self.manager.create_job(kind, params).to_public_dict())
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    async def dispatch(self, scope: Scope, receive: Receive) -> Response:
        path, method = scope['path'], scope['method']
        if path == '/jobs':
            require_method(method, ('GET', 'POST'))
            if method == 'POST':
                body = await read_json_object(scope, receive, max_bytes=1024 * 1024)
                try:
                    request = msgspec.convert(body, type=JobRequest, strict=True)
                except (TypeError, ValueError) as exc:
                    raise HTTPException(422, str(exc)) from exc
                data: object = await asyncio.to_thread(self.create, request.type, request.params)
            else:
                data = await asyncio.to_thread(self._list)
        else:
            parts = path.split('/')
            if len(parts) not in (3, 4) or not parts[2] or (len(parts) == 4 and parts[3] != 'cancel'):
                raise HTTPException(404, 'Unknown job route')
            action = 'cancel' if len(parts) == 4 else 'record'
            require_method(method, ('POST',) if action == 'cancel' else ('GET', 'DELETE'))
            data = await asyncio.to_thread(self._record, parts[2], method, action)
        return JSONResponse({'ok': True, 'data': data})

    def _list(self) -> list[dict[str, object]]:
        return [cast(dict[str, object], job.to_public_dict()) for job in self.manager.list_jobs().values()]

    def _record(self, job_id: str, method: str, action: str) -> dict[str, object]:
        manager = self.manager
        if manager.get_job(job_id) is None:
            raise HTTPException(404, 'Job not found')
        if method == 'DELETE':
            if not manager.delete_job(job_id):
                raise HTTPException(409, 'A running job must be cancelled before deletion')
            return {'deleted': True, 'id': job_id}
        if action == 'cancel':
            job = manager.cancel_job(job_id)
        else:
            found = manager.get_job(job_id)
            if found is None:
                raise HTTPException(404, 'Job not found')
            job = found
        return cast(dict[str, object], job.to_public_dict())
