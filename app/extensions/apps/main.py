import os
import json
import aiofiles

# Get project root reliably - app module's parent
import app
project_root = os.path.dirname(os.path.dirname(os.path.abspath(app.__file__)))
import time
import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, Request, HTTPException, WebSocket
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from app.libs.app_manager import ensure_app_running
from app.libs import app_lifecycle
from app.libs.framework_shells import FrameworkShellManager, get_manager as get_framework_shell_manager

# Avoid circular import - will be accessed dynamically
def get_loaded_apps():
    """Get loaded apps from app.main module at runtime."""
    import app.main
    return app.main.loaded_apps

apps_bp = APIRouter()



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
        augmented_apps.append(app)
        
    return {"ok": True, "data": augmented_apps}

@apps_bp.get('/api/apps')
def get_apps():
    """
    This endpoint is now responsible for providing the list of available applications.
    The actual loading and blueprint registration still happens at startup in app/main.py.
    """
    return {"ok": True, "data": get_loaded_apps()}

@apps_bp.get("/app/{app_id}", response_class=HTMLResponse)
async def app_shell(app_id: str, request: Request):
    """Renders the appropriate shell for an app."""
    manifest = next((app for app in get_loaded_apps() if app.get('id') == app_id), None)
    if not manifest:
        raise HTTPException(status_code=404, detail="App not found")

    entrypoints = manifest.get('entrypoints', {})
    if entrypoints.get('nicegui_shell'):
        print(f"[AppsExtension] app_shell launching nicegui app {app_id}")
        app_info = await ensure_app_running(app_id)
        port = app_info.get('port') if isinstance(app_info, dict) else None
        if not port:
            raise HTTPException(status_code=502, detail="App worker not running")

        await asyncio.sleep(2.0)
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

@apps_bp.get("/shell-logs/{shell_id}", response_class=HTMLResponse)
async def shell_logs_viewer(shell_id: str):
    """Render log viewer for a framework shell."""
    template_path = os.path.join(project_root, 'app', 'templates', 'shell_log_viewer.html')
    async with aiofiles.open(template_path, "r") as f:
        content = await f.read()
    content = content.replace("{{ shell_id }}", shell_id)
    return HTMLResponse(content=content)

@apps_bp.websocket("/ws/shell-logs/{shell_id}")
async def shell_logs_ws(websocket: WebSocket, shell_id: str):
    """WebSocket endpoint for tailing framework shell logs (both stdout and stderr)."""
    await websocket.accept()
    print(f"[AppsExtension] shell_logs_ws subscribed shell_id={shell_id}")
    
    logs_dir = Path.home() / ".cache/te_framework/logs"
    stdout_path = logs_dir / f"{shell_id}.stdout.log"
    stderr_path = logs_dir / f"{shell_id}.stderr.log"
    
    if not await asyncio.to_thread(stdout_path.exists) and not await asyncio.to_thread(stderr_path.exists):
        await websocket.send_json({
            "type": "error",
            "message": f"No log files found for {shell_id}"
        })
        await websocket.close()
        print(f"[AppsExtension] shell_logs_ws no logs for {shell_id}, closing")
        return
    
    try:
        # Send initial 200 lines from both logs
        stdout_lines = []
        if await asyncio.to_thread(stdout_path.exists):
            async with aiofiles.open(stdout_path, 'r') as f:
                stdout_lines = (await f.read()).splitlines()
        
        stderr_lines = []
        if await asyncio.to_thread(stderr_path.exists):
            async with aiofiles.open(stderr_path, 'r') as f:
                stderr_lines = (await f.read()).splitlines()
        
        stdout_initial = '\n'.join(stdout_lines[-200:])
        stderr_initial = '\n'.join(stderr_lines[-200:])
        
        await websocket.send_json({
            "type": "initial",
            "stdout": stdout_initial,
            "stderr": stderr_initial
        })
        print(f"[AppsExtension] shell_logs_ws sent initial payload for {shell_id}")
        
        # Track file sizes for tailing
        stdout_size = (await asyncio.to_thread(stdout_path.stat)).st_size if await asyncio.to_thread(stdout_path.exists) else 0
        stderr_size = (await asyncio.to_thread(stderr_path.stat)).st_size if await asyncio.to_thread(stderr_path.exists) else 0
        
        while True:
            await asyncio.sleep(1)  # Poll every second
            
            # Check stdout
            if await asyncio.to_thread(stdout_path.exists):
                current_stdout = (await asyncio.to_thread(stdout_path.stat)).st_size
                if current_stdout > stdout_size:
                    async with aiofiles.open(stdout_path, 'r') as f:
                        await f.seek(stdout_size)
                        new_content = await f.read()
                        await websocket.send_json({
                            "type": "update",
                            "stream": "stdout",
                            "data": new_content
                        })
                    stdout_size = current_stdout
                elif current_stdout < stdout_size:
                    stdout_size = 0
            
            # Check stderr
            if await asyncio.to_thread(stderr_path.exists):
                current_stderr = (await asyncio.to_thread(stderr_path.stat)).st_size
                if current_stderr > stderr_size:
                    async with aiofiles.open(stderr_path, 'r') as f:
                        await f.seek(stderr_size)
                        new_content = await f.read()
                        await websocket.send_json({
                            "type": "update",
                            "stream": "stderr",
                            "data": new_content
                        })
                    stderr_size = current_stderr
                elif current_stderr < stderr_size:
                    stderr_size = 0
                    
    except Exception as e:
        print(f"Log tail error: {e}")
    finally:
        await websocket.close()
