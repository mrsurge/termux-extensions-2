# app/apps/file_editor_cm6/monaco_editor/m_editor_app.py
#
# FastHTML-served Monaco iframe editor surface (mounted under /ui).
# This intentionally mirrors the organizational role of nicegui_editor/editor_app.py,
# but without NiceGUI.
#
# The editor runtime itself lives in `m_editor_app.js` so we can keep the harness
# modular and avoid embedding large scripts inside Python.

from __future__ import annotations

from pathlib import Path

from fastapi.responses import HTMLResponse, Response


def register_monaco_editor_routes(fastapi_app, mount_path: str = "/ui") -> None:
    """Register the Monaco iframe entrypoint route.

    The host app loads the iframe at `/api/app/<app_id>/ui/nc?...` so within the
    worker process this route is available at `/ui/nc`.
    """

    from fasthtml.common import Body, Div, Head, Html, Link, Meta, Script, Style, Title, to_xml

    @fastapi_app.get(f"{mount_path}/monaco_editor/m_editor_app.js", include_in_schema=False)
    async def _serve_monaco_editor_js():
        js_path = Path(__file__).with_name("m_editor_app.js")
        return Response(js_path.read_text(encoding="utf-8"), media_type="application/javascript")

    @fastapi_app.get(f"{mount_path}/nc", include_in_schema=False)
    async def _cm6_fasthtml_monaco_iframe(app_id: str | None = None):
        css = Style(
            """
            html, body { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; background: #0b0f14; }
            .fh-root { height: 100%; width: 100%; margin: 0; padding: 0; display: flex; }
            #fh-monaco { flex: 1; min-height: 0; min-width: 0; width: 100%; height: 100%; -webkit-touch-callout: none; user-select: none; }
            """
        )

        touch_css = Link(
            rel="stylesheet",
            href="/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.css",
        )

        html = Html(
            Head(
                Title("Code CM6"),
                Meta(charset="utf-8"),
                Meta(name="viewport", content="width=device-width, initial-scale=1"),
                css,
                touch_css,
                # Debug: prove CSS is loaded inside the iframe
                Style(
                    """
                    .__fh_debug_badge {
                      position: fixed;
                      top: 6px;
                      left: 6px;
                      z-index: 2147483647;
                      background: rgba(0,0,0,0.55);
                      color: #e6edf3;
                      border: 1px solid rgba(255,255,255,0.18);
                      border-radius: 8px;
                      padding: 6px 8px;
                      font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
                      pointer-events: none;
                    }
                    """
                ),
            ),
            Body(
                Div(
                    Div("", id="fh-monaco"),
                    Div("loading…", id="fh-debug", cls="__fh_debug_badge"),
                    cls="fh-root",
                ),
                # Load monaco-touch-selection BEFORE Monaco loader so AMD doesn't hijack it.
                Script(
                    src="/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js"
                ),
                Script(src="/static/vendor/socket.io.min.js"),
                Script(src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"),
                # Monaco editor harness (SSOT-first + editor socket transport).
                Script(src="monaco_editor/m_editor_app.js"),
            ),
        )

        return HTMLResponse(to_xml(html))
