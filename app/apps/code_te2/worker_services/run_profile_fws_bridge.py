# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol, cast

import socketio

from ..host.run_target_service import release_run_target_route
from ..run_profile_events import refresh_run_profile_state
from ..run_profile_shell_facts import (
    is_run_profile_shell_label,
    record_run_profile_shell,
    remove_run_profile_shell,
    replace_run_profile_shell_facts,
    run_profile_shell_label_for_id,
)
from ..run_profile_surfaces import (
    close_run_profile_surface_for_shell,
    reconcile_run_profile_surfaces,
)
from ..terminal_shell_facts import (
    notify_terminal_facts_changed,
    record_terminal_shell_fact,
    remove_terminal_shell_fact,
    replace_terminal_shell_facts,
)

logger = logging.getLogger(__name__)

FWS_NAMESPACE = "/fws"
FWS_SOCKET_PATH = "fws_ws/socket.io"
FWS_REQUEST_EVENT = "fws_request"
FWS_NOTIFICATION_EVENT = "fws_notification"
FWS_LOGS_OPEN_METHOD = "fws.logs.open"
FWS_LOGS_CHUNK_METHOD = "fws.logs.chunk"
FWS_LIFECYCLE_METHODS = frozenset(
    {
        "fws.shell.created",
        "fws.shell.spawned",
        "fws.shell.updated",
        "fws.shell.exited",
        "fws.shell.removed",
    }
)
class AsyncSocketIoClient(Protocol):
    connected: bool

    def on(
        self,
        event: str,
        handler: Callable[..., Awaitable[object | None]],
        *,
        namespace: str,
    ) -> object: ...

    def connect(
        self,
        url: str,
        *,
        namespaces: list[str],
        socketio_path: str,
        transports: list[str],
        wait: bool,
        wait_timeout: int,
        retry: bool,
    ) -> Awaitable[None]: ...

    def call(
        self,
        event: str,
        data: object,
        *,
        namespace: str,
        timeout: int,
    ) -> Awaitable[object]: ...


_client: AsyncSocketIoClient | None = None
_connect_task: asyncio.Task[None] | None = None
_snapshot_task: asyncio.Task[None] | None = None
_relevant_shell_labels: dict[str, str] = {}
_terminal_log_lock = asyncio.Lock()
_terminal_log_requested_shell_id = ""
_terminal_log_open_shell_id = ""
_terminal_log_stream_ready = False
_terminal_log_chunk_handler: Callable[[str, str], Awaitable[None]] | None = None
_terminal_log_reconnect_handler: Callable[[str], Awaitable[None]] | None = None


def configure_terminal_log_stream(
    *,
    on_chunk: Callable[[str, str], Awaitable[None]],
    on_reconnect: Callable[[str], Awaitable[None]],
) -> None:
    global _terminal_log_chunk_handler, _terminal_log_reconnect_handler
    _terminal_log_chunk_handler = on_chunk
    _terminal_log_reconnect_handler = on_reconnect


async def ensure_terminal_log_stream(shell_id: str) -> None:
    """Open the one shared Code TE2 terminal log stream on the FWS lane."""
    global _terminal_log_requested_shell_id
    normalized_shell_id = _text(shell_id).strip()
    if not normalized_shell_id:
        raise ValueError("Terminal log stream requires a shell id")
    _terminal_log_requested_shell_id = normalized_shell_id
    await _open_terminal_log_stream(normalized_shell_id)


