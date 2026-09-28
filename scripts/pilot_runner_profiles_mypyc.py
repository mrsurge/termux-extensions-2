"""Isolated development pilot. No installation or live service imports.

Builds copied modules under their canonical names; stores logs and measurements
in a new --output directory. Invoke with the target device's Python interpreter.
"""
from __future__ import annotations

import argparse
import compileall
import importlib
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

MODULE = "app.apps.code_te2.runner_profiles"
RELATIVE = Path("app/apps/code_te2/runner_profiles.py")
GROUP = (
    "app.libs.messagepack_stream", "app.libs.pipe_protocol", "app.libs.pipe_runtime",
    "app.apps.code_te2.worker_services.git_service",
    "app.apps.code_te2.worker_services.history_service",
)


def validate_group(root: Path) -> None:
    import asyncio
    import runpy
    import unittest
    from dataclasses import asdict

    runtime = importlib.import_module("app.libs.pipe_runtime")
    protocol = importlib.import_module("app.libs.pipe_protocol")
    stream = importlib.import_module("app.libs.messagepack_stream")
    history = importlib.import_module(GROUP[-1])
    git = importlib.import_module(GROUP[-2])
    tests = runpy.run_path(str(root / "test_history_service.py"))
    response = tests["response"]
    sent = []

    class Writer:
        def write(self, data: bytes) -> int:
            parser = stream.MessagePackStream()
            request = protocol.decode_envelope(list(parser.feed(data))[0])
            parser.finish()
            sent.append(request.method)
            if request.method == "git.branchList":
                result = {"dto": "GitBranchList", "version": 1, "root": "/project",
                          "current": "main", "branches": [{"name": "main", "current": True, "remote": False}]}
            else:
                result = response(request.method, request.params)
            assert runtime.accept_response(protocol.success_response(
                request, protocol.PipeIdentity(2200, "service.git"), result))
            return len(data)

        def flush(self) -> None:
            pass

    async def exercise() -> None:
        runtime.configure(lambda request: None, protocol.PipeIdentity(2100, "service.app"))
        runtime.configure_stdio_transport(Writer())
        try:
            branches = await asyncio.to_thread(git.list_branches, Path("/project"))
            assert asdict(branches) == {"current": "main", "branches": ["main"]}
            async with history.history_session(Path("/project"), 9) as session:
                assert session.snapshot is not None
                assert asdict(session.snapshot)["identity"] == "a" * 64
                page = await session.next_page()
                assert len(page.commits) == 1
                files = await session.files("b" * 40)
                assert len(files.files) == 1
                assert runtime.accept_notification(protocol.PipeEnvelope(
                    kind="notification", method="git.historyGraph.changed",
                    origin_nid=2200, origin_name="service.git", workspace_root="/project",
                    project_generation=9, params={"version": 1, "sessionId": session.session_id, "error": None}))
                assert await asyncio.wait_for(session.wait_changed(), 2) is None
            assert session.closed
        finally:
            runtime.close_stdio_transport("pilot finished")
    asyncio.run(exercise())
    print(json.dumps({"boundary_checks": "passed", "requests": sent}))
    pipe_tests = runpy.run_path(str(root / "test_messagepack_pipe.py"))
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(pipe_tests["MessagePackPipeTests"])
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    assert result.wasSuccessful(), "pipe suite failed"


