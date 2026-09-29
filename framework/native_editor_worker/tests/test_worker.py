"""Subprocess tests; never starts TE2, WBA or a live framework shell."""
from __future__ import annotations

import os
from pathlib import Path
import queue
import subprocess
import threading

import msgpack
import pytest

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("TE2_NATIVE_WORKER_BIN", ROOT / "target/debug/te2-native-editor-worker"))


class Worker:
    def __init__(self, module="fixture_service"):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "TE_", "TE2_", "FRAMEWORK_SHELLS_"))}
        self.process = subprocess.Popen(
            [str(BINARY), str(ROOT / "tests"), module], env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.messages = queue.Queue()
        self.errors = bytearray()
        self.decode_error = None
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.logger = threading.Thread(target=self._logs, daemon=True)
        self.reader.start()
        self.logger.start()

    def _read(self):
        decoder = msgpack.Unpacker(raw=False)
        try:
            while data := self.process.stdout.read1(65536):
                decoder.feed(data)
                for value in decoder:
                    self.messages.put(value)
        except Exception as error:
            self.decode_error = error

    def _logs(self):
        while data := self.process.stderr.read1(4096):
            self.errors.extend(data)

    def send(self, value):
        self.raw(msgpack.packb(value, use_bin_type=True))

    def raw(self, data):
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def request(self, method="echo", params=None, id="test", **extra):
        self.send({"jsonrpc": "2.0", "protocolVersion": 1, "kind": "request",
                   "id": id, "method": method, "params": params,
                   "originNid": 1, "originName": "framework.rust", **extra})

    def receive(self):
        try:
            return self.messages.get(timeout=5)
        except queue.Empty:
            pytest.fail(f"No reply: rc={self.process.poll()} stderr={self.errors.decode(errors='replace')} decoder={self.decode_error}")

    def finish(self):
        self.process.stdin.close()
        code = self.process.wait(timeout=6)
        self.reader.join(timeout=1)
        self.logger.join(timeout=1)
        assert self.decode_error is None
        return code

    def cleanup(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()


@pytest.fixture
def worker():
    assert BINARY.is_file(), "build the standalone crate first"
    instance = Worker()
    try:
        yield instance
    finally:
        instance.cleanup()


def test_values_identity_service_loading_and_eof(worker):
    value = {"binary": b"\x00\xff\n", "utf8": "λ 🐍", "null": None, "bool": True,
             "ints": [-2**63, 2**64-1], "float": 1.25, "list": [{"a": 1}]}
    worker.request(params=value, projectGeneration=8, workspaceRoot="/project", correlationId="c", opId="o")
    reply = worker.receive()
    assert reply["result"] == value
    assert {k: reply[k] for k in ("projectGeneration", "workspaceRoot", "correlationId", "opId")} == {
        "projectGeneration": 8, "workspaceRoot": "/project", "correlationId": "c", "opId": "o"}
    worker.request("inspect")
    assert worker.receive()["result"]["forbiddenImports"] == []
    assert worker.finish() == 0
    assert b"fixture imported" in worker.errors


def test_nested_call_replies_bypass_blocked_dispatch_and_late_duplicates(worker):
    worker.request("nested", {"binary": b"\xff"})
    outbound = worker.receive()
    assert outbound["method"] == "service.test"
    assert outbound["targetName"] == "framework.rust"
    response = {"kind": "response", "id": outbound["id"], "result": outbound["params"]}
    worker.send(response)
    worker.send(response)
    assert worker.receive()["result"] == {"binary": b"\xff"}
    worker.request(params="still alive")
    assert worker.receive()["result"] == "still alive"
    assert worker.finish() == 0


def test_invalid_schema_wrong_identity_and_disabled_diagnostics(worker):
    worker.send({"jsonrpc": "invalid"})
    assert worker.receive()["error"]["code"] == "protocol.invalidFrame"
    worker.request(targetNid=123)
    assert worker.receive()["error"]["code"] == "protocol.wrongTarget"
    worker.request("runtime.debug.eval")
    assert worker.receive()["error"]["code"] == "runtimeDebug.disabled"
    worker.request(params="valid after errors")
    assert worker.receive()["result"] == "valid after errors"


def test_notifications_are_ordered_and_handler_errors_are_replies(worker):
    worker.send({"kind": "notification", "method": "notify", "params": "event"})
    worker.request("inspect")
    assert worker.receive()["result"]["events"] == ["event"]
    for method in ("raise", "unsupported", "cycle"):
        worker.request(method)
        assert worker.receive()["error"]["code"] == "protocol.dispatchFailed"
    assert worker.finish() == 0


def test_timeout_and_late_reply(worker):
    worker.request("timeout")
    outbound = worker.receive()
    assert worker.receive()["error"]["code"] == "protocol.dispatchFailed"
    worker.send({"kind": "response", "id": outbound["id"], "result": "late"})
    worker.request(params="next")
    assert worker.receive()["result"] == "next"


def test_eof_fails_nested_waiter(worker):
    worker.request("nested")
    assert worker.receive()["kind"] == "request"
    assert worker.finish() == 0
    assert worker.messages.get_nowait()["error"]["code"] == "protocol.dispatchFailed"


@pytest.mark.parametrize("raw", [b"\x81", b"\xc1", b"\xdf\xff\xff\xff\xff"])
def test_corruption_or_truncation_is_fatal(worker, raw):
    worker.raw(raw)
    assert worker.finish() != 0


def test_truncated_eof_repeatedly_exits_with_transport_failure():
    # Catch process-exit ordering regressions in addition to the deterministic
    # native test. No live framework or persistent state is involved.
    for _ in range(30):
        instance = Worker()
        try:
            instance.raw(b"\x81")
            assert instance.finish() == 1
            assert b"input failed" in instance.errors
        finally:
            instance.cleanup()


def test_overload_rejects_new_requests_but_nested_reply_still_arrives(worker):
    worker.request("nested", id="held")
    outbound = worker.receive()
    for i in range(70):
        worker.request(params=i, id=str(i))
    # Dispatcher is held: bounded 64-entry queue must reject at least six.
    errors = [worker.receive() for _ in range(6)]
    assert all(e["error"]["code"] == "pipe.overloaded" for e in errors)
    worker.send({"kind": "response", "id": outbound["id"], "result": "released"})
    replies = [worker.receive() for _ in range(65)]
    assert replies[0]["id"] == "held"
    assert [reply["result"] for reply in replies[1:]] == list(range(64))
    assert worker.finish() == 0


def test_missing_service_fails_before_admission():
    worker = Worker("module_that_does_not_exist")
    try:
        assert worker.finish() != 0
        assert b"initialization failed" in worker.errors
    finally:
        worker.cleanup()


def test_fragmented_cross_language_fixture(worker):
    fixture = ROOT.parents[1] / "tests/fixtures/framework_pipe_request.msgpack.hex"
    request = msgpack.unpackb(bytes.fromhex(fixture.read_text()), raw=False)
    request["method"] = "echo"
    request["targetNid"] = 2100
    request["targetName"] = "service.app"
    encoded = msgpack.packb(request, use_bin_type=True)
    for offset in range(0, len(encoded), 3):
        worker.raw(encoded[offset:offset+3])
    reply = worker.receive()
    assert reply["id"] == "cross-language"
    assert reply["result"] == request["params"]


def test_oversized_reply_is_fatal_without_partial_frame(worker):
    worker.request("oversized")
    assert worker.finish() != 0
    assert worker.messages.empty()


def test_shutdown_deadline_handles_blocked_service(worker):
    worker.request("hang")
    assert worker.finish() == 2
    assert b"shutdown deadline exceeded" in worker.errors


def test_wrong_reply_target_does_not_consume_pending_call(worker):
    worker.request("nested")
    outgoing = worker.receive()
    worker.send({"kind": "response", "id": outgoing["id"], "targetName": "wrong", "result": "wrong"})
    worker.send({"kind": "response", "id": outgoing["id"], "targetName": "service.app", "result": "right"})
    assert worker.receive()["result"] == "right"


def test_service_retaining_bridge_does_not_hold_writer_open(worker):
    worker.request("retain")
    assert worker.receive()["result"] is True
    assert worker.finish() == 0
