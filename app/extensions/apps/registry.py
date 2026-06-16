from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

import app as app_pkg


def _builtin_apps_root() -> Path:
    project_root = Path(app_pkg.__file__).resolve().parents[1]
    return project_root / "app" / "apps"


def builtin_templates_root() -> Path:
    return _builtin_apps_root() / "_templates"


def te2_data_root() -> Path:
    return Path.home() / ".local" / "share" / "te2"


def te2_apps_root() -> Path:
    return te2_data_root() / "apps"


def te2_templates_root() -> Path:
    return te2_data_root() / "templates"


def ensure_user_local_layout() -> None:
    data_root = te2_data_root()
    apps_root = te2_apps_root()
    templates_root = te2_templates_root()
    builtin_templates = builtin_templates_root()

    data_root.mkdir(parents=True, exist_ok=True)
    apps_root.mkdir(parents=True, exist_ok=True)

    if not templates_root.exists() and builtin_templates.exists():
        shutil.copytree(builtin_templates, templates_root)


def default_app_roots() -> list[tuple[str, Path]]:
    return [
        ("builtin", _builtin_apps_root()),
        ("user_local", te2_apps_root()),
    ]


@dataclass(frozen=True)
class AppShell:
    ref: Optional[str] = None
    inline_spec: Optional[dict[str, Any]] = None
    label: Optional[str] = None
    subgroup: str = "app-worker"
    wait_ready: bool = True
    env: dict[str, str] = field(default_factory=dict)
    ui: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AppDefinition:
    app_id: str
    name: str
    description: str
    dir_name: str
    root_dir: Path
    manifest_path: Path
    source_kind: str
    source_root: Path
    asset_base_url: str
    entrypoints: dict[str, Any] = field(default_factory=dict)
    shells: list[AppShell] = field(default_factory=list)
    services_path: Optional[str] = None
    service_modules: list[str] = field(default_factory=list)
    proxy_shell: Optional[dict[str, Any]] = None
    framework_shell_ui: Optional[dict[str, Any]] = None
    icon_src_raw: str = ""
    icon_text: str = ""
    icon_emoji: str = ""
    fullscreen: bool = False
    readiness_support: bool = False
    enabled: bool = True
    raw_manifest: dict[str, Any] = field(default_factory=dict)
    registry_errors: list[str] = field(default_factory=list)

    @property
    def backend_module(self) -> Optional[str]:
        value = self.entrypoints.get("backend_blueprint")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def frontend_template(self) -> Optional[str]:
        value = self.entrypoints.get("frontend_template")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def frontend_script(self) -> Optional[str]:
        value = self.entrypoints.get("frontend_script")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def icon_src(self) -> str:
        raw = (self.icon_src_raw or "").strip()
        if not raw:
            return ""
        if raw.startswith(("http://", "https://", "/")):
            return raw
        return f"{self.asset_base_url}/{raw.lstrip('/')}"

    def to_payload(self, *, include_compat_dir: bool = True) -> dict[str, Any]:
        sidebar_state = self.raw_manifest.get("sidebar_state")
        if not isinstance(sidebar_state, dict):
            sidebar_state = None
        payload = {
            "id": self.app_id,
            "name": self.name,
            "description": self.description,
            "entrypoints": dict(self.entrypoints),
            "fullscreen": self.fullscreen,
            "icon_src": self.icon_src,
            "icon_src_raw": self.icon_src_raw,
            "icon_text": self.icon_text,
            "icon_emoji": self.icon_emoji,
            "source_kind": self.source_kind,
            "source_root": str(self.source_root),
            "root_dir": str(self.root_dir),
            "manifest_path": str(self.manifest_path),
            "asset_base_url": self.asset_base_url,
            "proxy_shell": self.proxy_shell,
            "sidebar_state": sidebar_state,
            "readiness_support": self.readiness_support,
            "enabled": self.enabled,
        }
        if include_compat_dir:
            payload["_dir"] = self.dir_name
        if self.registry_errors:
            payload["__service_errors__"] = list(self.registry_errors)
        return payload

    def to_catalog_payload(self, *, running: bool = False) -> dict[str, Any]:
        sidebar_state = self.raw_manifest.get("sidebar_state")
        if not isinstance(sidebar_state, dict):
            sidebar_state = None
        return {
            "id": self.app_id,
            "name": self.name,
            "description": self.description,
            "_dir": self.dir_name,
            "icon_src": self.icon_src,
            "icon_src_raw": self.icon_src_raw,
            "icon_text": self.icon_text,
            "icon_emoji": self.icon_emoji,
            "fullscreen": self.fullscreen,
            "backend_required": bool(self.backend_module),
            "running": running,
            "launch_url": f"/app/{self.app_id}",
            "embed_url": f"/app/{self.app_id}?embed=1",
            "source_kind": self.source_kind,
            "asset_base_url": self.asset_base_url,
            "sidebar_state": sidebar_state,
            "readiness_support": self.readiness_support,
            "enabled": self.enabled,
        }


def _resolve_shells(manifest: dict[str, Any], app_root: Path) -> list[AppShell]:
    shells: list[AppShell] = []
    shellspec_cfg = manifest.get("shellspec")
    if isinstance(shellspec_cfg, dict):
        ref = shellspec_cfg.get("app_worker") or shellspec_cfg.get("worker")
        if isinstance(ref, str) and ref.strip():
            shells.append(AppShell(ref=ref.strip()))
        elif isinstance(ref, dict):
            shells.append(AppShell(inline_spec=ref))

    if shells:
        return shells

    default_path = app_root / "shellspec" / "app_worker.yaml"
    if default_path.exists():
        shells.append(AppShell(ref="shellspec/app_worker.yaml#app-worker"))
    return shells