def validate(module: object, root: Path) -> None:
    from dataclasses import FrozenInstanceError, asdict, replace
    from unittest.mock import patch

    m = module
    config = {"profiles": [{"profileId": "python", "runner": "python",
        "include": ["src/**"], "exec": "python", "args": ["main.py"],
        "env": {"MODE": "test"}, "port": 3000,
        "sidebarUrl": "http://localhost:3000/", "additionalPorts": [{"port": 3001, "label": "HMR"}]}]}
    parsed = m.parse_run_profiles_config(config)
    profile = m._profiles_from_config(parsed)[0]
    assert profile.profile_id == "python" and profile.port == 3000
    assert profile.additional_ports == (m.RunProfileAdditionalPort(3001, "HMR"),)
    assert asdict(profile)["env"] == {"MODE": "test"}
    assert replace(profile, profile_id="other").profile_id == "other"
    try:
        profile.profile_id = "changed"
    except (FrozenInstanceError, AttributeError):
        pass
    else:
        raise AssertionError("frozen profile accepted mutation")
    assert m.run_profile_matches_path(profile, "src/main.py", project_root=root)
    assert not m.run_profile_matches_path(profile, "other.py", project_root=root)
    m.save_run_profiles_config(root, json.dumps(config))
    assert m.load_run_profiles(root) == [profile]
    match = m.match_run_profile(root, root / "src/main.py")
    assert match and replace(match).profile == profile
    m.set_run_save_warning(root, profile_id="python", enabled=False)
    assert not m.load_run_profiles(root)[0].show_save_warning
    for invalid in ({"profiles": [False]}, {"profiles": [config["profiles"][0]] * 2},
                    {"profiles": [{**config["profiles"][0], "port": True}]},
                    {"profiles": [{**config["profiles"][0], "env": {"BAD-NAME": "x"}}]}):
        try:
            m.parse_run_profiles_config(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid input accepted")
    exc = m.RunProfileConflictError(relative_path="src/main.py", profile_ids=["one", "two"])
    assert isinstance(exc, ValueError) and exc.profile_ids == ["one", "two"]
    assert "src/main.py" in str(exc)
    # Record rather than misclassify expected compiled early-binding behavior.
    with patch.object(m, "_profiles_from_config", wraps=m._profiles_from_config) as spy:
        m.load_run_profiles(root)
        print(json.dumps({"internal_mock_calls": spy.call_count}))


def sample(root: Path, warm: bool, test: bool, group: bool = False) -> None:
    sys.path.insert(0, str(root))
    if warm:
        for name in ("dataclasses", "fnmatch", "json", "pathlib", "re", "threading", "typing", "urllib.parse"):
            importlib.import_module(name)
        if group:
            for name in ("asyncio", "inspect", "itertools", "queue", "uuid", "msgspec", "msgpack"):
                importlib.import_module(name)
    start = time.perf_counter_ns()
    modules = [importlib.import_module(name) for name in (GROUP if group else (MODULE,))]
    m = modules[-1]
    elapsed = (time.perf_counter_ns() - start) / 1e6
    print(json.dumps({"import_ms": elapsed, "origin": m.__file__,
                      "origins": [module.__file__ for module in modules], "warm_dependencies": warm}))
    if test:
        if group:
            validate_group(root)
        else:
            with tempfile.TemporaryDirectory(dir=root) as temp:
                validate(m, Path(temp))
        print(json.dumps({"behavior_checks": "passed"}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sample", type=Path)
    parser.add_argument("--warm", action="store_true")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--group", action="store_true", help="Compile the five-module Git/history pipe group jointly")
    parser.add_argument("--interpreted-schema", action="store_true", help="Keep msgspec protocol schema interpreted in the group pilot")
    args = parser.parse_args()
    if args.sample:
        sample(args.sample.resolve(), args.warm, args.test, args.group)
        return
    if not args.output:
        parser.error("--output required")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    repo = Path(__file__).resolve().parents[1]
    relatives = [Path(name.replace(".", "/") + ".py") for name in GROUP] if args.group else [RELATIVE]
    schema = Path("app/libs/pipe_protocol.py")
    native_relatives = [p for p in relatives if not (args.group and args.interpreted_schema and p == schema)]
    for mode in ("interpreted", "compiled"):
        root = output / mode
        for relative in relatives:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repo / relative, target)
            if args.group and mode == "compiled" and relative == Path("app/libs/pipe_runtime.py"):
                content = target.read_text()
                marker = "class PipeRuntimeError(RuntimeError):"
                assert content.count(marker) == 1
                target.write_text(content.replace(marker,
                    "from mypy_extensions import mypyc_attr\n\n"
                    "@mypyc_attr(native_class=False)\n" + marker))
            if args.group and mode == "compiled" and relative == Path("app/apps/code_te2/worker_services/history_service.py"):
                content = target.read_text()
                marker = "@asynccontextmanager\nasync def history_session("
                assert content.count(marker) == 1
                prefix, lifecycle = content.split(marker)
                target.with_name("_mypyc_history_lifecycle.py").write_text(
                    "from __future__ import annotations\nimport asyncio\n"
                    "from contextlib import asynccontextmanager\nfrom collections.abc import AsyncIterator\n"
                    "from pathlib import Path\nfrom .history_service import HistorySession\n\n" + marker + lifecycle)
                target.write_text(prefix +
                    "from contextlib import AbstractAsyncContextManager\n\n"
                    "def history_session(root: Path, generation: int) -> AbstractAsyncContextManager[HistorySession]:\n"
                    "    from ._mypyc_history_lifecycle import history_session as lifecycle\n"
                    "    return lifecycle(root, generation)\n")
            for parent in relative.parents:
                marker = parent / "__init__.py"
                if (repo / marker).is_file():
                    shutil.copy2(repo / marker, root / marker)
        if args.group:
            for test_name in ("test_messagepack_pipe.py", "test_history_service.py"):
                shutil.copy2(repo / "tests" / test_name, root / test_name)
            (root / "fixtures").mkdir()
            shutil.copy2(repo / "tests/fixtures/framework_pipe_request.msgpack.hex", root / "fixtures")
    interpreted = output / "interpreted"
    assert compileall.compile_dir(str(interpreted), quiet=1, force=True)
    compiled = output / "compiled"
    assert compileall.compile_dir(str(compiled), quiet=1, force=True)
    env = dict(os.environ, PYTHON_JIT="0", PYTHONDONTWRITEBYTECODE="1", MAX_JOBS="1")
    build = f"from setuptools import setup; from mypyc.build import mypycify; setup(name='te2-mypyc-pilot', ext_modules=mypycify({[str(p) for p in native_relatives]!r}, opt_level='3'), script_args=['build_ext','--inplace'])"
    with (output / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, "-B", "-c", build], cwd=compiled, env=env,
                                stdout=log, stderr=subprocess.STDOUT, timeout=300)
    if result.returncode:
        raise SystemExit(f"Build failed; see {output / 'build.log'}")
    script = str(Path(__file__).resolve())
    extra = ["--group"] if args.group else []
    for root in (interpreted, compiled):
        result = subprocess.run([sys.executable, "-B", script, "--sample", str(root), "--test", *extra],
                                cwd=output, env=env, capture_output=True, text=True, timeout=30)
        (output / f"{root.name}.checks.log").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise SystemExit(f"Checks failed: {root.name}; see logs")
    records = []
    for warm in (False, True):
        for iteration in range(12):
            roots = (interpreted, compiled) if iteration % 2 == 0 else (compiled, interpreted)
            for root in roots:
                command = [sys.executable, "-B", script, "--sample", str(root), *extra]
                if warm:
                    command.append("--warm")
                result = subprocess.run(command, cwd=output, env=env, capture_output=True,
                                        text=True, check=True, timeout=30)
                record = json.loads(result.stdout)
                origin = Path(record["origin"])
                assert origin.is_relative_to(root)
                assert (origin.suffix == ".so") == (root == compiled), origin
                for loaded in record["origins"]:
                    assert Path(loaded).is_relative_to(root)
                    interpreted_schema = args.group and args.interpreted_schema and Path(loaded).relative_to(root) == schema
                    assert (Path(loaded).suffix == ".so") == (root == compiled and not interpreted_schema), loaded
                records.append({**record, "mode": root.name, "iteration": iteration})
    (output / "samples.json").write_text(json.dumps(records, indent=2))
    for warm in (False, True):
        for mode in ("interpreted", "compiled"):
            values = [r["import_ms"] for r in records if r["mode"] == mode and r["warm_dependencies"] == warm]
            print(json.dumps({"mode": mode, "warm_dependencies": warm, "n": len(values),
                              "median_ms": statistics.median(values), "min_ms": min(values), "max_ms": max(values)}))


if __name__ == "__main__":
    main()
