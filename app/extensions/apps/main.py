import os
import json
import aiofiles
import contextlib
import asyncio

# Get project root reliably - app module's parent
import app
project_root = os.path.dirname(os.path.dirname(os.path.abspath(app.__file__)))
import time
import asyncio
from pathlib import Path
from typing import Any
from fastapi import APIRouter, Depends, Request, HTTPException, WebSocket, Body, WebSocketDisconnect
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse, StreamingResponse
from app.libs import app_manager
from app.libs import app_lifecycle
from app.extensions.apps import loader as apps_loader
from app.extensions.apps.events import app_registry_events
from app.extensions.apps.scaffold import (
    list_templates as list_app_templates,
    scaffold_proxy_shell_wrapper,
    validate_proxy_shell_wrapper,
)
from framework_shells import FrameworkShellManager, get_event_bus, get_manager as _get_framework_shell_manager

async def get_framework_shell_manager() -> FrameworkShellManager:
    """FastAPI dependency wrapper (framework_shells.get_manager has **kwargs)."""
    return await _get_framework_shell_manager()
from urllib.parse import urlencode

# Avoid circular import - will be accessed dynamically
def get_loaded_apps():
    return apps_loader.get_loaded_apps()


def get_app_registry():
    return apps_loader.get_app_registry()


def get_app_runtime():
    return apps_loader.get_app_runtime()


def _resolve_manifest_icon_src(manifest: dict) -> str:
    raw = manifest.get("icon_src")
    if not isinstance(raw, str):
        return ""
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://") or value.startswith("/"):
        return value
    asset_base_url = manifest.get("asset_base_url")
    if isinstance(asset_base_url, str) and asset_base_url.strip():
        return f"{asset_base_url.rstrip('/')}/{value.lstrip('/')}"
    return value


def _build_apps_catalog(manifests: list, running_apps: dict | None = None) -> list[dict]:
    running = running_apps or {}
    readiness_by_app: dict[str, dict[str, Any]] = {}
    if isinstance(running_apps, dict):
        # Accept optional readiness data injected by callers under a reserved key.
        raw_readiness = running_apps.get("__readiness__")
        if isinstance(raw_readiness, dict):
            readiness_by_app = {
                str(app_id).strip(): dict(value)
                for app_id, value in raw_readiness.items()
                if str(app_id).strip() and isinstance(value, dict)
            }
    catalog: list[dict] = []
    for manifest in manifests:
        if not isinstance(manifest, dict):
            continue
        app_id = manifest.get("id")
        if not isinstance(app_id, str) or not app_id.strip():
            continue
        app_id = app_id.strip()
        entrypoints = manifest.get("entrypoints")
        if not isinstance(entrypoints, dict):
            entrypoints = {}

        backend_required = bool(entrypoints.get("backend_blueprint"))
        icon_src_resolved = _resolve_manifest_icon_src(manifest)
        sidebar_state = manifest.get("sidebar_state")
        if not isinstance(sidebar_state, dict):
            sidebar_state = None
        readiness_support = bool(manifest.get("readiness_support"))
        readiness = readiness_by_app.get(app_id) if readiness_support else {}
        if readiness_support and not readiness and backend_required and app_id in running:
            readiness = {"app_id": app_id, "status": "starting"}

        catalog.append({
            "id": app_id,
            "name": manifest.get("name") or app_id,
            "description": manifest.get("description") or "",
            "_dir": manifest.get("_dir"),
            "icon_src": icon_src_resolved,
            "icon_src_raw": manifest.get("icon_src") if isinstance(manifest.get("icon_src"), str) else "",
            "icon_text": manifest.get("icon_text") if isinstance(manifest.get("icon_text"), str) else "",
            "icon_emoji": manifest.get("icon_emoji") if isinstance(manifest.get("icon_emoji"), str) else "",
            "fullscreen": bool(manifest.get("fullscreen")),
            "backend_required": backend_required,
            "readiness_support": readiness_support,
            "running": app_id in running,
            "readiness": readiness or {},
            "launch_url": f"/app/{app_id}",
            "embed_url": f"/app/{app_id}?embed=1",
            "asset_base_url": manifest.get("asset_base_url") if isinstance(manifest.get("asset_base_url"), str) else "",
            "source_kind": manifest.get("source_kind") if isinstance(manifest.get("source_kind"), str) else "",
            "sidebar_state": sidebar_state,
        })

    catalog.sort(key=lambda item: str(item.get("name") or item.get("id") or "").lower())
    return catalog


