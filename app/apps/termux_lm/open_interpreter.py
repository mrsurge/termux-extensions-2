"""Helpers for launching and inspecting the Open Interpreter server."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.framework_shells import FrameworkShellManager

OI_LABEL_TEMPLATE = "oi:{model_id}"


def _normalize_remote_base(endpoint: str) -> str:
    endpoint = (endpoint or "").strip()
    if not endpoint:
        return ""
    base = endpoint.rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    if not base.endswith("/v1"):
        base = base + "/v1"
    return base


def build_interpreter_command(model: Dict[str, Any]) -> Dict[str, Any]:
    """Return command and env for launching Open Interpreter based on the loaded model.

    Rules:
    - Remote model: pass provider config on the command line so it’s visible in the shell UI
      (--api_base, --api_key, --model).
    - Local model: derive /v1 base from llama.cpp host/port and pass it via --api_base and --model.
    - Do NOT pass --host/--port to the interpreter process; it defaults to localhost:8000.
    """
    model_type = (model.get("type") or "local").strip()
    env: Dict[str, str] = {}

    if model_type == "remote":
        base = _normalize_remote_base(model.get("endpoint") or "")
        api_key = (model.get("api_key") or "").strip()
        if not base:
            raise ValueError("remote model missing/invalid endpoint")
        if not api_key:
            raise ValueError("remote model missing api_key")
        model_arg = str(model.get("remote_model") or model.get("name") or model.get("id") or "")
        command = [
            "interpreter",
            "--server",
            "--api_base", base,
            "--api_key", api_key,
        ]
        if model_arg:
            command.extend(["--model", model_arg])
        return {"command": command, "env": env}
    else:
        host = model.get("host", "127.0.0.1")
        port = model.get("port", 8081)
        base = f"http://{host}:{port}/v1"
        name = str(model.get("name") or model.get("id") or "")
        # Provide a dummy api key on CLI if the interpreter requires it; harmless value.
        command = [
            "interpreter",
            "--server",
            "--api_base", base,
            "--api_key", "sk-local",
        ]
        if name:
            command.extend(["--model", name])
        return {"command": command, "env": env}


def ensure_interpreter_shell(manager: FrameworkShellManager, model: Dict[str, Any]) -> Dict[str, Any]:
    """Launch interpreter if needed, returning descriptor."""
    model_id = model["id"]
    label = OI_LABEL_TEMPLATE.format(model_id=model_id)
    for record in manager.list_shells():
        description = manager.describe(record)
        if description.get("label") == label:
            return {"record": description, "created": False}

    command_info = build_interpreter_command(model)
    record = manager.spawn_shell(
        command_info["command"],
        cwd=str(Path.home()),
        label=label,
        env=command_info["env"],
        autostart=True,
    )
    description = manager.describe(record)
    return {"record": description, "created": True}


def stop_interpreter_shell(manager: FrameworkShellManager, model_id: Optional[str] = None) -> bool:
    """Stop interpreter shells. If model_id provided, only that shell."""
    matching = []
    for record in manager.list_shells():
        desc = manager.describe(record)
        label = desc.get("label")
        if not label or not label.startswith("oi:"):
            continue
        if model_id and label != OI_LABEL_TEMPLATE.format(model_id=model_id):
            continue
        matching.append(desc)

    stopped = False
    for shell in matching:
        try:
            manager.terminate_shell(shell["id"], force=True)
            stopped = True
        except Exception:
            pass
    return stopped


def describe_interpreter_shell(manager: FrameworkShellManager, model_id: Optional[str] = None) -> Dict[str, Any]:
    """Return a summary of interpreter shell state (assumes default localhost:8000)."""
    result = {
        "running": False,
        "host": "127.0.0.1",
        "port": 8000,
        "shell_id": None,
        "log": [],
    }
    for record in manager.list_shells():
        desc = manager.describe(record, include_logs=True, tail_lines=200)
        label = desc.get("label")
        if not label or not label.startswith("oi:"):
            continue
        if model_id and label != OI_LABEL_TEMPLATE.format(model_id=model_id):
            continue
        result.update(
            {
                "running": bool(desc.get("stats", {}).get("alive")),
                "shell_id": desc.get("id"),
                "log": desc.get("logs", {}).get("stdout_tail", []) or [],
            }
        )
        break
    return result

