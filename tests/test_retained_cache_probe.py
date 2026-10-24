"""Retained-cache probe reconstructs historical baselines after adoption."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

from framework.domain_optimization_probe.cache_probe import generate


def test_cache_probe_source_parity(tmp_path: Path) -> None:
    generate(tmp_path)
    repo = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-B", "framework/domain_optimization_probe/cache_probe.py",
         str(tmp_path), "--run", "source", "--check-only"],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"result": "pass"' in result.stdout
