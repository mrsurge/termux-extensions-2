"""Shared NiceGUI shell for Termux Extensions apps."""

from __future__ import annotations

import argparse
import os
import importlib
import sys
from contextlib import suppress
from dataclasses import dataclass
from typing import Callable

from nicegui import app as nicegui_app, ui


@dataclass
class ShellContext:
    header_primary: ui.element
    header_app: ui.element
    body: ui.element


def build_shell(load_fn: Callable[[ShellContext], None], app_id: str) -> None:
    """Construct the shared shell layout and embed the app UI."""

    def handle_home() -> None:
        ui.run_javascript("window.location.href='/'")

    def handle_reload() -> None:
        ui.run_javascript("window.location.reload()")

    shell_header = ui.header(fixed=True).props("elevated").classes(
        "shell-header w-full bg-slate-900 border-b border-slate-800 px-0 py-0"
    )
    with shell_header:
        header_primary = ui.row().classes(
            "w-full items-center gap-2 px-3 py-2 text-xs md:text-sm text-slate-100"
        )
        with header_primary:
            ui.button("Home", on_click=handle_home).props("flat dense")
            ui.button("Reload", on_click=handle_reload).props("flat dense")
            ui.button("Toast", on_click=lambda: ui.notify("Shell toast")).props("flat dense")
            ui.label(f"NiceGUI Shell · {app_id}").classes("text-xs text-slate-300")
        header_app = ui.element().classes(
            "app-header w-full px-3 py-1.5 bg-slate-900/85 border-t border-slate-800/60 backdrop-blur-sm"
        )

    main_scroll = ui.element("div").classes(
        "main-scroll flex-1 w-full overflow-auto overscroll-contain text-slate-100"
    ).style("max-width: 100vw; height: 100%; min-height: 0;")
    with main_scroll:
        canvas = ui.element().classes("app-body flex-1 w-full min-h-0 flex flex-col").style("max-width: 100vw; height: 100%; min-height: 0;")

    context = ShellContext(
        header_primary=header_primary,
        header_app=header_app,
        body=canvas,
    )

    try:
        load_fn(context)
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
        """<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root { --vk-offset: 0px; --shell-header-height: 0px; --app-height: 100vh; }
html, body {margin: 0; padding: 0; height: var(--app-height); overflow: hidden; background: #020617;}
body {color: #e2e8f0; font-family: 'Inter', sans-serif;}
#app {height: 100%; display: flex; flex-direction: column; max-width: 100vw;}
.nicegui-content {flex: 1 1 auto; display: flex !important; flex-direction: column !important; width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important;}
.q-page-container, .q-page {display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;}
.q-page > div, .nicegui-page, .nicegui-page-content {display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;}
.main-scroll {flex: 1 1 auto; display: flex; flex-direction: column; box-sizing: border-box; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--vk-offset)); background: #020617;}
.scroll-inner {flex: 1 1 auto; display: flex; flex-direction: column; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding-bottom: var(--vk-offset);}
.app-body {flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0;}
input, textarea, select {font-size: 16px;}
</style>"""
    )
    ui.add_body_html(
        """<script>
(function () {
  const root = document.documentElement;
  const vk = navigator.virtualKeyboard;
  const headerSelector = '.shell-header';
  let headerObserver;
  let mutationObserver;

  function updateMetrics() {
    const vv = window.visualViewport;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--app-height', viewportHeight + 'px');

    let offset = 0;
    if (vk && vk.boundingRect) {
      offset = vk.boundingRect.height || 0;
    } else if (vv) {
      offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    }
    root.style.setProperty('--vk-offset', offset + 'px');

    const header = document.querySelector(headerSelector);
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    root.style.setProperty('--shell-header-height', headerHeight + 'px');
  }

  function initObservers() {
    const header = document.querySelector(headerSelector);
    if (!header) {
      return;
    }
    if (typeof ResizeObserver !== 'undefined') {
      headerObserver?.disconnect();
      headerObserver = new ResizeObserver(updateMetrics);
      headerObserver.observe(header);
    }
    mutationObserver?.disconnect();
    mutationObserver = new MutationObserver(updateMetrics);
    mutationObserver.observe(header, {childList: true, subtree: true, attributes: true});
    updateMetrics();
  }

  if (vk && 'overlaysContent' in vk) {
    try { vk.overlaysContent = true; } catch (e) {}
    vk.addEventListener?.('geometrychange', updateMetrics);
  }

  const ready = () => {
    initObservers();
    updateMetrics();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, {once: true});
  } else {
    ready();
  }

  window.addEventListener('resize', updateMetrics, {passive: true});
  window.visualViewport?.addEventListener('resize', updateMetrics, {passive: true});
  window.addEventListener('orientationchange', updateMetrics);
})();
</script>"""
    )
    print(f"[nicegui_shell] Rendering app {args.app_id}")
    build_shell(builder, args.app_id)

    certfile = os.getenv("TE_SSL_CERT")
    keyfile = os.getenv("TE_SSL_KEY")

    run_kwargs: dict[str, object] = dict(
        host=args.host,
        port=args.port,
        reload=False,
        show=False,
        native=False,
    )

    if certfile and keyfile:
        run_kwargs["ssl_certfile"] = certfile
        run_kwargs["ssl_keyfile"] = keyfile
        print(f"[nicegui_shell] Running with TLS cert={certfile} key={keyfile}")

    ui.run(**run_kwargs)


if __name__ == "__main__":
    main(sys.argv[1:])
