"""Cheap executable health checks for explicit developer compiler workflows."""
from __future__ import annotations

import shutil
import subprocess


def ccache_health() -> tuple[bool, str]:
    executable = shutil.which('ccache')
    if executable is None:
        return False, 'ccache is not installed or not on PATH'
    try:
        result = subprocess.run([executable, '--version'], capture_output=True,
                                text=True, check=False, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f'ccache cannot run: {exc}'
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()[:2000]
        return False, f'ccache failed its startup check (exit {result.returncode}): {detail}'
    return True, ''
