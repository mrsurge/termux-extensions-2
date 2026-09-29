# pyright: strict
"""Exercise Code TE2 domain assembly without the retired Python HTTP stack."""
from __future__ import annotations

from collections.abc import Sequence
import importlib.abc
import importlib.machinery
import sys
from pathlib import Path
from types import ModuleType
from typing import override


class BlockFastAPI(importlib.abc.MetaPathFinder):
    @override
    def find_spec(self, fullname: str, path: Sequence[str] | None = None,
                  target: ModuleType | None = None) -> importlib.machinery.ModuleSpec | None:
        del path, target
        if fullname.split(".")[0] in {"fastapi", "pydantic", "pydantic_core", "starlette", "uvicorn"}:
            raise ImportError("forbidden Code TE2 import: " + fullname)
        return None


sys.meta_path.insert(0, BlockFastAPI())


if "--early-bootstrap" in sys.argv:
    import asyncio
    from importlib import import_module
    from unittest.mock import AsyncMock, patch
    from app.libs.app_worker_bootstrap import assemble_off_loop
    from app.apps.code_te2 import intelligence_bootstrap as bootstrap
    from app.apps.code_te2 import intelligence_startup as intelligence
    from app.apps.code_te2 import intelligence_bootstrap_gate as gate
    from app.apps.code_te2 import workbench_adapter_shell_manager as adapter

    async def import_early() -> ModuleType:
        events: list[str] = []

        async def prepare(_project: str) -> None:
            events.append("preparing")
            await gate.wait_for_application()
            events.append("attached")

        def assemble() -> ModuleType:
            module = import_module("app.apps.code_te2.main")
            events.append("assembled")
            return module

        with patch.object(intelligence, "prime_intelligence_runtime", prepare), patch.object(adapter, "publish_current_adapter_state", AsyncMock()), patch.object(adapter, "stop_adapter_io", AsyncMock()):
            async with bootstrap.te2_worker_bootstrap():
                module = await assemble_off_loop(assemble)
                assert events == ["preparing", "assembled"], events
                await bootstrap.attach_application(str(Path.home()))
                assert await bootstrap.await_early_intelligence(str(Path.home()))
                assert events == ["preparing", "assembled", "attached"]
                return module

    main = asyncio.run(import_early())
else:
    from app.apps.code_te2 import main

from app.apps.code_te2.socketio_gateway import CODE_TE2_SIO
from app.apps.code_te2.native_socketio import NativeSocketServer
assert isinstance(CODE_TE2_SIO, NativeSocketServer)
assert not hasattr(main, "TE2_ASGI_APP")
assert callable(main.te2_app_start) and callable(main.te2_app_stop)
assert not any(name.split(".")[0] in {"fastapi", "pydantic", "pydantic_core", "starlette", "uvicorn"} for name in sys.modules)
print("native code_te2 probe passed")
