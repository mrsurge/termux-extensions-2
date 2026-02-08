"""Diagnostics bridge: adapter WS → editor Socket.IO.

Subscribes to the workbench adapter event stream (WS on port 18181) and
forwards diagnostics/update events through the editor Socket.IO channel so
the browser receives them over the already-connected transport.

Server-side cache ensures newly connecting clients get immediate diagnostics.
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

ADAPTER_PORT = 18181
DIAG_CACHE_MAX = 100

# Server-side diagnostics cache: abs_path -> {ts_ms, owner, markers}
_diag_cache: Dict[str, Dict[str, Any]] = {}

# Background task handle
_bridge_task: Optional[asyncio.Task] = None
_bridge_running = False


def _abs_path_from_vscode_uri(raw: Any) -> str:
    """Extract absolute filesystem path from a vscode-remote:// or file:// URI."""
    if not raw:
        return ""
    s = str(raw)
    if s.startswith("/") or (len(s) > 2 and s[1:3] == ":/"):
        return s
    if s.startswith("file://"):
        from urllib.parse import unquote
        return unquote(s[len("file://"):])
    if s.startswith("vscode-remote://"):
        rest = s[len("vscode-remote://"):]
        slash = rest.find("/")
        if slash == -1:
            return ""
        from urllib.parse import unquote
        return unquote(rest[slash:])
    # Fallback: try URL parse
    try:
        u = urlparse(s)
        if u.path:
            from urllib.parse import unquote
            return unquote(u.path)
    except Exception:
        pass
    return ""


def get_cached_diagnostics(abs_path: str) -> Optional[Dict[str, Any]]:
    """Return cached diagnostics for a path, or None."""
    return _diag_cache.get(abs_path)


def get_all_cached_diagnostics() -> Dict[str, Dict[str, Any]]:
    """Return the full cache (read-only snapshot)."""
    return dict(_diag_cache)


async def nudge_diagnostics_for_file(abs_path: str, language_id: str = "") -> bool:
    """Ask the adapter to re-open a file, forcing the extension host to re-emit diagnostics."""
    try:
        import httpx
        payload = {
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000),
            "method": "vscode.openFile",
            "params": {
                "path": abs_path,
                "languageId": language_id or "",
            },
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"http://127.0.0.1:{ADAPTER_PORT}/cmd",
                json=payload,
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.debug("[diag_bridge] nudge failed: %s", exc)
        return False


async def send_cached_diagnostics_to_sid(sio, sid: str, abs_path: str):
    """Send cached diagnostics for a specific file to a specific Socket.IO client."""
    cached = _diag_cache.get(abs_path)
    if not cached:
        return
    try:
        await sio.emit("editor:diagnostics", cached, room=sid, namespace="/editor")
    except Exception as exc:
        logger.debug("[diag_bridge] send_cached to %s failed: %s", sid, exc)


def _process_diagnostics_update(params: dict):
    """Process a diagnostics/update event: update cache, return normalized items."""
    items = params.get("items") if isinstance(params, dict) else None
    if not isinstance(items, list):
        return []

    owner = str(params.get("owner", "unknown"))
    ts_ms = int(time.time() * 1000)
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue
        uri = item.get("uri", "")
        abs_path = _abs_path_from_vscode_uri(uri)
        if not abs_path:
            continue
        markers = item.get("markers", [])
        if not isinstance(markers, list):
            markers = []

        entry = {
            "type": "diagnostics/update",
            "ts_ms": ts_ms,
            "owner": owner,
            "path": abs_path,
            "markers": markers,
        }
        _diag_cache[abs_path] = entry
        result.append(entry)

    # Evict oldest if cache too large
    while len(_diag_cache) > DIAG_CACHE_MAX:
        oldest_key = min(_diag_cache, key=lambda k: _diag_cache[k].get("ts_ms", 0))
        del _diag_cache[oldest_key]

    return result


async def _adapter_ws_loop(sio):
    """Connect to adapter WS, listen for diagnostics, broadcast via Socket.IO."""
    import websockets

    url = f"ws://127.0.0.1:{ADAPTER_PORT}/ws"
    backoff = 1.0

    while _bridge_running:
        try:
            async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
                logger.info("[diag_bridge] connected to adapter ws %s", url)
                backoff = 1.0  # reset on successful connect

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if not isinstance(msg, dict):
                        continue
                    if msg.get("method") != "te2.event":
                        continue

                    ev = msg.get("params")
                    if not isinstance(ev, dict):
                        continue
                    ev_type = ev.get("type")

                    # Forward diagnostics/ready (baton resolution) to browser.
                    if ev_type == "diagnostics/ready":
                        try:
                            await sio.emit(
                                "editor:diagnostics_ready",
                                {"path": ev.get("path", ""), "markers": ev.get("markers", 0), "ts_ms": ev.get("ts_ms", 0)},
                                room="file_editor_cm6",
                                namespace="/editor",
                            )
                            print(f"[diag_bridge] diagnostics/ready path={ev.get('path','?')} markers={ev.get('markers',0)}", flush=True)
                        except Exception as exc:
                            print(f"[diag_bridge] diagnostics/ready emit FAIL: {exc}", flush=True)
                        continue

                    if ev_type != "diagnostics/update":
                        continue

                    entries = _process_diagnostics_update(ev)
                    print(f"[diag_bridge] rx {len(entries)} entries, paths={[e.get('path','?') for e in entries]}", flush=True)
                    for entry in entries:
                        try:
                            await sio.emit(
                                "editor:diagnostics",
                                entry,
                                room="file_editor_cm6",
                                namespace="/editor",
                            )
                            print(f"[diag_bridge] emit OK path={entry.get('path','?')} markers={len(entry.get('markers',[]))}", flush=True)
                        except Exception as exc:
                            print(f"[diag_bridge] emit FAIL: {exc}", flush=True)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("[diag_bridge] adapter ws error: %s, reconnecting in %.0fs", exc, backoff)

        if not _bridge_running:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


def start_bridge(sio):
    """Start the background diagnostics bridge task. Safe to call multiple times."""
    global _bridge_task, _bridge_running

    if _bridge_task and not _bridge_task.done():
        return  # already running

    _bridge_running = True
    _bridge_task = asyncio.ensure_future(_adapter_ws_loop(sio))


def stop_bridge():
    """Stop the background bridge task."""
    global _bridge_running, _bridge_task

    _bridge_running = False
    if _bridge_task and not _bridge_task.done():
        _bridge_task.cancel()
    _bridge_task = None
