from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.apps.code_te2.host.terminal_intent_backend import open_directory_terminal
from app.apps.code_te2.explorer.services import file_ops
from app.apps.code_te2.ui_ipc import sidebar_ws, notifications
from app.apps.code_te2 import terminal_backend


@pytest.fixture
def environment(monkeypatch, tmp_path):
    from app.apps.code_te2.worker_services import event_bus
    monkeypatch.setattr(file_ops, "get_project_root", lambda: tmp_path)
    monkeypatch.setattr(event_bus, "_current_project_root", str(tmp_path))
    monkeypatch.setattr(event_bus, "_project_generation", 1)
    monkeypatch.setattr(sidebar_ws, "_registered_hosts", {"sid"})
    monkeypatch.setattr(sidebar_ws, "_client_ids_by_sid", {"sid": "client_111111111111"})
    create = AsyncMock(return_value={"shell_id": "new-shell"})
    emit = AsyncMock()
    monkeypatch.setattr(terminal_backend, "_create_terminal_shell_data", create)
    monkeypatch.setattr(notifications, "emit_ui_ipc_rpc_notification", emit)
    return tmp_path, create, emit


def invoke(root, **extra):
    return asyncio.run(open_directory_terminal(directory=str(root), destination="drawer",
        client_id="client_111111111111", operation_id="operation", **extra))


def test_drawer_creates_at_directory_and_notifies_only_initiator(environment):
    root, create, emit = environment
    assert invoke(root) == {"shell_id": "new-shell"}
    create.assert_awaited_once_with(cwd=str(root), client_id="client_111111111111")
    assert emit.call_args.kwargs == {"client_instance_id": "client_111111111111"}


@pytest.mark.parametrize("destination", [None, "drawer"])
def test_host_choice_is_exact_client_single_use_and_cancel_has_no_effect(environment, destination):
    from app.apps.code_te2.host import terminal_intent_backend as service
    root, create, emit = environment
    async def run():
        pending = await service.open_directory_terminal(directory=str(root), destination="ask",
            client_id="client_111111111111", operation_id="op")
        assert pending == {"pending": True}
        create.assert_not_awaited()
        assert emit.call_args.kwargs == {"client_instance_id": "client_111111111111"}
        reply = {"requestId": emit.call_args.args[1]["requestId"], "destination": destination}
        with pytest.raises(ValueError):
            await service.resolve_terminal_destination(reply, client_id="client_222222222222")
        result = await service.resolve_terminal_destination(reply, client_id="client_111111111111")
        with pytest.raises(ValueError):
            await service.resolve_terminal_destination(reply, client_id="client_111111111111")
        return result
    result = asyncio.run(run())
    assert not service._pending_choices
    if destination is None:
        assert result == {"cancelled": True}
        create.assert_not_awaited()
    else:
        assert result == {"shell_id": "new-shell"}
        create.assert_awaited_once()


def test_host_choice_revalidates_project_and_disconnect_cancels(environment, monkeypatch):
    from app.apps.code_te2.host import terminal_intent_backend as service
    from app.apps.code_te2.worker_services import event_bus
    root, create, emit = environment
    async def run():
        await service.open_directory_terminal(directory=str(root), destination="ask",
            client_id="client_111111111111", operation_id="op")
        reply = {"requestId": emit.call_args.args[1]["requestId"], "destination": "drawer"}
        monkeypatch.setattr(event_bus, "_project_generation", 2)
        with pytest.raises(ValueError, match="project changed"):
            await service.resolve_terminal_destination(reply, client_id="client_111111111111")
        await service.open_directory_terminal(directory=str(root), destination="ask",
            client_id="client_111111111111", operation_id="op")
        reply["requestId"] = emit.call_args.args[1]["requestId"]
        service.cancel_terminal_destination("client_111111111111")
        with pytest.raises(ValueError, match="no longer active"):
            await service.resolve_terminal_destination(reply, client_id="client_111111111111")
    asyncio.run(run())
    create.assert_not_awaited()
    assert not service._pending_choices


def test_pending_choice_expires_and_duplicate_admission_creates_nothing(environment, monkeypatch):
    from app.apps.code_te2.host import terminal_intent_backend as service
    root, create, emit = environment
    clock = [0.0]
    monkeypatch.setattr(service, "monotonic", lambda: clock[0])
    async def run():
        await service.open_directory_terminal(directory=str(root), destination="ask",
            client_id="client_111111111111", operation_id="op")
        token = emit.call_args.args[1]["requestId"]
        with pytest.raises(ValueError, match="already pending"):
            await service.open_directory_terminal(directory=str(root), destination="ask",
                client_id="client_111111111111", operation_id="op2")
        clock[0] = 121.0
        with pytest.raises(ValueError, match="no longer active"):
            await service.resolve_terminal_destination({"requestId": token, "destination": "drawer"},
                client_id="client_111111111111")
    asyncio.run(run())
    create.assert_not_awaited()
    assert not service._pending_choices