class AppRegistry:
    def __init__(self, roots: Optional[Iterable[tuple[str, Path]]] = None):
        self._roots = [(kind, Path(root)) for kind, root in (roots or default_app_roots())]
        self._apps: dict[str, AppDefinition] = {}
        self._apps_by_dir: dict[str, AppDefinition] = {}

    @property
    def roots(self) -> list[tuple[str, Path]]:
        return list(self._roots)

    def list_apps(self) -> list[AppDefinition]:
        return sorted(self._apps.values(), key=lambda item: (item.name or item.app_id).lower())

    def get_app(self, app_id: str) -> Optional[AppDefinition]:
        return self._apps.get(str(app_id or "").strip())

    def get_app_by_dir(self, dir_name: str, *, source_kind: Optional[str] = None) -> Optional[AppDefinition]:
        app = self._apps_by_dir.get(str(dir_name or "").strip())
        if app is None:
            return None
        if source_kind and app.source_kind != source_kind:
            return None
        return app

    def resolve_asset_path(self, app_id: str, filename: str) -> Optional[Path]:
        app = self.get_app(app_id)
        if app is None:
            return None
        candidate = (app.root_dir / filename).resolve()
        try:
            candidate.relative_to(app.root_dir.resolve())
        except ValueError:
            return None
        return candidate

    def reload(self) -> list[AppDefinition]:
        apps: dict[str, AppDefinition] = {}
        apps_by_dir: dict[str, AppDefinition] = {}

        for source_kind, source_root in self._roots:
            if not source_root.exists():
                continue
            for app_dir in sorted(source_root.iterdir(), key=lambda path: path.name.lower()):
                if not app_dir.is_dir():
                    continue
                if app_dir.name.startswith("_"):
                    continue
                manifest_path = app_dir / "manifest.json"
                if not manifest_path.exists():
                    continue
                try:
                    manifest = json.loads(manifest_path.read_text())
                except Exception as exc:
                    broken_id = app_dir.name
                    apps[broken_id] = AppDefinition(
                        app_id=broken_id,
                        name=broken_id,
                        description="",
                        dir_name=app_dir.name,
                        root_dir=app_dir,
                        manifest_path=manifest_path,
                        source_kind=source_kind,
                        source_root=source_root,
                        asset_base_url=f"/apps/by-id/{broken_id}",
                        registry_errors=[f"manifest load failed: {type(exc).__name__}: {exc}"],
                    )
                    continue

                app_id = str(manifest.get("id") or app_dir.name).strip()
                if not app_id:
                    app_id = app_dir.name

                if app_id in apps:
                    existing = apps[app_id]
                    errors = list(existing.registry_errors)
                    errors.append(
                        f"duplicate app_id '{app_id}' ignored from {manifest_path} (already loaded from {existing.manifest_path})"
                    )
                    apps[app_id] = AppDefinition(
                        **{**existing.__dict__, "registry_errors": errors}
                    )
                    continue

                entrypoints = manifest.get("entrypoints")
                if not isinstance(entrypoints, dict):
                    entrypoints = {}

                services = manifest.get("services")
                services_path: Optional[str] = None
                service_modules: list[str] = []
                if isinstance(services, dict):
                    raw_path = services.get("path")
                    if isinstance(raw_path, str) and raw_path.strip():
                        services_path = raw_path.strip()
                    modules = services.get("modules")
                    if isinstance(modules, list):
                        service_modules = [item.strip() for item in modules if isinstance(item, str) and item.strip()]

                proxy_shell = manifest.get("proxy_shell")
                if not isinstance(proxy_shell, dict):
                    proxy_shell = None

                framework_shell_ui = manifest.get("framework_shell_ui")
                if not isinstance(framework_shell_ui, dict):
                    framework_shell_ui = None

                icon_src_raw = manifest.get("icon_src")
                if not isinstance(icon_src_raw, str):
                    icon_src_raw = ""

                icon_text = manifest.get("icon_text")
                if not isinstance(icon_text, str):
                    icon_text = ""

                icon_emoji = manifest.get("icon_emoji")
                if not isinstance(icon_emoji, str):
                    icon_emoji = ""

                app_def = AppDefinition(
                    app_id=app_id,
                    name=str(manifest.get("name") or app_id),
                    description=str(manifest.get("description") or ""),
                    dir_name=app_dir.name,
                    root_dir=app_dir.resolve(),
                    manifest_path=manifest_path.resolve(),
                    source_kind=source_kind,
                    source_root=source_root.resolve(),
                    asset_base_url=f"/apps/by-id/{app_id}",
                    entrypoints=entrypoints,
                    shells=_resolve_shells(manifest, app_dir.resolve()),
                    services_path=services_path or "services",
                    service_modules=service_modules,
                    proxy_shell=proxy_shell,
                    framework_shell_ui=framework_shell_ui,
                    icon_src_raw=icon_src_raw.strip(),
                    icon_text=icon_text.strip(),
                    icon_emoji=icon_emoji.strip(),
                    fullscreen=bool(manifest.get("fullscreen")),
                    readiness_support=bool(manifest.get("readiness_support")),
                    enabled=bool(manifest.get("enabled", True)),
                    raw_manifest=dict(manifest),
                )
                apps[app_id] = app_def
                apps_by_dir.setdefault(app_def.dir_name, app_def)

        self._apps = apps
        self._apps_by_dir = apps_by_dir
        return self.list_apps()
