"""Versioned, bounded native launch-selection exchange; no build entrypoint."""
from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, Protocol

import msgspec

MAX_SELECTION_BYTES = 1024 * 1024
MAX_CONTEXT_BYTES = 64 * 1024  # Below per-environment-string exec limits.
CONTEXT_ENV = 'TE2_NATIVE_SELECTION_CONTEXT'


class RuntimeReceipt(msgspec.Struct, forbid_unknown_fields=True):
    declaration: str
    executable: str
    environment: dict[str, str]
    remove_environment: list[str]
    executable_digest: str | None = None


class SelectionContext(msgspec.Struct, forbid_unknown_fields=True):
    schema_version: Literal[1]
    profile: Literal['release', 'debug', 'memory']
    packaged: bool
    workers: dict[str, RuntimeReceipt]


class WorkerSelection(msgspec.Struct, forbid_unknown_fields=True):
    app_id: str
    environment_key: str
    declaration: str
    status: Literal['ready', 'build_required', 'preparation_required']
    executable: str | None
    fingerprint: str | None
    environment: dict[str, str]
    remove_environment: list[str]


class SelectionSnapshot(msgspec.Struct, forbid_unknown_fields=True):
    schema_version: Literal[1]
    profile: Literal['release', 'debug', 'memory']
    packaged: bool
    generation: str
    workers: list[WorkerSelection]


class NativeSelector(Protocol):
    def __call__(self, env: Mapping[str, str], context: SelectionContext) -> SelectionSnapshot: ...


def declaration_digest(manifest: Path, provider: Path | None) -> str:
    digest = hashlib.sha256()
    for path in (manifest, manifest.with_name('manifest.json'), provider):
        if path is not None:
            digest.update(str(path.resolve()).encode())
            digest.update(b'\0')
            digest.update(path.read_bytes())
            digest.update(b'\0')
    return digest.hexdigest()


def executable_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(128 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def decode_context(raw: str) -> SelectionContext:
    data = raw.encode()
    if len(data) > MAX_CONTEXT_BYTES:
        raise ValueError('Native selection context exceeds byte limit')
    return msgspec.json.decode(data, type=SelectionContext)


def encode_context(context: SelectionContext) -> str:
    data = msgspec.json.encode(context)
    if len(data) > MAX_CONTEXT_BYTES:
        raise ValueError('Native selection context exceeds byte limit')
    return data.decode()
