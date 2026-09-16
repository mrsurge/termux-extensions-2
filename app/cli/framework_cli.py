from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import cast

from app.libs.framework_debug_client import request_debug


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="te2 framework")
    subcommands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("list-workers", "status", "eval"):
        command = subcommands.add_parser(operation)
        _ = command.add_argument("--url")
        if operation != "list-workers":
            _ = command.add_argument("--app", required=True)
            _ = command.add_argument("--shell", required=True)
            _ = command.add_argument("--instance", required=True)
            _ = command.add_argument("--timeout", type=int, default=20)
        if operation == "eval":
            _ = command.add_argument("--code", help="Python expression or statements; otherwise read stdin. Set result for statements.")
    args = parser.parse_args(argv)
    operation = cast(str, args.operation)
    target: dict[str, str] | None = None
    code: str | None = None
    timeout = 20
    if operation != "list-workers":
        target = {"appId": cast(str, args.app), "shellId": cast(str, args.shell), "instanceId": cast(str, args.instance)}
        timeout = cast(int, args.timeout)
    if operation == "eval":
        code = cast(str | None, args.code)
        if code is None:
            code = sys.stdin.read(32769)
    try:
        response = asyncio.run(request_debug(
            "workers" if operation == "list-workers" else operation,
            url=cast(str | None, args.url), credential=os.environ.get("TE2_RUNTIME_DEBUG_TOKEN"),
            target=target, code=code, timeout_seconds=timeout,
        ))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(response, ensure_ascii=True))
    return 0 if response.get("ok") is True else 1
