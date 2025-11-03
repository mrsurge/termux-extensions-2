
import argparse
import importlib.util
import os
import sys
from pathlib import Path

from flask import Flask, Blueprint

def main():
    parser = argparse.ArgumentParser(description="Termux Extensions App Worker")
    parser.add_argument("--app-id", required=True, help="The ID of the app to run.")
    parser.add_argument("--port", required=True, type=int, help="The port to run the app on.")
    parser.add_argument("--backend-module", required=True, help="The path to the backend module.")
    parser.add_argument("--socket-prefix", required=False, help="Raw websocket prefix for the worker (e.g. '_nicegui_ws')")
    args = parser.parse_args()

    app = Flask(__name__)

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

        init_app = getattr(module, "init_app", None)
        if callable(init_app):
            init_app(app)

        run_worker = getattr(module, "run_worker", None)

        blueprint_found = False
        for obj_name in dir(module):
            obj = getattr(module, obj_name)
            if isinstance(obj, Blueprint):
                app.register_blueprint(obj)
                blueprint_found = True
                break

        sock_obj = getattr(module, "sock", None)
        if sock_obj is not None and hasattr(sock_obj, "init_app"):
            try:
                sock_obj.init_app(app)
            except Exception as sock_err:
                raise RuntimeError(f"Failed to initialize WebSocket routes: {sock_err}") from sock_err

        if callable(run_worker):
            kwargs = {'host': '127.0.0.1', 'port': args.port, 'flask_app': app}
            if args.socket_prefix:
                kwargs['socket_prefix'] = args.socket_prefix
            run_worker(**kwargs)
            return

        if not blueprint_found:
            raise RuntimeError(f"No Flask Blueprint found in {args.backend_module}")

    except Exception as e:
        print(f"Error loading app backend: {e}", file=sys.stderr)
        sys.exit(1)

    app.run(host='127.0.0.1', port=args.port)

if __name__ == "__main__":
    main()
