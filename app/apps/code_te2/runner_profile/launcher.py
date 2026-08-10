# pyright: strict
from __future__ import annotations

import base64
import json
import os
import shlex
import sys
from typing import cast


JsonObject = dict[str, object]


def main() -> int:
    command = _load_command()
    if command is None:
        return 2

    argv = _string_list(command.get("argv"))
    if not argv:
        print("[runner-profile] command argv is empty", file=sys.stderr, flush=True)
        return 2

    env = dict(os.environ)
    env.update(_string_map(command.get("env")))

    # This line is the FWS readiness boundary before the launcher execs the
    # user runner. The actual runner stdout/stderr remain owned by its shell.
    print("runner-profile-ready", flush=True)
    print(f"[runner-profile] exec {shlex.join(argv)}", file=sys.stderr, flush=True)
    try:
        os.execvpe(argv[0], argv, env)
    except Exception as exc:
        print(f"[runner-profile] exec failed: {exc}", file=sys.stderr, flush=True)
        return 127


def _load_command() -> JsonObject | None:
    encoded = os.environ.get("TE2_RUN_PROFILE_COMMAND_B64", "")
    if not encoded:
        print("[runner-profile] missing TE2_RUN_PROFILE_COMMAND_B64", file=sys.stderr, flush=True)
        return None
    try:
        raw = base64.b64decode(encoded.encode("ascii")).decode("utf-8")
        decoded = cast(object, json.loads(raw))
    except Exception as exc:
        print(f"[runner-profile] invalid command payload: {exc}", file=sys.stderr, flush=True)
        return None
    if not isinstance(decoded, dict):
        print("[runner-profile] command payload must be an object", file=sys.stderr, flush=True)
        return None
    return {str(key): item for key, item in cast(dict[object, object], decoded).items()}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str) and item]


def _string_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {
        key: item
        for key, item in raw.items()
        if isinstance(key, str) and isinstance(item, str)
    }


if __name__ == "__main__":
    raise SystemExit(main())
