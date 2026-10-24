"""Qualify lazy search owners against their existing pipe schema and codec."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


def test_search_inventory_expands_only_in_build_process(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    output = tmp_path / "inventory.json"
    code = r'''
import sys
from pathlib import Path
from scripts import probe_code_te2_mypyc as probe
root = Path(sys.argv[1])
guarded = probe._isolate(root)
for name in probe.STARTUP_IMPORTS:
    probe.importlib.import_module(name)
assert "app.apps.code_te2.explorer.services.search_sessions" not in sys.modules
assert "app.apps.code_te2.explorer.search" not in sys.modules
guarded[0] = False
'''
    isolated = tmp_path / "startup"
    isolated.mkdir()
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    startup = subprocess.run([sys.executable, "-B", "-c", code, str(isolated)],
                             cwd=repo, env=env, capture_output=True, text=True, timeout=30)
    assert startup.returncode == 0, startup.stdout + startup.stderr
    result = subprocess.run([sys.executable, "-B", "scripts/probe_code_te2_mypyc.py",
                             "inventory", "--output", str(output)],
                            cwd=repo, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    modules = json.loads(output.read_text())["modules"]
    from scripts import probe_code_te2_mypyc as probe
    for name in ("app.apps.code_te2.explorer.services.search_sessions",
                 "app.apps.code_te2.explorer.search"):
        assert name in modules and name not in probe.INTERPRETED
    for name in ("app.apps.code_te2.explorer.contracts.search_review", "app.libs.pipe_dto",
                 "app.libs.pipe_protocol", "app.libs.pipe_runtime"):
        assert name in modules and name in probe.INTERPRETED


@pytest.mark.parametrize("compiled", [False, True])
def test_search_source_and_codegen_pipe_lifecycle(compiled: bool, tmp_path: Path) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import asyncio
import importlib
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
import probe_code_te2_mypyc as probe
names = {"app.apps.code_te2.explorer.services.search_sessions",
         "app.apps.code_te2.explorer.search"}
if compiled:
    from mypyc.build import mypycify
    from mypyc_build_workflow import mypy_build_args
    from setuptools import setup
    extensions = mypycify(mypy_build_args(repo, [n.replace(".", "/") + ".py" for n in sorted(names)]),
                         multi_file=True, target_dir=str(output / "csrc"))
    setup(name="search-coverage-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
    manifest = output / "manifest.json"
    manifest.write_text(json.dumps({"modules": {
        n: str(repo / (n.replace(".", "/") + ".py")) for n in names},
        "compiled_sources": [n.replace(".", "/") + ".py" for n in names]}))
    validation = subprocess.run([sys.executable, "-B", str(repo / "scripts/probe_code_te2_mypyc.py"),
        "validate", "--manifest", str(manifest), "--lib", str(output / "lib")],
        cwd=repo, capture_output=True, text=True, timeout=60)
    assert validation.returncode == 0, validation.stdout + validation.stderr
    assert json.loads(validation.stdout.splitlines()[-1])["compiled"] == len(names)
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
if compiled:
    sys.path.append(str(output / "lib"))
    sys.meta_path.insert(0, probe.CompiledFinder(output / "lib", names))
search = importlib.import_module("app.apps.code_te2.explorer.services.search_sessions")
provider = importlib.import_module("app.apps.code_te2.explorer.search")
from app.libs import pipe_runtime
from app.libs.pipe_codec import encode_frame, decode_envelope_bytes
from app.libs.pipe_dto import PipeEnvelope
from app.apps.code_te2.explorer.contracts import search_review
assert search.PipeEnvelope is PipeEnvelope
assert search_review.__file__.endswith(".py")
for module in (search, provider):
    assert module.__file__.endswith(".so" if compiled else ".py"), module.__file__
root = isolated / "project"
root.mkdir()

async def exercise():
    emitted, calls = [], []
    async def emit(method, payload, reply_to=None):
        emitted.append((method, payload, reply_to))
    manager = search.ExplorerSearchSessions(get_project_root=lambda: root, emit_personal=emit)
    await manager.start()
    listener = manager._listener
    await manager.start()
    assert manager._listener is listener

    def envelope(method, **fields):
        params = dict(searchId="s1", jobId="j1", root=str(root),
                      projectGeneration=generation, correlationId="c1")
        params.update(fields)
        # Use production concatenated MessagePack and the existing typed decoder.
        return decode_envelope_bytes(encode_frame(PipeEnvelope(
            kind="notification", method=method, params=params)))

    async def drain():
        for _ in range(12):
            await asyncio.sleep(0)

    generation = 0
    async def call(method, params, **kwargs):
        nonlocal generation
        calls.append((method, params, kwargs))
        if method == "search.job.cancel":
            return {"dto": "SearchJobCancelResult", "searchId": params["searchId"]}
        assert method in {"search.content.start", "search.files.start", "search.changes.start"}, method
        generation = params["projectGeneration"]
        assert params["correlationId"] == "c1"
        if method != "search.content.start":
            return {"dto": "SearchJobStarted", "searchId": "s1", "jobId": "j1"}
        assert kwargs["correlation_id"] == "c1"
        # Exercise the production listener/pump before the start ACK arrives.
        assert pipe_runtime.accept_notification(envelope("search.job.progress", filesScanned=2))
        await drain()
        assert len(manager._early_events) == 1 and not emitted
        return {"dto": "SearchJobStarted", "searchId": "s1", "jobId": "j1"}

    params = dict(mode="content", query="λ", correlationId="c1", isRegex=False,
                  isCaseSensitive=False, isWholeWords=False, includePattern="", excludePattern="",
                  useIgnoreFiles=True, searchThreads=None)
    with patch.object(pipe_runtime, "call_async", side_effect=call):
        await manager.run(params, "request-1")
        assert [e[0] for e in emitted] == ["explorer.search.started", "search.job.progress"]
        session = manager._sessions["s1"]
        match = {"lineNumber": 5, "endLineNumber": 6, "columnNumber": 2,
                 "lineText": "λ🙂", "snippet": "λ🙂", "matchText": "λ",
                 "lineRanges": [{"start": 1, "end": 2}],
                 "editTarget": {"sourceSha256": "a" * 64, "startByte": 4, "endByte": 6}}
        result = {"dto": "SearchContentResult", "files": [{"path": str(root / "a.py"),
            "relativePath": "a.py", "matches": [match]}]}
        for extra in ({"root": str(isolated / "other")}, {"projectGeneration": generation + 1},
                      {"searchId": "unknown", "jobId": "unknown"}):
            pipe_runtime.accept_notification(envelope("search.job.result", result=result, **extra))
        await drain()
        assert not session.content_files
        pipe_runtime.accept_notification(envelope("search.job.result", result=result))
        await drain()
        cached = session.content_files["a.py"]
        assert cached.matches[0].text == "λ🙂" and cached.matches[0].end_line == 6
        assert cached.matches[0].column == 1
        assert cached.matches[0].line_ranges == ((1, 2),)
        assert cached.matches[0].edit_target == match["editTarget"]
        pipe_runtime.accept_notification(envelope("search.job.result", result=result))
        await drain()
        assert session.content_files["a.py"] is cached and len(cached.matches) == 2
        pipe_runtime.accept_notification(envelope("search.job.done", status="done"))
        await drain()
        assert session.complete and session.status == "done"
        assert emitted[-1][0] == "search.job.done" and emitted[-1][1]["matchCount"] == 2
        await manager.more_in_file(dict(searchId="s1", projectGeneration=generation,
            relativePath="a.py", cursor=search._file_cursor("a.py", 0), maxMatches=1), "more-1")
        page = emitted[-1][1]["file"]
        assert page["fileTruncated"] and page["matches"][0]["endLineNumber"] == 6
        assert page["matches"][0]["editTarget"] == match["editTarget"]
        pipe_runtime.accept_notification(envelope("search.job.error", message="provider failed"))
        await drain()
        assert session.status == "error" and emitted[-1][1]["message"] == "provider failed"
        await manager.cancel_active(reason="user")
        assert calls[-1][0] == "search.job.cancel"
        assert not manager._sessions and not manager._job_to_search
        before = len(emitted)
        pipe_runtime.accept_notification(envelope("search.job.result", result=result))
        await drain()
        assert len(emitted) == before
        # Other branches retain the same provider/notification owners as well.
        await manager.run({**params, "mode": "name"}, "name-1")
        pipe_runtime.accept_notification(envelope("search.job.result", result={
            "dto": "SearchFilesResult", "items": [{"path": str(root / "a.py"),
                "relativePath": "a.py", "name": "a.py", "kind": "file"}]}))
        await drain()
        assert len(manager._sessions["s1"].name_items) == 1
        assert emitted[-1][0] == "explorer.search.results.updated"
        await manager.run({**params, "mode": "changes"}, "changes-1")
        pipe_runtime.accept_notification(envelope("search.job.result", result={
            "change": {"rel": "a.py", "status": "modified"},
            "metadata": {"base": {"mode": "head", "ref": "HEAD"}}}))
        await drain()
        changes = manager._sessions["s1"]
        assert changes.changes_items["a.py"]["status"] == "modified"
        assert changes.changes_metadata["base"]["ref"] == "HEAD"
        manager.cancel_for_project_switch()
        assert changes.cancelled and not manager._sessions and not manager._job_to_search
        await drain()
        assert calls[-1][0] == "search.job.cancel" and calls[-1][1]["reason"] == "projectSwitch"
        await manager.stop()
        assert manager._listener is None and manager._pump_task is None
        assert not pipe_runtime.accept_notification(envelope("search.job.result", result=result))
        await manager.stop()
asyncio.run(exercise())
print("actual search source/codegen pipe parity passed")
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path), str(int(compiled))],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=240,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "actual search source/codegen pipe parity passed" in result.stdout
