from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock
from typing import override

import msgspec

from app.libs.runtime_debug_eval import DebugEvalError, bounded_result, evaluate, inspect_runtime
from app.libs.framework_debug_client import local_credential, request_debug
from app.cli.framework_cli import main


class EvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def test_expression_statements_and_async_live_module(self) -> None:
        backend = ModuleType("fixture")
        self.assertEqual((await evaluate("1 + 2", backend))["value"], 3)
        result = await evaluate("backend.changed = 9\nawait asyncio.sleep(0)\nresult = backend.changed", backend)
        self.assertEqual(result["value"], 9)
        self.assertEqual((await evaluate("backend.changed", backend))["value"], 9)
        self.assertEqual((await evaluate("await asyncio.sleep(0, result=7)", backend))["value"], 7)
        self.assertEqual((await evaluate("'temporary' in globals()", backend))["value"], False)

    async def test_inspect_is_lazy_and_optional(self) -> None:
        backend = ModuleType("fixture")
        with mock.patch("app.libs.runtime_debug_eval.importlib.import_module", side_effect=ImportError):
            self.assertEqual((await evaluate("42", backend))["value"], 42)
            with self.assertRaises(DebugEvalError) as error:
                _ = await evaluate("inspect_runtime()", backend)
            self.assertEqual(error.exception.code, "runtimeDebug.inspectUnavailable")
        self.assertEqual(inspect_runtime().__name__, "inspect")

    async def test_code_limits_and_exceptions(self) -> None:
        for code in ("", " " * 32769, "'" + "é" * 20000 + "'"):
            with self.assertRaises(DebugEvalError):
                _ = await evaluate(code, ModuleType("fixture"))
        with self.assertRaises(ZeroDivisionError):
            _ = await evaluate("1/0", ModuleType("fixture"))

    async def test_result_projection_is_bounded_without_repr(self) -> None:
        class NoRepr:
            @override
            def __repr__(self) -> str:
                raise AssertionError("must not call repr")
        cycle: list[object] = []
        cycle.append(cycle)
        for value in (cycle, NoRepr(), list(range(10000)), "x" * 100000, ["x" * 4096] * 100, 1 << 10000):
            result = bounded_result(value)
            self.assertTrue(result["truncated"])
            self.assertLessEqual(len(msgspec.json.encode(result)), 65536)


class CredentialTests(unittest.TestCase):
    def test_private_credentials_and_url_binding(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"TE2_RUNTIME_HOME": directory}):
            path = Path(directory) / "runtime-debug-8089.json"
            _ = path.write_text(json.dumps({"frameworkUrl": "http://127.0.0.1:8089", "token": "a" * 64}))
            path.chmod(0o600)
            self.assertEqual(local_credential("http://127.0.0.1:8089"), "a" * 64)
            with self.assertRaises(ValueError):
                _ = local_credential("http://localhost:8089")
            with self.assertRaises(ValueError):
                _ = local_credential("http://remote:8089")
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                _ = local_credential("http://127.0.0.1:8089")

    def test_symlink_credentials_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"TE2_RUNTIME_HOME": directory}):
            target = Path(directory) / "target"
            _ = target.write_text("{}")
            (Path(directory) / "runtime-debug-8089.json").symlink_to(target)
            with self.assertRaises(OSError):
                _ = local_credential("http://127.0.0.1:8089")

    def test_explicit_empty_mcp_credential_does_not_load_local_token(self) -> None:
        with mock.patch("app.libs.framework_debug_client.local_credential", side_effect=AssertionError):
            with self.assertRaises(ValueError):
                _ = asyncio.run(request_debug("workers", credential=""))

    def test_cli_reads_stdin_and_propagates_exact_target(self) -> None:
        import io
        with mock.patch("app.cli.framework_cli.request_debug", new_callable=mock.AsyncMock, return_value={"ok": True}) as call, mock.patch("sys.stdin", io.StringIO("result = 7")), mock.patch("sys.stdout", io.StringIO()):
            self.assertEqual(main(["eval", "--app", "a", "--shell", "s", "--instance", "i"]), 0)
            call.assert_awaited_once_with("eval", url=None, credential=os.environ.get("TE2_RUNTIME_DEBUG_TOKEN"), target={"appId": "a", "shellId": "s", "instanceId": "i"}, code="result = 7", timeout_seconds=20)


if __name__ == "__main__":
    _ = unittest.main()
