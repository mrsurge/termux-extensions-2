import asyncio
import sys
from contextlib import suppress
from typing import Protocol, cast

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState


ADAPTER_HOST = "127.0.0.1"
ADAPTER_PORT = 18181


class WebsocketRouteRegistrar(Protocol):
    def add_api_websocket_route(self, path: str, endpoint: object, *, name: str | None = None) -> None:
        ...


async def _proxy_wba_socketio_websocket(websocket: WebSocket, rest: str = "") -> None:
    """Main-process shim: proxy editor-facing WBA Socket.IO to the Node adapter.

    Contract:
    - This service does not touch app-worker SSOT or editor state.
    - The upstream code-server/workbench websocket remains adapter-internal.
    - This only exposes the adapter-owned editor-facing WBA namespace.
    """

    await websocket.accept()

    scope = cast(dict[str, object], websocket.scope)
    query_obj = scope.get("query_string", b"")
    query = query_obj.decode("utf-8") if isinstance(query_obj, bytes) else ""
    path_obj = scope.get("path")
    incoming_path = path_obj if isinstance(path_obj, str) and path_obj else "/wba_ws/socket.io"
    adapter_url = f"ws://{ADAPTER_HOST}:{ADAPTER_PORT}{incoming_path}"
    if query:
        adapter_url += f"?{query}"

    client_headers = websocket.headers
    cookie_hdr = client_headers.get("cookie")
    ua_hdr = client_headers.get("user-agent")

    extra_headers: list[tuple[str, str]] = []
    if cookie_hdr:
        extra_headers.append(("Cookie", cookie_hdr))
    if ua_hdr:
        extra_headers.append(("User-Agent", ua_hdr))

    try:
        async with websockets.connect(
            adapter_url,
            additional_headers=extra_headers or None,
            max_size=None,
        ) as adapter_ws:

            async def forward_client_to_adapter() -> None:
                try:
                    while True:
                        packet = cast(dict[str, object], await websocket.receive())
                        if packet.get("type") == "websocket.disconnect":
                            break
                        text_msg = packet.get("text")
                        bytes_msg = packet.get("bytes")
                        if isinstance(text_msg, str):
                            await adapter_ws.send(text_msg)
                        elif isinstance(bytes_msg, (bytes, bytearray)):
                            await adapter_ws.send(bytes(bytes_msg))
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def forward_adapter_to_client() -> None:
                try:
                    async for msg in adapter_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    pass
                except Exception:
                    pass

            tasks = [
                asyncio.create_task(forward_client_to_adapter()),
                asyncio.create_task(forward_adapter_to_client()),
            ]
            _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(f"[WBA WS] Failed to proxy to adapter_url={adapter_url}: {exc}", file=sys.stderr, flush=True)
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


def register(app: WebsocketRouteRegistrar) -> None:
    """Register the editor-facing WBA Socket.IO websocket proxy in the main process."""

    app.add_api_websocket_route(
        "/wba_ws/socket.io",
        _proxy_wba_socketio_websocket,
        name="wba_ws_proxy_root",
    )
    app.add_api_websocket_route(
        "/wba_ws/socket.io/{rest:path}",
        _proxy_wba_socketio_websocket,
        name="wba_ws_proxy",
    )