def test_failed_choice_publication_cleans_up_ticket(environment):
    from app.apps.code_te2.host import terminal_intent_backend as service
    root, create, emit = environment
    emit.side_effect = RuntimeError("connection lost")
    with pytest.raises(RuntimeError, match="connection lost"):
        asyncio.run(service.open_directory_terminal(directory=str(root), destination="ask",
            client_id="client_111111111111", operation_id="op"))
    create.assert_not_awaited()
    assert not service._pending_choices


@pytest.mark.parametrize("failure", ["disconnect", "project-switch", "generation"])
def test_stale_creation_never_activates_or_retries(environment, monkeypatch, failure):
    root, create, emit = environment
    async def execute(**kwargs):
        if failure == "disconnect":
            sidebar_ws._registered_hosts.clear()
        elif failure == "project-switch":
            monkeypatch.setattr(file_ops, "get_project_root", lambda: root / "other")
        else:
            from app.apps.code_te2.worker_services import event_bus
            monkeypatch.setattr(event_bus, "_project_generation", 2)
        return {"shell_id": "new-shell"}
    create.side_effect = execute
    with pytest.raises(ValueError):
        invoke(root)
    assert create.await_count == 1
    emit.assert_not_awaited()


def test_sidebar_launch_seeds_fresh_session_without_drawer_creation(environment, monkeypatch):
    from app.apps.code_te2.host import sidebar_app_backend
    root, create, emit = environment
    launch = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(sidebar_app_backend, "open_sidebar_app", launch)
    async def run():
        for _ in range(2):
            await open_directory_terminal(directory=str(root), destination="sidebar",
                client_id="client_111111111111", operation_id="op")
    asyncio.run(run())
    seeds = [call.kwargs["params"] for call in launch.call_args_list]
    assert all(seed["cwd"] == str(root) and len(seed["new_session"]) == 32 for seed in seeds)
    assert seeds[0]["new_session"] != seeds[1]["new_session"]
    create.assert_not_awaited()
    emit.assert_not_awaited()


def test_drawer_creation_keeps_other_client_selection_and_does_not_rebind(monkeypatch, tmp_path):
    class Sidecar:
        active = "other-shell"
        ids = ["other-shell"]
        def get_active_terminal_shell_id(self): return self.active
        def add_terminal_shell_id(self, shell_id, *, activate=True):
            self.ids.append(shell_id)
            if activate: self.active = shell_id
        def set_active_terminal_shell_id(self, shell_id): self.active = shell_id
        def save(self): pass
        def get_terminal_shell_title(self, shell_id): return None
    sidecar = Sidecar()
    monkeypatch.setattr(terminal_backend.ProjectSidecar, "load_or_create", lambda _: sidecar)
    monkeypatch.setattr(terminal_backend, "_get_terminal_manager", AsyncMock())
    monkeypatch.setattr(terminal_backend, "_next_sequence_for_project", AsyncMock(return_value=2))
    create = AsyncMock(return_value={"id": "new-shell", "label": "code-editor-terminal:p:abcd1234:2"})
    monkeypatch.setattr(terminal_backend, "_create_editor_shell", create)
    monkeypatch.setattr(terminal_backend, "record_terminal_shell_fact", lambda _: None)
    rebind = AsyncMock()
    monkeypatch.setattr(terminal_backend, "close_active_terminal_sockets", rebind)
    monkeypatch.setattr(terminal_backend, "_broadcast_terminal_shell_list", AsyncMock())
    monkeypatch.setattr(terminal_backend, "_build_terminal_shell_list", AsyncMock(return_value={}))
    result = asyncio.run(terminal_backend._create_terminal_shell_for_project(
        str(tmp_path), cwd=str(tmp_path), client_id="client_111111111111"))
    assert result["shell_id"] == "new-shell"
    assert sidecar.active == "other-shell"
    assert "new-shell" in sidecar.ids
    rebind.assert_not_awaited()


