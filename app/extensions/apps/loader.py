import importlib.util
import json
import os
import traceback
from typing import Dict, List

from fastapi import APIRouter

# Resolve project root using the installed app package path.
import app as app_pkg
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(app_pkg.__file__)))
_APPS_DIR = os.path.join(_PROJECT_ROOT, 'app', 'apps')


def load_apps() -> List[dict]:
    """Scan for apps, load their manifests, and return the list."""
    apps = []
    if not os.path.exists(_APPS_DIR):
        return []

    for app_name in os.listdir(_APPS_DIR):
        app_path = os.path.join(_APPS_DIR, app_name)
        manifest_path = os.path.join(app_path, 'manifest.json')
        if not os.path.isdir(app_path) or not os.path.exists(manifest_path):
            continue

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
            manifest['_dir'] = app_name
            apps.append(manifest)

    return apps


def _load_service_module(module_path: str, module_name: str, app) -> None:
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Failed to load spec for {module_name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Optional hook
    if hasattr(module, "register") and callable(getattr(module, "register")):
        module.register(app)

    # Auto-register APIRouter instances
    for attr_name in dir(module):
        if attr_name.startswith('_'):
            continue
        attr = getattr(module, attr_name)
        if isinstance(attr, APIRouter):
            app.include_router(attr)


def load_app_services(apps: List[dict], app) -> None:
    """Load per-app services declared in manifest.services."""
    for manifest in apps:
        services = manifest.get("services")
        if not isinstance(services, dict):
            continue

        rel_path = (services.get("path") or "services").strip()
        modules = services.get("modules") or []
        if not isinstance(modules, list) or not modules:
            continue

        app_dir = os.path.join(_APPS_DIR, manifest["_dir"])
        services_dir = os.path.join(app_dir, rel_path)

        for module_name in modules:
            if not isinstance(module_name, str) or not module_name.strip():
                continue
            module_name = module_name.strip()
            module_path = os.path.join(services_dir, f"{module_name}.py")
            if not os.path.exists(module_path):
                manifest.setdefault("__service_errors__", []).append(
                    f"Missing service module: {module_path}"
                )
                continue

            fq_name = f"app.apps.{manifest['_dir']}.{rel_path.replace('/', '.')}.{module_name}"
            try:
                _load_service_module(module_path, fq_name, app)
            except Exception as exc:
                manifest.setdefault("__service_errors__", []).append(
                    f"{module_name}: {type(exc).__name__}: {exc}"
                )
                manifest.setdefault("__service_trace__", []).append(
                    traceback.format_exc()[-2048:]
                )


def load_apps_and_services(app) -> List[dict]:
    # App services run in the main process and are loaded here by design.
    apps = load_apps()
    load_app_services(apps, app)
    return apps
