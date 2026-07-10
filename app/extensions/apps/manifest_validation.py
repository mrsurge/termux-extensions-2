# pyright: basic
from __future__ import annotations

from typing import Any


def _is_bool(value: Any) -> bool:
    return isinstance(value, bool)


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_str_list(value: Any, field_name: str, errors: list[str]) -> None:
    if not isinstance(value, list):
        errors.append(f"{field_name} must be a list of strings")
        return
    for index, item in enumerate(value):
        if not _is_nonempty_str(item):
            errors.append(f"{field_name}[{index}] must be a non-empty string")


def validate_proxy_shell_manifest(manifest: dict[str, Any]) -> list[str]:
    """Return validation errors for the manifest's optional proxy_shell block."""
    errors: list[str] = []
    app_id = manifest.get("id", "<unknown>")
    config = manifest.get("proxy_shell")
    if config is None:
        return errors
    if not isinstance(config, dict):
        return [f"proxy_shell for '{app_id}' must be an object"]

    enabled = config.get("enabled", True)
    if not _is_bool(enabled):
        errors.append(f"proxy_shell.enabled for '{app_id}' must be a boolean")
        return errors
    if enabled is False:
        return errors

    if not _is_nonempty_str(config.get("start_path")):
        errors.append(
            f"proxy_shell.start_path for '{app_id}' is required and must be a non-empty string"
        )
    if not _is_nonempty_str(config.get("health_path")):
        errors.append(
            f"proxy_shell.health_path for '{app_id}' is required and must be a non-empty string"
        )
    if "ws_max_size_mb" in config and not _is_positive_int(config.get("ws_max_size_mb")):
        errors.append(f"proxy_shell.ws_max_size_mb for '{app_id}' must be a positive integer")

    rewrite = config.get("rewrite")
    if rewrite is not None:
        if not isinstance(rewrite, dict):
            errors.append(f"proxy_shell.rewrite for '{app_id}' must be an object")
        else:
            if "enabled" in rewrite and not _is_bool(rewrite.get("enabled")):
                errors.append(f"proxy_shell.rewrite.enabled for '{app_id}' must be a boolean")
            for key in (
                "path_prefixes",
                "content_types",
                "absolute_root_paths",
                "css_root_paths",
            ):
                if key in rewrite:
                    _validate_str_list(
                        rewrite.get(key),
                        f"proxy_shell.rewrite.{key}",
                        errors,
                    )
            if "ws_template_marker" in rewrite and not _is_nonempty_str(
                rewrite.get("ws_template_marker")
            ):
                errors.append(
                    f"proxy_shell.rewrite.ws_template_marker for '{app_id}' must be a non-empty string"
                )
            if "ws_template_replacement" in rewrite and not _is_nonempty_str(
                rewrite.get("ws_template_replacement")
            ):
                errors.append(
                    f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' must be a non-empty string"
                )
            if "ws_template_marker" in rewrite and "ws_template_replacement" not in rewrite:
                errors.append(
                    f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' is required when ws_template_marker is set"
                )
            if (
                "ws_template_replacement" in rewrite
                and "{proxy_prefix}" not in str(rewrite.get("ws_template_replacement"))
            ):
                errors.append(
                    f"proxy_shell.rewrite.ws_template_replacement for '{app_id}' must include '{{proxy_prefix}}'"
                )

    socketio = config.get("socketio")
    if socketio is not None:
        if not isinstance(socketio, dict):
            errors.append(f"proxy_shell.socketio for '{app_id}' must be an object")
        else:
            if "enabled" in socketio and not _is_bool(socketio.get("enabled")):
                errors.append(f"proxy_shell.socketio.enabled for '{app_id}' must be a boolean")
            if "inject_path" in socketio and not _is_bool(socketio.get("inject_path")):
                errors.append(f"proxy_shell.socketio.inject_path for '{app_id}' must be a boolean")
            if "namespace_marker" in socketio and not _is_nonempty_str(
                socketio.get("namespace_marker")
            ):
                errors.append(
                    f"proxy_shell.socketio.namespace_marker for '{app_id}' must be a non-empty string"
                )
            if socketio.get("inject_path") is True and not _is_nonempty_str(
                socketio.get("namespace_marker")
            ):
                errors.append(
                    f"proxy_shell.socketio.namespace_marker for '{app_id}' is required when socketio.inject_path is true"
                )

    return errors
