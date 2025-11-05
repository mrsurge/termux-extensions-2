import os
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
import time
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from app.libs.app_manager import ensure_app_running
from app.libs import app_lifecycle
from app.libs.framework_shells import FrameworkShellManager, get_manager as get_framework_shell_manager
from app.main import loaded_apps

apps_bp = APIRouter()



@apps_bp.post('/api/apps/{app_id}/start')
def start_app(app_id: str):
    try:
        app_info = ensure_app_running(app_id)
        return {"ok": True, "data": app_info}
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=500, detail=str(e))

@apps_bp.post('/api/apps/{app_id}/quit')
def quit_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """
    A new, specific endpoint for quitting an app.
    """
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_quit = next((app for app in running_apps if app.get("app_id") == app_id), None)

    if not app_to_quit:
        raise HTTPException(status_code=404, detail="App is not running or already terminated.")

    shell_id = app_to_quit["shell_id"]
    terminated = app_lifecycle.terminate_app(manager, shell_id)

    if terminated:
        return {"ok": True, "data": {"message": f"App {app_id} terminated."}}
    else:
        raise HTTPException(status_code=500, detail="Failed to terminate app.")

@apps_bp.post('/api/apps/{app_id}/lock')
def lock_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Sets the lock state for an app to true."""
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_lock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_lock:
        raise HTTPException(status_code=404, detail="App not running.")
    
    updated_app = app_lifecycle.set_lock_state(app_to_lock["shell_id"], True)
    return {"ok": True, "data": updated_app}

@apps_bp.post('/api/apps/{app_id}/unlock')
def unlock_app(app_id: str, manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Sets the lock state for an app to false."""
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_unlock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_unlock:
        raise HTTPException(status_code=404, detail="App not running.")
    
    updated_app = app_lifecycle.set_lock_state(app_to_unlock["shell_id"], False)
    return {"ok": True, "data": updated_app}

@apps_bp.get('/api/apps/running')
def get_running_apps(manager: FrameworkShellManager = Depends(get_framework_shell_manager)):
    """Returns a list of all currently running app shells with stats."""
    running_apps = app_lifecycle.get_running_apps(manager)
    # We need to augment this with data from the main app manifests (like name and icon)
    all_apps = {app['id']: app for app in loaded_apps}
    
    augmented_apps = []
    for app in running_apps:
        manifest_data = all_apps.get(app.get('app_id'))
        if manifest_data:
            app['name'] = manifest_data.get('name')
            app['icon_emoji'] = manifest_data.get('icon_emoji')
        augmented_apps.append(app)
        
    return {"ok": True, "data": augmented_apps}

@apps_bp.get('/api/apps')
def get_apps():
    """
    This endpoint is now responsible for providing the list of available applications.
    The actual loading and blueprint registration still happens at startup in app/main.py.
    """
    return {"ok": True, "data": loaded_apps}

@apps_bp.get("/app/{app_id}", response_class=HTMLResponse)
async def app_shell(app_id: str, request: Request):
    """Renders the appropriate shell for an app."""
    manifest = next((app for app in loaded_apps if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail="App not found")

    entrypoints = manifest.get('entrypoints', {})
    if entrypoints.get('nicegui_shell'):
        app_info = ensure_app_running(app_id)
        port = app_info.get('port') if isinstance(app_info, dict) else None
        if not port:
            raise HTTPException(status_code=502, detail="App worker not running")

        time.sleep(2.0)
        host_only = request.url.hostname
        scheme = request.url.scheme
        redirect_url = f"{scheme}://{host_only}:{port}/"
        return RedirectResponse(url=redirect_url)

    template_path = os.path.join(os.path.dirname(__file__), "..", "..", "templates", "app_shell.html")
    with open(template_path, "r") as f:
        template_content = f.read()
    
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
    # Ensure JS modules are served with a JS MIME type so dynamic import() works reliably
    if filename.endswith(('.js', '.mjs')):
        return FileResponse(full_path, media_type="application/javascript")
    return FileResponse(full_path)
