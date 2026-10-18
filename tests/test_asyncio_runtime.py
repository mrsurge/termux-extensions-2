from __future__ import annotations

import asyncio
import os
from pathlib import Path
import threading
from unittest.mock import patch

import pytest

from app.libs import asyncio_runtime


def missing_uvloop() -> ModuleNotFoundError:
    return ModuleNotFoundError("No module named 'uvloop'", name="uvloop")


def test_absent_module_uses_asyncio() -> None:
    with patch.dict(os.environ, {"TE2_DISABLE_UVLOOP": "0"}), patch.object(
        asyncio_runtime.importlib, "import_module", side_effect=missing_uvloop(),
    ):
        loop = asyncio_runtime.new_event_loop()
        try:
            assert isinstance(loop, asyncio.AbstractEventLoop)
        finally:
            loop.close()


@pytest.mark.parametrize("flag", ["1", "true", "YES", "on"])
def test_disabled_never_imports_uvloop(flag: str) -> None:
    with patch.dict(os.environ, {"TE2_DISABLE_UVLOOP": flag}), patch.object(
        asyncio_runtime.importlib, "import_module",
    ) as importer:
        loop = asyncio_runtime.new_event_loop()
        loop.close()
        importer.assert_not_called()


@pytest.mark.parametrize("error", [ImportError("ABI mismatch"), ModuleNotFoundError("dependency missing", name="dependency")])
def test_broken_installation_is_not_silently_hidden(error: Exception) -> None:
    with patch.dict(os.environ, {"TE2_DISABLE_UVLOOP": "0"}), patch.object(
        asyncio_runtime.importlib, "import_module", side_effect=error,
    ), pytest.raises(type(error)):
        asyncio_runtime.new_event_loop()


def test_available_factory_runs_in_owner_thread_and_closes_loop() -> None:
    loops: list[asyncio.AbstractEventLoop] = []
    owners: list[int] = []

    class Module:
        def new_event_loop(self) -> asyncio.AbstractEventLoop:
            owners.append(threading.get_ident())
            loop = asyncio.new_event_loop()
            loops.append(loop)
            return loop

    async def work() -> int:
        assert asyncio.get_running_loop() is loops[-1]
        await asyncio.sleep(0)
        return 42

    results: list[int] = []
    with patch.dict(os.environ, {"TE2_DISABLE_UVLOOP": "0"}), patch.object(
        asyncio_runtime.importlib, "import_module", return_value=Module(),
    ) as importer:
        thread = threading.Thread(target=lambda: results.append(asyncio_runtime.run(work())))
        thread.start()
        thread.join(3)
        assert not thread.is_alive()
        importer.assert_called_once_with("uvloop")
    assert results == [42]
    assert owners == [thread.ident]
    assert loops[0].is_closed()


def test_runner_cancels_pending_tasks_and_shuts_down_executor() -> None:
    cleaned: list[bool] = []

    async def pending() -> None:
        try:
            await asyncio.sleep(60)
        finally:
            cleaned.append(True)

    async def work() -> int:
        asyncio.create_task(pending())
        await asyncio.sleep(0)
        return await asyncio.to_thread(lambda: 7)

    with patch.dict(os.environ, {"TE2_DISABLE_UVLOOP": "1"}):
        assert asyncio_runtime.run(work()) == 7
    assert cleaned == [True]


def test_runner_factory_failure_closes_unstarted_coroutine() -> None:
    async def work() -> None:
        raise AssertionError("must not run")

    coroutine = work()
    with patch.object(asyncio_runtime, "new_event_loop", side_effect=ImportError("ABI mismatch")), pytest.raises(ImportError):
        asyncio_runtime.run(coroutine)
    assert coroutine.cr_frame is None


def test_all_three_startup_boundaries_use_shared_factory() -> None:
    root = Path(__file__).resolve().parents[1]
    worker = (root / "app/libs/app_worker.py").read_text()
    bridge = (root / "framework/bootstrap/runtime_bridge.py").read_text()
    domain = (root / "app/apps/code_te2/native_worker.py").read_text()
    assert "run(server.serve())" in worker
    assert "run(uvicorn.Server(config).serve())" in bridge
    assert "_loop = new_event_loop()" in domain
    assert "from app.libs.asyncio_runtime import new_event_loop" in domain
