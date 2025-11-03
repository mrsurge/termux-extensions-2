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
# Public mount point for the NiceGUI app.
UI_ROOT = "/apps/nice_code_cm6/ui"

bp = Blueprint(APP_ID, __name__)
_pages_registered = False

# Engine.IO path must be absolute (with leading slash) when app is mounted
# Starlette's Mount will handle the full path: /apps/nice_code_cm6/ui/socket.io
nicegui_runtime.sio_app.engineio_path = "/socket.io"


def _register_pages() -> None:
    """Register NiceGUI pages once."""
    global _pages_registered
    if _pages_registered:
        return
    _pages_registered = True

    if not nicegui_app.config.has_run_config:
        nicegui_app.config.add_run_config(
            reload=False,
            title="Code CM6",
            viewport="width=device-width, initial-scale=1",
            favicon=None,
            dark=False,
            language="en-US",
            binding_refresh_interval=0.1,
            reconnect_timeout=3.0,
            message_history_length=1000,
            cache_control_directives='public, max-age=31536000, immutable, stale-while-revalidate=31536000',
            tailwind=True,
            prod_js=True,
            show_welcome_message=False,
        )

    # Ensure URL generation and WebSocket routing respect the mounted root.
    nicegui_app.router.root_path = UI_ROOT

    @ui.page("/")
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

    @ui.page("/ui")
    def legacy_redirect() -> None:
        """Maintain compatibility with the older '/ui' path."""
        ui.run_javascript(f"window.location.replace('{UI_ROOT}/');")
        ui.label("Redirecting …").classes("px-4 py-6 text-slate-500")


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


def get_asgi_app():
    """Expose the NiceGUI ASGI application for unified hosting."""
    _register_pages()
    return nicegui_app


asgi_app = get_asgi_app()
