from __future__ import annotations

import asyncio
import copy
from pathlib import Path
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest

from app.apps.code_te2.host.sidebar_app_backend import open_sidebar_app
from app.apps.code_te2.ui_ipc import sidebar_ws, sidebar_window_state
from app.apps.code_te2.explorer.services import file_ops
from app.libs import pipe_runtime


class Store:
    def __init__(self):
        self.data = {"ui": {"sidebarWindowState": {"version": 2, "slots": {}}}}
        self.writes = 0

    def get_preferences(self):
        return copy.deepcopy(self.data)

    def update_preferences(self, *, ui=None, **kwargs):
        self.data["ui"].update(copy.deepcopy(ui or {}))
        self.writes += 1
        return copy.deepcopy(self.data)


@pytest.fixture
def environment(monkeypatch, tmp_path):
    store = Store()
    manifest = {"id": "file_explorer", "name": "File Explorer", "sidebar_state": {
        "enabled": True, "base_url": "/app/file_explorer", "kind": "path",
        "console_worker_prefix": "file_explorer", "url_state": {"param": "path"},
    }}
    monkeypatch.setattr(sidebar_window_state, "_iter_app_manifests", lambda: iter([manifest]))
    monkeypatch.setattr(sidebar_window_state, "get_preferences_store", lambda: store)
    monkeypatch.setattr(sidebar_ws, "_registered_hosts", {"one", "two"})
    monkeypatch.setattr(sidebar_ws, "_client_ids_by_sid", {"one": "client_111111111111", "two": "client_222222222222"})
    monkeypatch.setattr(sidebar_ws, "_client_active_windows", {"client_222222222222": "keep-other-client"})
    monkeypatch.setattr(sidebar_ws, "_client_active_shortcuts", {})
    monkeypatch.setattr(sidebar_ws, "_emit_sidebar_window_focused_global", AsyncMock())
    publish = AsyncMock()
    monkeypatch.setattr(sidebar_ws, "publish_sidebar_window_state_changed", publish)
    monkeypatch.setattr(file_ops, "get_project_root", lambda: tmp_path)
    from app.apps.code_te2.worker_services import event_bus
    monkeypatch.setattr(event_bus, "_current_project_root", str(tmp_path))
    monkeypatch.setattr(event_bus, "_project_generation", 1)
    launch = AsyncMock(return_value={"url": "/app/file_explorer?path=%2Fproject%2Fspace+name"})
    monkeypatch.setattr(pipe_runtime, "call_async", launch)
    return store, launch, publish, tmp_path


def invoke(root, **kwargs):
    return asyncio.run(open_sidebar_app(app_id="file_explorer", params={"path": "/project/space name"},
        client_id="client_111111111111", operation_id="operation", expected_project_root=root, **kwargs))


def test_launches_over_pipe_and_creates_distinct_stateful_slots_for_initiator(environment):
    store, launch, publish, root = environment
    first, second = invoke(root), invoke(root)
    assert first["window"]["host_id"] != second["window"]["host_id"]
    for result in (first, second):
        query = parse_qs(urlsplit(result["window"]["url"]).query)
        assert query["path"] == ["/project/space name"]
        assert query["embed"] == ["1"]
        assert query["te2_host_id"] == [result["window"]["host_id"]]
    assert launch.call_args.args == ("app.open", {"appId": "file_explorer", "params": {"path": "/project/space name"}})
    assert launch.call_args.kwargs["target_name"] == "framework.rust"
    assert launch.call_args.kwargs["op_id"] == "operation"
    assert sidebar_ws._client_active_windows["client_222222222222"] == "keep-other-client"
    assert publish.call_args.kwargs["activated_scope"] == "client"
    assert publish.call_args.kwargs["client_id"] == "client_111111111111"
    assert publish.call_args.kwargs["activated"]["revealSidebar"] is True
    assert len(second["state"]["slots"]) == 2


