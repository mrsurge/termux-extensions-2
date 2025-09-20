"""Framework shell management scaffolding.

Provides data structures and a manager stub that will later orchestrate
background shells (dtach-managed) hidden from the interactive Sessions UI.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from flask import Blueprint, current_app, jsonify, request


@dataclass
class ShellRecord:
    """Serialized representation of a framework shell."""

    id: str
    command: List[str]
    label: Optional[str]
    cwd: str
    env: Dict[str, str]
    pid: Optional[int]
    status: str
    created_at: float
    updated_at: float
    autostart: bool

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        # Avoid leaking full environment values by default; expose keys only.
        data["env_keys"] = sorted(self.env.keys())
        data.pop("env", None)
        return data


class FrameworkShellManager:
    """Stores metadata and provides hooks for managing framework shells."""

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        home = Path(os.path.expanduser("~"))
        self.base_dir = base_dir or (home / ".cache" / "te_framework")
        self.metadata_dir = self.base_dir / "meta"
        self.sockets_dir = self.base_dir / "sockets"
        self.logs_dir = self.base_dir / "logs"
        for directory in (self.metadata_dir, self.sockets_dir, self.logs_dir):
            directory.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Metadata helpers

    def _meta_path(self, shell_id: str) -> Path:
        return self.metadata_dir / shell_id / "meta.json"

    def _load_meta(self, path: Path) -> Optional[ShellRecord]:
        try:
            data = json.loads(path.read_text())
            return ShellRecord(
                id=data["id"],
                command=list(data.get("command") or []),
                label=data.get("label"),
                cwd=data.get("cwd", "~"),
                env=dict(data.get("env") or {}),
                pid=data.get("pid"),
                status=data.get("status", "unknown"),
                created_at=float(data.get("created_at", time.time())),
                updated_at=float(data.get("updated_at", time.time())),
                autostart=bool(data.get("autostart", False)),
            )
        except FileNotFoundError:
            return None
        except Exception:
            return None

    def _save_meta(self, record: ShellRecord) -> None:
        record_dir = self.metadata_dir / record.id
        record_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = record_dir / "meta.json.tmp"
        meta_path = record_dir / "meta.json"
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(asdict(record), fh, indent=2)
        tmp_path.replace(meta_path)

    # ------------------------------------------------------------------
    # Public API (scaffolding)

    def list_shells(self) -> List[ShellRecord]:
        items: List[ShellRecord] = []
        for meta in self.metadata_dir.glob("*/meta.json"):
            record = self._load_meta(meta)
            if record:
                items.append(record)
        items.sort(key=lambda rec: rec.created_at)
        return items

    def get_shell(self, shell_id: str) -> Optional[ShellRecord]:
        return self._load_meta(self._meta_path(shell_id))

    # The following methods are placeholders; full implementations will arrive in
    # subsequent iterations.
    def spawn_shell(
        self,
        command: Iterable[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        label: Optional[str] = None,
        autostart: bool = False,
    ) -> ShellRecord:
        raise NotImplementedError("Framework shell spawning not implemented yet.")

    def terminate_shell(self, shell_id: str, *, force: bool = False) -> None:
        raise NotImplementedError("Terminate operation not implemented yet.")

    def restart_shell(self, shell_id: str) -> ShellRecord:
        raise NotImplementedError("Restart operation not implemented yet.")

    def sweep(self) -> None:
        """Placeholder for a cleanup routine that prunes stale metadata."""
        return None


# ----------------------------------------------------------------------
# Flask blueprint scaffolding

framework_shells_bp = Blueprint("framework_shells", __name__)


def _manager() -> FrameworkShellManager:
    mgr = current_app.config.get("TE_FRAMEWORK_SHELL_MANAGER")
    if not isinstance(mgr, FrameworkShellManager):
        mgr = FrameworkShellManager()
        current_app.config["TE_FRAMEWORK_SHELL_MANAGER"] = mgr
    return mgr


@framework_shells_bp.route("/api/framework_shells", methods=["GET"])
def list_framework_shells():
    records = [rec.to_dict() for rec in _manager().list_shells()]
    return jsonify({"ok": True, "data": records})


@framework_shells_bp.route("/api/framework_shells", methods=["POST"])
def create_framework_shell():
    return jsonify({"ok": False, "error": "Framework shell spawning is not implemented yet."}), 501


@framework_shells_bp.route("/api/framework_shells/<shell_id>", methods=["GET"])
def get_framework_shell(shell_id: str):
    record = _manager().get_shell(shell_id)
    if not record:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    return jsonify({"ok": True, "data": record.to_dict()})


@framework_shells_bp.route("/api/framework_shells/<shell_id>", methods=["DELETE"])
def delete_framework_shell(shell_id: str):
    return jsonify({"ok": False, "error": "Shell deletion is not implemented yet."}), 501


@framework_shells_bp.route("/api/framework_shells/<shell_id>/action", methods=["POST"])
def framework_shell_action(shell_id: str):
    action = (request.get_json(silent=True) or {}).get("action")
    return (
        jsonify({
            "ok": False,
            "error": f"Action '{action}' is not implemented yet."
        }),
        501,
    )
