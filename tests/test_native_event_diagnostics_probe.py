"""Regression for the isolated N3 comparison, not production activation."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

from framework.domain_optimization_probe.events_probe import generate


def test_n3_source_parity_and_copy_ownership(tmp_path: Path) -> None:
    generate(tmp_path)
    repo = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-B", "framework/domain_optimization_probe/events_probe.py",
         str(tmp_path), "--run", "source", "--check-only"],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"kind": "event_parity"' in result.stdout
    assert '"outputs": "pass"' in result.stdout
    assert '"copy_removal_alias_change": true' in result.stdout
