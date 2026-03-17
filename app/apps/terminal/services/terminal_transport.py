import asyncio
import inspect
import sys
from contextlib import suppress

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.libs.app_manager import get_running_apps


async def _proxy_terminal_socketio_websocket(websocket: WebSocket, rest: str = "") -> None:
    await websocket.accept()

    app_id = "terminal"
    running_apps = await get_running_apps()
    if app_id not in running_apps:
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    port = int(running_apps[app_id]["port"])
    query = websocket.scope.get("query_string", b"").decode("utf-8")
    incoming_path = websocket.scope.get("path") or "/terminal_app_ws/socket.io"
    if incoming_path == "/terminal_app_ws/socket.io":
        incoming_path = "/terminal_app_ws/socket.io/"
    worker_url = f"ws://127.0.0.1:{port}{incoming_path}"
    if query:
        worker_url += f"?{query}"

    client_headers = websocket.headers
    origin_hdr = client_headers.get("origin")
    cookie_hdr = client_headers.get("cookie")
    ua_hdr = client_headers.get("user-agent")
    sec_ws_proto = client_headers.get("sec-websocket-protocol")
    subprotocols = None
    if sec_ws_proto:
        subprotocols = [p.strip() for p in sec_ws_proto.split(",") if p.strip()]

    extra_headers = []
    if cookie_hdr:
        extra_headers.append(("Cookie", cookie_hdr))
    if ua_hdr:
        extra_headers.append(("User-Agent", ua_hdr))

    connect_kwargs = {
        "origin": origin_hdr,
        "subprotocols": subprotocols,
    }
    if extra_headers:
        param_names = inspect.signature(websockets.connect).parameters
        if "additional_headers" in param_names:
            connect_kwargs["additional_headers"] = extra_headers
        else:
            connect_kwargs["extra_headers"] = extra_headers

    try:
        async with websockets.connect(worker_url, **connect_kwargs) as worker_ws:
            async def forward_client_to_worker() -> None:
                try:
                    while True:
                        packet = await websocket.receive()
                        if packet.get("type") == "websocket.disconnect":
                            break
                        if packet.get("text") is not None:
                            await worker_ws.send(packet["text"])
                        elif packet.get("bytes") is not None:
                            await worker_ws.send(packet["bytes"])
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def forward_worker_to_client() -> None:
                try:
                    async for msg in worker_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    pass
                except Exception:
                    pass

            tasks = [
                asyncio.create_task(forward_client_to_worker()),
                asyncio.create_task(forward_worker_to_client()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(f"[Terminal App WS] Failed to proxy to worker_url={worker_url}: {exc}", file=sys.stderr, flush=True)
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


def register(app) -> None:
    app.add_api_websocket_route(
        "/terminal_app_ws/socket.io",
        _proxy_terminal_socketio_websocket,
        name="terminal_app_ws_proxy_root",
    )
    app.add_api_websocket_route(
        "/terminal_app_ws/socket.io/{rest:path}",
        _proxy_terminal_socketio_websocket,
        name="terminal_app_ws_proxy",
    )
