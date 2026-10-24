"""Actual retained-cache owners, source and small real-codegen qualification."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("compiled", [False, True])
def test_retained_caches_preserve_keys_expiry_invalidation_and_copies(compiled: bool, tmp_path: Path) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import importlib
from pathlib import Path
import sys
from unittest.mock import patch

repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
import probe_code_te2_mypyc as probe
names = {"app.apps.code_te2.diff_helper", "app.apps.code_te2.draft_diff_helper",
         "app.apps.code_te2.worker_services.git_service"}
if compiled:
    from mypyc.build import mypycify
    from setuptools import setup
    from mypyc_build_workflow import mypy_build_args
    sources = [name.replace(".", "/") + ".py" for name in sorted(names)]
    extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                         target_dir=str(output / "csrc"))
    setup(name="retained-cache-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
if compiled:
    sys.path.append(str(output / "lib"))
    sys.meta_path.insert(0, probe.CompiledFinder(output / "lib", names))
git = importlib.import_module("app.apps.code_te2.worker_services.git_service")
diff = importlib.import_module("app.apps.code_te2.diff_helper")
draft = importlib.import_module("app.apps.code_te2.draft_diff_helper")
for module in (git, diff, draft):
    assert module.__file__.endswith(".so" if compiled else ".py"), module.__file__
root, other = isolated / "project", isolated / "other"
root.mkdir()
other.mkdir()
calls = []

class NoRepr(str):
    def __repr__(self):
        raise AssertionError("diff payload must not be stringified for unused metadata")

def provider(method, params, **kwargs):
    calls.append((method, dict(params)))
    if method == "git.diff.hunks":
        if params["relativePath"] == "failure.py":
            raise RuntimeError("provider failure")
        return {"dto": "GitDiffHunks", "root": params["root"],
            "relativePath": params["relativePath"], "base": params["base"],
            "summary": {"added": 1, "deleted": 0, "tracked": True},
            "hunks": [{"oldStart": 1, "oldLines": 0, "newStart": 1, "newLines": 1,
                "lines": [{"type": "add", "text": NoRepr("λ🙂") }]}]}
    if method == "git.snapshot.get":
        return {"dto": "GitSnapshot", "root": params["root"],
                "isRepository": True, "hasHead": True,
                "statuses": {"a.py": "modified", "lib/b.py": "staged"}}
    raise AssertionError("unexpected provider call: " + method)

# Stub only the existing external service boundary; use actual native-local
# cache/normalization helpers, not mocks ignored by compiled direct calls.
with patch.object(git.pipe_runtime, "call", side_effect=provider), patch("time.time", return_value=100.0) as clock:
    first = diff.collect_diff(root, "a.py", " HEAD ")
    assert first["hunks"][0]["lines"][0]["text"] == "λ🙂"
    assert first["summary"] == {"added": 1, "deleted": 0, "tracked": True}
    assert diff.collect_diff(root, "a.py", "HEAD") is first
    assert len(calls) == 1
    assert not hasattr(next(iter(diff._DIFF_CACHE.values())), "size")
    pinned = diff.collect_diff(root, "a.py", "abc")
    sibling = diff.collect_diff(root, "b.py", "HEAD")
    other_value = diff.collect_diff(other, "a.py", "HEAD")
    assert len(calls) == 4
    diff.invalidate_diff_cache(root, "a.py")
    assert diff.collect_diff(root, "b.py", "HEAD") is sibling
    assert diff.collect_diff(other, "a.py", "HEAD") is other_value
    assert len(calls) == 4
    assert diff.collect_diff(root, "a.py", "abc") == pinned
    assert len(calls) == 5
    diff.invalidate_diff_cache(root)
    assert diff.collect_diff(other, "a.py", "HEAD") is other_value
    diff.collect_diff(root, "a.py", "HEAD")
    assert len(calls) == 6
    clock.return_value = 104.999
    diff.collect_diff(root, "a.py", "HEAD")
    assert len(calls) == 6
    clock.return_value = 105.0
    diff.collect_diff(root, "a.py", "HEAD")
    assert len(calls) == 7
    diff.invalidate_diff_cache()
    assert not diff._DIFF_CACHE
    diff.collect_diff(root, "lib\\a.py")
    assert calls[-1][1]["relativePath"] == "lib/a.py"
    before = len(calls)
    try:
        diff.collect_diff(root, "failure.py")
    except RuntimeError as error:
        assert str(error) == "provider failure"
    else:
        raise AssertionError("provider failure swallowed")
    assert len(calls) == before + 1
    assert not any(key[1] == "failure.py" for key in diff._DIFF_CACHE)

    # Cached and fresh status projections are detached maps. Unknown/dirty
    # reads do not invoke the provider, including global invalidation.
    assert git.get_cached_statuses(root) == {}
    snapshot = git.get_snapshot(root)
    cached = git.get_cached_statuses(root)
    assert cached == snapshot["statuses"] and cached is not snapshot["statuses"]
    cached.clear()
    assert git.get_cached_statuses(root) == {"a.py": "modified", "lib/b.py": "staged"}
    fresh = git.get_status_snapshot(root)
    retained = git.get_cached_snapshot(root)
    assert retained is not None and fresh is not retained["statuses"]
    fresh["a.py"] = "clean"
    assert git.get_cached_statuses(root)["a.py"] == "modified"
    git.get_snapshot(other)
    before = len(calls)
    git.mark_status_cache_dirty(root)
    assert git.get_cached_statuses(root) == {} and git.get_cached_statuses(other)
    git.mark_status_cache_dirty()
    assert git.get_cached_statuses(other) == {} and len(calls) == before

    # Unchanged draft-diff cache and its already-native metadata retain
    # content-based keys, exact expiry, cache object identity and size guard.
    clock.return_value = 200
    a = draft.compute_draft_diff("a.py", "new λ🙂\n", "old\n")
    assert draft.compute_draft_diff("a.py", "new λ🙂\n", "old\n") is a
    b = draft.compute_draft_diff("a.py", "newer\n", "old\n")
    assert b != a
    clock.return_value = 201.999
    assert draft.compute_draft_diff("a.py", "new λ🙂\n", "old\n") is a
    clock.return_value = 202
    assert draft.compute_draft_diff("a.py", "new λ🙂\n", "old\n") is not a
    oversized = draft.compute_draft_diff("big.py", "x" * (draft.MAX_DIFF_CHARS + 1), "")
    assert oversized["error"] == "File too large for live diff"
print("actual retained-cache source/codegen parity passed")
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path), str(int(compiled))],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=240,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "actual retained-cache source/codegen parity passed" in result.stdout
