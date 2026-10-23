"""Actual lane consumers retain pre-reuse behavior in source and real codegen."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("compiled", [False, True])
def test_actual_rpc_lanes_reuse_frozen_schema(compiled: bool, tmp_path: Path) -> None:
    if compiled and importlib.util.find_spec("mypyc") is None:
        pytest.skip("requires mypyc")
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import importlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
import msgspec

repo, output, compiled = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == "1"
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
import probe_code_te2_mypyc as isolation
isolated = output / "isolated"
isolated.mkdir()
name = "app.apps.code_te2.monaco_editor.editor_rpc_contract"
if compiled:
    from mypyc.build import mypycify
    from setuptools import setup
    from mypyc_build_workflow import mypy_build_args
    source = name.replace(".", "/") + ".py"
    # A real multi-module group uses the same root-level shared library layout
    # as production (single-module codegen puts its helper inside the package).
    companion = "app.apps.code_te2.network_rpc_ingress"
    companion_source = companion.replace(".", "/") + ".py"
    sources = [source, companion_source]
    extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                         target_dir=str(output / "csrc"))
    setup(name="rpc-schema-reuse-fixture", ext_modules=extensions,
          script_args=["build_ext", "--build-lib", str(output / "lib"),
                       "--build-temp", str(output / "temp"), "-j", "2"])
    (output / "manifest.json").write_text(json.dumps({
        "modules": {name: str(repo / source), companion: str(repo / companion_source)},
        "compiled_sources": sources}))
    from app.apps.code_te2.mypyc_overlay import install
    install(str(repo), str(output))

from framework.domain_optimization_probe import common_rpc_probe as probe
generated = output / "comparison"
generated.mkdir()
probe.generate(generated)
sys.path.insert(0, str(generated))
isolation._isolate(isolated)
from app.apps.code_te2 import socketio_jsonrpc as common
assert common.__file__.endswith(".py"), common.__file__
assert tuple(field.name for field in msgspec.structs.fields(common._IncomingJsonRpcEnvelope)) == ("jsonrpc", "method", "params", "id")
legacy = common.JsonRpcEnvelope("legacy", {}, None, True)
assert legacy.method == "legacy" and legacy.has_id is True
for attr in ("method", "request_id", "has_id"):
    incoming = common._IncomingJsonRpcEnvelope("2.0", "test", {}, "r1")
    with patch.object(common.msgspec, "convert", return_value=incoming):
        assert common.coerce_jsonrpc_envelope({}) is incoming
    try:
        setattr(incoming, attr, None)
    except (AttributeError, TypeError):
        pass
    else:
        raise AssertionError("mutable schema property: " + attr)
incoming = common._IncomingJsonRpcEnvelope("2.0", " test ", {}, "r1")
with patch.object(common.msgspec, "convert", return_value=incoming):
    normalized = common.coerce_jsonrpc_envelope({})
assert normalized is not incoming and normalized.method == "test"
assert incoming.method == " test " and normalized.params is incoming.params
assert normalized.request_id == "r1" and normalized.has_id is True

for lane, (relative, request, notification, _, method, notify_method) in probe.LANES.items():
    actual_name = "app.apps.code_te2." + relative[:-3].replace("/", ".")
    actual = importlib.import_module(actual_name)
    assert actual.__file__.endswith(".so" if compiled and lane == "editor" else ".py"), actual.__file__
    baseline = probe.load("lane_" + lane + "_baseline", False)
    # Actual production functions, not transformed copies of the new parser.
    adapter = SimpleNamespace(parse_request=getattr(actual, request),
                              parse_notification=getattr(actual, notification) if notification else baseline.parse_notification)
    for payload in probe.fixtures(method, notify_method):
        expected = probe.outcome(baseline, payload)
        result = probe.outcome(adapter, payload)
        assert result == expected, (lane, payload, expected, result)
    print(lane + ": actual-source parity passed")
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path), str(int(compiled))],
        cwd=repo,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=240,
    )
    assert result.returncode == 0, result.stdout + result.stderr
