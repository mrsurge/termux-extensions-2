from __future__ import annotations

import argparse
import json
import sys
from typing import Sequence

from desktop_client.electron_runtime import (
    ElectronRuntimeError,
    desktop_runtime_status,
    ensure_desktop_runtime,
    launch_desktop_runtime,
    uninstall_desktop_runtime,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="te2 desktop",
        description="Build, install, and launch the TE2 Electron desktop client.",
    )
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser(
        "install",
        help="Build the locked Electron source and install user-local desktop integration.",
    )
    subparsers.add_parser(
        "repair",
        help="Rebuild the Electron runtime and replace receipt-owned desktop integration.",
    )
    status = subparsers.add_parser("status", help="Report Electron runtime and integration state.")
    status.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    subparsers.add_parser(
        "uninstall",
        help="Remove the Electron runtime and unchanged receipt-owned integration files.",
    )
    launch = subparsers.add_parser(
        "launch",
        help="Launch TE2 Desktop, building it first when the runtime is absent.",
    )
    launch.add_argument("arguments", nargs=argparse.REMAINDER)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    if not arguments and _invoked_as_desktop_script():
        arguments = ["launch"]
    parser = _parser()
    args = parser.parse_args(arguments)
    if not args.command:
        parser.print_help()
        return 0
    try:
        if args.command == "install":
            runtime = ensure_desktop_runtime()
            print(f"TE2 Desktop {runtime.version} installed at {runtime.root}")
            return 0
        if args.command == "repair":
            runtime = ensure_desktop_runtime(force=True)
            print(f"TE2 Desktop {runtime.version} repaired at {runtime.root}")
            return 0
        if args.command == "status":
            status = desktop_runtime_status()
            if args.json:
                print(json.dumps(status, indent=2, sort_keys=True))
            elif status["installed"]:
                print(
                    f"TE2 Desktop {status['version']} is installed at "
                    f"{status['runtimeRoot']}"
                )
            else:
                print("TE2 Desktop is not installed")
            return 0
        if args.command == "uninstall":
            result = uninstall_desktop_runtime()
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0
        if args.command == "launch":
            return launch_desktop_runtime(list(args.arguments))
    except ElectronRuntimeError as exc:
        print(f"te2 desktop: {exc}", file=sys.stderr)
        return 1
    parser.error(f"unknown desktop command: {args.command}")
    return 2


def _invoked_as_desktop_script() -> bool:
    name = str(sys.argv[0] or "").rsplit("/", 1)[-1]
    return name == "te2-desktop"


if __name__ == "__main__":
    raise SystemExit(main())
