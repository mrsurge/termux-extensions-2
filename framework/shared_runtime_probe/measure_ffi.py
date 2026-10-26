"""Stripped cdylib versus equally stripped static Rust consumers, Linux only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import tomllib
import zipfile

from measure import BINARIES, EXPECTED_RUST, SOURCE, build, output


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(root: Path, label: str, resume: bool) -> None:
    if output(["rustc", "--version"]) != EXPECTED_RUST:
        raise RuntimeError(f"requires matched compiler {EXPECTED_RUST}")
    host = "x86_64-unknown-linux-gnu"
    compiler = output(["rustc", "--version", "--verbose"])
    if f"host: {host}" not in compiler:
        raise RuntimeError("first cdylib PoC is Linux x86_64 only")
    if resume:
        if not (root / "source/ffi/Cargo.lock").is_file():
            raise RuntimeError("resume requires existing fixture")
    else:
        if root.exists():
            raise RuntimeError("output must be new")
        root.mkdir(parents=True)
        shutil.copytree(SOURCE, root / "source", ignore=shutil.ignore_patterns("__pycache__"))
    destination = root / label
    destination.mkdir()
    env = dict(os.environ)
    for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR", "LD_LIBRARY_PATH"):
        env.pop(key, None)
    source = root / "source"
    results: dict[str, object] = {"compiler": compiler, "target": host,
        "label": label, "runtime_source_sha256": digest(source / "src/runtime.rs")}
    observed: dict[str, dict[str, str]] = {}
    dependency_sets: list[set[tuple[str, str, str]]] = []
    for mode, project_name in (("static", "static"), ("shared", "ffi")):
        project = source / project_name
        lock = project / "Cargo.lock"
        if not lock.is_file():
            subprocess.run(["cargo", "generate-lockfile", "--offline", "--manifest-path", str(project / "Cargo.toml")], env=env, check=True)
        packages = tomllib.loads(lock.read_text())["package"]
        dependency_sets.append({(p["name"], p["version"], p["source"]) for p in packages if "source" in p})
        target = root / "targets" / mode
        command = ["cargo", "build", "--workspace", "--release", "--offline", "--locked", "-j", "2",
            "--config", 'profile.release.strip="symbols"', "--manifest-path", str(project / "Cargo.toml"),
            "--target-dir", str(target), "--target", host]
        elapsed = build(command, env, destination / f"{mode}-build.log", root)
        noop = build(command, env, destination / f"{mode}-noop.log", root)
        release = target / host / "release"
        stage = destination / mode
        (stage / "bin").mkdir(parents=True)
        reused = 0
        if mode == "static":
            for name in BINARIES:
                shutil.copy2(release / name, stage / "bin" / name)
        else:
            (stage / "lib").mkdir()
            library = release / "libte2_probe_runtime_ffi.so"
            shutil.copy2(library, stage / "lib")
            # Client invalidation deliberately follows ABI/header/compiler/source,
            # not private library implementation hashes. Production bootstrap has
            # not adopted this recipe. Never reuse a client after ABI/source drift.
            recipe = {"compiler": compiler, "source": digest(source / "src/consumer_ffi.rs"),
                "header": digest(source / "ffi/te2_probe.h"), "target": host,
                "flags": "edition2024 O3 strip=symbols ORIGIN/../lib", "abi": 1}
            clients = root / "clients"
            clients.mkdir(exist_ok=True)
            receipt = clients / "recipe.json"
            previous: object = json.loads(receipt.read_text()) if receipt.is_file() else None
            for name in BINARIES:
                binary = clients / name
                if previous == recipe and binary.is_file():
                    reused += 1
                else:
                    started = time.monotonic()
                    subprocess.run(["rustc", "--edition=2024", "--crate-name", name.replace("-", "_"),
                        "--target", host, "-C", "opt-level=3", "-C", "strip=symbols",
                        "-L", f"native={release}", "-C", "link-arg=-Wl,-rpath,$ORIGIN/../lib",
                        str(source / "src/consumer_ffi.rs"), "-o", str(binary)],
                        env={**env, "PROBE_LABEL": name}, check=True)
                    elapsed += time.monotonic() - started
                shutil.copy2(binary, stage / "bin" / name)
            receipt.write_text(json.dumps(recipe, indent=2) + "\n")
            symbols = output(["nm", "-D", "--defined-only", str(library)])
            exported = {line.split()[-1] for line in symbols.splitlines()}
            if exported != {"te2_probe_abi_version", "te2_probe_run_v1"}:
                raise RuntimeError(f"unexpected cdylib exports: {exported}")
        files = sorted(p for p in stage.rglob("*") if p.is_file())
        needed: dict[str, list[str]] = {}
        for path in files:
            dynamic = output(["readelf", "-d", str(path)])
            deps = re.findall(r"\(NEEDED\).*?\[(.*?)\]", dynamic)
            if any(name.startswith("libstd-") for name in deps):
                raise RuntimeError("cdylib/static case unexpectedly needs shared Rust std")
            needed[str(path.relative_to(stage))] = deps
        observed[mode] = {name: output([str(stage / "bin" / name)], env=env) for name in BINARIES}
        archive = destination / f"{mode}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for path in files:
                bundle.write(path, path.relative_to(stage))
        results[mode] = {"build_seconds": elapsed, "noop_cargo_seconds": noop,
            "reused_clients": reused, "needed": needed, "output": observed[mode],
            "raw_bytes": sum(p.stat().st_size for p in files), "zip_bytes": archive.stat().st_size,
            "files": {str(p.relative_to(stage)): {"bytes": p.stat().st_size, "sha256": digest(p)} for p in files}}
    if dependency_sets[0] != dependency_sets[1] or observed["static"] != observed["shared"]:
        raise RuntimeError("static/cdylib dependency or behavior mismatch")
    (destination / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", default="initial")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.label):
        parser.error("invalid label")
    measure(args.output.absolute(), args.label, args.resume)
