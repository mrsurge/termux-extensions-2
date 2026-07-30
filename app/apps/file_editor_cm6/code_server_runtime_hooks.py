# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable

CodeServerRuntimePrimer = Callable[[str], Awaitable[None]]

_runtime_primer: CodeServerRuntimePrimer | None = None


def set_code_server_runtime_primer(primer: CodeServerRuntimePrimer) -> None:
    global _runtime_primer
    _runtime_primer = primer


async def prime_code_server_runtime(project_root: str) -> None:
    primer = _runtime_primer
    if primer is None:
        raise RuntimeError("Code Server runtime primer is not configured")
    await primer(project_root)
