# /data/data/com.termux/files/home/mrselect/app/libs/app_worker.py

import argparse
import importlib.util
import os
import signal
import sys
from pathlib import Path

from fastapi import FastAPI, APIRouter
import uvicorn

def main():
    parser = argparse.ArgumentParser(description="Termux Extensions App Worker")
    parser.add_argument("--app-id", required=True, help="The ID of the app to run.")
    parser.add_argument("--port", required=True, type=int, help="The port to run the app on.")
    parser.add_argument("--backend-module", required=True, help="The path to the backend module.")
    args = parser.parse_args()

    app = FastAPI()

    try:
        # Add project root to the Python path
        project_root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(project_root))

        module_name = f"app.apps.{args.app_id}.{Path(args.backend_module).stem}"
        spec = importlib.util.spec_from_file_location(module_name, args.backend_module)
        if spec is None:
            raise ImportError(f"Could not create spec for module {module_name} at {args.backend_module}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Look for the main router with app_id in the name (e.g., file_editor_cm6_bp)
        # This ensures we get the main router, not sub-routers that are included in it
        expected_router_name = f"{args.app_id}_bp"
        router_found = False
        router_obj = None
        
        print(f"DEBUG: Looking for main router '{expected_router_name}' in module", file=sys.stderr)
        
        for obj_name in dir(module):
            obj = getattr(module, obj_name)
            if isinstance(obj, APIRouter):
                print(f"DEBUG: Found APIRouter '{obj_name}' with {len(obj.routes)} routes", file=sys.stderr)
                
                # Prioritize exact match with expected name
                if obj_name == expected_router_name:
                    print(f"DEBUG: Using main router '{obj_name}' (exact match)", file=sys.stderr)
                    for route in list(obj.routes)[:10]:
                        route_path = getattr(route, 'path', 'NO_PATH')
                        print(f"  - {route_path}", file=sys.stderr)
                    if len(obj.routes) > 10:
                        print(f"  ... and {len(obj.routes) - 10} more routes", file=sys.stderr)
                    
                    app.include_router(obj)
                    router_obj = obj
                    router_found = True
                    break
        
        if not router_found:
            raise RuntimeError(f"No FastAPI APIRouter named '{expected_router_name}' found in {args.backend_module}")
        
        # Check for NiceGUI or other init hooks
        nicegui_init = getattr(module, 'NICEGUI_INIT_HOOK', None)
        if nicegui_init:
            print(f"DEBUG: Calling NICEGUI_INIT_HOOK", file=sys.stderr)
            nicegui_init(app)
        
        # Mount optional sub-apps if the backend module provides them (fallback)
        subapps = getattr(module, 'SUBAPPS', None)
        if subapps:
            print(f"DEBUG: Mounting {len(subapps)} sub-app(s)", file=sys.stderr)
            for path, subapp in subapps:
                print(f"  - Mounting at {path}", file=sys.stderr)
                app.mount(path, subapp)

    except Exception as e:
        print(f"Error loading app backend: {e}", file=sys.stderr)
        sys.exit(1)

    # Final check: how many routes does the app have?
    print(f"DEBUG: FastAPI app has {len(app.routes)} total routes before uvicorn.run()", file=sys.stderr)
    for route in list(app.routes)[:15]:
        route_path = getattr(route, 'path', 'NO_PATH')
        route_name = getattr(route, 'name', 'NO_NAME')
        print(f"  - {route_path} ({route_name})", file=sys.stderr)
    if len(app.routes) > 15:
        print(f"  ... and {len(app.routes) - 15} more routes", file=sys.stderr)
    
    print(f"DEBUG: Starting uvicorn on http://127.0.0.1:{args.port}", file=sys.stderr)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=args.port,
        timeout_graceful_shutdown=2.0,
        log_config=None,
    )
    server = uvicorn.Server(config)

    def _force_exit(signum, _frame):
        print(f"[app-worker] Received signal {signum}; forcing shutdown", file=sys.stderr)
        server.force_exit = True
        server.should_exit = True

    signal.signal(signal.SIGTERM, _force_exit)
    signal.signal(signal.SIGINT, _force_exit)

    server.run()

if __name__ == "__main__":
    main()
