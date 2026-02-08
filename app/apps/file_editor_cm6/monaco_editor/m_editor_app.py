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
from starlette.responses import FileResponse


def register_monaco_editor_routes(fastapi_app, mount_path: str = "/ui") -> None:
    """Register the Monaco iframe entrypoint route.

    The host app loads the iframe at `/api/app/<app_id>/ui/nc?...` so within the
    worker process this route is available at `/ui/nc`.
    """

    from fasthtml.common import Body, Div, Head, Html, Link, Meta, Script, Style, Title, to_xml

    # Use the pinned VS Code monaco-editor-core build output (ESM) directly.
    # This directory is produced by: `worktrees/vscode-te2-diff` -> `gulp editor-distro`.
    # Resolve repo root (m_editor_app.py lives at: app/apps/file_editor_cm6/monaco_editor/...)
    repo_root = Path(__file__).resolve().parents[4]
    vscode_monaco_esm_dir = repo_root / "worktrees" / "vscode-te2-diff" / "out-monaco-editor-core" / "esm"
    esm_ok = vscode_monaco_esm_dir.exists()

    # Monaco language contributions (syntax + pseudo-LSP).
    # This directory is produced by an esbuild bundle from the pinned monaco-editor sources:
    # `worktrees/vscode-te2-diff/out-monaco-editor-core/te2-lang/`.
    vscode_monaco_lang_dir = repo_root / "worktrees" / "vscode-te2-diff" / "out-monaco-editor-core" / "te2-lang"
    lang_ok = vscode_monaco_lang_dir.exists()

    # IMPORTANT: Monaco's ESM output imports CSS via `import './foo.css'`.
    # Browsers don't support CSS module imports directly, so we serve `.css` as a JS
    # module shim which injects a `<link>` that points at the real CSS with `?raw=1`.
    async def _serve_static_with_css_shim(base_dir: Path, file_path: str, raw: str | None):
        base = base_dir.resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")

        # Serve raw CSS when explicitly requested.
        if target.suffix == ".css" and raw == "1":
            return FileResponse(str(target), media_type="text/css")

        # Serve a JS module shim for CSS imports.
        if target.suffix == ".css":
            shim = """
// Auto-generated CSS module shim (TE2 / VSCode Monaco ESM)
const url = new URL(import.meta.url);
url.searchParams.set('raw', '1');
const href = url.toString();
const id = 'te2-css:' + href;
if (!document.querySelector(`link[data-te2-css="${id}"]`)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.te2Css = id;
  document.head.appendChild(link);
}
export default href;
""".lstrip()
            return Response(shim, media_type="application/javascript")

        # Default: serve the file normally (js, map, wasm, etc).
        return FileResponse(str(target))

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/esm/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_esm(file_path: str, raw: str | None = None):
        if not esm_ok:
            return Response("monaco esm not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_esm_dir, file_path, raw)

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/lang/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_lang(file_path: str, raw: str | None = None):
        if not lang_ok:
            return Response("te2-lang not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_lang_dir, file_path, raw)

    @fastapi_app.get(f"{mount_path}/monaco_editor/m_editor_app.js", include_in_schema=False)
    async def _serve_monaco_editor_js():
        js_path = Path(__file__).with_name("m_editor_app.js")
        return Response(js_path.read_text(encoding="utf-8"), media_type="application/javascript")

    @fastapi_app.get(mount_path + "/monaco_editor/themes/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_theme_json(file_path: str):
        base = Path(__file__).with_name("themes").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    @fastapi_app.get(mount_path + "/monaco_editor/textmate/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_textmate(file_path: str):
        # TextMate grammars + Oniguruma WASM used by the Monaco iframe (client-side tokenization).
        base = Path(__file__).with_name("textmate").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        # Let FileResponse infer content type for .js/.json/.wasm.
        return FileResponse(str(target))

    @fastapi_app.get(f"{mount_path}/nc", include_in_schema=False)
    async def _cm6_fasthtml_monaco_iframe(app_id: str | None = None):
        # Best-effort: start the backend shells early so the iframe can immediately
        # use the language sidecar without an extra "warm up" round-trip.
        try:
            from ..stores import _history_store
            from ..explorer_helper import get_project_root
            from ..code_server_shell_manager import ensure_code_server_shell
            from ..vscode_api_shell_manager import ensure_vscode_api_shell

            project_root = _history_store.get_active_project() or str(get_project_root())
            if project_root:
                await ensure_code_server_shell(project_root)
                # vscode_api is used by the iframe for grammars/themes/LSP and now sidecar bridging.
                await ensure_vscode_api_shell(project_root)
        except Exception:
            # Do not block editor load on shell orchestration failures.
            pass

        if not esm_ok or not lang_ok:
            missing = []
            if not esm_ok:
                missing.append("monaco ESM (out-monaco-editor-core/esm)")
            if not lang_ok:
                missing.append("te2-lang (out-monaco-editor-core/te2-lang)")
            msg = "Missing build artifacts: " + ", ".join(missing)
            msg += "\\nRun: `cd worktrees/vscode-te2-diff && ./build_monaco_te2.sh`"
            return HTMLResponse(
                f"<pre style='white-space:pre-wrap;padding:16px;font-family:ui-monospace'>{msg}</pre>",
                status_code=503,
            )
        css = Style(
            """
            @font-face {
              font-family: 'JetBrains Mono';
              src: url('/static/fonts/jetbrains/webfonts/JetBrainsMono-Regular.woff2') format('woff2');
              font-weight: 400;
              font-style: normal;
              font-display: swap;
            }
            @font-face {
              font-family: 'JetBrains Mono';
              src: url('/static/fonts/jetbrains/webfonts/JetBrainsMono-Italic.woff2') format('woff2');
              font-weight: 400;
              font-style: italic;
              font-display: swap;
            }
            @font-face {
              font-family: 'JetBrains Mono';
              src: url('/static/fonts/jetbrains/webfonts/JetBrainsMono-Bold.woff2') format('woff2');
              font-weight: 700;
              font-style: normal;
              font-display: swap;
            }
            @font-face {
              font-family: 'JetBrains Mono';
              src: url('/static/fonts/jetbrains/webfonts/JetBrainsMono-BoldItalic.woff2') format('woff2');
              font-weight: 700;
              font-style: italic;
              font-display: swap;
            }
            html, body { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; background: #0b0f14; }
            .fh-root { height: 100%; width: 100%; margin: 0; padding: 0; display: flex; }
            #fh-monaco { flex: 1; min-height: 0; min-width: 0; width: 100%; height: 100%; -webkit-touch-callout: none; user-select: none; }
            .fh-root, .monaco-editor { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

            /* Draft diff decorations (Monaco) */
            .monaco-editor .te2-draft-add-line { background: rgba(56, 139, 253, 0.22) !important; } /* blue */
            .monaco-editor .te2-draft-del-line { background: rgba(210, 153, 34, 0.18) !important; } /* yellow */
            .monaco-editor .margin-view-overlays .te2-draft-del-marker {
              background: rgba(210, 153, 34, 0.90);
              width: 3px !important;
            }
            .monaco-editor .te2-draft-del-zone {
              background: rgba(210, 153, 34, 0.12);
              color: #e6b450;
              font-family: inherit;
              font-size: inherit;
              line-height: inherit;
              white-space: pre;
            }

            /* Keep folding controls + diff revert arrows visible (disable hover-hide) */
            .monaco-editor .margin-view-overlays .codicon-folding-expanded,
            .monaco-editor .margin-view-overlays .codicon-folding-collapsed,
            .monaco-editor .margin-view-overlays .codicon-folding-manual-expanded,
            .monaco-editor .margin-view-overlays .codicon-folding-manual-collapsed,
            .monaco-editor .arrow-revert-change {
              opacity: 1 !important;
              visibility: visible !important;
            }
            """
        )

        touch_css = Link(
            rel="stylesheet",
            href="/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.css",
        )
        bootstrap_bundle_css = Link(
            rel="stylesheet",
            href="/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css?raw=1",
        )

        # NOTE: Import map URLs are resolved relative to the iframe document.
        # Use the absolute /api/app/<app_id>/ui/... path to avoid any ambiguity.
        import_map = Script(
            """
            {
              "imports": {
                "monaco-editor-core": "/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/editor/editor.api.js"
              }
            }
            """.strip(),
            type="importmap",
        )

        html = Html(
            Head(
                Title("Code TE2"),
                Meta(charset="utf-8"),
                Meta(name="viewport", content="width=device-width, initial-scale=1"),
                css,
                touch_css,
                bootstrap_bundle_css,
                import_map,
                # Debug: prove CSS is loaded inside the iframe
                Style(
                    """
            .__fh_debug_badge {
                      position: fixed;
                      left: 8px;
                      bottom: 8px;
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
                # TextMate tokenization dependencies (UMD globals): `window.onig`, `window.vscodetextmate`.
                Script(src="monaco_editor/textmate/vscode-oniguruma.umd.js"),
                Script(src="monaco_editor/textmate/vscode-textmate.umd.js"),
                Script(src="/static/vendor/socket.io.min.js"),
                # Monaco editor harness (SSOT-first + editor socket transport).
                Script(src="monaco_editor/m_editor_app.js"),
            ),
        )

        return HTMLResponse(to_xml(html))
