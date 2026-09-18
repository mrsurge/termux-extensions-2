"""Optional private Node compilation caches, independent of project storage."""
from __future__ import annotations

import logging
import os
import stat
from typing import Literal

from app.te2_paths import te2_cache_home


def node_compile_cache(service: Literal["code-server", "workbench-adapter"]) -> str:
    # Node partitions cache entries by runtime version. The environment setting
    # is a path, not a boolean; unsupported runtimes (such as Bun) may ignore it.
    path = te2_cache_home().resolve() / "node_compile" / service
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        metadata = path.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077:
            raise OSError("compile cache must be an owned private directory")
        return str(path)
    except OSError as exc:
        # An optional optimization must never prevent an otherwise valid launch.
        logging.getLogger(__name__).warning("[%s] compile cache unavailable: %s", service, exc)
        return ""
