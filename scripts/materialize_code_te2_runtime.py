"""Construct a relocatable native Code TE2 payload from a validated snapshot.

Build/release tooling only: never activates a runtime or restarts a worker.
Run with the same CPython ABI used to compile the worker and mypyc group.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import sysconfig
import tempfile
from typing import cast

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from app.release_runtime.code_te2 import (
    MANIFEST, compiled_module_names, python_identity, sha256, validate_runtime,
)
from scripts.mypyc_build_workflow import read_artifact, source_digest

RESOURCE_PATHS = (
    "app/apps/code_te2/shellspec",
    "app/apps/code_te2/runner_profile",
    "app/apps/code_te2/page_preview",
    "app/apps/code_te2/workbench_protocol_proxy",
    "app/apps/code_te2/monaco_editor/themes",
    "app/apps/code_te2/monaco_editor/textmate",
    "app/apps/code_te2/static",
)
_EXCLUDED = {"node_modules", "__pycache__", ".git", "target", "build"}


def _mapping(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise RuntimeError(f"invalid {label}")
    return cast(dict[str, object], value)


def _relative(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or "\\" in value or any(part in {"", ".", ".."} for part in value.split("/")):
        raise RuntimeError(f"unsafe snapshot path: {value}")
    return path


def _copy_resources(source: Path, target: Path) -> None:
    """Dereference only the known snapshot root links, never arbitrary children."""
    if not source.is_dir():
        raise RuntimeError(f"missing resource directory: {source}")
    target.mkdir(parents=True, exist_ok=True)
    for item in sorted(source.iterdir()):
        if item.name in _EXCLUDED or item.suffix in {".pyc", ".pyo"}:
            continue
        if item.is_symlink():
            raise RuntimeError(f"resource child symlink cannot be shipped: {item}")
        destination = target / item.name
        if item.is_dir():
            _copy_resources(item, destination)
        elif item.is_file():
            if destination.exists():
                raise RuntimeError(f"resource collides with compiled artifact: {destination}")
            shutil.copy2(item, destination)
        else:
            raise RuntimeError(f"resource is not a regular file/directory: {item}")


def materialize(*, repo: Path, snapshot: Path, worker: Path, output: Path,
                package_version: str, rust_fingerprint: str) -> Path:
    repo, snapshot = repo.resolve(strict=True), snapshot.resolve(strict=True)
    if not re.fullmatch(r"[0-9a-f]{64}", rust_fingerprint):
        raise RuntimeError("rust fingerprint must be a full SHA-256 build identity")
    if not package_version.strip():
        raise RuntimeError("package version is required")
    if output.exists() or output.is_symlink():
        raise RuntimeError(f"refusing to overwrite payload: {output}")
    if worker.is_symlink() or not worker.is_file() or not os.access(worker, os.X_OK):
        raise RuntimeError(f"worker must be a regular executable: {worker}")
    artifact = read_artifact(snapshot)
    identity = _mapping(artifact.get("toolchain"), "snapshot toolchain")
    if identity.get("soabi") != sysconfig.get_config_var("SOABI") or identity.get("machine") != os.uname().machine:
        raise RuntimeError("snapshot Python ABI/architecture does not match the packaging interpreter")
    manifest_path = snapshot / "manifest.json"
    if manifest_path.is_symlink() or sha256(manifest_path) != artifact.get("manifest_sha256"):
        raise RuntimeError("snapshot manifest checksum mismatch")
    manifest = _mapping(cast(object, json.loads(manifest_path.read_text())), "snapshot manifest")
    raw_modules = _mapping(manifest.get("modules"), "snapshot modules")
    modules: dict[str, str] = {}
    portable: dict[str, str] = {}
    for name, raw_path in raw_modules.items():
        if not isinstance(raw_path, str):
            raise RuntimeError(f"invalid source path for {name}")
        path = Path(raw_path)
        if not path.is_absolute() or not path.is_file() or path.is_symlink():
            raise RuntimeError(f"snapshot source is not a regular absolute file: {path}")
        relative = path.resolve(strict=True).relative_to(repo).as_posix()
        _relative(relative)
        modules[name], portable[name] = str(path), relative
    expected_source = artifact.get("source_digest")
    if source_digest(repo, modules) != expected_source:
        raise RuntimeError("snapshot sources have changed; rebuild before packaging")
    portable_manifest: dict[str, object] = {
        "schemaVersion": 2, "modules": portable,
        "compiled_sources": manifest.get("compiled_sources"),
        "interpreted": manifest.get("interpreted"),
    }
    names = compiled_module_names(portable_manifest)
    libraries = _mapping(artifact.get("libraries"), "snapshot libraries")
    if not libraries:
        raise RuntimeError("snapshot has no libraries")
    suffix = str(sysconfig.get_config_var("EXT_SUFFIX"))
    required = {f"lib/{name.replace('.', '/')}{suffix}" for name in names}
    if not required.issubset(libraries):
        raise RuntimeError("snapshot library inventory omits compiled modules")
    if not any(Path(name).name.endswith(f"__mypyc{suffix}") for name in libraries):
        raise RuntimeError("snapshot library inventory omits the shared mypyc group")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".code-te2-publish-", dir=output.parent) as temporary:
        stage = Path(temporary) / "payload"
        (stage / "bin").mkdir(parents=True)
        shutil.copy2(worker, stage / "bin/code-te2-worker")
        for relative, digest in libraries.items():
            path = _relative(relative)
            if path.parts[0] != "lib" or path.suffix != ".so":
                raise RuntimeError(f"unexpected snapshot library: {relative}")
            source = snapshot / path
            if source.is_symlink() or not source.resolve().is_relative_to(snapshot) or sha256(source) != digest:
                raise RuntimeError(f"snapshot library checksum/path mismatch: {relative}")
            target = stage / "domain" / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        for relative in RESOURCE_PATHS:
            # The developer overlay intentionally links these roots to source.
            linked = snapshot / "lib" / relative
            source = repo / relative
            if linked.resolve(strict=True) != source.resolve(strict=True):
                raise RuntimeError(f"snapshot resource does not match this checkout: {relative}")
            _copy_resources(source, stage / "domain/lib" / relative)
        (stage / "domain/manifest.json").write_text(json.dumps(portable_manifest, indent=2) + "\n")
        runtime_manifest: dict[str, object] = {
            "schemaVersion": 1, "appId": "code_te2", "packageVersion": package_version,
            "python": python_identity(), "platform": sys.platform,
            "machine": os.uname().machine, "libc": "glibc",
            "executable": "bin/code-te2-worker", "domain": "domain",
            "rustFingerprint": rust_fingerprint, "domainFingerprint": expected_source,
            "files": {path.relative_to(stage).as_posix(): sha256(path)
                      for path in sorted(stage.rglob("*")) if path.is_file()},
        }
        (stage / MANIFEST).write_text(json.dumps(runtime_manifest, indent=2, sort_keys=True) + "\n")
        validate_runtime(stage, package_version=package_version)
        if source_digest(repo, modules) != expected_source:
            raise RuntimeError("snapshot sources changed during publication")
        stage.rename(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=REPO)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--package-version", required=True)
    parser.add_argument("--rust-fingerprint", required=True)
    args = parser.parse_args()
    print(materialize(repo=args.repo, snapshot=args.snapshot, worker=args.worker,
                      output=args.output, package_version=args.package_version,
                      rust_fingerprint=args.rust_fingerprint))


if __name__ == "__main__":
    main()
