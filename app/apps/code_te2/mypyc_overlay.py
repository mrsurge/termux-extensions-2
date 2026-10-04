"""Opt-in compiled-domain import hook for local native-worker experiments."""

from __future__ import annotations

from collections.abc import Sequence
from importlib.machinery import EXTENSION_SUFFIXES, ExtensionFileLoader, ModuleSpec
from importlib.util import spec_from_file_location
import json
from pathlib import Path
import sys
from types import ModuleType


class _CompiledFinder:
    def __init__(self, library: Path, names: set[str]) -> None:
        self.library = library
        self.names = names

    def find_spec(self, fullname: str, path: Sequence[str] | None = None,
                  target: ModuleType | None = None) -> ModuleSpec | None:
        if fullname not in self.names:
            return None
        stem = self.library / fullname.replace(".", "/")
        for suffix in EXTENSION_SUFFIXES:
            binary = Path(f"{stem}{suffix}")
            if binary.is_file():
                return spec_from_file_location(
                    fullname, binary, loader=ExtensionFileLoader(fullname, str(binary))
                )
        raise ImportError(f"compiled Code TE2 module is missing: {fullname}")


def install(source_root: str, output_root: str) -> int:
    root = Path(source_root).resolve()
    output = Path(output_root).resolve()
    manifest = json.loads((output / "manifest.json").read_text())
    if manifest.get("schemaVersion") == 2:
        from app.release_runtime.code_te2 import compiled_module_names
        names = compiled_module_names(manifest)
    else:
        sources = set(manifest["compiled_sources"])
        names = {
            name for name, source in manifest["modules"].items()
            if Path(source).resolve().relative_to(root).as_posix() in sources
        }
        if not names or len(names) != len(sources):
            raise RuntimeError("mypyc module manifest does not match this checkout")
    library = output / "lib"
    for name in names:
        stem = library / name.replace(".", "/")
        if not any(Path(f"{stem}{suffix}").is_file() for suffix in EXTENSION_SUFFIXES):
            raise RuntimeError(f"missing mypyc extension for {name}")
    sys.path.append(str(library))
    sys.meta_path.insert(0, _CompiledFinder(library, names))
    return len(names)
