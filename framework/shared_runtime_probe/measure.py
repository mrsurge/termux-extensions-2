"""Isolated Linux static-vs-dylib packaging experiment; never activates TE2."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time
import zipfile

SOURCE = Path(__file__).resolve().parent
EXPECTED_RUST = "rustc 1.95.0 (59807616e 2026-04-14)"
BINARIES = ("framework-fixture", "worker-fixture")


def output(command: list[str], *, env: dict[str, str] | None = None) -> str:
    return subprocess.check_output(command, env=env, text=True, timeout=30).strip()


def build(command: list[str], env: dict[str, str], log: Path, root: Path) -> float:
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise RuntimeError("need at least 2 GiB free before a build")
    started = time.monotonic()
    with log.open("w") as stream:
        child = subprocess.Popen(command, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        try:
            while child.poll() is None:
                if shutil.disk_usage(root).free < 1024**3:
                    raise RuntimeError("stopping this probe build: less than 1 GiB free")
                time.sleep(0.25)
            if child.returncode:
                raise RuntimeError(f"build failed; inspect {log}")
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
    return time.monotonic() - started


def measure(root: Path, label: str, resume: bool) -> None:
    compiler = output(["rustc", "--version"])
    if compiler != EXPECTED_RUST:
        raise RuntimeError(f"matched-toolchain PoC requires {EXPECTED_RUST}; found {compiler}")
    verbose = output(["rustc", "--version", "--verbose"])
    host = next(line.removeprefix("host: ") for line in verbose.splitlines() if line.startswith("host: "))
    if host != "x86_64-unknown-linux-gnu":
        raise RuntimeError("this first PoC qualifies Linux x86_64 only")
    if resume:
        if not (root / "source/src/runtime.rs").is_file():
            raise RuntimeError("resume needs an existing isolated source copy")
    else:
        if root.exists():
            raise RuntimeError("output must be new; use --resume for retained build targets")
        root.mkdir(parents=True)
        shutil.copytree(SOURCE, root / "source", ignore=shutil.ignore_patterns("__pycache__"))
    destination = root / label
    destination.mkdir()  # Never overwrite an earlier measurement.
    base_env = dict(os.environ)
    for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR", "LD_LIBRARY_PATH"):
        base_env.pop(key, None)
    libdir = Path(output(["rustc", "--print", "target-libdir", "--target", host]))
    results: dict[str, object] = {"compiler": verbose, "target": host, "label": label,
                                  "runtime_source_sha256": hashlib.sha256((root / "source/src/runtime.rs").read_bytes()).hexdigest()}
    observed: dict[str, dict[str, str]] = {}
    for mode in ("static", "shared"):
        project = root / "source" / mode
        env = dict(base_env)
        if mode == "shared":
            env["RUSTFLAGS"] = "-C prefer-dynamic -C link-arg=-Wl,-rpath,$ORIGIN/../lib"
        if not (project / "Cargo.lock").is_file():
            subprocess.run(["cargo", "generate-lockfile", "--offline", "--manifest-path", str(project / "Cargo.toml")],
                           env=env, check=True)
        target = root / "targets" / mode
        command = ["cargo", "build", "--workspace", "--release", "--offline", "--locked", "-j", "2",
                   "--manifest-path", str(project / "Cargo.toml"), "--target-dir", str(target), "--target", host]
        elapsed = build(command, env, destination / f"{mode}-build.log", root)
        noop = build(command, env, destination / f"{mode}-noop.log", root)
        release = target / host / "release"
        stage = destination / mode
        (stage / "bin").mkdir(parents=True)
        for name in BINARIES:
            shutil.copy2(release / name, stage / "bin" / name)
        if mode == "shared":
            (stage / "lib").mkdir()
            shutil.copy2(release / "libte2_probe_runtime.so", stage / "lib")
            standard, = libdir.glob("libstd-*.so")
            shutil.copy2(standard, stage / "lib")
        files = sorted(path for path in stage.rglob("*") if path.is_file())
        needed: dict[str, list[str]] = {}
        available = {path.name for path in files}
        for path in files:
            dynamic = output(["readelf", "-d", str(path)])
            dependencies = re.findall(r"\(NEEDED\).*?\[(.*?)\]", dynamic)
            needed[str(path.relative_to(stage))] = dependencies
            for dependency in dependencies:
                if dependency.startswith(("libstd-", "libte2_")) and dependency not in available:
                    raise RuntimeError(f"unbundled Rust library: {dependency}")
        observed[mode] = {name: output([str(stage / "bin" / name)], env=base_env) for name in BINARIES}
        archive = destination / f"{mode}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for path in files:
                bundle.write(path, path.relative_to(stage))
        results[mode] = {
            "build_seconds": elapsed, "noop_seconds": noop,
            "compiling": [line for line in (destination / f"{mode}-build.log").read_text().splitlines() if line.strip().startswith("Compiling ")],
            "files": {str(path.relative_to(stage)): {"bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in files},
            "raw_bytes": sum(path.stat().st_size for path in files),
            "zip_bytes": archive.stat().st_size, "needed": needed, "output": observed[mode],
        }
    if observed["static"] != observed["shared"]:
        raise RuntimeError("static/shared behavior differs")
    if (root / "source/static/Cargo.lock").read_bytes() != (root / "source/shared/Cargo.lock").read_bytes():
        raise RuntimeError("dependency lockfiles differ")
    (destination / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", default="initial")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.label):
        parser.error("label must be a simple measurement name")
    measure(args.output.absolute(), args.label, args.resume)
