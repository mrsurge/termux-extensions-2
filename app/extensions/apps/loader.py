from __future__ import annotations

import importlib.util
import re
import traceback
from pathlib import Path
from typing import Optional

from fastapi import APIRouter

from app.extensions.apps.registry import AppDefinition, AppRegistry
from app.extensions.apps.runtime import AppRuntime

_APP_REGISTRY: Optional[AppRegistry] = None
_APP_RUNTIME: Optional[AppRuntime] = None
_LOADED_APPS: list[dict] = []
_REGISTERED_SERVICE_MODULES: set[str] = set()
_APP_ERRORS: dict[str, list[str]] = {}


def _slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "")).strip("_") or "app"


def get_app_registry(*, reload: bool = False) -> AppRegistry:
    global _APP_REGISTRY
    if _APP_REGISTRY is None:
        _APP_REGISTRY = AppRegistry()
        reload = True
    if reload:
        _APP_REGISTRY.reload()
    return _APP_REGISTRY


def get_app_runtime() -> AppRuntime:
    global _APP_RUNTIME
    registry = get_app_registry()
    if _APP_RUNTIME is None or _APP_RUNTIME.registry is not registry:
        _APP_RUNTIME = AppRuntime(registry)
    return _APP_RUNTIME


def _set_app_error(app_id: str, message: str) -> None:
    _APP_ERRORS.setdefault(app_id, []).append(message)


def _serialize_apps(apps: list[AppDefinition]) -> list[dict]:
    payloads: list[dict] = []
    for app_def in apps:
        payload = app_def.to_payload()
        errors = list(app_def.registry_errors)
        errors.extend(_APP_ERRORS.get(app_def.app_id, []))
        if errors:
            payload["__service_errors__"] = errors
        payloads.append(payload)
    return payloads


def _collect_registry_errors(apps: list[AppDefinition]) -> None:
    from app.extensions.apps.proxy_shell import validate_proxy_shell_manifest

    for app_def in apps:
        for err in validate_proxy_shell_manifest(app_def.raw_manifest):
            _set_app_error(app_def.app_id, f"proxy_shell: {err}")


def load_apps() -> list[dict]:
    registry = get_app_registry(reload=True)
    global _APP_ERRORS
    _APP_ERRORS = {}
    _collect_registry_errors(registry.list_apps())
    global _LOADED_APPS
    _LOADED_APPS = _serialize_apps(registry.list_apps())
    return list(_LOADED_APPS)


def _load_service_module(module_path: Path, module_name: str, app) -> None:
    spec = importlib.util.spec_from_file_location(module_name, str(module_path))
    if not spec or not spec.loader:
        raise RuntimeError(f"Failed to load spec for {module_name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if hasattr(module, "register") and callable(getattr(module, "register")):
        module.register(app)

    for attr_name in dir(module):
        if attr_name.startswith("_"):
            continue
        attr = getattr(module, attr_name)
        if isinstance(attr, APIRouter):
            app.include_router(attr)


def load_app_services(apps: list[AppDefinition], app) -> None:
    for app_def in apps:
        if not app_def.service_modules:
            continue
        services_dir = app_def.root_dir / (app_def.services_path or "services")
        for module_name in app_def.service_modules:
            module_path = (services_dir / f"{module_name}.py").resolve()
            module_key = str(module_path)
            if module_key in _REGISTERED_SERVICE_MODULES:
                continue
            if not module_path.exists():
                _set_app_error(app_def.app_id, f"Missing service module: {module_path}")
                continue
            fq_name = (
                f"te2_apps.services.{_slug(app_def.source_kind)}."
                f"{_slug(app_def.app_id)}.{_slug(module_name)}"
            )
            try:
                _load_service_module(module_path, fq_name, app)
                _REGISTERED_SERVICE_MODULES.add(module_key)
            except Exception as exc:
                _set_app_error(app_def.app_id, f"{module_name}: {type(exc).__name__}: {exc}")
                _set_app_error(app_def.app_id, traceback.format_exc()[-2048:])


def refresh_registry() -> list[dict]:
    registry = get_app_registry(reload=True)
    global _APP_ERRORS
    _APP_ERRORS = {}
    _collect_registry_errors(registry.list_apps())
    global _LOADED_APPS
    _LOADED_APPS = _serialize_apps(registry.list_apps())
    return list(_LOADED_APPS)


async def initialize_runtime() -> list[dict]:
    runtime = get_app_runtime()
    return await runtime.adopt_running_apps()


def load_apps_and_services(app) -> list[dict]:
    global _APP_ERRORS, _LOADED_APPS
    _APP_ERRORS = {}
    registry = get_app_registry(reload=True)
    apps = registry.list_apps()

    from app.extensions.apps.proxy_shell import register_proxy_shell_engine
    from app.extensions.apps.sio_service import register_sio_service_proxy

    _collect_registry_errors(apps)
    load_app_services(apps, app)
    for app_def in apps:
        try:
            register_sio_service_proxy(app_def, app)
        except Exception as exc:
            _set_app_error(app_def.app_id, f"sio_service: {type(exc).__name__}: {exc}")
    register_proxy_shell_engine(app)
    _LOADED_APPS = _serialize_apps(apps)
    return list(_LOADED_APPS)


def get_loaded_apps() -> list[dict]:
    return list(_LOADED_APPS)
