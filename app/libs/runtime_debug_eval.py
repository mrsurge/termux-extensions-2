"""Trusted, opt-in live-worker evaluation with bounded result projection."""
from __future__ import annotations

import ast
import asyncio
import importlib
import math
from collections.abc import Awaitable
from types import CodeType, ModuleType
from typing import cast

import msgspec

MAX_CODE_BYTES = 32 * 1024
MAX_RESULT_BYTES = 64 * 1024


class DebugEvalError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code: str = code


def inspect_runtime() -> ModuleType:
    # Optional on demand, never a prerequisite for worker startup/evaluation.
    try:
        return importlib.import_module("inspect")
    except ImportError as exc:
        raise DebugEvalError("runtimeDebug.inspectUnavailable", "Python inspect is unavailable") from exc


def bounded_result(value: object) -> dict[str, object]:
    """Avoid arbitrary repr/property execution and bound traversal before encoding."""
    seen: set[int] = set()
    budget = 2048
    truncated = False

    def visit(item: object, depth: int) -> object:
        nonlocal budget, truncated
        budget -= 1
        if budget < 0 or depth > 12:
            truncated = True
            return "<limit>"
        if item is None or type(item) in (bool, int, float, str):
            if isinstance(item, str) and len(item) > 4096:
                truncated = True
                return item[:4096]
            if isinstance(item, int) and item.bit_length() > 4096:
                truncated = True
                return "<large integer>"
            if isinstance(item, float) and not math.isfinite(item):
                return str(item)
            return item
        if type(item) in (dict, list, tuple):
            identity = id(item)
            if identity in seen:
                truncated = True
                return "<cycle/shared>"
            seen.add(identity)
            if type(item) is dict:
                output: dict[str, object] = {}
                for key, entry in cast(dict[object, object], item).items():
                    if budget <= 0:
                        truncated = True
                        break
                    budget -= 1
                    if type(key) is not str or len(key) > 1024:
                        truncated = True
                        continue
                    output[key] = visit(entry, depth + 1)
                return output
            output_list: list[object] = []
            for entry in cast(list[object] | tuple[object, ...], item):
                if budget <= 0:
                    truncated = True
                    break
                output_list.append(visit(entry, depth + 1))
            return output_list
        truncated = True
        return "<non-JSON object; inspect explicitly>"

    projected = visit(value, 0)
    result: dict[str, object] = {"value": projected, "truncated": truncated}
    if len(msgspec.json.encode(result)) > MAX_RESULT_BYTES:
        return {"value": None, "truncated": True, "reason": "result byte limit"}
    return result


async def evaluate(code: str, backend: ModuleType) -> dict[str, object]:
    if not code.strip() or len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise DebugEvalError("runtimeDebug.invalidCode", "Code must be nonempty and at most 32 KiB")
    # Fresh bindings per request; backend mutations are real and survive requests.
    scope: dict[str, object] = {"backend": backend, "asyncio": asyncio, "inspect_runtime": inspect_runtime}
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
    try:
        compiled = cast(CodeType, compile(code, "<te2-runtime-eval>", "eval", flags=flags))
    except SyntaxError:
        compiled = cast(CodeType, compile(code, "<te2-runtime-eval>", "exec", flags=flags))
        is_expression = False
    else:
        is_expression = True
    value = cast(object, eval(compiled, scope, scope))
    if asyncio.iscoroutine(value):
        value = await cast(Awaitable[object], value)
    return bounded_result(value if is_expression else scope.get("result"))
