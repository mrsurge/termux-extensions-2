"""Plugin helpers for chroot-distro containers."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List


@dataclass
class MountSpec:
    device: str
    target: str
    filesystem: str | None = None
    options: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, str]) -> "MountSpec":
        return cls(
            device=data.get("device") or data.get("source") or "",
            target=data.get("target") or data.get("path") or "",
            filesystem=data.get("filesystem") or data.get("fstype"),
            options=data.get("opts") or data.get("options"),
        )


class CommandError(RuntimeError):
    def __init__(self, message: str, *, command: List[str]):
        super().__init__(message)
        self.command = command


class ChrootDistroPlugin:
    """Wraps chroot-distro operations for a single container definition."""

    def __init__(self, container: Dict[str, str]):
        self.container = container
        self.container_id = container.get("id")
        if not self.container_id:
            raise ValueError("Container definition requires an 'id'")

    # ------------------------------------------------------------------
    # Helpers

    def _expand(self, value: str | None) -> str:
        if not value:
            return ''
        return os.path.abspath(os.path.expanduser(value))

    def mount_specs(self) -> List[MountSpec]:
        mounts = self.container.get("mounts") or []
        specs = [MountSpec.from_dict(item) for item in mounts]
        for spec in specs:
            if not spec.device or not spec.target:
                raise ValueError(f"Invalid mount spec for {self.container_id}: {spec}")
        return specs

    def environment(self) -> Dict[str, str]:
        env = {}
        for key, value in (self.container.get("environment") or {}).items():
            env[key] = self._expand(value)
        # Provide convenience path if rootfs defined
        rootfs = self.container.get("rootfs")
        if rootfs:
            env.setdefault("DISTRO_ROOTFS", self._expand(rootfs))
        return env

    # ------------------------------------------------------------------
    # Mount management

    def mount(self) -> None:
        for spec in self.mount_specs():
            target = Path(self._expand(spec.target))
            target.mkdir(parents=True, exist_ok=True)
            cmd: List[str] = ["sudo", "mount"]
            if spec.filesystem:
                cmd.extend(["-t", spec.filesystem])
            if spec.options:
                cmd.extend(["-o", spec.options])
            cmd.extend([spec.device, str(target)])
            self._run(cmd)

    def unmount(self, *, force: bool = False) -> None:
        for spec in reversed(self.mount_specs()):
            target = self._expand(spec.target)
            if not target:
                continue
            cmd = ["sudo", "umount"]
            if force:
                cmd.append("-l")
            cmd.append(target)
            self._run(cmd, check=False)

    # ------------------------------------------------------------------
    # chroot-distro commands

    def login_command(self) -> List[str]:
        return ["sudo", "chroot-distro", "login", self.container_id]

    def mount_command(self) -> List[str]:
        return ["sudo", "chroot-distro", "mount", self.container_id]

    def unmount_command(self) -> List[str]:
        return ["sudo", "chroot-distro", "unmount", self.container_id]

    def exec_command(self, command: str) -> List[str]:
        return ["sudo", "chroot-distro", "command", self.container_id, command]

    # ------------------------------------------------------------------

    def _run(self, command: List[str], *, check: bool = True) -> None:
        try:
            subprocess.run(command, check=check)
        except subprocess.CalledProcessError as exc:
            raise CommandError(f"Command failed: {' '.join(command)}", command=command) from exc

    # Utility to evaluate mount state
    def is_mounted(self) -> bool:
        for spec in self.mount_specs():
            target = self._expand(spec.target)
            if target and not os.path.ismount(target):
                return False
        return True
