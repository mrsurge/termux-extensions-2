"""Exercise the compiled reader cleanup without a shared worker or shell."""
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.skipif(not os.environ.get("CODE_TE2_MYPYC_DIR"), reason="compiled overlay required")
def test_compiled_reader_releases_after_pending_read_error():
    root = Path(__file__).resolve().parents[3]
    code = r'''
import asyncio
import os
import threading
from pathlib import Path
from app.apps.code_te2.mypyc_overlay import install
install(str(Path.cwd()), os.environ["CODE_TE2_MYPYC_DIR"])
from app.apps.code_te2.native_shells import OutputReader
import app.apps.code_te2.native_shells as module
assert module.__file__.endswith(".so"), module.__file__

class Bridge:
    def __init__(self):
        self.started = threading.Event()
        self.cancelled = threading.Event()
        self.releases = []
    def shell_read(self, token):
        self.started.set()
        assert self.cancelled.wait(5)
        raise RuntimeError("closed intelligence reader")
    def shell_unsubscribe(self, token):
        self.cancelled.set()
    def shell_release(self, token):
        self.releases.append(token)

async def run():
    loop = asyncio.get_running_loop()
    errors = []
    loop.set_exception_handler(lambda loop, context: errors.append(context))
    bridge = Bridge()
    reader = OutputReader(bridge, 17)
    consumer = asyncio.create_task(reader.get())
    assert await asyncio.to_thread(bridge.started.wait, 5)
    consumer.cancel()
    await asyncio.gather(consumer, return_exceptions=True)
    await reader.close()
    await reader.close()
    await asyncio.sleep(0)
    assert bridge.releases == [17], bridge.releases
    assert reader.pending is None
    assert errors == [], errors

asyncio.run(run())
'''
    result = subprocess.run([sys.executable, "-B", "-c", code], cwd=root,
                            capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