async def _open_terminal_log_stream(shell_id: str) -> None:
    global _terminal_log_open_shell_id, _terminal_log_stream_ready
    async with _terminal_log_lock:
        if (
            _terminal_log_stream_ready
            and _terminal_log_open_shell_id == shell_id
        ):
            return
        client = _client
        if client is None or not client.connected:
            raise RuntimeError("FWS terminal log transport is disconnected")
        response = await client.call(
            FWS_REQUEST_EVENT,
            {
                "jsonrpc": "2.0",
                "id": f"code_te2_terminal_logs_{shell_id}",
                "method": FWS_LOGS_OPEN_METHOD,
                "params": {"shell_id": shell_id},
            },
            namespace=FWS_NAMESPACE,
            timeout=10,
        )
        envelope = _mapping(response)
        error = envelope.get("error") if envelope is not None else None
        if error is not None:
            raise RuntimeError(str(error))
        if _terminal_log_requested_shell_id != shell_id:
            return
        _terminal_log_open_shell_id = shell_id
        _terminal_log_stream_ready = True


def start_run_profile_fws_bridge() -> None:
    """Subscribe once to FWS lifecycle facts; no timer or state polling is used."""
    global _client, _connect_task
    if _connect_task is not None and not _connect_task.done():
        return

    client = cast(
        AsyncSocketIoClient,
        socketio.AsyncClient(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=1,
            reconnection_delay_max=5,
            logger=False,
        ),
    )
    _client = client
    _ = client.on("connect", _on_connect, namespace=FWS_NAMESPACE)
    _ = client.on(
        FWS_NOTIFICATION_EVENT,
        _on_notification,
        namespace=FWS_NAMESPACE,
    )
    _ = client.on("connect_error", _on_connect_error, namespace=FWS_NAMESPACE)
    _connect_task = asyncio.create_task(
        _connect(client),
        name="code_te2_run_profile_fws_bridge",
    )


