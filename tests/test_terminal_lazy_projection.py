from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
import sys
import threading
from unittest.mock import patch

import pytest


def test_gateway_import_does_not_load_pyte(tmp_path: Path) -> None:
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("TE_", "TE2_", "XDG_", "FRAMEWORK_SHELLS_"))}
    env.update(HOME=str(tmp_path), TMPDIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1")
    for kind in ("DATA", "CONFIG", "CACHE", "RUNTIME"):
        env[f"TE2_{kind}_HOME"] = str(tmp_path / kind.lower())
    code = """
import sys
from pathlib import Path
from scripts.profile_code_te2_import import check_event
root = Path(sys.argv[1])
sys.addaudithook(lambda event, args: check_event(root, event, args))
import app.apps.code_te2.socketio_gateway
assert 'app.apps.code_te2.terminal_screen_projection' in sys.modules
assert 'app.apps.code_te2.terminal_pyte' not in sys.modules
assert 'pyte' not in sys.modules
"""
    result = subprocess.run([sys.executable, "-B", "-c", code, str(tmp_path)],
                            env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_projection_first_use_is_off_loop_and_shared(tmp_path: Path) -> None:
    from app.apps.code_te2 import terminal_screen_projection as projection

    path = tmp_path / "terminal.log"
    path.write_bytes(b"hello\r\n")
    original = projection._TerminalProjection
    threads: list[int] = []

    def create(*args):
        threads.append(threading.get_ident())
        return original(*args)

    async def run() -> None:
        registry = projection.TerminalScreenProjectionRegistry()
        with patch.object(projection, "_TerminalProjection", side_effect=create):
            first, second = await asyncio.gather(
                registry.checkpoint("shell", path, columns=80, lines=24),
                registry.checkpoint("shell", path, columns=80, lines=24),
            )
        assert first == second
        assert len(threads) == 1
        assert threads[0] != threading.get_ident()

    asyncio.run(run())


def test_failed_construction_does_not_publish_state(tmp_path: Path) -> None:
    from app.apps.code_te2 import terminal_screen_projection as projection

    path = tmp_path / "terminal.log"
    path.write_bytes(b"hello")

    async def run() -> None:
        registry = projection.TerminalScreenProjectionRegistry()
        with patch.object(projection, "_TerminalProjection", side_effect=RuntimeError("parser failed")):
            with pytest.raises(RuntimeError, match="parser failed"):
                await registry.checkpoint("shell", path, columns=80, lines=24)
        assert not registry._states
        result = await registry.checkpoint("shell", path, columns=80, lines=24)
        assert result.output_offset == 5

    asyncio.run(run())


def test_cancelled_construction_does_not_publish_late_state(tmp_path: Path) -> None:
    from app.apps.code_te2 import terminal_screen_projection as projection

    path = tmp_path / "terminal.log"
    path.write_bytes(b"hello")
    original = projection._TerminalProjection
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def create(*args):
        started.set()
        try:
            assert release.wait(5), "test did not release constructor"
            return original(*args)
        finally:
            finished.set()

    async def run() -> None:
        registry = projection.TerminalScreenProjectionRegistry()
        with patch.object(projection, "_TerminalProjection", side_effect=create):
            task = asyncio.create_task(registry.checkpoint("shell", path))
            try:
                assert await asyncio.to_thread(started.wait, 5)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
            finally:
                release.set()
                assert await asyncio.to_thread(finished.wait, 5)
        assert not registry._states
        result = await registry.checkpoint("shell", path)
        assert result.output_offset == 5

    asyncio.run(run())
