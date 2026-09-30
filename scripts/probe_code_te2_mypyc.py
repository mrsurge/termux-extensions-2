"""Build and import-check Code TE2's startup Python graph with mypyc.

This is a developer probe, not a wheel build or native-worker runtime switch.
The output directory must be new and is never installed into the source tree.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
import importlib
from importlib.machinery import EXTENSION_SUFFIXES, ExtensionFileLoader
from importlib.util import spec_from_file_location
import json
import os
from pathlib import Path
import sys
import tempfile
import time

from scripts.profile_code_te2_import import check_event


REPO = Path(__file__).resolve().parents[1]
STARTUP_IMPORTS = (
    "app.apps.code_te2.native_worker",
    "app.apps.code_te2.intelligence_bootstrap",
    "app.apps.code_te2.main",
    "app.apps.code_te2.socketio_gateway",
)
# Interpreted islands are local compiler/runtime-shape limits, not an external
# dependency fallback. Re-evaluate each after the domain/transport split.
INTERPRETED = frozenset({
    "app.libs.pipe_protocol",  # runtime-inspected pipe annotations
    "app.libs.pipe_runtime",  # RuntimeError subclass codegen
    "app.apps.code_te2.code_server_bootstrap",  # RuntimeError subclass codegen
    "app.apps.code_te2.intelligence_bootstrap",  # async generator
    "app.apps.code_te2.worker_services.history_service",  # async generator
    "app.apps.code_te2.draft_index_sidecar",  # dataclass ClassVar cache
    "app.apps.code_te2.project_sidecar",  # dataclass ClassVar cache
    "app.apps.code_te2.explorer_runtime",  # runtime_checkable Protocol identity
    "app.apps.code_te2.socketio_jsonrpc",
    "app.apps.code_te2.ui_ipc.sidebar_rpc_contract",
    "app.apps.code_te2.ui_ipc.rpc_contract",
    "app.apps.code_te2.explorer.transport.rpc_contract",
    "app.apps.code_te2.explorer.contracts.extensions",
    "app.apps.code_te2.explorer.contracts.git",
    "app.apps.code_te2.explorer.contracts.session",
    "app.apps.code_te2.explorer.contracts.file_tree",
    "app.apps.code_te2.explorer.contracts.watcher",
    "app.apps.code_te2.explorer.contracts.extension_menus",
    "app.apps.code_te2.explorer.contracts.search_review",
    "app.apps.code_te2.explorer.contracts.prefs",
    "app.apps.code_te2.explorer.contracts.integration",
    "app.apps.code_te2.explorer.contracts.project",
})


class CompiledFinder:
    def __init__(self, root: Path, names: set[str]) -> None:
        self.root = root
        self.names = names

    def find_spec(self, fullname: str, path: object = None, target: object = None) -> object:
        if fullname not in self.names:
            return None
        stem = self.root / fullname.replace(".", "/")
        for suffix in EXTENSION_SUFFIXES:
            binary = Path(str(stem) + suffix)
            if binary.is_file():
                return spec_from_file_location(
                    fullname, binary, loader=ExtensionFileLoader(fullname, str(binary))
                )
        raise ImportError(f"missing compiled module: {fullname}")


def _isolate(root: Path) -> list[bool]:
    for key in tuple(os.environ):
        if key.startswith(("TE_", "TE2_", "FRAMEWORK_SHELLS_", "XDG_")):
            del os.environ[key]
    os.environ.update({"HOME": str(root), "TMPDIR": str(root), "PYTHON_JIT": "0"})
    for kind in ("DATA", "CACHE", "CONFIG", "RUNTIME"):
        path = root / kind.lower()
        os.environ[f"TE2_{kind}_HOME"] = str(path)
        os.environ[f"XDG_{kind}_HOME" if kind != "RUNTIME" else "XDG_RUNTIME_DIR"] = str(path)
    sys.dont_write_bytecode = True
    guarded = [True]
    sys.addaudithook(lambda event, values: check_event(root, event, values) if guarded[0] else None)
    return guarded


def inventory(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="te2-mypyc-inventory-", dir=output.parent) as temporary:
        root = Path(temporary)
        guarded = _isolate(root)
        try:
            for name in STARTUP_IMPORTS:
                importlib.import_module(name)
            modules: dict[str, str] = {}
            for name, module in sys.modules.items():
                if not name.startswith(("app.apps.code_te2.", "app.libs.")):
                    continue
                path = getattr(module, "__file__", None)
                if isinstance(path, str) and path.endswith(".py"):
                    modules[name] = str(Path(path).resolve())
        finally:
            guarded[0] = False
        output.write_text(json.dumps({"count": len(modules), "modules": modules}, indent=2))
        print(f"Inventoried {len(modules)} local startup modules: {output}")


def build(output: Path) -> None:
    if output.exists():
        raise SystemExit(f"output already exists: {output}")
    output.mkdir(parents=True)
    import subprocess

    env = dict(os.environ, PYTHONPATH=str(REPO), PYTHON_JIT="0", PYTHONDONTWRITEBYTECODE="1")
    subprocess.run(
        [sys.executable, "-B", str(Path(__file__).resolve()), "inventory", "--output", str(output / "startup.json")],
        cwd=REPO, env=env, check=True,
    )
    modules: dict[str, str] = json.loads((output / "startup.json").read_text())["modules"]
    sources = [str(Path(path).relative_to(REPO)) for name, path in modules.items()
               if not path.endswith("/__init__.py") and name not in INTERPRETED]
    manifest = {"modules": modules, "compiled_sources": sources, "interpreted": sorted(INTERPRETED)}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Compiling {len(sources)} local modules in one mypyc group", flush=True)
    from setuptools import setup
    from mypyc.build import mypycify

    os.environ.setdefault("MAX_JOBS", "2")
    log_path = output / "build.log"
    try:
        with log_path.open("w") as log, redirect_stdout(log), redirect_stderr(log):
            setup(
                name="te2-mypyc-domain-probe",
                ext_modules=mypycify(sources, opt_level="3", multi_file=True, target_dir=str(output / "csrc")),
                script_args=["build_ext", "--build-lib", str(output / "lib"), "--build-temp", str(output / "temp")],
            )
    except BaseException:
        print("\n".join(log_path.read_text().splitlines()[-35:]), file=sys.stderr)
        raise
    print(f"Built shared group: {output / 'lib'} (details: {log_path})")


def validate(manifest_path: Path, lib: Path | None) -> None:
    manifest = json.loads(manifest_path.read_text())
    names = {name for name, path in manifest["modules"].items()
             if str(Path(path).relative_to(REPO)) in manifest["compiled_sources"]}
    with tempfile.TemporaryDirectory(prefix="te2-mypyc-validate-", dir=manifest_path.parent) as temporary:
        guarded = _isolate(Path(temporary))
        try:
            if lib is not None:
                lib = lib.resolve()
                sys.path.append(str(lib))
                sys.meta_path.insert(0, CompiledFinder(lib, names))
            started = time.perf_counter_ns()
            for name in STARTUP_IMPORTS:
                importlib.import_module(name)
            elapsed_ms = (time.perf_counter_ns() - started) / 1e6
            loaded = {name: str(getattr(sys.modules.get(name), "__file__", ""))
                      for name in names if name in sys.modules}
            compiled = {name for name, path in loaded.items() if path.endswith(".so")}
            if lib is not None and compiled != names:
                raise AssertionError(f"missing compiled imports: {sorted(names - compiled)}")
            print(json.dumps({"mode": "compiled" if lib else "interpreted",
                              "elapsed_ms": elapsed_ms, "loaded": len(loaded),
                              "compiled": len(compiled), "missing": sorted(names - set(loaded))}))
        finally:
            guarded[0] = False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inventory").add_argument("--output", type=Path, required=True)
    commands.add_parser("build").add_argument("--output", type=Path, required=True)
    check = commands.add_parser("validate")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--lib", type=Path)
    args = parser.parse_args()
    if args.command == "inventory":
        inventory(args.output.resolve())
    elif args.command == "build":
        build(args.output.resolve())
    else:
        validate(args.manifest.resolve(), args.lib)


if __name__ == "__main__":
    main()