async def _connect(client: AsyncSocketIoClient) -> None:
    try:
        await client.connect(
            _framework_url(),
            namespaces=[FWS_NAMESPACE],
            socketio_path=FWS_SOCKET_PATH,
            transports=["websocket"],
            wait=True,
            wait_timeout=5,
            retry=True,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("[run_profile] FWS lifecycle bridge stopped: %s", exc)


async def _on_connect() -> None:
    global _snapshot_task, _terminal_log_open_shell_id, _terminal_log_stream_ready
    reconnect_shell_id = _terminal_log_requested_shell_id
    _terminal_log_open_shell_id = ""
    _terminal_log_stream_ready = False
    if _snapshot_task is not None and not _snapshot_task.done():
        _ = _snapshot_task.cancel()
    _snapshot_task = asyncio.create_task(
        _open_dashboard_snapshot(reconnect_shell_id),
        name="code_te2_run_profile_fws_snapshot",
    )


async def _open_dashboard_snapshot(reconnect_shell_id: str = "") -> None:
    # python-socketio invokes the namespace connect callback before completing
    # its own connect-packet bookkeeping. Yield once so call() sees /fws as
    # connected; this is a handshake boundary, not a polling loop.
    await asyncio.sleep(0)
    client = _client
    if client is None or not client.connected:
        return
    try:
        response = await client.call(
            FWS_REQUEST_EVENT,
            {
                "jsonrpc": "2.0",
                "id": "code_te2_run_profile_snapshot",
                "method": "fws.dashboard.open",
                "params": {"view": "html"},
            },
            namespace=FWS_NAMESPACE,
            timeout=10,
        )
        terminal_facts_changed = _replace_relevant_shell_ids(response)
        if terminal_facts_changed:
            await notify_terminal_facts_changed()
        if reconnect_shell_id:
            await _open_terminal_log_stream(reconnect_shell_id)
            reconnect_handler = _terminal_log_reconnect_handler
            if reconnect_handler is not None:
                await reconnect_handler(reconnect_shell_id)
        _ = await reconcile_run_profile_surfaces(set(_relevant_shell_labels))
        _ = await refresh_run_profile_state(
            source="fws_snapshot",
            reconcile_stale_route=True,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("[run_profile] FWS snapshot failed: %s", exc)


async def _on_notification(payload: object) -> None:
    notification = _mapping(payload)
    if notification is None:
        return
    method = notification.get("method")
    if not isinstance(method, str):
        return

    params = _mapping(notification.get("params"))
    if params is None:
        return
    if method == FWS_LOGS_CHUNK_METHOD:
        shell_id = _text(params.get("shell_id")).strip()
        stream = _text(params.get("stream")).strip()
        chunk = _text(params.get("chunk"))
        if (
            shell_id
            and shell_id == _terminal_log_requested_shell_id
            and stream == "stdout"
            and chunk
        ):
            handler = _terminal_log_chunk_handler
            if handler is not None:
                await handler(shell_id, chunk)
        return
    if method not in FWS_LIFECYCLE_METHODS:
        return
    if method == "fws.shell.removed":
        shell_id = _text(params.get("shell_id"))
        if remove_terminal_shell_fact(shell_id):
            await notify_terminal_facts_changed()
        label = (
            _relevant_shell_labels.pop(shell_id, "")
            or run_profile_shell_label_for_id(shell_id)
        )
        if not shell_id or not label:
            return
        _ = remove_run_profile_shell(shell_id=shell_id, label=label)
    else:
        shell = _mapping(params.get("shell"))
        if shell is None:
            return
        shell_id = _text(shell.get("id"))
        if record_terminal_shell_fact(shell):
            await notify_terminal_facts_changed()
        label = (
            _text(shell.get("label"))
            or _relevant_shell_labels.get(shell_id, "")
            or run_profile_shell_label_for_id(shell_id)
        )
        relevant = is_run_profile_shell_label(label) or shell_id in _relevant_shell_labels
        if not relevant:
            return
        if shell_id:
            if method == "fws.shell.exited":
                _ = _relevant_shell_labels.pop(shell_id, None)
                _ = remove_run_profile_shell(shell_id=shell_id, label=label)
            else:
                _relevant_shell_labels[shell_id] = label
                _ = record_run_profile_shell(shell_id, label)

    if method in {"fws.shell.exited", "fws.shell.removed"} and label:
        await _release_route_best_effort(owner_id=label, shell_id=shell_id)
        _ = await close_run_profile_surface_for_shell(
            shell_id=shell_id,
            shell_label=label,
            source=method,
        )
    _ = await refresh_run_profile_state(source=method)


async def _on_connect_error(error: object) -> None:
    logger.debug("[run_profile] FWS lifecycle transport unavailable: %s", error)


def _replace_relevant_shell_ids(payload: object) -> bool:
    response = _mapping(payload)
    result = _mapping(response.get("result")) if response is not None else None
    state = _mapping(result.get("state")) if result is not None else None
    shells = state.get("shells") if state is not None else None
    terminal_facts_changed = replace_terminal_shell_facts(shells)
    relevant_labels: dict[str, str] = {}
    if isinstance(shells, list):
        for item in cast(list[object], shells):
            shell = _mapping(item)
            if (
                shell is None
                or _text(shell.get("status")).strip().lower() != "running"
                or not is_run_profile_shell_label(_text(shell.get("label")))
            ):
                continue
            shell_id = _text(shell.get("id"))
            label = _text(shell.get("label"))
            if shell_id:
                relevant_labels[shell_id] = label
    _relevant_shell_labels.clear()
    _relevant_shell_labels.update(relevant_labels)
    replace_run_profile_shell_facts(relevant_labels)
    return terminal_facts_changed


async def _release_route_best_effort(*, owner_id: str, shell_id: str) -> None:
    try:
        _ = await release_run_target_route(owner_id=owner_id, shell_id=shell_id)
    except Exception:
        pass


def _framework_url() -> str:
    return (
        os.environ.get("FRAMEWORK_SHELLS_FWS_SOCKETIO_URL")
        or os.environ.get("TE_FRAMEWORK_URL")
        or "http://127.0.0.1:8089"
    ).rstrip("/")


def _mapping(value: object) -> Mapping[str, object] | None:
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else None


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""
