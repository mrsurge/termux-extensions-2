"""Actual diagnostics-module behavior in source and isolated real codegen."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("compiled", [False, True])
def test_diagnostics_cache_projection_ownership_and_eviction(compiled: bool, tmp_path: Path) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import asyncio
import importlib
import json
from pathlib import Path
import sys

repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
import probe_code_te2_mypyc as probe
names = {"app.apps.code_te2.diagnostics_bridge", "app.apps.code_te2.diagnostics_latency_metrics"}
if compiled:
    from mypyc.build import mypycify
    from setuptools import setup
    from mypyc_build_workflow import mypy_build_args
    sources = [name.replace(".", "/") + ".py" for name in sorted(names)]
    extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                         target_dir=str(output / "csrc"))
    setup(name="diagnostics-cache-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
if compiled:
    sys.path.append(str(output / "lib"))
    sys.meta_path.insert(0, probe.CompiledFinder(output / "lib", names))
diag = importlib.import_module("app.apps.code_te2.diagnostics_bridge")
metrics = importlib.import_module("app.apps.code_te2.diagnostics_latency_metrics")
assert diag.__file__.endswith(".so" if compiled else ".py"), diag.__file__
assert metrics.__file__.endswith(".so" if compiled else ".py"), metrics.__file__
from app.apps.code_te2.worker_services import event_bus as bus
from app.apps.code_te2.explorer.services import file_ops
from app.apps.code_te2.file_tabs_projection import _diagnostics_from_detail

async def run():
    project = isolated / "project"
    project.mkdir()
    other = isolated / "other"
    other.mkdir()
    file_ops.set_project_root(str(project))
    generation = bus.next_project_generation(project)
    observed = []
    async def capture(event):
        observed.append(event)
    bus.subscribe("DiagnosticsDetailChanged", capture)
    metrics._METRICS.enabled = True
    path = str(project / "a.py")
    marker = {"severity": "8", "message": "λ🙂", 7: "normalized", "extra": {"nested": [1, 2]}}
    payload = {"owner": "one", "items": [None, 1,
        {"uri": "file://" + path, "markers": [None, 1, marker]},
        {"uri": "file://" + str(other / "outside.py"), "markers": []},
        {"uri": "", "markers": []}]}
    entries, ignored = diag._process_diagnostics_update(payload, project_root=str(project))
    assert ignored == 2 and len(entries) == 1
    cached = entries[0]["markers"][0]
    assert cached == {"severity": "8", "message": "λ🙂", "7": "normalized", "extra": marker["extra"]}
    assert cached is not marker and cached["extra"] is marker["extra"]
    marker["message"] = "later input mutation"
    assert cached["message"] == "λ🙂"
    await diag._emit_diagnostics_debounced()
    first = observed[-1]
    assert first["project_generation"] == generation
    detail = first["payload"]["detail"]
    assert _diagnostics_from_detail(detail) == {path: {"errors": 1, "warnings": 0}}
    published = detail[path][0]
    assert published is not cached and published["extra"] is cached["extra"]
    published["message"] = "consumer mutation"
    assert cached["message"] == "λ🙂"
    await diag._emit_diagnostics_debounced()
    assert observed[-1]["payload"]["detail"][path][0]["message"] == "λ🙂"

    # Real public handler, metrics path and debounce; no patched compiled-local
    # callbacks which would hide native direct-call behavior.
    await diag.handle_wba_diagnostics_update({"type": "diagnostics/update", "owner": "two", "items": [
        {"uri": "file://" + path, "markers": [{"severity": 4}]}]})
    task = diag._diag_emit_task
    assert task is not None
    await task
    assert _diagnostics_from_detail(observed[-1]["payload"]["detail"])[path] == {"errors": 1, "warnings": 1}
    for invalid in (None, "", 123):
        await diag.handle_wba_diagnostics_update({"type": "diagnostics/clear", "owner": invalid})
    assert set(diag._diag_cache) == {(path, "one"), (path, "two")}
    await diag.handle_wba_diagnostics_update({"type": "diagnostics/clear", "owner": "one"})
    task = diag._diag_emit_task
    assert task is not None
    await task
    assert set(diag._diag_cache) == {(path, "two")}
    assert _diagnostics_from_detail(observed[-1]["payload"]["detail"])[path] == {"errors": 0, "warnings": 1}
    await diag.handle_wba_diagnostics_update({"type": "diagnostics/update", "owner": "two", "items": [
        {"uri": "file://" + path, "markers": []}]})
    task = diag._diag_emit_task
    assert task is not None
    await task
    assert observed[-1]["payload"]["detail"] == {}
    diag.reset_diagnostics_projection()
    diag._process_diagnostics_update({"owner": "many", "items": [
        {"uri": "file://" + str(project / (str(index) + ".py")), "markers": [{"severity": 8}]}
        for index in range(505)]}, project_root=str(project))
    assert len(diag._diag_cache) == 500
    assert (str(project / "0.py"), "many") not in diag._diag_cache
    assert (str(project / "5.py"), "many") in diag._diag_cache
    assert diag._prune_cache_to_project(str(other)) == 500
    diag._process_diagnostics_update({"owner": "one", "items": [
        {"uri": "file://" + path, "markers": [{"severity": 8}]}]}, project_root=str(project))
    file_ops.set_project_root(str(other))
    next_generation = bus.next_project_generation(other)
    await diag.reset_diagnostics_projection_for_project(other, project_generation=next_generation)
    assert not diag._diag_cache
    assert observed[-1]["project_root"] == str(other)
    assert observed[-1]["project_generation"] == next_generation
    assert observed[-1]["payload"] == {"detail": {}, "reason": "project_switch"}
    diag.reset_diagnostics_projection()
    bus.unsubscribe("DiagnosticsDetailChanged", capture)
    print(json.dumps({"compiled": compiled, "diagnostics_ownership": "pass"}))

asyncio.run(run())
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path), str(int(compiled))],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=240,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"diagnostics_ownership": "pass"' in result.stdout
    records = [json.loads(line) for line in result.stdout.splitlines()
               if '"system":"code_te2.diagnostics_latency"' in line]
    updates = [record for record in records if record["kind"] == "diagnostics_update"]
    assert [record["accepted_markers"] for record in updates] == [1, 0]
    assert [record["input_markers"] for record in updates] == [1, 0]
