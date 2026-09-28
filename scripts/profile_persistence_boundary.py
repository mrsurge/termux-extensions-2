"""Bounded development-only persistence probe; never opens live files for writing.

Supply explicit input paths. Copies remain in a new private output directory.
Results contain timings and sizes, not document contents.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time


MAX_BYTES = 16 * 1024 * 1024


def summary(values: list[float]) -> dict[str, float]:
    return {"median_ms": statistics.median(values), "min_ms": min(values), "max_ms": max(values)}


def timed(call):
    start = time.perf_counter_ns()
    value = call()
    return value, (time.perf_counter_ns() - start) / 1e6


def child(root: Path, startup: bool = False, warm_bytecode: bool = False, seed_bytecode: bool = False) -> None:
    from profile_code_te2_import import check_event

    sys.dont_write_bytecode = not seed_bytecode
    if warm_bytecode:
        sys.pycache_prefix = str(root / "bytecode")
    sys.addaudithook(lambda event, args: check_event(root, event, args))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    if startup:
        import cProfile
        import pstats

        profiler = cProfile.Profile()
        compilation_files: dict[str, int] = {}
        def audit_compile(event: str, args: tuple[object, ...]) -> None:
            if event == "compile":
                filename = str(args[1])
                compilation_files[filename] = compilation_files.get(filename, 0) + 1
        sys.addaudithook(audit_compile)
        started = time.perf_counter()
        profiler.enable()
        try:
            __import__("app.apps.code_te2.main", fromlist=["*"])
        finally:
            profiler.disable()
        elapsed = (time.perf_counter() - started) * 1000
        stats = pstats.Stats(profiler)
        selected = []
        persistence_files = {"preferences_store.py", "extension_registry.py", "intelligence_state.py",
                             "history_store.py", "project_sidecar.py", "draft_index_sidecar.py"}
        for (filename, line, name), (primitive, calls, own, cumulative, callers) in stats.stats.items():
            if Path(filename).name not in persistence_files and not (
                "/json/" in filename and name in {"loads", "decode", "raw_decode"}
            ):
                continue
            selected.append({"file": Path(filename).name, "line": line, "function": name,
                             "calls": calls, "primitive_calls": primitive,
                             "self_ms": own * 1000, "cumulative_ms": cumulative * 1000,
                             "callers": [{"file": Path(key[0]).name, "line": key[1], "function": key[2],
                                          "stats": list(value) if isinstance(value, tuple) else value}
                                         for key, value in callers.items()]})
        selected.sort(key=lambda item: item["cumulative_ms"], reverse=True)
        compile_callers = []
        for key, value in stats.stats.items():
            if key[2] == "<built-in method builtins.compile>":
                compile_callers = [{"file": caller[0], "line": caller[1], "function": caller[2],
                                    "calls": timing[1], "self_ms": timing[2] * 1000,
                                    "cumulative_ms": timing[3] * 1000}
                                   for caller, timing in value[4].items()]
        top_self = sorted(
            ({"file": filename, "line": line, "function": name, "calls": value[1],
              "self_ms": value[2] * 1000, "cumulative_ms": value[3] * 1000}
             for (filename, line, name), value in stats.stats.items()),
            key=lambda item: item["self_ms"], reverse=True,
        )[:30]
        print(json.dumps({"phase": "backend_import_only", "profiled_wall_ms": elapsed,
                          "lifecycle_started": False, "client_connected": False,
                          "functions": selected, "top_self": top_self,
                          "compile_callers": compile_callers, "compilation_files": compilation_files,
                          "warm_bytecode": warm_bytecode, "seed_bytecode": seed_bytecode}))
        return
    msgspec, codec_import = timed(lambda: importlib.import_module("msgspec"))
    decoder = msgspec.json.Decoder(type=dict[str, object])
    untyped_decoder = msgspec.json.Decoder()
    records = {}
    for name, path in {
        "preferences": root / "config/code_te2/preferences.json",
        "registry": root / "data/code_te2/code_server/te2_extension_registry.json",
    }.items():
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        std = json.loads(text)
        assert isinstance(std, dict)
        assert decoder.decode(raw) == std, "decoder value mismatch"
        assert untyped_decoder.decode(raw) == std, "untyped decoder value mismatch"
        assert json.loads(msgspec.json.encode(std)) == std, "encoder roundtrip mismatch"
        # Separate stages plus complete read/decode/admission paths. Alternate
        # order to reduce a systematic first/last measurement bias.
        cases = {
            "read_bytes": path.read_bytes,
            "utf8_decode": lambda: raw.decode("utf-8"),
            "stdlib_decode": lambda: json.loads(text),
            "msgspec_decode_object": lambda: decoder.decode(raw),
            "msgspec_decode_untyped": lambda: untyped_decoder.decode(raw),
            "top_level_copy": lambda: dict(std),
            "stdlib_read_decode": lambda: json.loads(path.read_text("utf-8")),
            "msgspec_read_decode": lambda: decoder.decode(path.read_bytes()),
            "stdlib_encode_pretty": lambda: json.dumps(std, ensure_ascii=False, indent=2),
            "stdlib_encode_compact_bytes": lambda: json.dumps(std, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            "msgspec_encode_compact": lambda: msgspec.json.encode(std),
        }
        values = {key: [] for key in cases}
        for iteration in range(30):
            keys = list(cases)
            if iteration % 2:
                keys.reverse()
            for key in keys:
                _, elapsed = timed(cases[key])
                values[key].append(elapsed)
        records[name] = {"bytes": len(raw), "samples": 30,
                         "stages": {key: summary(value) for key, value in values.items()}}

    prefs_module, prefs_import = timed(lambda: importlib.import_module("app.apps.code_te2.preferences_store"))
    registry_module, registry_import = timed(lambda: importlib.import_module("app.apps.code_te2.extension_registry"))
    prefs, prefs_init = timed(lambda: prefs_module.PreferencesStore())
    _, registry_first = timed(registry_module.load_registry)
    loads = {"preferences_get": [], "registry_load": []}
    for iteration in range(30):
        cases = [("preferences_get", prefs.get_preferences), ("registry_load", registry_module.load_registry)]
        if iteration % 2:
            cases.reverse()
        for key, call in cases:
            _, elapsed = timed(call)
            loads[key].append(elapsed)
    print(json.dumps({"python": sys.version, "codec_import_ms": codec_import,
                     "preferences_import_ms": prefs_import, "registry_import_ms": registry_import,
                     "preferences_init_ms": prefs_init, "registry_first_load_ms": registry_first,
                     "store_warm": {key: summary(value) for key, value in loads.items()},
                     "files": records, "worker_started": False}))


def copy_bounded(source: Path, target: Path) -> None:
    with source.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Input exceeds profiling size bound")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    target.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--preferences", type=Path)
    parser.add_argument("--registry", type=Path)
    parser.add_argument("--intelligence", type=Path)
    parser.add_argument("--startup", action="store_true", help="Profile backend import call counts instead of codec microbenchmarks")
    parser.add_argument("--warm-bytecode", action="store_true", help="Seed and reuse bytecode only inside each scratch root")
    parser.add_argument("--seed-bytecode", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.child:
        child(args.child.resolve(), args.startup, args.warm_bytecode, args.seed_bytecode)
        return
    if any(value is None for value in (args.output, args.preferences, args.registry, args.intelligence)):
        parser.error("output and all three input paths are required")
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    fixtures = output / "fixtures"
    for source, relative in ((args.preferences, "config/code_te2/preferences.json"),
                             (args.intelligence, "config/code_te2/intelligence.json"),
                             (args.registry, "data/code_te2/code_server/te2_extension_registry.json")):
        copy_bounded(source, fixtures / relative)
    for index in range(3):
        root = output / f"run-{index}"
        shutil.copytree(fixtures, root)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("TE_", "TE2_", "XDG_", "FRAMEWORK_SHELLS_"))}
        env.update(HOME=str(root), TMPDIR=str(root), PYTHON_JIT="0", PYTHONDONTWRITEBYTECODE="1")
        for kind in ("DATA", "CONFIG", "CACHE", "RUNTIME"):
            env[f"TE2_{kind}_HOME"] = str(root / kind.lower())
            env[f"XDG_{kind}_HOME" if kind != "RUNTIME" else "XDG_RUNTIME_DIR"] = str(root / kind.lower())
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "--child", str(root)]
        if args.startup:
            command.append("--startup")
        if args.warm_bytecode:
            if not args.startup:
                parser.error("--warm-bytecode requires --startup")
            command.append("--warm-bytecode")
            seed = subprocess.run([*command, "--seed-bytecode"], env=env,
                                  capture_output=True, text=True, timeout=60)
            (output / f"{index}.seed.stdout").write_text(seed.stdout)
            (output / f"{index}.seed.stderr").write_text(seed.stderr)
            if seed.returncode:
                raise SystemExit(f"Bytecode seeding failed; inspect run {index} logs")
        result = subprocess.run(command,
                                env=env, capture_output=True, text=True, timeout=60)
        (output / f"{index}.stdout").write_text(result.stdout)
        (output / f"{index}.stderr").write_text(result.stderr)
        if result.returncode:
            raise SystemExit(f"Probe failed; inspect run {index} logs")
        print(json.dumps({"run": index, "ok": True}))


if __name__ == "__main__":
    main()
