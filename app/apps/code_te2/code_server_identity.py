"""Pinned managed package identity shared by installation and registry consumers."""
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from app.te2_paths import te2_data_home

PINNED_CODE_SERVER_VERSION: Final = "4.130.0"


@dataclass(frozen=True)
class CodeServerInstallation:
    executable: Path
    vscode_root: Path | None
    source: str


def te2_managed_code_server_root() -> Path:
    return te2_data_home() / "code_server"
