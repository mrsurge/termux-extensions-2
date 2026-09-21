"""Authenticated parent-worker diagnostics relay; never mounted on app RPC/HTTP."""
from __future__ import annotations

import os
from typing import cast

from app.libs.runtime_debug_eval import DebugEvalError


async def request_wba(
    operation: str, shell_id: str | None = None, instance_id: str | None = None,
    code: str | None = None, timeout_seconds: int = 20,
) -> dict[str, object]:
    if os.environ.get("TE2_RUNTIME_DEBUG", "").strip().lower() not in {"1", "true", "yes", "on"}:
        raise DebugEvalError("runtimeDebug.disabled", "Runtime debugging is disabled")
    if operation not in {"status", "eval"} or not 1 <= timeout_seconds <= 30:
        raise DebugEvalError("runtimeDebug.invalidRequest", "Invalid WBA diagnostic operation")
    if operation == "eval" and (not shell_id or not instance_id or not code or len(code.encode("utf-8")) > 32 * 1024):
        raise DebugEvalError("runtimeDebug.invalidRequest", "Evaluation requires exact WBA shell/instance and at most 32 KiB of code")
    # Lazy import avoids coupling diagnostics to worker boot. Use the existing
    # loop-owned reader, pending table and serialized MessagePack writer.
    from . import workbench_adapter_shell_manager as adapter

    selected_shell = shell_id or adapter.get_adapter_shell_id()
    if not selected_shell:
        raise DebugEvalError("runtimeDebug.unavailable", "WBA has not started")
    response = await adapter.adapter_rpc(
        f"runtime.debug.{operation}", {"instanceId": instance_id, "code": code},
        timeout=float(timeout_seconds), expected_shell_id=selected_shell,
    )
    error = response.get("error")
    if error is not None:
        raise DebugEvalError("runtimeDebug.wbaError", str(error)[:1024])
    payload = response.get("result")
    if not isinstance(payload, dict):
        raise DebugEvalError("runtimeDebug.invalidResponse", "WBA returned no diagnostic object")
    return {"shellId": selected_shell, **cast(dict[str, object], payload)}
