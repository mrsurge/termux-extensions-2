from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Optional

import yaml
from framework_shells.shellspec import parse_shellspec_data

from app.extensions.apps.manifest_validation import validate_proxy_shell_manifest
from app.extensions.apps.registry import (
    builtin_templates_root,
    ensure_user_local_layout,
    te2_apps_root,
    te2_templates_root,
)

_TEMPLATE_NAME = "proxy_shell_wrapper"
_DEFAULT_ICON_EMOJI = "🧩"


def list_templates() -> list[dict[str, Any]]:
    ensure_user_local_layout()
    templates_root = te2_templates_root()
    items: list[dict[str, Any]] = []
    if not templates_root.exists():
        return items
    for entry in sorted(templates_root.iterdir(), key=lambda path: path.name.lower()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        readme_path = entry / "README.md"
        summary = ""
        if readme_path.exists():
            try:
                lines = [line.strip() for line in readme_path.read_text(encoding="utf-8").splitlines() if line.strip()]
                if lines:
                    summary = lines[1] if len(lines) > 1 and lines[0].startswith("#") else lines[0]
            except Exception:
                summary = ""
        items.append(
            {
                "id": entry.name,
                "name": entry.name,
                "path": str(entry),
                "readme_path": str(readme_path) if readme_path.exists() else None,
                "summary": summary,
            }
        )
    return items


def _normalize_app_id(value: Any) -> str:
    app_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value or "").strip()).strip("_")
    if not app_id:
        raise ValueError("app_id is required")
    return app_id


