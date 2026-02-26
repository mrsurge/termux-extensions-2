import os
import json
import aiofiles
import contextlib

# Get project root reliably - app module's parent
import app
project_root = os.path.dirname(os.path.dirname(os.path.abspath(app.__file__)))
import time
import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, Request, HTTPException, WebSocket, Body
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from app.libs.app_manager import ensure_app_running
from app.libs import app_manager
from app.libs import app_lifecycle
from framework_shells import FrameworkShellManager, get_manager as _get_framework_shell_manager

async def get_framework_shell_manager() -> FrameworkShellManager:
    """FastAPI dependency wrapper (framework_shells.get_manager has **kwargs)."""
    return await _get_framework_shell_manager()
from urllib.parse import urlencode

# Avoid circular import - will be accessed dynamically
def get_loaded_apps():
    """Get loaded apps from app.main module at runtime."""
    import app.main
    return app.main.loaded_apps


def _resolve_manifest_icon_src(manifest: dict) -> str:
    raw = manifest.get("icon_src")
    if not isinstance(raw, str):
        return ""
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://") or value.startswith("/"):
        return value
    app_dir = manifest.get("_dir")
    if isinstance(app_dir, str) and app_dir.strip():
        return f"/apps/{app_dir.strip()}/{value.lstrip('/')}"
    return value


def _build_apps_catalog(manifests: list, running_apps: dict | None = None) -> list[dict]:
    running = running_apps or {}
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
        nicegui_shell = bool(entrypoints.get("nicegui_shell"))
        icon_src_resolved = _resolve_manifest_icon_src(manifest)

        catalog.append({
            "id": app_id,
            "name": manifest.get("name") or app_id,
            "description": manifest.get("description") or "",
            "_dir": manifest.get("_dir"),
            "icon_src": icon_src_resolved,
            "icon_src_raw": manifest.get("icon_src") if isinstance(manifest.get("icon_src"), str) else "",
            "icon_emoji": manifest.get("icon_emoji") if isinstance(manifest.get("icon_emoji"), str) else "",
            "fullscreen": bool(manifest.get("fullscreen")),
            "backend_required": backend_required,
            "nicegui_shell": nicegui_shell,
            "running": app_id in running,
            "launch_url": f"/app/{app_id}",
            "embed_url": f"/app/{app_id}?embed=1",
        })

    catalog.sort(key=lambda item: str(item.get("name") or item.get("id") or "").lower())
    return catalog


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
        app_info = await ensure_app_running(app_id)
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
        app_info = await ensure_app_running(app_id)
        print(f"[AppsExtension] start_app succeeded for {app_id}: shell={app_info.get('shell_id')} port={app_info.get('port')}")
        return {"ok": True, "data": app_info}
    except (ValueError, RuntimeError) as e:
        print(f"[AppsExtension] start_app failed for {app_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@apps_bp.post('/api/apps/{app_id}/quit')
async def quit_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """
    A new, specific endpoint for quitting an app.
    """
    print(f"[AppsExtension] quit_app requested for {app_id}")
    running_apps = await app_lifecycle.get_running_apps(manager)
    app_to_quit = next((app for app in running_apps if app.get("app_id") == app_id), None)

    if not app_to_quit:
        print(f"[AppsExtension] quit_app: app {app_id} not running")
        raise HTTPException(status_code=404, detail="App is not running or already terminated.")

    shell_id = app_to_quit["shell_id"]
    terminated = await app_lifecycle.terminate_app(manager, shell_id)
    print(f"[AppsExtension] quit_app terminate_app(shell_id={shell_id}) -> {terminated}")

    if terminated:
        return {"ok": True, "data": {"message": f"App {app_id} terminated."}}
    else:
        raise HTTPException(status_code=500, detail="Failed to terminate app.")

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
            app['icon_src'] = manifest_data.get('icon_src')
            app['_dir'] = manifest_data.get('_dir')
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
    running_apps = await app_manager.get_running_apps()
    catalog = _build_apps_catalog(manifests, running_apps)
    return {"ok": True, "data": catalog}


@apps_bp.post('/api/apps/reload')
def reload_apps():
    """
    Reload app manifests from disk without re-registering services/routers.
    Safe for launcher refresh use-cases where manifest metadata changed.
    """
    from app.extensions.apps import loader as apps_loader
    import app.main as main_app

    manifests = apps_loader.load_apps()
    main_app.loaded_apps = manifests
    app_manager._LOADED_APPS = manifests
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
    if backend_required and not entrypoints.get('nicegui_shell'):
        running_apps = await app_manager.get_running_apps()
        if app_id not in running_apps:
            return RedirectResponse(url="/")
        if app_id == "file_editor_cm6":
            app_info = running_apps.get(app_id) or {}
            port = app_info.get("port")
            if not port:
                return RedirectResponse(url="/")
            if not await _is_local_port_open(int(port)):
                return RedirectResponse(url="/")

    if entrypoints.get('nicegui_shell'):
        running_apps = await app_manager.get_running_apps()
        app_info = running_apps.get(app_id)
        port = app_info.get('port') if isinstance(app_info, dict) else None
        if not port:
            return RedirectResponse(url="/")

        host_only = request.url.hostname
        scheme = request.url.scheme
        redirect_url = f"{scheme}://{host_only}:{port}/"
        return RedirectResponse(url=redirect_url)

    template_path = os.path.join(os.path.dirname(__file__), "..", "..", "templates", "app_shell.html")
    async with aiofiles.open(template_path, "r") as f:
        template_content = await f.read()
    
    # Basic templating, since Jinja2 is not used here
    template_content = template_content.replace("{{ app_id|tojson }}", json.dumps(app_id))
    template_content = template_content.replace("{{ url_for('static', filename='js/ws_port.js') }}", "/static/js/ws_port.js")


    return HTMLResponse(content=template_content)

@apps_bp.get("/apps/{app_dir}/{filename:path}")
def serve_app_file(app_dir: str, filename: str):
    """Serves static assets for a specific app."""
    full_path = os.path.join(project_root, 'app', 'apps', app_dir, filename)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    # Set no-cache headers for JS/CSS to ensure fresh code loads
    if filename.endswith(('.js', '.mjs', '.css')):
        headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
        media_type = "application/javascript" if filename.endswith(('.js', '.mjs')) else "text/css"
        return FileResponse(full_path, media_type=media_type, headers=headers)
    
    return FileResponse(full_path)

# Shell log viewer routes are now hosted by the framework_shells module under `/fws/`.
