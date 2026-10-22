"""Typed WBA byte adapter behavior and small real-codegen regression."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import msgspec
import pytest

from app.apps.code_te2 import wba_pipe_codec as codec


def test_native_adapter_decodes_original_frames_without_encoder_or_graph_feed() -> None:
    expected: list[object] = [None, True, 18446744073709551615, {"binary": b"\x00\xff", "text": "λ🙂"}]
    class Native:
        finished = False
        def feed_frames(self, data: bytes) -> list[bytes]:
            assert data == b"chunk"
            return [msgspec.msgpack.encode(value) for value in expected]
        def finish(self) -> None:
            self.finished = True
        def feed(self, data: bytes) -> list[object]:
            raise AssertionError("graph conversion must not be used")
    native = Native()
    class Bridge:
        def wba_stream(self) -> Native:
            return native
        def wba_encode(self, value: object) -> bytes:
            raise AssertionError("no counting encode")
    with patch.object(codec, "_native", Bridge()):
        stream = codec.new_stream()
        assert list(stream.feed(b"chunk")) == expected
        stream.finish()
        assert native.finished


def test_native_selection_rejects_old_stream_instead_of_falling_back() -> None:
    class Old:
        def feed(self, data: bytes) -> list[object]:
            raise AssertionError("must not retry graph feed")
    class Bridge:
        def wba_stream(self) -> Old:
            return Old()
    with patch.object(codec, "_native", Bridge()):
        with pytest.raises(RuntimeError, match="lacks feed_frames"):
            codec.new_stream()


@pytest.mark.skipif(importlib.util.find_spec("mypyc") is None, reason="requires mypyc")
def test_compiled_wba_adapter_uses_native_frames(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import json
from pathlib import Path
import sys
from mypyc.build import mypycify
from setuptools import setup
repo, output = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(repo))
sys.path.insert(0, str(repo / "scripts"))
from mypyc_build_workflow import mypy_build_args
names = {"app.apps.code_te2.wba_pipe_codec", "app.libs.pipe_codec",
         "app.apps.code_te2.workbench_adapter_shell_manager"}
sources = [name.replace(".", "/") + ".py" for name in sorted(names)]
extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                     target_dir=str(output / "csrc"))
setup(name="wba-frame-fixture", ext_modules=extensions,
      script_args=["build_ext", "--build-lib", str(output / "lib"),
                   "--build-temp", str(output / "temp"), "-j", "2"])
(output / "manifest.json").write_text(json.dumps({
    "modules": {name: str(repo / (name.replace(".", "/") + ".py")) for name in names},
    "compiled_sources": sources}))
import probe_code_te2_mypyc as probe
isolated = output / "isolated"
isolated.mkdir()
probe._isolate(isolated)
from app.apps.code_te2.mypyc_overlay import install
install(str(repo), str(output))
from app.apps.code_te2 import wba_pipe_codec as codec
assert codec.__file__.endswith(".so"), codec.__file__
class Native:
    finished = False
    def feed_frames(self, data):
        return [data]
    def finish(self):
        self.finished = True
native = Native()
class Bridge:
    def wba_stream(self):
        return native
    def wba_encode(self, value):
        raise AssertionError("not used")
codec.configure_native(Bridge())
stream = codec.new_stream()
assert list(stream.feed(b"\x81\xa1x\x01")) == [{"x": 1}]
stream.finish()
assert native.finished
import asyncio
import msgspec
from app.apps.code_te2 import workbench_adapter_shell_manager as manager
assert manager.__file__.endswith(".so"), manager.__file__
async def check_consumer():
    queue = asyncio.Queue()
    reply = asyncio.get_running_loop().create_future()
    manager._rpc_pending[7] = reply
    task = asyncio.create_task(manager._stdout_reader_loop("codegen-probe", queue))
    try:
        queue.put_nowait(msgspec.msgpack.encode({"kind": "reply", "payload": {"id": 7, "result": {"ok": True}}}))
        assert await asyncio.wait_for(reply, 2) == {"id": 7, "result": {"ok": True}}
    finally:
        task.cancel()
        await task
asyncio.run(check_consumer())
print(codec.__file__)
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(repo), str(tmp_path)],
        cwd=repo, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        text=True, capture_output=True, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
