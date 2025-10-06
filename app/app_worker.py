
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
    args = parser.parse_args()

    app = Flask(__name__)

    try:
        # Add project root to the Python path
        project_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(project_root))

        module_name = f"app.apps.{args.app_id}.{Path(args.backend_module).stem}"
        spec = importlib.util.spec_from_file_location(module_name, args.backend_module)
        if spec is None:
            raise ImportError(f"Could not create spec for module {module_name} at {args.backend_module}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        blueprint_found = False
        for obj_name in dir(module):
            obj = getattr(module, obj_name)
            if isinstance(obj, Blueprint):
                app.register_blueprint(obj)
                blueprint_found = True
                break
        
        if not blueprint_found:
            raise RuntimeError(f"No Flask Blueprint found in {args.backend_module}")

    except Exception as e:
        print(f"Error loading app backend: {e}", file=sys.stderr)
        sys.exit(1)

    app.run(host='127.0.0.1', port=args.port)

if __name__ == "__main__":
    main()
