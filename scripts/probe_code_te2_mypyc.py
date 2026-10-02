"""Build and import-check Code TE2's startup Python graph with mypyc.

This is a developer workflow, not a wheel build or automatic runtime switch.
Build intermediates are cached; validated snapshot output directories must be new.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
import importlib
from importlib.machinery import EXTENSION_SUFFIXES, ExtensionFileLoader, ModuleSpec
from importlib.util import spec_from_file_location
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import subprocess
from types import ModuleType
from typing import Sequence

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))

from profile_code_te2_import import check_event
from mypyc_build_workflow import (
    activate, build_lock, cache_key, compiler_cache, publish_snapshot,
    prune, source_digest, toolchain,
)


STARTUP_IMPORTS = (
    "app.apps.code_te2.native_worker",
    "app.apps.code_te2.intelligence_bootstrap",
    "app.apps.code_te2.main",
    "app.apps.code_te2.socketio_gateway",
)


def link_resources(library: Path) -> None:
    """Keep the developer overlay's __file__-relative assets source-owned."""
    for relative in (
        "app/apps/code_te2/shellspec",
        "app/apps/code_te2/runner_profile",
        "app/apps/code_te2/page_preview",
        "app/apps/code_te2/workbench_protocol_proxy",
        "app/apps/code_te2/monaco_editor/themes",
        "app/apps/code_te2/monaco_editor/textmate",
        "app/apps/code_te2/static",
    ):
        source = REPO / relative
        target = library / relative
        if not source.is_dir():
            raise RuntimeError(f"missing source resource directory: {source}")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink() and target.resolve() == source.resolve():
            continue
        if target.exists() or target.is_symlink():
            raise RuntimeError(f"refusing to replace overlay resource: {target}")
        target.symlink_to(source, target_is_directory=True)

# Interpreted islands are local compiler/runtime-shape limits, not an external
# dependency fallback. Re-evaluate each after the domain/transport split.
INTERPRETED = frozenset({
    "app.libs.pipe_dto",  # msgspec Struct fields require runtime annotations
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

    def find_spec(self, fullname: str, path: Sequence[str] | None = None,
                  target: ModuleType | None = None) -> ModuleSpec | None:
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


def build(output: Path, cache_root: Path) -> None:
    if output.exists() or output.is_symlink():
        raise SystemExit(f"output already exists: {output}")
    cache_root.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PYTHONPATH=str(REPO), PYTHON_JIT="0", PYTHONDONTWRITEBYTECODE="1")
    with tempfile.TemporaryDirectory(prefix='inventory-', dir=cache_root) as temporary:
        inventory_path = Path(temporary) / 'startup.json'
        subprocess.run(
            [sys.executable, "-B", str(Path(__file__).resolve()), "inventory", "--output", str(inventory_path)],
            cwd=REPO, env=env, check=True,
        )
        inventory_bytes = inventory_path.read_bytes()
    modules: dict[str, str] = json.loads(inventory_bytes)["modules"]
    sources = [str(Path(path).relative_to(REPO)) for name, path in modules.items()
               if not path.endswith("/__init__.py") and name not in INTERPRETED]
    manifest: dict[str, object] = {"modules": modules, "compiled_sources": sources, "interpreted": sorted(INTERPRETED)}
    digest = source_digest(REPO, modules)
    identity = toolchain(REPO, sources)
    cache = cache_root / cache_key(identity)
    print(f"Compiling {len(sources)} local modules in one mypyc group", flush=True)
    from setuptools import setup
    from mypyc.build import mypycify

    os.environ.setdefault("MAX_JOBS", "2")
    with build_lock(cache_root / '.build.lock'):
        cache.mkdir(parents=True, exist_ok=True)
        (cache / 'startup.json').write_bytes(inventory_bytes)
        (cache / 'toolchain.json').write_text(json.dumps(identity, indent=2))
        started = time.monotonic()
        log_path = cache / "build.log"
        try:
            with compiler_cache(cache_root, identity) as cached:
                print(f'Build cache: {cache}; ccache: {"enabled (512M limit)" if cached else "unavailable; full changed-extension rebuilds"}', flush=True)
                with log_path.open("w") as log, redirect_stdout(log), redirect_stderr(log):
                    extensions = mypycify(sources, opt_level="3", multi_file=True, target_dir=str(cache / "csrc"))
                    setup(
                        name="te2-mypyc-domain-probe", ext_modules=extensions,
                        script_args=["build_ext", "--build-lib", str(cache / "lib"), "--build-temp", str(cache / "temp")],
                    )
            publish_snapshot(REPO, cache, output, manifest, [ext.name for ext in extensions],
                             identity, digest, time.monotonic() - started, link_resources)
        except BaseException:
            if log_path.is_file():
                print("\n".join(log_path.read_text().splitlines()[-35:]), file=sys.stderr)
            raise
    print(f"Published validated snapshot: {output} (build {time.monotonic() - started:.2f}s)")


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
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--cache-dir", type=Path,
                              default=Path(os.environ.get('TMPDIR') or REPO / '.codex-scratch') / 'mypyc-build-cache')
    activate_parser = commands.add_parser('activate')
    activate_parser.add_argument('--snapshot', type=Path, required=True)
    activate_parser.add_argument('--link', type=Path, default=REPO / '.codex-scratch/mypyc-active')
    prune_parser = commands.add_parser('prune')
    prune_parser.add_argument('--root', type=Path, default=REPO / '.codex-scratch/mypyc-snapshots')
    prune_parser.add_argument('--link', type=Path, default=REPO / '.codex-scratch/mypyc-active')
    prune_parser.add_argument('--keep', type=int, default=2)
    prune_parser.add_argument('--apply', action='store_true')
    check = commands.add_parser("validate")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--lib", type=Path)
    args = parser.parse_args()
    if args.command == "inventory":
        inventory(args.output.resolve())
    elif args.command == "build":
        build(args.output.resolve(), args.cache_dir.resolve())
    elif args.command == 'activate':
        activate(args.snapshot, args.link.absolute())
    elif args.command == 'prune':
        prune(args.root.resolve(), args.link.absolute(), keep=args.keep, apply=args.apply)
    else:
        validate(args.manifest.resolve(), args.lib)


if __name__ == "__main__":
    main()
