"""Explicit editable mypyc build/publication; never restarts the running worker."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from app.te2_paths import resolve_te2_paths


def build_commands(
    *, repo: Path, python: str, cache_home: Path, compiler_cache: Path,
    name: str, activate: bool,
) -> tuple[Path, list[list[str]]]:
    snapshot = cache_home / "code_te2" / "build" / "mypyc-snapshots" / name
    helper = str(repo / "scripts" / "probe_code_te2_mypyc.py")
    commands = [[python, "-B", helper, "build", "--cache-dir", str(compiler_cache),
                 "--output", str(snapshot)]]
    if activate:
        commands.append([python, "-B", helper, "activate", "--snapshot", str(snapshot),
                         "--link", str(repo / ".codex-scratch" / "mypyc-active")])
    return snapshot, commands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=int(os.environ.get("MAX_JOBS", "1")))
    parser.add_argument("--cache-dir", type=Path,
        default=Path(os.environ.get("TMPDIR") or REPO / ".codex-scratch") / "mypyc-build-cache")
    parser.add_argument("--no-activate", action="store_true")
    parser.add_argument("--no-cache", action="store_true", default=os.environ.get("NO_CACHE") == "1",
        help="Explicitly allow an uncached build (also NO_CACHE=1); retain build intermediates")
    parser.add_argument("--print-commands", action="store_true", help="Print resolved paths/commands without building or changing state")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("--jobs must be at least 1")
    if not (REPO / "scripts" / "probe_code_te2_mypyc.py").is_file():
        parser.error("This developer build entrypoint requires a source/editable checkout")
    if not args.no_cache and shutil.which("ccache") is None:
        parser.exit(1, "Build failed: ccache is not available on PATH. Install ccache, or explicitly build anyway with --no-cache or NO_CACHE=1.\n")
    name = datetime.now(timezone.utc).strftime("check-%Y%m%d-%H%M%S") + f"-{time.time_ns()}"
    snapshot, commands = build_commands(
        repo=REPO, python=sys.executable, cache_home=resolve_te2_paths().cache_home,
        compiler_cache=args.cache_dir.expanduser().resolve(), name=name,
        activate=not args.no_activate,
    )
    env = dict(os.environ, MAX_JOBS=str(args.jobs), NO_CACHE="1" if args.no_cache else "0")
    print("Compiler cache: explicitly disabled" if args.no_cache else "Compiler cache: ccache available", flush=True)
    print(f"Validated artifact destination: {snapshot}", flush=True)
    for command in commands:
        print(shlex.join(command), flush=True)
        if not args.print_commands:
            subprocess.run(command, cwd=REPO, env=env, check=True)
    if not args.print_commands:
        print(f"Published: {snapshot}\nDomain libraries: {snapshot / 'lib'}", flush=True)
        print("Running workers are unchanged. No Rust executable build or packaging performed.", flush=True)


if __name__ == "__main__":
    main()