def _readiness_manifest_or_404(app_id: str) -> dict:
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' not found")
    if not bool(manifest.get("readiness_support")):
        raise HTTPException(status_code=404, detail=f"App '{app_id}' does not support readiness")
    return manifest


async def _build_apps_snapshot() -> dict[str, Any]:
    manifests = get_loaded_apps()
    running_apps = await get_app_runtime().get_running_app_map()
    readiness = await app_lifecycle.get_all_app_readiness()
    catalog_input = dict(running_apps)
    catalog_input["__readiness__"] = readiness
    return {
        "catalog": _build_apps_catalog(manifests, catalog_input),
        "running_ids": sorted(str(app_id).strip() for app_id in running_apps.keys() if str(app_id).strip()),
    }


def _derive_app_id_from_shell_event(event: dict[str, Any]) -> str:
    app_id = str(event.get("app_id") or event.get("data", {}).get("app_id") or "").strip()
    if app_id:
        return app_id

    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    label = str(data.get("label") or "").strip()
    if label.startswith("app-worker:"):
        return label.split(":", 1)[1].strip()
    if label.startswith("asgi-app:"):
        return label.split(":", 1)[1].strip()

    spec_id = str(data.get("spec_id") or "").strip()
    if spec_id.startswith("app:"):
        parts = spec_id.split(":")
        if len(parts) >= 2:
            return parts[1].strip()
    return ""


def _proxy_shell_urls(app_id: str, proxy_cfg: dict) -> dict:
    proxy_prefix = f"/api/app/{app_id}/proxy"
    start_path = proxy_cfg.get("start_path")
    health_path = proxy_cfg.get("health_path")
    if not isinstance(start_path, str) or not start_path.strip():
        raise HTTPException(status_code=500, detail=f"App '{app_id}' proxy_shell.start_path is required")
    if not isinstance(health_path, str) or not health_path.strip():
        raise HTTPException(status_code=500, detail=f"App '{app_id}' proxy_shell.health_path is required")

    start_path = start_path.strip()
    health_path = health_path.strip()
    if not start_path.startswith("/"):
        start_path = f"/{start_path}"
    if not health_path.startswith("/"):
        health_path = f"/{health_path}"

    return {
        "proxy_prefix": proxy_prefix,
        "start_path": start_path,
        "health_path": health_path,
        "start_url": f"{proxy_prefix}{start_path}",
        "health_url": f"{proxy_prefix}{health_path}",
    }


apps_bp = APIRouter()


async def _is_local_port_open(port: int, timeout: float = 0.4) -> bool:
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", int(port)), timeout=timeout)
    except Exception:
        return False
    writer.close()
    with contextlib.suppress(Exception):
        await writer.wait_closed()
    return True

@apps_bp.post('/api/apps/{app_id}/open')
async def open_app(app_id: str, payload: dict = Body(...)):
    """
    Launch an app, ensuring it is running, and return the deep-link URL.
    Payload can contain 'params' (dict) which will be converted to query string.
    """
    print(f"[AppsExtension] open_app requested for {app_id}")
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' not found")

    try:
        app_info = await get_app_runtime().start_app(app_id)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to start app: {e}")

    # Construct the URL
    base_url = f"/app/{app_id}"
    params = payload.get("params", {})
    
    # If it's a nicegui app running on a different port, redirect directly?
    # No, for standard apps we route through /app/{app_id} which loads app_shell.html
    # app_shell.html -> loads main.js -> main.js checks query params.
    
    query_string = ""
    if params:
        query_string = "?" + urlencode(params)
    
    full_url = f"{base_url}{query_string}"
    
    return {"ok": True, "data": {"url": full_url, "app_info": app_info}}

