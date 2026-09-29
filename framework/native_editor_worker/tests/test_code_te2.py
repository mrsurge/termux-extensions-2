"""Real backend in isolated roots; no shared TE2/FWS process is restarted."""
from __future__ import annotations

import json
import os
import queue
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

import msgpack
import pytest
import socketio

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "framework/native_editor_worker/target/release/code-te2-worker"


@pytest.fixture
def native_app(tmp_path):
    assert BINARY.exists(), "build code-te2-worker first"
    config = tmp_path / "config/code_te2"
    config.mkdir(parents=True)
    (config / "intelligence.json").write_text(json.dumps({"version": 1, "webWorkersEnabled": True, "codeServerInstallation": {"installed": False}}))
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if not k.startswith(("TE_", "TE2_", "FRAMEWORK_SHELLS_", "PYTHON", "XDG_"))}
    env.update(HOME=str(tmp_path), VIRTUAL_ENV=str(REPO / ".jitenv"), TE_FRAMEWORK_URL="http://127.0.0.1:1", TE_APP_ID="code_te2")
    for name in ("CONFIG", "DATA", "CACHE", "RUNTIME"):
        env[f"TE2_{name}_HOME"] = str(tmp_path / name.lower())
    process = subprocess.Popen([str(BINARY), str(REPO), str(port)], cwd=tmp_path,
                               env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    logs = []
    lock = threading.Lock()

    def log_reader():
        for line in process.stderr:
            logs.append(line.decode(errors="replace"))

    def framework_peer():
        decoder = msgpack.Unpacker(raw=False)
        try:
            while data := process.stdout.read1(65536):
                decoder.feed(data)
                for request in decoder:
                    if request.get("kind") != "request":
                        continue
                    # The empty test project needs no real fs/git/shell work.
                    reply = {"jsonrpc": "2.0", "protocolVersion": 1, "kind": "response",
                             "id": request["id"], "result": {}}
                    with lock:
                        process.stdin.write(msgpack.packb(reply, use_bin_type=True))
                        process.stdin.flush()
        except (OSError, ValueError):
            pass

    threading.Thread(target=log_reader, daemon=True).start()
    threading.Thread(target=framework_peer, daemon=True).start()
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail("Native worker exited:\n" + "".join(logs))
            try:
                with urllib.request.urlopen(url + "/status", timeout=0.2) as response:
                    assert json.load(response)["ok"]
                    break
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        else:
            pytest.fail("Native worker not ready:\n" + "".join(logs))
        yield url, process, tmp_path, logs
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()


def test_real_http_and_path_containment(native_app):
    url, process, state, logs = native_app
    with urllib.request.urlopen(url + "/static/icons/CODE_TE2.png") as response:
        assert response.headers["content-type"] == "image/png"
        assert response.read().startswith(b"\x89PNG")
    for path in ("/static/%2e%2e/main.py", "/static/%2fetc/passwd", "/unknown"):
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url + path)
        assert error.value.code == 404
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(urllib.request.Request(url + "/status", method="HEAD"))
    assert error.value.code == 405
    assert error.value.headers["allow"] == "GET"
    assert (state / "config/code_te2/preferences.json").exists()
    with urllib.request.urlopen(url + "/__te2/runtime/loop") as response:
        assert json.load(response)["data"]["app_id"] == "code_te2"
    preflight = urllib.request.Request(url + "/socket.io/?EIO=4&transport=polling", method="OPTIONS",
                                      headers={"Origin": "http://127.0.0.1:12345", "Access-Control-Request-Headers": "content-type"})
    with urllib.request.urlopen(preflight) as response:
        assert response.status == 204
        assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:12345"
        assert response.headers["Access-Control-Allow-Headers"] == "content-type"


@pytest.mark.parametrize("transport", ["polling", "websocket"])
def test_real_host_rpc_binary_ack(native_app, transport):
    url, process, state, logs = native_app
    client = socketio.Client(reconnection=False)
    errors = []
    notifications = []
    client.on("connect_error", lambda data: errors.append(data), namespace="/ui_ipc")
    client.on("rpc.notify", lambda data: notifications.append(data), namespace="/ui_ipc")
    try:
        try:
            client.connect(url + "?client_instance_id=client_nativetest000001&client_role=primary", namespaces=["/ui_ipc"],
                           auth={"rpcCodec": "msgpack-v1"}, transports=[transport], wait_timeout=15)
        except socketio.exceptions.ConnectionError:
            pytest.fail(f"Connect failed: {errors}\n{''.join(logs)}")
        payload = msgpack.packb({"jsonrpc": "2.0", "id": "test", "method": "ui.host.projects.list", "params": {}}, use_bin_type=True)
        reply = client.call("rpc", payload, namespace="/ui_ipc", timeout=15)
        assert isinstance(reply, bytes), (reply, "".join(logs))
        decoded = msgpack.unpackb(reply, raw=False)
        assert decoded["id"] == "test", decoded
        assert "result" in decoded, decoded
        update = msgpack.packb({"jsonrpc": "2.0", "id": "update", "method": "ui.host.editorPreference.update",
                               "params": {"key": "wordWrap", "value": True}}, use_bin_type=True)
        updated = msgpack.unpackb(client.call("rpc", update, namespace="/ui_ipc", timeout=15), raw=False)
        assert "result" in updated, updated
        persisted = json.loads((state / "config/code_te2/preferences.json").read_text())
        assert persisted["editor"]["wordWrap"] is True
        # Force the long-poll waiting path repeatedly, not just its buffered path.
        for _ in range(10):
            time.sleep(0.02)
            assert isinstance(client.call("rpc", payload, namespace="/ui_ipc", timeout=5), bytes)
        assert notifications, logs
        assert all(isinstance(item, bytes) for item in notifications)
        assert all(msgpack.unpackb(item, raw=False)["jsonrpc"] == "2.0" for item in notifications)
    finally:
        client.disconnect()