@pytest.mark.parametrize("status", ["running", "exited", "wrong-cwd"])
def test_standalone_launch_claim_reuses_or_rejects_record_without_spawning(monkeypatch, tmp_path, status):
    from app.apps.terminal import backend
    record = SimpleNamespace(id="claimed", label="terminal-stream:1", pid=123,
        status="exited" if status == "exited" else "running", env_overrides={
            "TERMINAL_STREAM_PROTOCOL": "msgpack-v1", "TE2_TERMINAL_LAUNCH_ID": "a" * 32,
            "TERMINAL_STREAM_CWD": str(tmp_path / "wrong") if status == "wrong-cwd" else str(tmp_path),
        })
    manager = SimpleNamespace(list_shells=AsyncMock(return_value=[record]),
        describe=AsyncMock(return_value={"id": "claimed"}))
    monkeypatch.setattr(backend, "mgr", AsyncMock(return_value=manager))
    create = AsyncMock()
    monkeypatch.setattr(backend, "_create_shell_record", create)
    call = backend._lifecycle_create_shell({"cwd": str(tmp_path), "launch_id": "a" * 32})
    if status == "running":
        assert asyncio.run(call) == {"id": "claimed"}
    else:
        with pytest.raises(ValueError): asyncio.run(call)
    create.assert_not_awaited()


def test_standalone_concurrent_launch_seed_creates_one_record(monkeypatch, tmp_path):
    from app.apps.terminal import backend
    records = []
    manager = SimpleNamespace(list_shells=AsyncMock(side_effect=lambda: list(records)),
        describe=AsyncMock(return_value={"id": "claimed"}))
    monkeypatch.setattr(backend, "mgr", AsyncMock(return_value=manager))
    monkeypatch.setattr(backend, "_launch_creation_lock", asyncio.Lock())
    async def create(request):
        await asyncio.sleep(0)
        records.append(SimpleNamespace(id="claimed", label="terminal-stream:1", pid=123,
            status="running", env_overrides={"TERMINAL_STREAM_PROTOCOL": "msgpack-v1",
                "TE2_TERMINAL_LAUNCH_ID": request.launch_id, "TERMINAL_STREAM_CWD": request.cwd}))
        return {"id": "claimed"}
    create_mock = AsyncMock(side_effect=create)
    monkeypatch.setattr(backend, "_create_shell_record", create_mock)
    async def run():
        return await asyncio.gather(*(backend._lifecycle_create_shell(
            {"cwd": str(tmp_path), "launch_id": "b" * 32}) for _ in range(2)))
    assert asyncio.run(run()) == [{"id": "claimed"}, {"id": "claimed"}]
    assert create_mock.await_count == 1


def test_nonactivating_membership_preserves_existing_active_under_small_cap(monkeypatch, tmp_path):
    from app.apps.code_te2.project_sidecar import ProjectSidecar
    monkeypatch.setattr(ProjectSidecar, "get_sidecar_path", staticmethod(lambda _: tmp_path / "sidecar.json"))
    sidecar = ProjectSidecar(str(tmp_path))
    sidecar._data["terminal_shell_cap"] = 1
    sidecar.add_terminal_shell_id("other-client-shell")
    sidecar.add_terminal_shell_id("new-client-shell", activate=False)
    assert sidecar.get_active_terminal_shell_id() == "other-client-shell"
    assert sidecar.get_terminal_shell_ids() == ["other-client-shell", "new-client-shell"]


def test_terminal_pipe_checks_current_presentation(environment, monkeypatch):
    from app.apps.code_te2.app_intent_pipe import dispatch_app_intent
    from app.libs.pipe_protocol import PipeEnvelope
    root, create, emit = environment
    from app.apps.code_te2.ui_ipc import sidebar_window_state
    client = "client_111111111111"
    monkeypatch.setattr(sidebar_ws, "_client_active_windows", {client: "slot"})
    monkeypatch.setattr(sidebar_ws, "_client_presentations", {(client, "slot"): "current"})
    monkeypatch.setattr(sidebar_window_state, "get_sidebar_window_state", lambda: {
        "slots": {"slot": {"app_id": "file_explorer"}}})
    request = PipeEnvelope(kind="request", method="app.intent.deliver", id="r", correlation_id="r",
        op_id="operation", origin_nid=1, origin_name="framework.rust", params={
            "intent": "terminal.createSession", "context": {
                "clientId": client, "hostId": "slot", "presentationId": "current"},
            "payload": {"directory": str(root), "destination": "drawer"},
            "source": {"appId": "file_explorer", "shellId": "owned"},
        })
    assert asyncio.run(dispatch_app_intent(request)) == {"shell_id": "new-shell"}
    create.reset_mock(); emit.reset_mock()
    request.params["context"]["presentationId"] = "stale"
    with pytest.raises(ValueError): asyncio.run(dispatch_app_intent(request))
    create.assert_not_awaited(); emit.assert_not_awaited()
