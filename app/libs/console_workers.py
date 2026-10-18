"""Ephemeral console addresses, separate from durable application identities."""
from __future__ import annotations

import re
import secrets
import string
from dataclasses import dataclass


@dataclass(frozen=True)
class ConsoleWorker:
    sid: str
    worker_id: str
    requested_id: str
    label: str
    client_id: str
    presentation_id: str


class ConsoleWorkers:
    """One exact socket per public address; ambiguous legacy names fail closed.

    Short tokens are observability addresses, never authorization credentials.
    They are not reused during this runtime, so stale handles cannot hit a new
    page. Registration counts and allocation attempts are bounded.
    """

    def __init__(self) -> None:
        self.by_sid: dict[str, ConsoleWorker] = {}
        self.by_id: dict[str, ConsoleWorker] = {}
        self._tokens: set[str] = set()
        self._clients: dict[str, str] = {}

    def _token(self) -> str:
        if len(self._tokens) >= 65536:
            raise ValueError('console registry capacity reached')
        for _ in range(128):
            token = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(4))
            if token not in self._tokens:
                self._tokens.add(token)
                return token
        raise ValueError('console short-address allocation failed')

    def register(self, sid: str, requested_id: str, label: str, client_id: str = '',
                 presentation_id: str = '', *, compact: bool = False, qualified: bool = False) -> ConsoleWorker:
        current = self.by_sid.get(sid)
        if current and (current.requested_id, current.client_id, current.presentation_id) == (
            requested_id, client_id, presentation_id
        ):
            return current
        if len(self._tokens) >= 65536 or len(self.by_sid) >= 4096:
            raise ValueError('console registry capacity reached')
        label = re.sub(r'[^a-zA-Z0-9_-]', '_', label)[:48] or 'worker'
        if qualified and re.fullmatch(r'[A-Za-z0-9_-]+:[A-Za-z0-9]{4}(?:\.[A-Za-z0-9]{4})?', requested_id) is None:
            raise ValueError('invalid qualified presentation identity')
        previous_owner = self.by_id.get(requested_id) if qualified else None
        if previous_owner is not None and previous_owner.sid != sid:
            if previous_owner.requested_id != requested_id or previous_owner.client_id != client_id:
                raise ValueError('qualified console identity belongs to another client')
            self.remove(previous_owner.sid)
        if compact and not qualified:
            owner = ''
            if client_id:
                if client_id not in self._clients:
                    self._clients[client_id] = self._token()
                owner = '.' + self._clients[client_id]
            for _ in range(128):
                worker_id = f'{label}:{self._token()}{owner}'
                if worker_id not in self.by_id:
                    break
            else:
                raise ValueError('console short-address allocation failed')
        else:
            worker_id = requested_id
            if worker_id in self.by_id:
                worker_id = f'{requested_id}.{self._token()}'
        if current:
            self.remove(sid)
        worker = ConsoleWorker(sid, worker_id, requested_id, label, client_id, presentation_id)
        self.by_sid[sid] = worker
        self.by_id[worker_id] = worker
        return worker

    def remove(self, sid: str) -> ConsoleWorker | None:
        worker = self.by_sid.pop(sid, None)
        if worker and self.by_id.get(worker.worker_id) is worker:
            self.by_id.pop(worker.worker_id)
        return worker

    def lookup(self, worker_id: str) -> ConsoleWorker:
        # A long legacy name is usable only while it identifies exactly one SID.
        matches = [worker for worker in self.by_sid.values() if worker.requested_id == worker_id]
        if len(matches) > 1:
            raise LookupError(f'ambiguous console worker: {worker_id}; use an exact live handle')
        worker = self.by_id.get(worker_id)
        if worker is not None:
            return worker
        if len(matches) == 1:
            return matches[0]
        raise LookupError(f'console worker not registered: {worker_id}')
