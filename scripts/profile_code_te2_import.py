"""Development-only isolated import timing; never starts the worker lifecycle.

Run with the target interpreter. Results are not full worker startup timings.
The audit guard is accidental-side-effect protection, not a security sandbox.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def check_event(root: Path, event: str, args: tuple[object, ...]) -> None:
    def writable(value: object) -> None:
        if isinstance(value, int):
            if value in (1, 2):
                return
            try:
                target = Path(os.readlink(f"/proc/self/fd/{value}")).resolve()
            except OSError as exc:
                raise RuntimeError(f"profile blocked descriptor write: {value}") from exc
            if target.is_relative_to(root):
                return
            raise RuntimeError(f"profile blocked descriptor write: {value}")
        path = Path(os.fsdecode(value)).resolve()  # type: ignore[arg-type]
        if not path.is_relative_to(root):
            raise RuntimeError(f"profile blocked write outside scratch: {path}")

    if event in {"socket.connect", "socket.bind", "socket.sendto", "subprocess.Popen",
                 "os.system", "os.fork", "os.forkpty", "os.posix_spawn", "os.exec",
                 "os.spawn", "os.kill", "os.killpg"}:
        raise RuntimeError(f"profile blocked operation: {event}")
    if event == "open":
        mode = args[1]
        flags = args[2]
        if (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
            isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)
        ):
            writable(args[0])
    if event in {"os.mkdir", "os.remove", "os.rmdir", "os.chmod", "os.chown", "os.utime", "os.truncate"}:
        writable(args[0])
    if event in {"os.rename", "os.link", "os.symlink"}:
        writable(args[0])
        writable(args[1])


def child(root: Path) -> None:
    sys.dont_write_bytecode = True
    sys.addaudithook(lambda event, args: check_event(root, event, args))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    started = time.perf_counter()
    cpu = time.process_time()
    importlib.import_module("app.apps.code_te2.main")
    print(json.dumps({"import_ms": (time.perf_counter() - started) * 1000,
                      "cpu_ms": (time.process_time() - cpu) * 1000,
                      "python": sys.version, "executable": sys.executable,
                      "lifecycle_started": False}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--runs", type=int, default=3, choices=range(1, 6))
    options = parser.parse_args()
    if options.child:
        child(options.child.resolve())
        return
    if options.output is None:
        parser.error("--output is required (use a new scratch directory)")
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    for index in range(options.runs):
        with tempfile.TemporaryDirectory(prefix="state-", dir=output) as temporary:
            root = Path(temporary)
            env = dict(os.environ)
            for key in tuple(env):
                if key.startswith(("TE_", "TE2_", "FRAMEWORK_SHELLS_", "XDG_")):
                    del env[key]
            env.update({"HOME": str(root), "TMPDIR": str(root),
                        "PYTHONDONTWRITEBYTECODE": "1", "PYTHON_JIT": "0"})
            for kind in ("DATA", "CACHE", "CONFIG", "RUNTIME"):
                env[f"TE2_{kind}_HOME"] = str(root / kind.lower())
                env[f"XDG_{kind}_HOME" if kind != "RUNTIME" else "XDG_RUNTIME_DIR"] = str(root / kind.lower())
            with (output / f"{index}.stdout").open("w") as stdout, (output / f"{index}.imports").open("w") as stderr:
                result = subprocess.run(
                    [sys.executable, "-B", "-X", "importtime", str(Path(__file__).resolve()), "--child", str(root)],
                    env=env, stdout=stdout, stderr=stderr, timeout=60, check=False,
                )
            print(json.dumps({"run": index, "returncode": result.returncode, "output": str(output)}), flush=True)
            if result.returncode:
                raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
