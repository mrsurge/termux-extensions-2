"""Compile only the synthetic bridge fixture, never production startup modules."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch", type=Path)
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(Path(__file__).with_name("bridge_fixture.py"), args.scratch / "bridge_fixture.py")
    (args.scratch / "setup.py").write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="bridge-probe", ext_modules=mypycify(["bridge_fixture.py"], opt_level="3"))\n')
    subprocess.run([sys.executable, "setup.py", "build_ext", "--inplace"], cwd=args.scratch, check=True)


if __name__ == "__main__":
    main()
