"""Subprocess runner: reject unwanted web-framework imports before worker import."""
# pyright: strict
from __future__ import annotations

import importlib.abc
import importlib.machinery
import os
import runpy
import sys
from collections.abc import Sequence
from types import ModuleType
from typing import override


class BlockWebFrameworks(importlib.abc.MetaPathFinder):
    @override
    def find_spec(self, fullname: str, path: Sequence[str] | None = None,
                  target: ModuleType | None = None) -> importlib.machinery.ModuleSpec | None:
        del path, target
        blocked = {"fastapi", "pydantic", "pydantic_core"}
        if os.environ.get("TE2_TEST_BLOCK_ALL_WEB") == "1":
            blocked.update({"uvicorn", "starlette"})
        if fullname.split(".")[0] in blocked:
            raise ImportError("forbidden worker import: " + fullname)
        return None


sys.meta_path.insert(0, BlockWebFrameworks())
_ = runpy.run_module("app.libs.app_worker", run_name="__main__")
