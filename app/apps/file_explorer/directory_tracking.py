"""Private generation-scoped Bash directory requests; paths are data, not code."""
from __future__ import annotations

import os
from pathlib import Path
import stat
import tempfile
from typing import TypedDict
import uuid


class TrackingStatus(TypedDict):
    state: str
    path: str


class DirectoryTracking:
    def __init__(self, root: Path) -> None:
        self.root: Path = root

    def directory(self, identity: str) -> Path:
        if len(identity) != 32 or any(char not in '0123456789abcdef' for char in identity):
            raise ValueError('Invalid terminal tracking generation')
        path = self.root / identity
        for directory in (self.root, path):
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Unsafe terminal tracking directory')
        return path

    def create(self) -> str:
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        identity = uuid.uuid4().hex
        (self.root / identity).mkdir(mode=0o700)
        _ = self.directory(identity)
        self.request(identity, 0, None)
        return identity

    def discard(self, identity: str) -> None:
        try:
            directory = self.directory(identity)
        except FileNotFoundError:
            return
        for path in directory.iterdir():
            if path.name not in ('request', 'ack') and not path.name.startswith(('.ack-', '.request-')):
                raise ValueError('Unexpected terminal tracking resource')
            path.unlink()
        directory.rmdir()

    def request(self, identity: str, revision: int, path: str | None) -> None:
        directory = self.directory(identity)
        if revision < 0 or path is not None and ('\0' in path or len(os.fsencode(path)) > 4096):
            raise ValueError('Invalid directory tracking request')
        # A cancelled request may precede a failed tab persistence. A nonce keeps
        # later intents distinct even if that same tab revision is reused.
        token = f'{revision}-{uuid.uuid4().hex}'.encode()
        data = token + b'\n' + (b'1\n' if path is not None else b'0\n') + os.fsencode(path or '') + b'\0'
        fd, temporary = tempfile.mkstemp(prefix='.request-', dir=directory)
        try:
            with os.fdopen(fd, 'wb') as stream:
                _ = stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, directory / 'request')
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _read(self, directory: Path, name: str) -> bytes | None:
        try:
            fd = os.open(directory / name, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 8192:
                raise ValueError('Unsafe terminal tracking message')
            return stream.read(8193)

    def status(self, identity: str | None, locked: bool) -> TrackingStatus:
        if not locked:
            return {'state': 'unlocked', 'path': ''}
        if identity is None:
            return {'state': 'unavailable', 'path': ''}
        try:
            directory = self.directory(identity)
        except FileNotFoundError:
            return {'state': 'unavailable', 'path': ''}
        request = self._read(directory, 'request')
        ack = self._read(directory, 'ack')
        if ack is None:
            return {'state': 'starting', 'path': ''}
        parts = ack.split(b'\n', 2)
        token = parts[0].split(b'-')
        valid_token = len(token) == 2 and token[0].isdigit() and len(token[1]) == 32 and all(char in b'0123456789abcdef' for char in token[1])
        if len(parts) != 3 or not valid_token or parts[1] not in (b'ready', b'applied', b'error') or not parts[2].endswith(b'\0'):
            raise ValueError('Invalid terminal tracking acknowledgment')
        requested = request.split(b'\n', 2) if request is not None else []
        if len(requested) == 3 and requested[1] == b'0' and requested[0] != parts[0]:
            return {'state': 'ready', 'path': os.fsdecode(parts[2][:-1])}
        if len(requested) == 3 and requested[1] == b'1' and requested[0] != parts[0]:
            return {'state': 'pending', 'path': os.fsdecode(requested[2][:-1])}
        return {'state': parts[1].decode(), 'path': os.fsdecode(parts[2][:-1])}
