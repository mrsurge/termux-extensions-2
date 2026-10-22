"""Typed app-owned runtime preparation contract used by the bootstrap.

Providers are trusted application code, loaded only during explicit preparation,
never while discovering manifests or selecting cached Cargo artifacts.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class NativeRuntimeContext:
    project_root: Path
    app_root: Path
    packaged: bool
    environment: Mapping[str, str]


@dataclass(frozen=True)
class NativeRuntimeResult:
    environment: Mapping[str, str]
    remove_environment: tuple[str, ...] = ()
    executable: Path | None = None


class NativeRuntimeProvider(Protocol):
    def __call__(self, context: NativeRuntimeContext) -> NativeRuntimeResult: ...
