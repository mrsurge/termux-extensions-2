"""
NiceGUI Code CM6 - Phase 1 bootstrap.

This module exposes a minimal NiceGUI page while remaining compatible with the
framework's worker launcher. The intent is to keep all UI state in Python while
we incrementally replace the legacy JS-heavy implementation.
"""

from __future__ import annotations

from flask import Blueprint, jsonify
from nicegui import app as nicegui_app
from nicegui import ui
import nicegui.nicegui as nicegui_runtime

APP_ID = "nice_code_cm6"

bp = Blueprint(APP_ID, __name__)
_pages_registered = False

# Ensure engine.io path matches the framework proxy configuration.
# NiceGUI defaults to '/_nicegui_ws/socket.io', but we set it explicitly so
# future mount point tweaks cannot break the WS upgrade.
nicegui_runtime.sio_app.engineio_path = "/_nicegui_ws/socket.io"


def _register_pages() -> None:
    """Register NiceGUI pages once."""
    global _pages_registered
    if _pages_registered:
        return
    _pages_registered = True

    @ui.page("/ui")
    def code_cm6_page() -> None:
        """Phase 1 placeholder UI rendered via NiceGUI."""
        with ui.header().classes(
            "items-center gap-3 px-4 py-2 bg-slate-900 text-slate-100"
        ):
            ui.label("Code CM6 (NiceGUI)").classes("text-lg font-semibold")
            ui.label("Phase 1 • Bootstrap").classes("text-sm text-slate-300")

        with ui.column().classes("w-full gap-4 px-4 pb-8"):
            with ui.card().classes("w-full"):
                ui.label("Hello TE-2! 🚀").classes("text-base font-medium")
                ui.label(
                    "NiceGUI is running inside the framework worker. "
                    "Future phases will swap this placeholder with the modular layout."
                ).classes("text-sm text-slate-500")
                ui.button("Show Toast", on_click=lambda: ui.notify("It works! 🎉"))

            with ui.expansion("Roadmap Preview", icon="info").classes("w-full"):
                ui.markdown(
                    """
                    **Coming Up**
                    1. File header + menus rendered in Python
                    2. Drawer modules (Explorer, Terminal, Agents)
                    3. CM6 viewport integration with disk-backed state
                    4. Git operations and inline diff decorations
                    """
                )

    @ui.page("/")
    def root_redirect() -> None:
        """Redirect visitors hitting the worker root."""
        ui.run_javascript("window.location.replace('/api/app/nice_code_cm6/ui');")
        ui.label("Loading Code CM6 …").classes("px-4 py-6 text-slate-500")


@bp.get("/status")
def status() -> tuple[dict[str, object], int]:
    """Lightweight health endpoint."""
    return jsonify({"ok": True, "data": {"message": "NiceGUI worker ready"}}), 200


def init_app(flask_app) -> None:
    """Invoked by the framework when the worker module loads."""
    _register_pages()


def run_worker(*, host: str, port: int, flask_app=None, **_) -> None:
    """Custom worker runner for NiceGUI apps."""
    _register_pages()
    print(f"[{APP_ID}] Starting NiceGUI server on {host}:{port}")
    ui.run(
        host=host,
        port=port,
        reload=False,
        show=False,
        native=False,
        title="Code CM6 (NiceGUI)",
    )
