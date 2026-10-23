"""Source and real-codegen parity through the domain submit/Future owner."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("compiled", [False, True])
def test_real_domain_submit_rpc_preserves_namespace_dispatch(compiled: bool, tmp_path: Path) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import json
from pathlib import Path
import sys
from types import ModuleType
repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
names = {"app.apps.code_te2.native_worker", "app.apps.code_te2.native_socketio",
         "app.apps.code_te2.network_rpc_ingress"}
if compiled:
    from mypyc.build import mypycify
    from setuptools import setup
    from mypyc_build_workflow import mypy_build_args
    sources = [name.replace(".", "/") + ".py" for name in sorted(names)]
    extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                         target_dir=str(output / "csrc"))
    setup(name="network-rpc-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
    (output / "manifest.json").write_text(json.dumps({
        "modules":{name:str(repo / (name.replace(".", "/") + ".py")) for name in names},
        "compiled_sources":sources}))
import probe_code_te2_mypyc as probe
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
if compiled:
    from app.apps.code_te2.mypyc_overlay import install
    install(str(repo),str(output))
path = repo / "framework/native_editor_worker/examples/network_rpc_boundary_probe.py"
helper = ModuleType("network_probe")
exec(compile(path.read_text(),str(path),"exec"),helper.__dict__)
info = helper.start()
try:
    assert all(path.endswith(".so" if compiled else ".py") for path in info.values()), info
    helper.check_python()
finally:
    helper.stop()
print(json.dumps(info))
'''
    result = subprocess.run([sys.executable,"-B","-c",code,str(repo),str(tmp_path),str(int(compiled))],
        cwd=repo, env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"}, capture_output=True,text=True,timeout=240)
    assert result.returncode == 0, result.stdout + result.stderr
