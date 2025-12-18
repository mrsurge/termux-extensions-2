from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
import json

@dataclass
class ShellRecord:
    """Serializable metadata describing a framework shell."""

    id: str
    command: List[str]
    label: Optional[str]
    cwd: str
    env_overrides: Dict[str, str]
    pid: Optional[int]
    status: str
    created_at: float
    updated_at: float
    autostart: bool
    stdout_log: str
    stderr_log: str
    spec_id: Optional[str] = None
    exit_code: Optional[int] = None
    subgroups: List[str] = field(default_factory=list)
    ui: Dict[str, Any] = field(default_factory=dict)
    run_id: Optional[str] = None
    launcher_pid: Optional[int] = None
    adopted: bool = False
    uses_pty: bool = False
    uses_pipes: bool = False
    uses_dtach: bool = False

    # Runtime isolation (Phase 2)
    runtime_id: Optional[str] = None
    signature: Optional[str] = None
    
    # App context (Phase 2A)
    app_id: Optional[str] = None
    parent_shell_id: Optional[str] = None
    is_app_worker: bool = False

    def derive_app_id(self) -> Optional[str]:
        """Extract app_id from label or subgroups."""
        if self.label and self.label.startswith("app-worker:"):
            return self.label.split(":", 1)[1]
        if self.subgroups:
            return self.subgroups[0]
        return None

    def sign(self, secret: str) -> None:
        """Sign record with secret."""
        from .auth import sign_record, derive_runtime_id
        self.runtime_id = derive_runtime_id(secret)
        self.signature = sign_record(secret, self.to_dict())

    def verify(self, secret: str) -> bool:
        """Verify record signature."""
        from .auth import verify_record, derive_runtime_id
        if self.runtime_id != derive_runtime_id(secret):
            return False
        return verify_record(secret, self.to_dict())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "spec_id": self.spec_id,
            "command": self.command,
            "label": self.label,
            "subgroups": self.subgroups,
            "ui": self.ui,
            "cwd": self.cwd,
            "env_overrides": self.env_overrides,
            "pid": self.pid,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "autostart": self.autostart,
            "stdout_log": self.stdout_log,
            "stderr_log": self.stderr_log,
            "exit_code": self.exit_code,
            "run_id": self.run_id,
            "launcher_pid": self.launcher_pid,
            "adopted": self.adopted,
            "uses_pty": self.uses_pty,
            "uses_pipes": self.uses_pipes,
            "uses_dtach": self.uses_dtach,
            "runtime_id": self.runtime_id,
            "signature": self.signature,
            "app_id": self.app_id,
            "parent_shell_id": self.parent_shell_id,
            "is_app_worker": self.is_app_worker,
        }

    def to_payload(self, *, include_env: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "spec_id": self.spec_id,
            "command": list(self.command),
            "label": self.label,
            "subgroups": list(self.subgroups or []),
            "ui": dict(self.ui or {}),
            "cwd": self.cwd,
            "pid": self.pid,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "autostart": self.autostart,
            "stdout_log": self.stdout_log,
            "stderr_log": self.stderr_log,
            "exit_code": self.exit_code,
            "env_keys": sorted(self.env_overrides.keys()),
            "run_id": self.run_id,
            "launcher_pid": self.launcher_pid,
            "adopted": self.adopted,
            "uses_pty": self.uses_pty,
            "uses_pipes": self.uses_pipes,
            "uses_dtach": self.uses_dtach,
            "runtime_id": self.runtime_id,
            "app_id": self.app_id,
            "parent_shell_id": self.parent_shell_id,
            "is_app_worker": self.is_app_worker,
        }
        if include_env:
            payload["env_overrides"] = dict(self.env_overrides)
        return payload
