"""Check relocatable matched-set loading without modifying measured packages."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

from measure import BINARIES


def check(initial: Path, changed: Path, destination: Path, library_name: str = "libte2_probe_runtime.so", incompatible: Path | None = None) -> None:
    env = dict(os.environ)
    env.pop("LD_LIBRARY_PATH", None)
    if destination.exists():
        raise RuntimeError("validation output must be new")
    shutil.copytree(initial / "shared", destination)
    previous = json.loads((initial / "results.json").read_text())["shared"]["output"]
    updated = json.loads((changed / "results.json").read_text())["shared"]["output"]

    def verify(expected: dict[str, str]) -> None:
        for name in BINARIES:
            result = subprocess.check_output([str(destination / "bin" / name)],
                                             cwd="/", env=env, text=True, timeout=10).strip()
            if result != expected[name]:
                raise RuntimeError(f"unexpected output from {name}: {result}")

    verify(previous)
    library = destination / "lib" / library_name
    hidden = library.with_suffix(".unavailable")
    library.rename(hidden)
    try:
        for name in BINARIES:
            result = subprocess.run([str(destination / "bin" / name)], cwd="/", env=env,
                                    capture_output=True, text=True, timeout=10)
            if result.returncode == 0 or library_name not in result.stderr:
                raise RuntimeError("missing-library case did not fail explicitly")
    finally:
        hidden.rename(library)
    shutil.copy2(changed / "shared/lib" / library_name, library)
    verify(updated)
    if incompatible is not None:
        shutil.copy2(incompatible, library)
        try:
            for name in BINARIES:
                result = subprocess.run([str(destination / "bin" / name)], cwd="/", env=env,
                                        capture_output=True, text=True, timeout=10)
                if result.returncode != 1 or "unsupported runtime ABI" not in result.stderr:
                    raise RuntimeError("incompatible ABI was not rejected before execution")
        finally:
            shutil.copy2(changed / "shared/lib" / library_name, library)
        print("PASS: incompatible ABI rejected before execution")
    print("PASS: relocated loading, explicit missing-library failure, library-only update with unchanged consumers")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initial", type=Path, required=True)
    parser.add_argument("--changed", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--library", default="libte2_probe_runtime.so",
                        choices=("libte2_probe_runtime.so", "libte2_probe_runtime_ffi.so"))
    parser.add_argument("--incompatible", type=Path)
    args = parser.parse_args()
    check(args.initial.absolute(), args.changed.absolute(), args.output.absolute(), args.library, args.incompatible)
