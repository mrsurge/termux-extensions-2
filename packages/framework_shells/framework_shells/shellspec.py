from __future__ import annotations

import os
import re
import shlex
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import yaml


@dataclass(frozen=True)
class ReadinessProbe:
    type: str  # "stdout_regex" | "tcp_port" | "http_ok"
    timeout: float = 30.0
    # stdout_regex
    pattern: Optional[str] = None
    # tcp_port
    host: str = "127.0.0.1"
    port: Optional[int] = None
    # http_ok
    url: Optional[str] = None
    status_codes: List[int] = field(default_factory=lambda: [200])


@dataclass(frozen=True)
class RestartPolicy:
    policy: str = "never"  # "never" | "on-failure" | "always"
    max_restarts: int = 3
    backoff_ms: int = 1000


@dataclass(frozen=True)
class ShellSpec:
    id: str
    command: Union[str, List[str]]
    cwd: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    subgroups: List[str] = field(default_factory=list)
    ui: Dict[str, Any] = field(default_factory=dict)
    readiness: Optional[ReadinessProbe] = None
    restart: RestartPolicy = field(default_factory=RestartPolicy)
    backend: str = "proc"  # "proc" | "pty" | "pipe" | "dtach"
    autostart: bool = True

    def normalized_command(self) -> List[str]:
        if isinstance(self.command, str):
            return shlex.split(self.command)
        return [str(part) for part in self.command]


_TEMPLATE_RE = re.compile(r"\$\{([^}]+)\}")


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return int(s.getsockname()[1])


def _render_string(template: str, *, ctx: Mapping[str, Any], env: Mapping[str, str], state: Dict[str, Any]) -> str:
    def _replace(match: re.Match) -> str:
        key = match.group(1).strip()
        if not key:
            return ""

        if key == "free_port":
            if "free_port" not in state:
                state["free_port"] = _find_free_port()
            return str(state["free_port"])

        if key.startswith("env:"):
            name = key.split(":", 1)[1]
            return str(env.get(name, ""))

        if key.startswith("ctx:"):
            name = key.split(":", 1)[1]
            return str(ctx.get(name, ""))

        # Convenience: ${PROJECT_ROOT} resolves from ctx first, then env.
        if key in ctx:
            return str(ctx.get(key, ""))
        return str(env.get(key, ""))

    return _TEMPLATE_RE.sub(_replace, template)


