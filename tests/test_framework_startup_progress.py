from __future__ import annotations

import io
import json
import os
import sys
from unittest.mock import patch

import pytest

from app.cli import framework_startup_progress as startup_progress


def test_build_progress_is_bounded_and_exit_status_is_not_readiness() -> None:
    stream = io.StringIO()
    code = "import sys; sys.stderr.write('Building [==>] 3/8: worker\\r' + 'x'*5000 + '\\n'); sys.exit(9)"
    with startup_progress.reporting(stream):
        result = startup_progress.run_build([sys.executable, "-c", code], os.environ, unit="code_te2")
        frames = [json.loads(line) for line in stream.getvalue().splitlines()]
    assert stream.closed
    assert result == 9
    assert frames[0]["phase"] == "preparing"
    assert frames[-1] == {"version": 1, "type": "event", "event": "startup",
                          "phase": "build-finished", "unit": "code_te2", "exitCode": 9}
    assert all(len(frame.get("output", "")) <= 2048 for frame in frames)
    assert not any(frame.get("type") == "hello" for frame in frames)


def test_no_control_stream_preserves_existing_subprocess_behavior() -> None:
    with patch.object(startup_progress.subprocess, "run") as run:
        run.return_value.returncode = 3
        assert startup_progress.run_build(["cargo", "build"], {"TEST": "yes"}, unit="te2") == 3
    run.assert_called_once_with(["cargo", "build"], env={"TEST": "yes"}, check=False)


def test_reporter_scope_resets_on_failure() -> None:
    stream = io.StringIO()
    with pytest.raises(RuntimeError), startup_progress.reporting(stream):
        raise RuntimeError("failed")
    assert stream.closed
    startup_progress.emit("starting")  # No write against the old/closed stream.
