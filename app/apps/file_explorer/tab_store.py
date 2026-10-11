"""Durable File Explorer tabs. Presentation lifetime does not own records."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import TypedDict, cast
from collections.abc import Mapping
import uuid


class TabOptions(TypedDict):
    showHidden: bool
    view: str
    sortBy: str
    sortAsc: bool


class TabRecord(TypedDict):
    id: str
    path: str
    revision: int
    options: TabOptions
    shellId: str | None
    directoryLocked: bool
    shellTrackingId: str | None


def object_map(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError('Expected an object')
    source = cast(Mapping[object, object], value)
    if any(not isinstance(key, str) for key in source):
        raise ValueError('Expected string keys')
    return {str(key): item for key, item in source.items()}


def text(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ValueError('Expected nonempty bounded text')
    return value


def options(value: object) -> TabOptions:
    body = object_map(value)
    hidden, asc = body.get('showHidden', False), body.get('sortAsc', True)
    view, sort = body.get('view', 'list'), body.get('sortBy', 'name')
    if not isinstance(hidden, bool) or not isinstance(asc, bool):
        raise ValueError('Expected boolean tab options')
    if view not in ('list', 'grid') or sort not in ('name', 'size', 'type', 'date'):
        raise ValueError('Invalid tab options')
    return {'showHidden': hidden, 'sortAsc': asc, 'view': str(view), 'sortBy': str(sort)}


def record(value: object) -> TabRecord:
    body = object_map(value)
    revision = body.get('revision')
    shell = body.get('shellId')
    locked = body.get('directoryLocked', True)
    tracking = body.get('shellTrackingId')
    if not isinstance(locked, bool) or tracking is not None and not isinstance(tracking, str):
        raise ValueError('Invalid directory tracking state')
    if isinstance(tracking, str) and (shell is None or len(tracking) != 32 or any(char not in '0123456789abcdef' for char in tracking)):
        raise ValueError('Invalid shell tracking generation')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValueError('Invalid tab revision')
    if shell is not None and not isinstance(shell, str):
        raise ValueError('Invalid shell association')
    return {'id': text(body.get('id')), 'path': text(body.get('path')),
            'revision': revision, 'options': options(body.get('options')), 'shellId': shell,
            'directoryLocked': locked, 'shellTrackingId': tracking}


def clone(tab: TabRecord) -> TabRecord:
    return record(tab)


class TabStore:
    """Called under the session service lock; replace disk before memory commit."""
    def __init__(self, path: Path) -> None:
        self.path: Path = path
        self.tabs: dict[str, TabRecord] = {}
        self.creations: dict[str, str] = {}
        self.loaded: bool = False

    def load(self) -> None:
        if self.loaded:
            return
        if self.path.exists():
            if self.path.stat().st_size > 4 * 1024 * 1024:
                raise ValueError('Tab store exceeds size bound')
            body = object_map(cast(object, json.loads(self.path.read_text())))
            if body.get('schema') != 1:
                raise ValueError('Unsupported tab store schema')
            tabs = object_map(body.get('tabs'))
            creations = object_map(body.get('creations'))
            self.tabs = {key: record(value) for key, value in tabs.items()}
            if any(key != tab['id'] for key, tab in self.tabs.items()):
                raise ValueError('Mismatched tab identity')
            self.creations = {key: text(value) for key, value in creations.items()}
        self.loaded = True

    def _commit(self, tabs: dict[str, TabRecord], creations: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps({'schema': 1, 'tabs': tabs, 'creations': creations})
        if len(raw.encode()) > 4 * 1024 * 1024:
            raise ValueError('Tab store exceeds size bound')
        fd, temporary = tempfile.mkstemp(prefix='.tabs-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                _ = stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.tabs, self.creations = tabs, creations

    def get(self, tab_id: str) -> TabRecord | None:
        self.load()
        tab = self.tabs.get(tab_id)
        return clone(tab) if tab else None

    def snapshot(self) -> list[TabRecord]:
        self.load()
        return [clone(tab) for tab in self.tabs.values()]

    def create(self, operation: str, path: str, preferences: TabOptions) -> TabRecord:
        self.load()
        if operation in self.creations:
            existing = self.get(self.creations[operation])
            if existing is None:
                raise ValueError('This tab creation was already closed')
            return existing
        if len(self.tabs) >= 512 or len(self.creations) >= 8192:
            raise ValueError('Tab record limit reached')
        tab: TabRecord = {'id': uuid.uuid4().hex, 'path': path, 'revision': 1,
                          'options': preferences.copy(), 'shellId': None,
                          'directoryLocked': True, 'shellTrackingId': None}
        self._commit({**self.tabs, tab['id']: tab}, {**self.creations, operation: tab['id']})
        return clone(tab)

    def update(self, tab_id: str, revision: int, path: str, preferences: TabOptions) -> TabRecord:
        tab = self.get(tab_id)
        if tab is None:
            raise ValueError('Tab no longer exists')
        if revision != tab['revision']:
            raise ValueError('Tab changed; resync before navigating')
        if tab['path'] == path and tab['options'] == preferences:
            return tab
        tab['path'], tab['options'], tab['revision'] = path, preferences.copy(), revision + 1
        self._commit({**self.tabs, tab_id: tab}, self.creations.copy())
        return clone(tab)

    def close(self, tab_id: str, revision: int) -> None:
        tab = self.get(tab_id)
        if tab is None:
            return
        if revision != tab['revision']:
            raise ValueError('Tab changed; resync before closing')
        if tab['shellId']:
            raise ValueError('Close the associated terminal before closing this tab')
        remaining = self.tabs.copy()
        del remaining[tab_id]
        self._commit(remaining, self.creations.copy())

    def set_shell(self, tab_id: str, revision: int, shell_id: str | None, tracking_id: str | None = None) -> TabRecord:
        tab = self.get(tab_id)
        if tab is None or tab['revision'] != revision:
            raise ValueError('Tab changed; resync before changing terminal')
        if shell_id is not None:
            shell_id = text(shell_id)
        if tab['shellId'] == shell_id:
            return tab
        tab['shellId'], tab['revision'] = shell_id, revision + 1
        tab['shellTrackingId'] = tracking_id if shell_id else None
        self._commit({**self.tabs, tab_id: tab}, self.creations.copy())
        return clone(tab)

    def set_directory_lock(self, tab_id: str, revision: int, locked: bool) -> TabRecord:
        tab = self.get(tab_id)
        if tab is None or tab['revision'] != revision:
            raise ValueError('Tab changed; resync before changing directory lock')
        if tab['directoryLocked'] == locked:
            return tab
        tab['directoryLocked'], tab['revision'] = locked, revision + 1
        self._commit({**self.tabs, tab_id: tab}, self.creations.copy())
        return clone(tab)
