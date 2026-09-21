"""Preference-owned managed installation identity, with no executable probes."""
# pyright: strict
from __future__ import annotations

import os
from typing import Literal

from .code_server_identity import CodeServerInstallation, PINNED_CODE_SERVER_VERSION, te2_managed_code_server_root
from .intelligence_state import IntelligenceStateStore

Layout = Literal["termux", "standalone"]


def _state_store() -> IntelligenceStateStore:
    return IntelligenceStateStore()


def installation_for_layout(layout: Layout) -> CodeServerInstallation:
    root = te2_managed_code_server_root() / PINNED_CODE_SERVER_VERSION
    package = "code-server" if layout == "termux" else f"code-server-{PINNED_CODE_SERVER_VERSION}"
    return CodeServerInstallation(root / "bin" / "code-server", root / "lib" / package / "lib" / "vscode", "te2-managed")


def default_layout() -> Layout:
    return "termux" if os.environ.get("ANDROID_ROOT") or os.environ.get("ANDROID_DATA") or "/com.termux/" in os.environ.get("PREFIX", "") else "standalone"


def selected_installation() -> CodeServerInstallation | None:
    snapshot = _state_store().read()
    state = snapshot.installation
    if state is None:
        # One-time adoption: attempt the known private launcher, never scan disks.
        # Success records the pin/layout; failure records unavailable, ending retry.
        if snapshot.web_workers_enabled:
            return None
        return installation_for_layout(default_layout())
    if state.get("installed") is not True or state.get("version") != PINNED_CODE_SERVER_VERSION:
        return None
    layout = state.get("layout")
    if layout not in ("termux", "standalone"):
        return None
    return installation_for_layout("termux" if layout == "termux" else "standalone")


def record_installation(installation: CodeServerInstallation) -> None:
    # Only our two packaged layouts are accepted. No filesystem discovery here.
    for layout in ("termux", "standalone"):
        expected = installation_for_layout(layout)
        if installation.executable == expected.executable and installation.vscode_root == expected.vscode_root:
            _state_store().set_code_server_installation({
                "installed": True, "version": PINNED_CODE_SERVER_VERSION, "layout": layout,
            })
            return
    raise ValueError("Code Server installation does not match a managed package layout")


def clear_installation() -> None:
    _state_store().set_code_server_installation({"installed": False})
