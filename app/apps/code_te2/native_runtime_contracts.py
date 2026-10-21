"""Runtime-inspected protocols; retain Python identity under mypyc overlays."""
from __future__ import annotations

from collections.abc import Awaitable
from typing import Protocol, runtime_checkable


@runtime_checkable
class NativeEventHandler(Protocol):
    """Callability only; event owners retain argument and payload validation."""

    def __call__(self, *args: object) -> Awaitable[object]: ...


@runtime_checkable
class QueueSizeReader(Protocol):
    def qsize(self) -> object: ...
