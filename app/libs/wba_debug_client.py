"""CLI/MCP WBA access through the existing exact, authenticated Python target."""
from __future__ import annotations

from app.libs.framework_debug_client import request_debug


async def request_wba_debug(
    operation: str, *, target: dict[str, str], credential: str | None = None,
    url: str | None = None, shell_id: str | None = None, instance_id: str | None = None,
    code: str | None = None, timeout_seconds: int = 20,
) -> dict[str, object]:
    if target.get("appId") != "code_te2":
        raise ValueError("WBA diagnostics require the code_te2 parent worker")
    if operation not in {"status", "eval"}:
        raise ValueError("Unknown WBA diagnostic operation")
    if operation == "eval" and (not shell_id or not instance_id or not code or len(code.encode("utf-8")) > 32 * 1024):
        raise ValueError("WBA eval requires shell, instance, and code of at most 32 KiB")
    # repr quotes arguments as Python literals: JavaScript is data until it
    # reaches the pipe-only evaluator. No new credential or public endpoint.
    program = (
        "from app.apps.code_te2.workbench_runtime_debug import request_wba\n"
        f"result = await request_wba({operation!r}, {shell_id!r}, {instance_id!r}, {code!r}, {timeout_seconds!r})"
    )
    return await request_debug(
        "eval", url=url, credential=credential, target=target, code=program,
        timeout_seconds=timeout_seconds,
    )
