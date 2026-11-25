"""Locate the shared, wheel-only PTY runtime. Missing payloads use source bootstrap."""
from __future__ import annotations

from pathlib import Path


def packaged_terminal_root(identity: dict[str, str]) -> Path | None:
    target = (identity["platform"], identity["arch"])
    if target not in {("linux", "x64"), ("android", "arm64")} or identity["modules"] != "137":
        return None
    root = Path(__file__).resolve().parent / "vendor" / "terminal"
    modules = root / "node_modules"
    binary = modules / "node-pty" / "prebuilds" / "-".join(target) / "pty.node"
    if not binary.is_file():
        return None
    for entry in ("node-pty/lib/index.js", "@msgpack/msgpack/dist.cjs/index.cjs",
                  "@xterm/headless/lib-headless/xterm-headless.js", "@xterm/addon-serialize/lib/addon-serialize.js"):
        if not (modules / entry).is_file():
            return None
    return root