def _normalize_path(value: Any, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    if not text.startswith("/"):
        text = f"/{text}"
    return text


def _normalize_project_root(value: Any) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("project_root is required")
    path = Path(raw).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise ValueError(f"project_root does not exist: {path}")
    return path


def _normalize_command(value: Any) -> str:
    if isinstance(value, list):
        parts = [str(item).strip() for item in value if str(item).strip()]
        command = " ".join(parts)
    else:
        command = str(value or "").strip()
    if not command:
        raise ValueError("command is required")
    return command


def _normalize_port(value: Any) -> int:
    try:
        port = int(value)
    except Exception as exc:
        raise ValueError("port must be an integer") from exc
    if port < 1 or port > 65535:
        raise ValueError("port must be between 1 and 65535")
    return port


def _normalize_icon_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > 2:
        raise ValueError("icon_text must be 1 or 2 characters")
    return text


def _infer_icon_text(name: str, app_id: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9]+", name or app_id)
    if len(tokens) >= 2:
        return (tokens[0][:1] + tokens[1][:1]).upper()
    if len(tokens) == 1:
        token = tokens[0]
        if len(token) >= 2:
            return token[:2].upper()
        return token[:1].upper()
    fallback = re.sub(r"[^A-Za-z0-9]+", "", app_id)
    return fallback[:2].upper()


def _resolve_icon_fields(app_id: str, name: str, target_dir: Path, *, icon_src: Any, icon_text: Any, icon_emoji: Any) -> tuple[str, str, str, list[str]]:
    warnings: list[str] = []
    manifest_icon_src = ""
    normalized_text = _normalize_icon_text(icon_text)
    normalized_emoji = str(icon_emoji or "").strip()

    raw_icon_src = str(icon_src or "").strip()
    if raw_icon_src:
        src_path = Path(raw_icon_src).expanduser()
        if src_path.exists() and src_path.is_file():
            dest_name = src_path.name
            shutil.copy2(src_path, target_dir / dest_name)
            manifest_icon_src = dest_name
        elif raw_icon_src.startswith(("http://", "https://", "/")):
            manifest_icon_src = raw_icon_src
        else:
            raise ValueError(f"icon_src does not exist: {raw_icon_src}")

    if not manifest_icon_src and not normalized_text:
        inferred = _infer_icon_text(name, app_id)
        normalized_text = _normalize_icon_text(inferred)
        if normalized_text:
            warnings.append(f"icon_text inferred as '{normalized_text}'")

    if not manifest_icon_src and not normalized_text and not normalized_emoji:
        normalized_emoji = _DEFAULT_ICON_EMOJI
        warnings.append("icon_emoji fallback applied")

    return manifest_icon_src, normalized_text, normalized_emoji, warnings


def _template_dir() -> Path:
    ensure_user_local_layout()
    local_template = te2_templates_root() / _TEMPLATE_NAME
    if local_template.exists():
        return local_template
    builtin_template = builtin_templates_root() / _TEMPLATE_NAME
    if builtin_template.exists():
        return builtin_template
    raise FileNotFoundError(f"Proxy shell wrapper template not found: {local_template}")


def _target_app_dir(app_id: str) -> Path:
    return te2_apps_root() / app_id


def _write_manifest(target_dir: Path, manifest: dict[str, Any]) -> Path:
    path = target_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def _write_shellspec(target_dir: Path, shellspec: dict[str, Any]) -> Path:
    shellspec_dir = target_dir / "shellspec"
    shellspec_dir.mkdir(parents=True, exist_ok=True)
    path = shellspec_dir / "app_worker.yaml"
    path.write_text(yaml.safe_dump(shellspec, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return path


def _rewrite_template_html(target_dir: Path, *, title: str) -> None:
    path = target_dir / "template.html"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    text = text.replace('title="Proxy Shell App"', f'title="{title}"')
    text = text.replace("Waiting for proxy shell worker...", f"Waiting for {title}...")
    path.write_text(text, encoding="utf-8")


def _rewrite_backend_stub(target_dir: Path, *, app_id: str, name: str) -> None:
    path = target_dir / "main.py"
    if not path.exists():
        return
    safe_name = re.sub(r"[^a-zA-Z0-9_]+", "_", app_id).strip("_") or "proxy_shell"
    text = (
        "from fastapi import APIRouter\n\n"
        f"{safe_name}_bp = APIRouter()\n\n\n"
        f"@{safe_name}_bp.get(\"/\")\n"
        "async def status():\n"
        f"    return {{\"ok\": True, \"data\": {{\"message\": \"{name} backend ready\"}}}}\n"
    )
    path.write_text(text, encoding="utf-8")


def scaffold_proxy_shell_wrapper(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_user_local_layout()
    app_id = _normalize_app_id(payload.get("app_id"))
    name = str(payload.get("name") or app_id).strip() or app_id
    description = str(payload.get("description") or "").strip()
    project_root = _normalize_project_root(payload.get("project_root"))
    command = _normalize_command(payload.get("command"))
    port = _normalize_port(payload.get("port"))
    start_path = _normalize_path(payload.get("start_path") or "/", field_name="start_path")
    health_path = _normalize_path(payload.get("health_path") or "/api/health", field_name="health_path")
    overwrite = bool(payload.get("overwrite"))
    readiness_timeout = float(payload.get("readiness_timeout") or 20)
    socketio_enabled = bool(payload.get("socketio_enabled"))
    socketio_inject_path = bool(payload.get("socketio_inject_path"))
    socketio_namespace_marker = str(payload.get("socketio_namespace_marker") or "").strip()
    extra_env = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    target_dir = _target_app_dir(app_id)

    if target_dir.exists():
        if not overwrite:
            raise FileExistsError(f"target app already exists: {target_dir}")
        shutil.rmtree(target_dir)

    shutil.copytree(_template_dir(), target_dir)

    icon_src, icon_text, icon_emoji, icon_warnings = _resolve_icon_fields(
        app_id,
        name,
        target_dir,
        icon_src=payload.get("icon_src"),
        icon_text=payload.get("icon_text"),
        icon_emoji=payload.get("icon_emoji"),
    )

    manifest: dict[str, Any] = {
        "name": name,
        "id": app_id,
        "version": "0.1.0",
        "description": description or f"Thin TE2 proxy wrapper for {name}.",
        "shellspec": {
            "app_worker": "shellspec/app_worker.yaml#app-worker",
        },
        "entrypoints": {
            "backend_blueprint": "main.py",
            "frontend_template": "template.html",
            "frontend_script": "main.js",
        },
        "proxy_shell": {
            "enabled": True,
            "start_path": start_path,
            "health_path": health_path,
            "rewrite": {
                "enabled": True,
                "path_prefixes": ["/", "/static/"],
                "content_types": ["text/html", "javascript", "application/json", "text/css"],
                "absolute_root_paths": ["/api/", "/ws/", "/static/"],
                "css_root_paths": ["/static/"],
            },
            "socketio": {
                "enabled": socketio_enabled,
                "inject_path": socketio_inject_path,
            },
        },
    }
    if icon_src:
        manifest["icon_src"] = icon_src
    if icon_text:
        manifest["icon_text"] = icon_text
    if icon_emoji:
        manifest["icon_emoji"] = icon_emoji
    if socketio_inject_path and socketio_namespace_marker:
        manifest["proxy_shell"]["socketio"]["namespace_marker"] = socketio_namespace_marker

    shell_env = {
        "TE_APP_ID": app_id,
        "TE_APP_WORKER_PORT": str(port),
    }
    for key, value in extra_env.items():
        if not str(key).strip():
            continue
        shell_env[str(key)] = str(value)

    shellspec = {
        "version": "1",
        "shells": {
            "app-worker": {
                "backend": "proc",
                "cwd": str(project_root),
                "command": [
                    "sh",
                    "-lc",
                    command,
                ],
                "env": shell_env,
                "subgroups": [
                    app_id,
                    "app-worker",
                ],
                "readiness": {
                    "type": "tcp_port",
                    "host": "127.0.0.1",
                    "port": port,
                    "timeout": readiness_timeout,
                },
            }
        },
    }

    manifest_path = _write_manifest(target_dir, manifest)
    shellspec_path = _write_shellspec(target_dir, shellspec)
    _rewrite_template_html(target_dir, title=name)
    _rewrite_backend_stub(target_dir, app_id=app_id, name=name)

    return {
        "ok": True,
        "app_id": app_id,
        "app_dir": str(target_dir),
        "template_dir": str(_template_dir()),
        "manifest_path": str(manifest_path),
        "shellspec_path": str(shellspec_path),
        "project_root": str(project_root),
        "warnings": icon_warnings,
        "files": sorted(str(path) for path in target_dir.rglob("*") if path.is_file()),
    }


def validate_proxy_shell_wrapper(app_id: str) -> dict[str, Any]:
    ensure_user_local_layout()
    app_id = _normalize_app_id(app_id)
    app_dir = _target_app_dir(app_id)
    manifest_path = app_dir / "manifest.json"
    shellspec_path = app_dir / "shellspec" / "app_worker.yaml"
    errors: list[str] = []
    warnings: list[str] = []

    if not app_dir.exists() or not app_dir.is_dir():
        raise FileNotFoundError(f"app wrapper not found: {app_dir}")

    manifest: dict[str, Any] = {}
    if not manifest_path.exists():
        errors.append("manifest.json is missing")
    else:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"manifest.json parse failed: {type(exc).__name__}: {exc}")

    if manifest:
        manifest_id = str(manifest.get("id") or "").strip()
        if manifest_id != app_id:
            errors.append(f"manifest id '{manifest_id}' does not match app id '{app_id}'")
        errors.extend(validate_proxy_shell_manifest(manifest))

        icon_src = str(manifest.get("icon_src") or "").strip()
        icon_text = str(manifest.get("icon_text") or "").strip()
        icon_emoji = str(manifest.get("icon_emoji") or "").strip()
        if icon_src:
            if not (icon_src.startswith(("http://", "https://", "/")) or (app_dir / icon_src).exists()):
                errors.append(f"icon_src target not found: {icon_src}")
        elif icon_text:
            if len(icon_text) > 2:
                errors.append("icon_text must be 1 or 2 characters")
        elif icon_emoji:
            warnings.append("icon_emoji fallback in use")
        else:
            errors.append("one of icon_src, icon_text, or icon_emoji is required")

        entrypoints = manifest.get("entrypoints") if isinstance(manifest.get("entrypoints"), dict) else {}
        for key in ("backend_blueprint", "frontend_template", "frontend_script"):
            raw = entrypoints.get(key)
            if isinstance(raw, str) and raw.strip():
                target = (app_dir / raw.strip()).resolve()
                try:
                    target.relative_to(app_dir.resolve())
                except ValueError:
                    errors.append(f"entrypoint {key} escapes app root: {raw}")
                    continue
                if not target.exists() or not target.is_file():
                    errors.append(f"entrypoint {key} missing: {raw}")

    if not shellspec_path.exists():
        errors.append("shellspec/app_worker.yaml is missing")
    else:
        try:
            raw_spec = yaml.safe_load(shellspec_path.read_text(encoding="utf-8"))
            parsed = parse_shellspec_data(raw_spec, default_id="app-worker")
            spec = parsed.get("app-worker")
            if spec is None:
                errors.append("shellspec/app_worker.yaml does not define shell 'app-worker'")
            else:
                if not spec.command:
                    errors.append("shellspec app-worker command is empty")
                cwd = str(spec.cwd or "").strip()
                if not cwd:
                    errors.append("shellspec app-worker cwd is required")
                else:
                    cwd_path = Path(cwd).expanduser()
                    if not cwd_path.exists() or not cwd_path.is_dir():
                        errors.append(f"shellspec app-worker cwd does not exist: {cwd_path}")
                readiness = spec.readiness
                if readiness is None:
                    errors.append("shellspec app-worker readiness is required")
                elif readiness.type == "tcp_port":
                    if readiness.port is None:
                        errors.append("shellspec tcp_port readiness requires a port")
                    env_port = str((spec.env or {}).get("TE_APP_WORKER_PORT") or "").strip()
                    if env_port and readiness.port is not None and env_port != str(readiness.port):
                        errors.append(
                            f"shellspec TE_APP_WORKER_PORT ({env_port}) does not match readiness port ({readiness.port})"
                        )
        except Exception as exc:
            errors.append(f"shellspec/app_worker.yaml parse failed: {type(exc).__name__}: {exc}")

    return {
        "ok": not errors,
        "app_id": app_id,
        "app_dir": str(app_dir),
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "manifest_path": str(manifest_path),
        "shellspec_path": str(shellspec_path),
    }