@pytest.mark.parametrize("failure", ["launch", "disconnect", "project-switch", "generation-change", "invalid-url"])
def test_failed_or_stale_launch_does_not_commit_slot_or_retry(environment, monkeypatch, failure):
    store, launch, publish, root = environment
    async def execute(*args, **kwargs):
        if failure == "launch":
            raise RuntimeError("outcome unknown")
        if failure == "disconnect":
            sidebar_ws._registered_hosts.clear()
        if failure == "project-switch":
            monkeypatch.setattr(file_ops, "get_project_root", lambda: root / "another-project")
        if failure == "generation-change":
            from app.apps.code_te2.worker_services import event_bus
            monkeypatch.setattr(event_bus, "_project_generation", event_bus._project_generation + 1)
        return {"url": "https://untrusted.example/" if failure == "invalid-url" else "/app/file_explorer"}
    launch.side_effect = execute
    with pytest.raises((RuntimeError, ValueError)):
        invoke(root)
    assert launch.await_count == 1
    assert store.writes == 0
    publish.assert_not_awaited()


def test_unknown_or_disconnected_caller_does_not_launch(environment):
    store, launch, publish, root = environment
    with pytest.raises(ValueError, match="unknown"):
        asyncio.run(open_sidebar_app(app_id="missing", params={}, client_id="client_111111111111", operation_id="operation"))
    sidebar_ws._registered_hosts.clear()
    with pytest.raises(ValueError, match="not connected"):
        invoke(root)
    launch.assert_not_awaited()
    assert store.writes == 0


def test_explorer_handler_uses_connection_identity_and_validates_directory(monkeypatch, tmp_path):
    from app.apps.code_te2.explorer.context import ExplorerFileTreeHandlerContext
    from app.apps.code_te2.explorer.handlers.app_intents import handle_open_in_file_explorer
    from app.apps.code_te2.host import sidebar_app_backend
    from app.apps.code_te2.explorer.transport.rpc_contract import dispatcher_message_type_from_rpc_method
    assert dispatcher_message_type_from_rpc_method("explorer.directory.openInFileExplorer") == "explorer:openInFileExplorer"
    root = tmp_path / "project"; root.mkdir()
    (root / "nested").mkdir()
    (root / "file").write_text("text")
    target = tmp_path / "outside"; target.mkdir()
    (root / "escape").symlink_to(target)
    callback = AsyncMock()
    context = ExplorerFileTreeHandlerContext(root, "connection-client", callback, callback, callback, callback)
    launch = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(sidebar_app_backend, "open_sidebar_app", launch)
    asyncio.run(handle_open_in_file_explorer(context, {"rel": "nested", "clientId": "forged"}, "rpc-id"))
    assert launch.call_args.kwargs["client_id"] == "connection-client"
    assert launch.call_args.kwargs["params"] == {"path": str(root / "nested")}
    assert launch.call_args.kwargs["operation_id"] == "rpc-id"
    for rel in ("file", "../outside", "escape"):
        launch.reset_mock()
        with pytest.raises(ValueError):
            asyncio.run(handle_open_in_file_explorer(context, {"rel": rel}, "rpc-id"))
        launch.assert_not_awaited()


def test_embedded_pipe_opens_app_for_validated_source_and_rechecks_presentation(environment, monkeypatch):
    from app.apps.code_te2.app_intent_pipe import dispatch_app_intent
    from app.libs.pipe_protocol import PipeEnvelope
    store, launch, publish, root = environment
    context = {"clientId": "client_111111111111", "hostId": "source", "presentationId": "present"}
    monkeypatch.setattr(sidebar_ws, "_client_presentations", {("client_111111111111", "source"): "present"})
    sidebar_ws._client_active_windows["client_111111111111"] = "source"
    original_state = sidebar_window_state.get_sidebar_window_state
    monkeypatch.setattr(sidebar_window_state, "get_sidebar_window_state", lambda: {
        **original_state(), "slots": {"source": {"app_id": "file_explorer"}},
    })
    async def launch_and_replace(*args, **kwargs):
        sidebar_ws._client_presentations[("client_111111111111", "source")] = "recreated"
        return {"url": "/app/file_explorer"}
    launch.side_effect = launch_and_replace
    envelope = PipeEnvelope(kind="request", id="request", op_id="operation", params={
        "intent": "sidebar.openApp", "context": context,
        "payload": {"appId": "file_explorer", "params": {"path": "/directory"}},
        "source": {"appId": "file_explorer", "shellId": "owned"},
    })
    with pytest.raises(ValueError, match="stale"):
        asyncio.run(dispatch_app_intent(envelope))
    assert launch.await_count == 1
    assert store.writes == 0
    publish.assert_not_awaited()
