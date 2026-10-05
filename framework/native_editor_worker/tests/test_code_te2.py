"""Real backend in isolated roots; no shared TE2/FWS process is restarted."""
from __future__ import annotations

import json
import os
import py_compile
import queue
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import msgpack
import pytest
import socketio

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "framework/native_editor_worker/target/release/code-te2-worker"


@pytest.mark.parametrize('present', ['CODE_TE2_PYTHON_HOME', 'CODE_TE2_PYTHON_EXECUTABLE'])
def test_partial_interpreter_selection_fails_before_domain_start(present, tmp_path):
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('CODE_TE2_', 'PYTHON'))}
    env[present] = sys.base_prefix if present.endswith('HOME') else sys.executable
    result = subprocess.run([str(BINARY), str(REPO), '0'], env=env, cwd=tmp_path,
                            input=b'', capture_output=True, timeout=10)
    assert result.returncode != 0
    assert b'native Python selection requires both home and executable' in result.stderr
    assert not result.stdout


def test_private_python_ignores_host_paths_and_sites(tmp_path):
    source = tmp_path / 'private-source'
    module = source / 'app/apps/code_te2/native_worker.py'
    module.parent.mkdir(parents=True)
    cached_module = source / 'cache_probe.py'
    cached_module.write_text('raise RuntimeError("adjacent bytecode must never execute")\n')
    py_compile.compile(str(cached_module), doraise=True,
        invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
    cached_module.write_text('SAFE = True\n')
    module.write_text('import sys, json, importlib.util\n'
        'import cache_probe\n'
        'print("PRIVATE_PROBE=" + json.dumps({"path": sys.path, '
        '"isolated": sys.flags.isolated, "site": sys.flags.no_site, '
        '"bytecodeDisabled": sys.dont_write_bytecode, "cachePrefix": sys.pycache_prefix, '
        '"poison": importlib.util.find_spec("host_poison") is not None}), file=sys.stderr)\n')
    poison = tmp_path / 'host-site'
    poison.mkdir()
    (poison / 'host_poison.py').write_text('raise RuntimeError("must not import")')
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('CODE_TE2_', 'PYTHON'))}
    env.update(CODE_TE2_PYTHON_HOME=sys.base_prefix,
        CODE_TE2_PYTHON_EXECUTABLE=sys.executable, CODE_TE2_PYTHON_ISOLATED='1',
        CODE_TE2_PYTHON_SOURCE=str(source), PYTHONPATH=str(poison),
        PYTHONHOME=str(poison), PYTHONUSERBASE=str(poison), VIRTUAL_ENV=str(poison))
    result = subprocess.run([str(BINARY), str(REPO), '0'], env=env,
        input=b'', capture_output=True, timeout=10)
    # Deliberately incomplete domain fails after its import-time probe.
    assert result.returncode != 0
    report = next(line.removeprefix('PRIVATE_PROBE=')
        for line in result.stderr.decode().splitlines() if line.startswith('PRIVATE_PROBE='))
    values = json.loads(report)
    assert values['isolated'] == 1 and values['site'] == 1
    assert values['poison'] is False
    assert values['bytecodeDisabled'] is True
    assert values['cachePrefix'] == str(Path(sys.base_prefix) / '.disabled-bytecode-cache')
    assert str(poison) not in values['path']
    assert str(REPO) not in values['path']
    assert values['path'][0] == str(source)


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
    env.update(CODE_TE2_PYTHON_HOME=sys.base_prefix, CODE_TE2_PYTHON_EXECUTABLE=sys.executable)
    for name in ("CONFIG", "DATA", "CACHE", "RUNTIME"):
        env[f"TE2_{name}_HOME"] = str(tmp_path / name.lower())
    process = subprocess.Popen([str(BINARY), str(REPO), str(port)], cwd=tmp_path,
                               env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    logs = []
    lock = threading.Lock()
    ready = threading.Event()

    def log_reader():
        for line in process.stderr:
            logs.append(line.decode(errors="replace"))

    def framework_peer():
        decoder = msgpack.Unpacker(raw=False)
        try:
            while data := process.stdout.read1(65536):
                decoder.feed(data)
                for request in decoder:
                    if request.get("method") == "app.readiness":
                        assert request["kind"] == "notification"
                        assert request["targetName"] == "framework.rust"
                        assert request["params"] == {"status": "ready", "phase": "serving"}
                        ready.set()
                        continue
                    if request.get("kind") != "request":
                        continue
                    # The empty test project needs no real fs/git/shell work.
                    result = {}
                    method = request.get("method", "")
                    params = request.get("params") or {}
                    if method == "fs.listDirectory":
                        result = {"dto": "FsDirectoryListing", "version": 1,
                                  "root": params["root"], "path": params["path"],
                                  "resolvedPath": params["path"], "entries": []}
                    elif method == "git.historyGraph.open":
                        result = {"dto": "GitHistoryOpened", "version": 1, "sessionId": params["sessionId"],
                                  "snapshot": {"dto": "GitHistorySnapshot", "version": 1,
                                    "snapshotId": "a" * 64, "headId": "b" * 40, "headRef": "refs/heads/main",
                                    "refs": [{"name": "refs/heads/main", "commitId": "b" * 40}]}}
                    elif method == "git.historyGraph.next":
                        result = {"dto": "GitHistoryPageResult", "version": 1, "sessionId": params["sessionId"],
                                  "page": {"dto": "GitHistoryPage", "version": 1,
                                    "snapshotId": "a" * 64, "offset": params["offset"], "complete": True,
                                    "commits": [{"id": "b" * 40, "parentIds": ["c" * 40],
                                                 "subject": "History bridge regression", "author": "test", "timestamp": 1}]}}
                    elif method == "git.historyGraph.files":
                        result = {"dto": "GitHistoryFilesResult", "version": 1, "sessionId": params["sessionId"],
                                  "page": {"dto": "GitHistoryFilesPage", "version": 1,
                                    "commitId": params["commitId"], "parentId": "c" * 40, "offset": 0,
                                    "nextOffset": None, "totalFiles": 1,
                                    "files": [{"index": 0, "status": "modified", "oldPath": "test.py",
                                               "newPath": "test.py", "oldBlob": "d" * 40, "newBlob": "e" * 40,
                                               "counts": {"state": "ready", "additions": 2, "deletions": 1}}]}}
                    reply = {"jsonrpc": "2.0", "protocolVersion": 1, "kind": "response",
                             "id": request["id"], "result": result}
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
        assert ready.wait(3), "worker did not publish readiness over its pipe"
        assert not any("readiness post" in line for line in logs)
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
        boot = msgpack.packb({"jsonrpc": "2.0", "id": "boot", "method": "ui.host.bootSnapshot.get",
                             "params": {"clientInstanceId": "client_nativetest000001"}}, use_bin_type=True)
        boot_reply = msgpack.unpackb(client.call("rpc", boot, namespace="/ui_ipc", timeout=15), raw=False)
        assert "result" in boot_reply, (boot_reply, "".join(logs))
        assert boot_reply["result"]["ok"] is True
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


@pytest.mark.parametrize("transport", ["polling", "websocket"])
def test_history_dataclass_tuples_reach_explorer(native_app, transport):
    url, _, _, logs = native_app
    client = socketio.Client(reconnection=False)
    events = queue.Queue()
    client.on("rpc.notify", lambda data: events.put(msgpack.unpackb(data, raw=False)), namespace="/rpc/explorer")
    try:
        client.connect(url + "?client_instance_id=client_nativetest000001&client_role=primary",
                       namespaces=["/rpc/explorer"], auth={"rpcCodec": "msgpack-v1"}, transports=[transport])
        reply = client.call("rpc", msgpack.packb({"jsonrpc": "2.0", "id": "history",
                            "method": "explorer.history.open", "params": {}}), namespace="/rpc/explorer", timeout=10)
        assert "result" in msgpack.unpackb(reply, raw=False), logs
        received = {}
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not {"snapshot", "page", "listing"} <= received.keys():
            try:
                event = events.get(timeout=0.2)
            except queue.Empty:
                continue
            if event.get("method") == "explorer.list.updated":
                received["listing"] = event["params"]
            if event.get("method") == "explorer.history.updated":
                payload = event["params"]
                received[payload["kind"]] = payload
        assert {"snapshot", "page", "listing"} <= received.keys(), (received, "".join(logs))
        assert received["snapshot"]["snapshot"]["refs"] == [{"name": "refs/heads/main", "commit_id": "b" * 40}]
        assert received["page"]["page"]["commits"][0]["parents"] == ["c" * 40]
        files_reply = client.call("rpc", msgpack.packb({"jsonrpc": "2.0", "id": "files",
            "method": "explorer.history.files", "params": {"generation": received["page"]["generation"],
            "commitId": "b" * 40, "offset": 0}}), namespace="/rpc/explorer", timeout=10)
        decoded = msgpack.unpackb(files_reply, raw=False)
        assert decoded["result"]["page"]["files"][0]["new_path"] == "test.py", decoded
        assert "unsupported service value" not in "".join(logs)
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


@pytest.mark.parametrize("transport", ["polling", "websocket"])
def test_terminal_namespace_connect_does_not_create_shell(native_app, transport):
    url, _, _, logs = native_app
    client = socketio.Client(reconnection=False)
    try:
        client.connect(url, namespaces=["/terminal"], transports=[transport], wait_timeout=15)
        # Unknown events are ignored; simply opening the lane must not launch a PTY.
        assert client.call("not_a_terminal_command", {}, namespace="/terminal", timeout=5) is None
        assert "[terminal_ws] connect" in "".join(logs)
    finally:
        client.disconnect()


@pytest.mark.parametrize("transport", ["polling", "websocket"])
def test_drawer_native_pty_checkpoint_resize_and_close(native_app, transport):
    url, _, _, logs = native_app
    client = socketio.Client(reconnection=False)
    registered = queue.Queue()
    errors = []
    client.on("terminal:shell_id", registered.put, namespace="/terminal")
    client.on("terminal:error", errors.append, namespace="/terminal")
    shell_id = None
    def request(method, **params):
        reply = client.call("terminal:request", {"id": method, "method": method, "params": params},
                            namespace="/terminal", timeout=10)
        assert reply["ok"], (reply, logs)
        return reply["result"]
    try:
        client.connect(url, namespaces=["/terminal"], transports=[transport], wait_timeout=15)
        client.call("terminal:register", {"shell_id": "auto", "client_id": "drawer-test"}, namespace="/terminal", timeout=10)
        try:
            shell_id = registered.get(timeout=10)["shell_id"]
        except queue.Empty:
            pytest.fail(f"Terminal registration failed: {errors!r}\n{''.join(logs)}")
        # This fixture deliberately has no FWS controller. Its observer's
        # disconnected warning is expected; log checkpoints are tested directly.
        assert all(error.get("source") == "fws_terminal_log_stream" for error in errors), (errors, logs)
        client.call("terminal:resize", {"shell_id": shell_id, "cols": 91, "rows": 37}, namespace="/terminal", timeout=10)
        client.call("terminal:input", {"shell_id": shell_id, "data": "printf 'native-%s\\n' drawer; stty size\n"}, namespace="/terminal", timeout=10)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            checkpoint = request("shell.history", shell_id=shell_id, cols=91, rows=37)
            if "native-drawer" in checkpoint["checkpoint_ansi"] and "37 91" in checkpoint["checkpoint_ansi"]:
                break
            time.sleep(.05)
        else:
            pytest.fail(f"Missing PTY output: {checkpoint!r}\n{''.join(logs)}")
        assert checkpoint["output_offset"] > 0
        request("shell.remove", shell_id=shell_id)
        shell_id = None
    finally:
        if shell_id is not None and client.connected:
            request("shell.remove", shell_id=shell_id)
        client.disconnect()
