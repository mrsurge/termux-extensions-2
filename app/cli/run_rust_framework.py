from __future__ import annotations

import importlib.util
import site
import sys
import sysconfig
from pathlib import Path
from types import ModuleType
from importlib import metadata

import app as app_pkg


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "console":
        from app.cli.console_cli import main as console_main
        return int(console_main(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == "migrate-legacy-roots":
        from app.cli.legacy_roots import main as migration_main
        return int(migration_main(sys.argv[2:]))
    bootstrap = _load_bootstrap_module()
    entry = getattr(bootstrap, "main", None)
    if not callable(entry):
        raise SystemExit("Rust framework bootstrap does not expose main()")
    return int(entry(sys.argv[1:]))


def _load_bootstrap_module() -> ModuleType:
    for candidate in _bootstrap_candidates():
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("te2_framework_bootstrap", candidate)
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
    candidates = [
        package_root / "framework" / "bootstrap" / "bootstrap.py",
        package_root / "te2" / "framework" / "bootstrap" / "bootstrap.py",
        *(_distribution_bootstrap_candidates()),
        data_root / "te2" / "framework" / "bootstrap" / "bootstrap.py",
        Path(site.USER_BASE) / "te2" / "framework" / "bootstrap" / "bootstrap.py",
    ]
    return _dedupe_paths(candidates)


def _distribution_bootstrap_candidates() -> list[Path]:
    try:
        distribution = metadata.distribution("te2")
    except metadata.PackageNotFoundError:
        return []

    candidates: list[Path] = []
    for file in distribution.files or ():
        file_text = file.as_posix()
        if file_text.endswith("te2/framework/bootstrap/bootstrap.py") or file_text.endswith(
            "framework/bootstrap/bootstrap.py"
        ):
            candidates.append(Path(distribution.locate_file(file)))
    return candidates


def _dedupe_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    deduped: list[Path] = []
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


if __name__ == "__main__":
    raise SystemExit(main())
