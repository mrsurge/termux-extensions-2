from __future__ import annotations

import asyncio
import contextlib
import io
import os
import unittest
from types import ModuleType
from typing import cast
from unittest import mock

from app.cli.framework_cli import main
from app.libs.runtime_debug_eval import DebugEvalError, evaluate
from app.libs.wba_debug_client import request_wba_debug
from app.apps.code_te2.workbench_runtime_debug import request_wba


class WbaDebugTests(unittest.IsolatedAsyncioTestCase):
    async def test_parent_disabled_before_adapter_import(self) -> None:
        with mock.patch.dict(os.environ, {"TE2_RUNTIME_DEBUG": "0"}):
            with self.assertRaises(DebugEvalError) as failure:
                _ = await request_wba("status")
            self.assertEqual(failure.exception.code, "runtimeDebug.disabled")

    async def test_required_exact_identity_and_code(self) -> None:
        with mock.patch.dict(os.environ, {"TE2_RUNTIME_DEBUG": "1"}):
            for code in (None, "", "x" * 32769):
                with self.assertRaises(DebugEvalError):
                    _ = await request_wba("eval", "shell", "instance", code)
            with self.assertRaises(DebugEvalError):
                _ = await request_wba("eval", None, "instance", "1")

    async def test_status_and_eval_reuse_exact_pipe_without_starting_shells(self) -> None:
        from app.apps.code_te2 import workbench_adapter_shell_manager as adapter

        calls: list[tuple[str, object, str | None]] = []

        async def rpc(method: str, params: object = None, timeout: float = 30, *, expected_shell_id: str | None = None) -> dict[str, object]:
            _ = timeout
            calls.append((method, params, expected_shell_id))
            return {"result": {"instanceId": "process", "value": 42}}

        with mock.patch.dict(os.environ, {"TE2_RUNTIME_DEBUG": "1"}), mock.patch.object(adapter, "_active_shell_id", "live-shell"), mock.patch.object(adapter, "adapter_rpc", rpc):
            self.assertEqual((await request_wba("status"))["shellId"], "live-shell")
            self.assertEqual((await request_wba("eval", "old-shell", "process", "42"))["value"], 42)
        self.assertEqual(calls[0][2], "live-shell")
        self.assertEqual(calls[1], ("runtime.debug.eval", {"instanceId": "process", "code": "42"}, "old-shell"))

    async def test_stale_shell_is_rejected_before_transport(self) -> None:
        from app.apps.code_te2 import workbench_adapter_shell_manager as adapter

        with mock.patch.object(adapter, "_active_shell_id", "new-shell"), mock.patch.object(adapter, "_rpc_write_lock", asyncio.Lock()):
            with self.assertRaisesRegex(RuntimeError, "staleShell"):
                _ = await adapter.adapter_rpc("runtime.debug.eval", expected_shell_id="old-shell")

    async def test_missing_adapter_and_error_propagation(self) -> None:
        from app.apps.code_te2 import workbench_adapter_shell_manager as adapter

        async def rpc(method: str, params: object = None, timeout: float = 30, *, expected_shell_id: str | None = None) -> dict[str, object]:
            _ = method, params, timeout, expected_shell_id
            return {"error": {"message": "runtimeDebug.staleInstance"}}

        with mock.patch.dict(os.environ, {"TE2_RUNTIME_DEBUG": "1"}), mock.patch.object(adapter, "_active_shell_id", None):
            with self.assertRaisesRegex(DebugEvalError, "has not started"):
                _ = await request_wba("status")
        with mock.patch.dict(os.environ, {"TE2_RUNTIME_DEBUG": "1"}), mock.patch.object(adapter, "adapter_rpc", rpc):
            with self.assertRaisesRegex(DebugEvalError, "staleInstance"):
                _ = await request_wba("eval", "shell", "old-process", "1")

    async def test_client_uses_existing_auth_and_quotes_javascript_as_data(self) -> None:
        captured: dict[str, object] = {}
        javascript = "const s = '\"\\n';\nresult = await Promise.resolve(s);"

        async def debug(operation: str, **kwargs: object) -> dict[str, object]:
            captured.update(kwargs)
            captured["operation"] = operation
            return {"ok": True}

        async def relay(operation: str, shell_id: str | None, instance_id: str | None, code: str | None, timeout_seconds: int) -> dict[str, object]:
            return {"operation": operation, "shell": shell_id, "instance": instance_id, "code": code, "timeout": timeout_seconds}

        target = {"appId": "code_te2", "shellId": "parent", "instanceId": "parent-instance"}
        with mock.patch("app.libs.wba_debug_client.request_debug", debug):
            _ = await request_wba_debug("eval", target=target, credential="explicit", shell_id="child", instance_id="child-instance", code=javascript)
        self.assertEqual(captured["credential"], "explicit")
        self.assertEqual(captured["target"], target)
        self.assertEqual(captured["operation"], "eval")
        with mock.patch("app.apps.code_te2.workbench_runtime_debug.request_wba", relay):
            result = await evaluate(cast(str, captured["code"]), ModuleType("backend"))
        value = cast(dict[str, object], result["value"])
        self.assertEqual(value["code"], javascript)
        self.assertEqual(value["instance"], "child-instance")


class WbaCliTests(unittest.TestCase):
    def test_cli_routes_javascript_to_wba_not_python_eval(self) -> None:
        captured: dict[str, object] = {}

        async def debug(operation: str, **kwargs: object) -> dict[str, object]:
            captured.update(kwargs)
            captured["operation"] = operation
            return {"ok": True}

        with mock.patch("app.cli.framework_cli.request_wba_debug", debug), contextlib.redirect_stdout(io.StringIO()):
            exit_code = main(["wba-eval", "--app", "code_te2", "--shell", "parent", "--instance", "parent-instance", "--wba-shell", "child", "--wba-instance", "process", "--code", "wb.status()"])
        self.assertEqual(exit_code, 0)
        self.assertEqual(captured["operation"], "eval")
        self.assertEqual(captured["shell_id"], "child")
        self.assertEqual(captured["code"], "wb.status()")


if __name__ == "__main__":
    _ = unittest.main()
