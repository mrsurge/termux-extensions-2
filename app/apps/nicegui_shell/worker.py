"""Shared NiceGUI shell for Termux Extensions apps."""

from __future__ import annotations

import argparse
import importlib
import sys
from contextlib import suppress
from typing import Callable

from nicegui import app as nicegui_app, ui


def build_shell(load_fn: Callable[[ui.element], None], app_id: str) -> None:
    """Construct the shared shell layout and embed the app UI."""

    def handle_home() -> None:
        ui.run_javascript("window.location.href='/'")

    def handle_reload() -> None:
        ui.run_javascript("window.location.reload()")

    root = ui.element().classes(
        "flex flex-col w-full h-screen bg-slate-950 text-slate-100 overflow-hidden"
    ).style("max-width: 100vw; width: 100vw;")

    with root:
        with ui.row().classes(
            "w-full items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900"
        ):
            ui.button("Home", on_click=handle_home).props("flat")
            ui.button("Reload", on_click=handle_reload).props("flat")
            ui.button("Toast", on_click=lambda: ui.notify("Shell toast"))
            ui.label(f"NiceGUI Shell · {app_id}").classes("text-sm text-slate-300")

        body = ui.element().classes("flex-1 w-full overflow-hidden").style("max-width: 100vw;")
        with body:
            inner = ui.element().classes("w-full h-full overflow-hidden").style("max-width: 100vw;")
            with inner:
                canvas = ui.element().classes("h-full w-full p-0 m-0").style("max-width: 100vw;")
                try:
                    load_fn(canvas)
                except Exception as exc:  # pragma: no cover - surface to UI
                    ui.notification(f"Failed to load app module: {exc}", close_button='OK')
                    with canvas:
                        ui.label("App failed to load (see logs).").classes("text-red-400")


def import_builder(module_path: str) -> Callable[[ui.column], None]:
    module = importlib.import_module(module_path)
    builder = getattr(module, "build_ui", None)
    if not callable(builder):
        raise AttributeError(f"Module {module_path} must expose callable 'build_ui'")
    return builder


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Termux Extensions NiceGUI shell")
    parser.add_argument("--app-id", required=True, help="App identifier")
    parser.add_argument("--module", required=True, help="Python module path exposing build_ui")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args(argv)

    builder = import_builder(args.module)
    ui.add_head_html(
        """<style>
html, body {margin: 0; padding: 0; height: 100%; overflow: hidden; background: #020617;}
body {color: #e2e8f0; font-family: 'Inter', sans-serif;}
#app {height: 100%; width: 100%; max-width: 100vw;}
.nicegui-content {width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important;}
</style>"""
    )
    build_shell(builder, args.app_id)
    ui.run(host=args.host, port=args.port, reload=False, show=False, native=False)


if __name__ == "__main__":
    main(sys.argv[1:])
