"""Stage locked JS and one checksum-pinned release asset into a platform wheel."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
from urllib.error import URLError
from urllib.request import urlopen
import warnings

RELEASE = "https://github.com/mrsurge/termux-extensions-2/releases/download/node-pty-1.1.0-te2.1"
ASSETS = {
    "linux-x64": "b2c0ef4b67d6159ca328b71b619d00fecaf710e2536b7b3030455f89a62d21e7",
    "android-arm64": "38b9d89959c51ffde262e5fd6cbb29295f4ada537ae6893545ef09dbcca64754",
}


def stage_terminal(root: Path, destination: Path, target: str) -> None:
    name = f"pty-{target}.node"
    local = os.environ.get("TE2_PTY_ASSET_DIR")
    try:
        if local:
            data = (Path(local) / name).read_bytes()
        else:
            with urlopen(f"{RELEASE}/{name}", timeout=45) as response:
                data = response.read(1024 * 1024 + 1)
    except (FileNotFoundError, URLError, TimeoutError) as error:
        warnings.warn(f"{name} unavailable; terminal will bootstrap on first use: {error}", stacklevel=2)
        return
    if hashlib.sha256(data).hexdigest() != ASSETS[target]:
        raise ValueError(f"Checksum mismatch for {name}")
    modules = destination / "node_modules"
    shutil.copytree(root / "vendor/terminal-runtime/packages", modules)
    binary = modules / "node-pty/prebuilds" / target / "pty.node"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(data)
