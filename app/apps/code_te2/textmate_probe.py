"""Temporary metadata-only TextMate diagnostics for the loading investigation."""
from __future__ import annotations

import os
import sys
import time


def trace(phase: str, **fields: object) -> None:
    if os.environ.get("TE2_RUNTIME_DEBUG", "").lower() not in {"1", "true", "yes"}:
        return
    print(f"[textmate_probe] unix_ms={time.time_ns() // 1_000_000} phase={phase} {fields!r}",
          file=sys.stderr, flush=True)
