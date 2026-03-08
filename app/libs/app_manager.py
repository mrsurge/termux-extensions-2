from __future__ import annotations

from app.extensions.apps import loader as apps_loader

# Compatibility surface for existing imports. The authoritative app registry/runtime
# now lives under app.extensions.apps.
_LOADED_APPS: list[dict] = []


async def initialize_running_apps():
    return await apps_loader.initialize_runtime()


async def ensure_app_running(app_id):
    return await apps_loader.get_app_runtime().start_app(app_id)


async def get_running_apps():
    return await apps_loader.get_app_runtime().get_running_app_map()


def get_loaded_apps():
    loaded = apps_loader.get_loaded_apps()
    if loaded:
        return loaded
    return list(_LOADED_APPS)