@pytest.mark.parametrize("namespace", ["/rpc/editor", "/rpc/explorer"])
def test_real_domain_connect_and_binary_error(native_app, namespace):
    url, _, _, logs = native_app
    client = socketio.Client(reconnection=False)
    received = []
    client.on("rpc", lambda data: received.append(msgpack.unpackb(data, raw=False)), namespace=namespace)
    try:
        client.connect(url + "?client_instance_id=client_nativetest000001&client_role=primary",
                       namespaces=[namespace], auth={"rpcCodec": "msgpack-v1"},
                       transports=["websocket"], wait_timeout=15)
        payload = msgpack.packb({"jsonrpc": "2.0", "id": "unknown", "method": "nonexistent.method", "params": {}}, use_bin_type=True)
        if namespace == "/rpc/explorer":
            reply = msgpack.unpackb(client.call("rpc", payload, namespace=namespace, timeout=5), raw=False)
        else:
            client.emit("rpc", payload, namespace=namespace)
            deadline = time.monotonic() + 5
            while not any(item.get("id") == "unknown" for item in received) and time.monotonic() < deadline:
                time.sleep(0.01)
            reply = next((item for item in received if item.get("id") == "unknown"), {})
        assert reply.get("id") == "unknown" and "error" in reply, (reply, logs)
    finally:
        client.disconnect()


def test_rejects_missing_codec(native_app):
    url, *_ = native_app
    client = socketio.Client(reconnection=False)
    try:
        with pytest.raises(socketio.exceptions.ConnectionError):
            client.connect(url + "?client_instance_id=client_nativetest000001", namespaces=["/ui_ipc"], transports=["polling"], wait_timeout=5)
    finally:
        client.disconnect()


def test_real_worker_truncated_pipe_is_fatal(native_app):
    _, process, _, logs = native_app
    process.stdin.write(b"\x81")
    process.stdin.flush()
    process.stdin.close()
    assert process.wait(timeout=10) != 0, logs


@pytest.mark.parametrize("transport", ["polling", "websocket"])
@pytest.mark.parametrize("namespace", ["/rpc/editor", "/rpc/explorer", "/ui_ipc"])
def test_native_rpc_rejects_bad_bytes_and_keeps_domain_validation(native_app, transport, namespace):
    url, _, _, logs = native_app
    client = socketio.Client(reconnection=False)
    received = queue.Queue()
    client.on("rpc", lambda data: received.put(data), namespace=namespace)

    def request(payload):
        if namespace != "/rpc/editor":
            reply = client.call("rpc", payload, namespace=namespace, timeout=5)
        else:
            client.emit("rpc", payload, namespace=namespace)
            deadline = time.monotonic() + 5
            while True:
                reply = received.get(timeout=max(0.01, deadline - time.monotonic()))
                decoded = msgpack.unpackb(reply, raw=False)
                if "error" in decoded:
                    break
        assert isinstance(reply, bytes), (reply, logs)
        return msgpack.unpackb(reply, raw=False)

    try:
        client.connect(url + "?client_instance_id=client_nativetest000001&client_role=primary",
                       namespaces=[namespace], auth={"rpcCodec": "msgpack-v1"},
                       transports=[transport], wait_timeout=15)
        for payload, message in [({"jsonrpc": "2.0"}, "binary_rpc_payload_required"),
                                 (b"\xc1", "invalid_msgpack_payload"),
                                 (b"\x81", "invalid_msgpack_payload"),
                                 (b"\xc0\xc0", "invalid_msgpack_payload"),
                                 (b"\xc6\xff\xff\xff\xff", "invalid_msgpack_payload")]:
            reply = request(payload)
            assert reply == {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": message}}
            assert client.connected
        # Valid MessagePack with invalid RPC shape still reaches Python's existing validator.
        assert request(msgpack.packb({}))["error"]["code"] == -32600
        reply = request(msgpack.packb({"jsonrpc": "2.0", "id": "unknown", "method": "nonexistent.method", "params": {}}, use_bin_type=True))
        assert "error" in reply and reply["error"]["code"] != -32700, reply
    finally:
        client.disconnect()


def test_sidebar_rpc_remains_structured_not_frontend_messagepack(native_app):
    url, *_ = native_app
    client = socketio.Client(reconnection=False)
    try:
        client.connect(url, namespaces=["/sidebar_ipc"], transports=["websocket"], wait_timeout=15)
        reply = client.call("rpc", {"jsonrpc": "2.0", "id": "unknown", "method": "nonexistent.method", "params": {}},
                            namespace="/sidebar_ipc", timeout=5)
        assert isinstance(reply, dict) and "error" in reply, reply
    finally:
        client.disconnect()
