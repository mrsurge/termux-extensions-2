import asyncio
import sys
from contextlib import suppress
from urllib.parse import parse_qs

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from framework_shells import get_manager


def _get_query_param(websocket: WebSocket, key: str) -> str:
    raw = (websocket.scope.get("query_string") or b"").decode("utf-8", "ignore")
    params = parse_qs(raw)
    values = params.get(key) or []
    return str(values[0]) if values else ""


async def _find_vscode_rpc_shell(shell_id: str | None) -> tuple[str, int] | None:
    mgr = await get_manager()

    record = None
    if shell_id:
        record = await mgr.get_shell(shell_id)
        if not record or record.status != "running":
            record = None

    if not record:
        # Best-effort fallback: find any running vscode_rpc shell for file_editor_cm6.
        try:
            shells = await mgr.list_shells()
        except Exception:
            shells = []
        for s in shells:
            if s.status != "running":
                continue
            if not s.label:
                continue
            if s.label.startswith("vscode_rpc:file_editor_cm6"):
                record = s
                break

    if not record:
        return None

    env = record.env_overrides or {}
    port_s = env.get("TE_VSCODE_RPC_PORT") or env.get("PORT") or ""
    try:
        port = int(str(port_s))
    except Exception:
        return None

    return (record.id, port)


async def _proxy_vscode_rpc_websocket(websocket: WebSocket) -> None:
    """Main-process shim: proxy browser WS to the vscode_rpc framework shell WS.

    This module must remain proxy-only:
    - no SSOT access
    - no JSON-RPC parsing
    - frames forwarded verbatim
    """

    await websocket.accept()

    requested_shell_id = _get_query_param(websocket, "shell_id") or None
    found = await _find_vscode_rpc_shell(requested_shell_id)
    if not found:
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    _shell_id, port = found
    upstream_url = f"ws://127.0.0.1:{port}/vscode_rpc"

    try:
        async with websockets.connect(upstream_url) as upstream_ws:

            async def forward_client_to_upstream() -> None:
                try:
                    while True:
                        packet = await websocket.receive()
                        if packet.get("type") == "websocket.disconnect":
                            break
                        if packet.get("text") is not None:
                            await upstream_ws.send(packet["text"])
                        elif packet.get("bytes") is not None:
                            await upstream_ws.send(packet["bytes"])
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def forward_upstream_to_client() -> None:
                try:
                    async for msg in upstream_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    pass
                except Exception:
                    pass

            tasks = [
                asyncio.create_task(forward_client_to_upstream()),
                asyncio.create_task(forward_upstream_to_client()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(f"[vscode_rpc WS] Failed proxy upstream_url={upstream_url}: {exc}", file=sys.stderr, flush=True)
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


def register(app) -> None:
    """Register vscode_rpc websocket proxy in the main process."""

    app.add_api_websocket_route(
        "/vscode_rpc_ws",
        _proxy_vscode_rpc_websocket,
        name="vscode_rpc_ws_proxy",
    )
