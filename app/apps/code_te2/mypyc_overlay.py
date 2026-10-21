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
    raw_manifest: object = json.loads((output / "manifest.json").read_text())
    manifest = _manifest_object(raw_manifest, "manifest")
    if manifest.get("schemaVersion") == 2:
        from app.release_runtime.code_te2 import compiled_module_names
        names = compiled_module_names(manifest)
    else:
        raw_sources = manifest["compiled_sources"]
        if not isinstance(raw_sources, list):
            raise ValueError("compiled_sources must be a list")
        source_items: list[object] = raw_sources
        sources: set[str] = set()
        for source in source_items:
            if not isinstance(source, str):
                raise ValueError("compiled_sources must contain strings")
            sources.add(source)
        names = set()
        for name, source in _manifest_object(manifest["modules"], "modules").items():
            if not isinstance(source, str):
                raise ValueError("module paths must be strings")
            if Path(source).resolve().relative_to(root).as_posix() in sources:
                names.add(name)
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


def _manifest_object(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    entries: dict[object, object] = value
    result: dict[str, object] = {}
    for key, item in entries.items():
        if not isinstance(key, str):
            raise ValueError(f"{field} keys must be strings")
        result[key] = item
    return result