@apps_bp.post('/api/apps/{app_id}/start')
async def start_app(app_id: str):
    print(f"[AppsExtension] start_app requested for {app_id}")
    try:
        app_info = await get_app_runtime().start_app(app_id)
        print(f"[AppsExtension] start_app succeeded for {app_id}: shell={app_info.get('shell_id')} port={app_info.get('port')}")
        return {"ok": True, "data": app_info}
    except (ValueError, RuntimeError) as e:
        print(f"[AppsExtension] start_app failed for {app_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@apps_bp.post('/api/apps/{app_id}/restart')
async def restart_app(app_id: str):
    print(f"[AppsExtension] restart_app requested for {app_id}")
    try:
        app_info = await get_app_runtime().restart_app(app_id)
        started = app_info.get("started", {}) if isinstance(app_info, dict) else {}
        print(
            f"[AppsExtension] restart_app succeeded for {app_id}: "
            f"shell={started.get('shell_id') if isinstance(started, dict) else None} "
            f"port={started.get('port') if isinstance(started, dict) else None}"
        )
        return {"ok": True, "data": app_info}
    except (ValueError, RuntimeError) as e:
        print(f"[AppsExtension] restart_app failed for {app_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@apps_bp.post('/api/apps/{app_id}/quit')
async def quit_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """
    A new, specific endpoint for quitting an app.
    """
    print(f"[AppsExtension] quit_app requested for {app_id}")
    shutdown_result = await get_app_runtime().shutdown_app(app_id)
    shutdown = shutdown_result.get("shutdown", {}) if isinstance(shutdown_result, dict) else {}
    root_pids = shutdown.get("root_pids", []) if isinstance(shutdown, dict) else []
    stats = shutdown.get("stats", {}) if isinstance(shutdown, dict) else {}
    print(
        f"[AppsExtension] quit_app terminate_app_group(app_id={app_id}) "
        f"ok={bool(shutdown_result.get('ok')) if isinstance(shutdown_result, dict) else False} "
        f"root_pids={root_pids} stats={stats}"
    )

    if not root_pids:
        raise HTTPException(status_code=404, detail="App is not running or already terminated.")
    if not (isinstance(shutdown_result, dict) and shutdown_result.get("ok")):
        raise HTTPException(status_code=500, detail="Failed to terminate app group.")
    return {"ok": True, "data": {"message": f"App {app_id} terminated.", "root_pids": root_pids, "stats": stats}}

@apps_bp.post('/api/apps/{app_id}/lock')
async def lock_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Sets the lock state for an app to true."""
    print(f"[AppsExtension] lock_app requested for {app_id}")
    running_apps = await app_lifecycle.get_running_apps(manager)
    app_to_lock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_lock:
        raise HTTPException(status_code=404, detail="App not running.")
    
    updated_app = await app_lifecycle.set_lock_state(app_to_lock["shell_id"], True)
    return {"ok": True, "data": updated_app}

@apps_bp.post('/api/apps/{app_id}/unlock')
async def unlock_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Sets the lock state for an app to false."""
    print(f"[AppsExtension] unlock_app requested for {app_id}")
    running_apps = await app_lifecycle.get_running_apps(manager)
    app_to_unlock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_unlock:
        raise HTTPException(status_code=404, detail="App not running.")
    
    updated_app = await app_lifecycle.set_lock_state(app_to_unlock["shell_id"], False)
    return {"ok": True, "data": updated_app}

@apps_bp.put('/api/apps/{app_id}/readiness')
@apps_bp.post('/api/apps/{app_id}/readiness')
async def set_app_readiness(app_id: str, payload: dict | None = Body(None)):
    """
    Semantic readiness callback for apps whose backend/page needs more than TCP shell readiness.
    Minimum body: {"status": "ready"}. POST and PUT have the same semantics.
    This is app/backend lifecycle state only; slot/window state belongs to the sidebar window API.
    """
    _readiness_manifest_or_404(app_id)
    body = payload if isinstance(payload, dict) else {}
    status = str(body.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status is required")
    status_normalized = status.lower()
    if status_normalized == "loading":
        status_normalized = "starting"
    if status_normalized not in {"starting", "ready", "error", "stopped"}:
        raise HTTPException(status_code=400, detail="invalid readiness status")

    readiness = await app_lifecycle.set_app_readiness(app_id, body)
    await app_registry_events.publish("app_readiness_changed", {"app_id": app_id, "readiness": readiness})
    return {"ok": True, "data": readiness}


@apps_bp.get('/api/apps/{app_id}/readiness')
async def get_app_readiness(app_id: str):
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' not found")
    readiness = await app_lifecycle.get_app_readiness(app_id)
    if readiness is None:
        running = await get_app_runtime().get_running_app(app_id)
        readiness = {"app_id": app_id, "status": "starting" if isinstance(running, dict) else "stopped"}
    return {"ok": True, "data": readiness}

@apps_bp.get('/api/apps/running')
async def get_running_apps(manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Returns a list of all currently running app shells with stats."""
    running_apps = await app_lifecycle.get_running_apps(manager)
    print(f"[AppsExtension] get_running_apps returning {len(running_apps)} entries")
    # We need to augment this with data from the main app manifests (like name and icon)
    all_apps = {app['id']: app for app in get_loaded_apps()}
    
    augmented_apps = []
    for app in running_apps:
        manifest_data = all_apps.get(app.get('app_id'))
        if manifest_data:
            app['name'] = manifest_data.get('name')
            app['icon_emoji'] = manifest_data.get('icon_emoji')
            app['icon_text'] = manifest_data.get('icon_text')
            app['icon_src'] = manifest_data.get('icon_src')
            app['_dir'] = manifest_data.get('_dir')
            app['asset_base_url'] = manifest_data.get('asset_base_url')
            app['source_kind'] = manifest_data.get('source_kind')
        augmented_apps.append(app)
        
    return {"ok": True, "data": augmented_apps}

@apps_bp.get('/api/apps')
def get_apps():
    """
    This endpoint is now responsible for providing the list of available applications.
    The actual loading and blueprint registration still happens at startup in app/main.py.
    """
    return {"ok": True, "data": get_loaded_apps()}


@apps_bp.get('/api/apps/catalog')
async def get_apps_catalog():
    """
    Canonical launcher/sidebar catalog with normalized icon URLs and runtime flags.
    """
    manifests = get_loaded_apps()
    running_apps = await get_app_runtime().get_running_app_map()
    readiness = await app_lifecycle.get_all_app_readiness()
    catalog_input = dict(running_apps)
    catalog_input["__readiness__"] = readiness
    catalog = _build_apps_catalog(manifests, catalog_input)
    return {"ok": True, "data": catalog}


@apps_bp.get('/api/apps/templates')
def get_apps_templates():
    return {"ok": True, "data": list_app_templates()}


@apps_bp.get('/api/apps/events')
async def apps_events(request: Request):
    async def stream():
        queue = app_registry_events.subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                payload = json.dumps(event.payload, ensure_ascii=False)
                yield f"event: {event.type}\ndata: {payload}\n\n"
        finally:
            app_registry_events.unsubscribe(queue)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@apps_bp.websocket('/ws/apps')
async def apps_ws(websocket: WebSocket):
    await websocket.accept()
    registry_queue = app_registry_events.subscribe()
    shell_queue = get_event_bus().subscribe()
    receive_task: asyncio.Task | None = None
    registry_task: asyncio.Task | None = None
    shell_task: asyncio.Task | None = None

    async def _send_snapshot(event_type: str) -> None:
        await websocket.send_json({
            "type": event_type,
            "payload": await _build_apps_snapshot(),
        })

    try:
        await _send_snapshot("apps_snapshot")
        while True:
            receive_task = asyncio.create_task(websocket.receive())
            registry_task = asyncio.create_task(registry_queue.get())
            shell_task = asyncio.create_task(shell_queue.get())
            done, pending = await asyncio.wait(
                {receive_task, registry_task, shell_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

            if receive_task in done:
                message = receive_task.result()
                if message.get("type") == "websocket.disconnect":
                    break
                continue

            if registry_task in done:
                _ = registry_task.result()
                await _send_snapshot("catalog_snapshot")
                continue

            if shell_task in done:
                shell_event = shell_task.result()
                event_dict = shell_event.to_dict() if hasattr(shell_event, "to_dict") else {}
                app_id = _derive_app_id_from_shell_event(event_dict if isinstance(event_dict, dict) else {})
                if not app_id or get_app_registry().get_app(app_id) is None:
                    continue
                running = await get_app_runtime().get_running_app(app_id)
                await websocket.send_json({
                    "type": "app_running_changed",
                    "payload": {
                        "app_id": app_id,
                        "running": bool(running),
                        "event_type": event_dict.get("type"),
                        "shell_id": event_dict.get("shell_id"),
                    },
                })
    except WebSocketDisconnect:
        pass
    finally:
        for task in (receive_task, registry_task, shell_task):
            if task is None:
                continue
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        app_registry_events.unsubscribe(registry_queue)
        get_event_bus().unsubscribe(shell_queue)


@apps_bp.post('/api/apps/scaffold/proxy_shell_wrapper')
def scaffold_proxy_shell_wrapper_route(payload: dict = Body(...)):
    try:
        result = scaffold_proxy_shell_wrapper(payload or {})
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "data": result}


@apps_bp.post('/api/apps/{app_id}/validate_wrapper')
def validate_proxy_shell_wrapper_route(app_id: str):
    try:
        result = validate_proxy_shell_wrapper(app_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "data": result}


@apps_bp.get('/api/apps/{app_id}/proxy_shell')
def get_proxy_shell(app_id: str):
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' not found")

    proxy_cfg = manifest.get("proxy_shell")
    if not isinstance(proxy_cfg, dict) or proxy_cfg.get("enabled") is False:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' does not declare an enabled proxy_shell")

    urls = _proxy_shell_urls(app_id, proxy_cfg)
    return {"ok": True, "data": {"app_id": app_id, **urls}}


@apps_bp.post('/api/apps/reload')
async def reload_apps():
    """
    Reload app manifests from disk without re-registering services/routers.
    Safe for launcher refresh use-cases where manifest metadata changed.
    """
    import app.main as main_app

    manifests = apps_loader.refresh_registry()
    main_app.loaded_apps = manifests
    app_manager._LOADED_APPS = manifests
    await app_registry_events.publish("registry_reloaded", {"count": len(manifests)})
    return {"ok": True, "data": {"count": len(manifests)}}

@apps_bp.get("/app/{app_id}", response_class=HTMLResponse)
async def app_shell(app_id: str, request: Request):
    """Renders the appropriate shell for an app."""
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail="App not found")

    entrypoints = manifest.get('entrypoints', {})
    backend_required = bool(entrypoints.get('backend_blueprint'))

    # Strict stale-session handling:
    # If this app requires a backend worker and the worker is not running,
    # redirect to framework root instead of attempting to auto-start.
    if backend_required:
        running_apps = await app_manager.get_running_apps()
        app_info = running_apps.get(app_id) if isinstance(running_apps, dict) else None
        if not isinstance(app_info, dict):
            return RedirectResponse(url="/")
        port = app_info.get("port")
        if not port:
            return RedirectResponse(url="/")

    template_path = os.path.join(os.path.dirname(__file__), "..", "..", "templates", "app_shell.html")
    async with aiofiles.open(template_path, "r") as f:
        template_content = await f.read()
    
    # Basic templating, since Jinja2 is not used here
    template_content = template_content.replace("{{ app_id|tojson }}", json.dumps(app_id))
    template_content = template_content.replace("{{ url_for('static', filename='js/ws_port.js') }}", "/static/js/ws_port.js")


    return HTMLResponse(content=template_content)

def _resolve_file_response(full_path: str):
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    suffix = Path(full_path).suffix.lower()
    # Set no-cache headers for JS/CSS to ensure fresh code loads
    if suffix in {'.js', '.mjs', '.ts', '.css'}:
        headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
        media_type = "application/javascript" if suffix in {'.js', '.mjs', '.ts'} else "text/css"
        return FileResponse(full_path, media_type=media_type, headers=headers)

    return FileResponse(full_path)


@apps_bp.get("/apps/by-id/{app_id}/{filename:path}")
def serve_app_file_by_id(app_id: str, filename: str):
    """Serve app assets from the registry-backed app root."""
    resolved = get_app_registry().resolve_asset_path(app_id, filename)
    if resolved is None:
        raise HTTPException(status_code=404, detail="File not found")
    return _resolve_file_response(str(resolved))


@apps_bp.get("/apps/{app_dir}/{filename:path}")
def serve_app_file(app_dir: str, filename: str):
    """Compatibility alias for built-in app assets."""
    app_def = get_app_registry().get_app_by_dir(app_dir, source_kind="builtin")
    if app_def is None:
        raise HTTPException(status_code=404, detail="File not found")
    resolved = get_app_registry().resolve_asset_path(app_def.app_id, filename)
    if resolved is None:
        raise HTTPException(status_code=404, detail="File not found")
    return _resolve_file_response(str(resolved))

# Shell log viewer routes are now hosted by the framework_shells module under `/fws/`.
