from __future__ import annotations

import importlib.util
import sys
import sysconfig
from pathlib import Path
from types import ModuleType

import app as app_pkg


def main() -> int:
    bootstrap = _load_bootstrap_module()
    entry = getattr(bootstrap, "main", None)
    if not callable(entry):
        raise SystemExit("Rust framework bootstrap does not expose main()")
    return int(entry(sys.argv[1:]))


def _load_bootstrap_module() -> ModuleType:
    for candidate in _bootstrap_candidates():
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("te2_rust_spike_bootstrap", candidate)
            if spec is None or spec.loader is None:
                break
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            return module
    searched = ", ".join(str(path) for path in _bootstrap_candidates())
    raise SystemExit(f"Rust framework bootstrap not found. Searched: {searched}")


def _bootstrap_candidates() -> list[Path]:
    package_root = Path(app_pkg.__file__).resolve().parents[1]
    data_root = Path(sysconfig.get_path("data"))
    return [
        package_root / "rust-spike" / "app" / "bootstrap.py",
        data_root / "te2" / "rust-spike" / "app" / "bootstrap.py",
    ]


if __name__ == "__main__":
    raise SystemExit(main())
