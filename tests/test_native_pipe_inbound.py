"""Real inbound owners in disposable roots, including a small mypyc build."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("compiled", [False, True])
def test_native_domain_control_buffer_dispatch(tmp_path: Path, compiled: bool) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import json
from pathlib import Path
import runpy
import sys

repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
import probe_code_te2_mypyc as probe
names = {"app.apps.code_te2.native_worker", "app.libs.pipe_codec"}
if compiled:
    from mypyc.build import mypycify
    from mypyc_build_workflow import mypy_build_args
    from setuptools import setup
    sources = [name.replace(".", "/") + ".py" for name in sorted(names)]
    extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                         target_dir=str(output / "csrc"))
    setup(name="inbound-control-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
    (output / "manifest.json").write_text(json.dumps({
        "modules": {name: str(repo / (name.replace(".", "/") + ".py")) for name in names},
        "compiled_sources": sources}))
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
if compiled:
    from app.apps.code_te2.mypyc_overlay import install
    install(str(repo), str(output))
scope = runpy.run_path(str(repo / "framework/native_editor_worker/examples/inbound_dispatch_probe.py"))
result = scope["run"]()
assert str(result["module"]).endswith(".so" if compiled else ".py"), result
print(result)
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path), "1" if compiled else "0"],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        text=True, capture_output=True, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