def _render_value(value: Any, *, ctx: Mapping[str, Any], env: Mapping[str, str], state: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        return _render_string(value, ctx=ctx, env=env, state=state)
    if isinstance(value, list):
        return [_render_value(v, ctx=ctx, env=env, state=state) for v in value]
    if isinstance(value, dict):
        return {str(k): _render_value(v, ctx=ctx, env=env, state=state) for k, v in value.items()}
    return value


def render_shellspec(spec: ShellSpec, *, ctx: Optional[Mapping[str, Any]] = None, env: Optional[Mapping[str, str]] = None) -> ShellSpec:
    """Render templates in a spec (e.g. ${free_port}, ${ctx:APP_ID}, ${env:HOME}).

    Rendering is per-shell: `${free_port}` is stable within a rendered spec, but
    different shells render with different values.
    """
    ctx = dict(ctx or {})
    env_map = dict(env or os.environ)
    state: Dict[str, Any] = {}

    rendered = _render_value(
        {
            "id": spec.id,
            "command": spec.command,
            "cwd": spec.cwd,
            "env": dict(spec.env or {}),
            "subgroups": list(spec.subgroups or []),
            "ui": dict(spec.ui or {}),
            "readiness": None,
            "restart": {
                "policy": spec.restart.policy,
                "max_restarts": spec.restart.max_restarts,
                "backoff_ms": spec.restart.backoff_ms,
            },
            "backend": spec.backend,
            "autostart": spec.autostart,
        },
        ctx=ctx,
        env=env_map,
        state=state,
    )

    readiness = spec.readiness
    if readiness:
        rendered_probe_raw = _render_value(
            {
                "type": readiness.type,
                "timeout": readiness.timeout,
                "pattern": readiness.pattern,
                "host": readiness.host,
                "port": readiness.port,
                "url": readiness.url,
                "status_codes": list(readiness.status_codes or [200]),
            },
            ctx=ctx,
            env=env_map,
            state=state,
        )

        port = rendered_probe_raw.get("port")
        try:
            if isinstance(port, str) and port.strip().isdigit():
                port = int(port.strip())
        except Exception:
            pass

        readiness = ReadinessProbe(
            type=str(rendered_probe_raw.get("type") or readiness.type),
            timeout=float(rendered_probe_raw.get("timeout") or readiness.timeout),
            pattern=(rendered_probe_raw.get("pattern") or None),
            host=str(rendered_probe_raw.get("host") or readiness.host),
            port=port if isinstance(port, int) else None,
            url=(rendered_probe_raw.get("url") or None),
            status_codes=[int(x) for x in (rendered_probe_raw.get("status_codes") or [200])],
        )

    restart_raw = rendered.get("restart") or {}
    restart = RestartPolicy(
        policy=str(restart_raw.get("policy") or spec.restart.policy),
        max_restarts=int(restart_raw.get("max_restarts") or spec.restart.max_restarts),
        backoff_ms=int(restart_raw.get("backoff_ms") or spec.restart.backoff_ms),
    )

    return ShellSpec(
        id=str(rendered.get("id") or spec.id),
        command=rendered.get("command"),
        cwd=(rendered.get("cwd") or None),
        env={str(k): str(v) for k, v in (rendered.get("env") or {}).items()},
        subgroups=[str(x) for x in (rendered.get("subgroups") or [])],
        ui=rendered.get("ui") or {},
        readiness=readiness,
        restart=restart,
        backend=str(rendered.get("backend") or spec.backend),
        autostart=bool(rendered.get("autostart") if "autostart" in rendered else spec.autostart),
    )


def _parse_readiness(raw: Any) -> Optional[ReadinessProbe]:
    if not isinstance(raw, dict):
        return None
    type_val = raw.get("type")
    if not type_val:
        return None
    status_codes = raw.get("status_codes") or raw.get("statusCodes") or [200]
    if not isinstance(status_codes, list):
        status_codes = [200]
    port_val = raw.get("port")
    if isinstance(port_val, str) and port_val.strip().isdigit():
        port_val = int(port_val.strip())
    elif isinstance(port_val, (int, float)):
        port_val = int(port_val)
    else:
        port_val = None
    return ReadinessProbe(
        type=str(type_val),
        timeout=float(raw.get("timeout", 30.0)),
        pattern=raw.get("pattern"),
        host=str(raw.get("host", "127.0.0.1")),
        port=port_val,
        url=raw.get("url"),
        status_codes=[int(x) for x in status_codes],
    )


def _parse_restart(raw: Any) -> RestartPolicy:
    if not isinstance(raw, dict):
        return RestartPolicy()
    return RestartPolicy(
        policy=str(raw.get("policy", "never")),
        max_restarts=int(raw.get("max_restarts", 3)),
        backoff_ms=int(raw.get("backoff_ms", 1000)),
    )


def _spec_from_dict(shell_id: str, raw: Dict[str, Any]) -> ShellSpec:
    command = raw.get("command")
    if not command:
        raise ValueError(f"shellspec '{shell_id}' missing command")
    if not isinstance(command, (str, list)):
        raise ValueError(f"shellspec '{shell_id}' command must be string or list")
    if isinstance(command, list) and not all(isinstance(x, (str, int, float)) for x in command):
        raise ValueError(f"shellspec '{shell_id}' command list must be scalars")

    env_raw = raw.get("env") or {}
    if not isinstance(env_raw, dict):
        raise ValueError(f"shellspec '{shell_id}' env must be a mapping")

    subgroups = raw.get("subgroups") or []
    if not isinstance(subgroups, list):
        subgroups = []

    ui = raw.get("ui") or {}
    if not isinstance(ui, dict):
        ui = {}

    return ShellSpec(
        id=str(raw.get("id") or shell_id),
        command=command if isinstance(command, str) else [str(x) for x in command],
        cwd=raw.get("cwd"),
        env={str(k): str(v) for k, v in env_raw.items()},
        subgroups=[str(x) for x in subgroups],
        ui=dict(ui),
        readiness=_parse_readiness(raw.get("readiness")),
        restart=_parse_restart(raw.get("restart")),
        backend=str(raw.get("backend") or "proc"),
        autostart=bool(raw.get("autostart", True)),
    )


def parse_shellspec_data(raw: Any, *, default_id: Optional[str] = None) -> Dict[str, ShellSpec]:
    """Parse an in-memory shellspec document into a mapping of id -> ShellSpec.

    Supported shapes:
    - Compose-like: {version: "1", shells: {id: {...}}}
    - Single-shell: {id: "...", command: ...} (id optional; defaults to `default_id`)
    """
    if not isinstance(raw, dict):
        return {}

    if isinstance(raw.get("shells"), dict):
        out: Dict[str, ShellSpec] = {}
        for shell_id, shell_def in raw.get("shells", {}).items():
            if not isinstance(shell_def, dict):
                continue
            spec = _spec_from_dict(str(shell_id), shell_def)
            out[spec.id] = spec
        return out

    # Single-shell format
    if "command" in raw:
        shell_id = str(raw.get("id") or default_id or "shell")
        return {shell_id: _spec_from_dict(shell_id, raw)}

    return {}


def load_shellspec(path: Union[str, Path]) -> Dict[str, ShellSpec]:
    p = Path(path)
    if not p.exists():
        return {}

    if p.is_dir():
        merged: Dict[str, ShellSpec] = {}
        for child in sorted(p.iterdir()):
            if child.suffix.lower() not in (".yaml", ".yml"):
                continue
            part = load_shellspec(child)
            for sid, spec in part.items():
                if sid in merged:
                    raise ValueError(f"duplicate shellspec id '{sid}' in {p}")
                merged[sid] = spec
        return merged

    with p.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return parse_shellspec_data(raw, default_id=p.stem)


def parse_shellspec_ref(ref: str) -> Tuple[str, Optional[str]]:
    """Parse `path[#id]` references."""
    if "#" not in ref:
        return ref, None
    path_part, shell_id = ref.split("#", 1)
    shell_id = shell_id.strip() or None
    return path_part.strip(), shell_id

