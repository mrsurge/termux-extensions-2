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

    # Use the vendored Monaco build artifacts (JS + CSS only, no sourcemaps).
    # These are committed to the repo under app/static/vendor/monaco-editor-core/.
    # To rebuild: run `worktrees/vscode-te2-diff/build_monaco_te2.sh`.
    repo_root = Path(__file__).resolve().parents[4]
    vendored_monaco = repo_root / "app" / "static" / "vendor" / "monaco-editor-core"
    vscode_monaco_esm_dir = vendored_monaco / "esm"
    esm_ok = vscode_monaco_esm_dir.exists()

    # Monaco language contributions (syntax + pseudo-LSP workers).
    vscode_monaco_lang_dir = vendored_monaco / "te2-lang"
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
        # Prefer bundled output from esbuild; fall back to raw source for dev.
        dist_path = Path(__file__).resolve().parent.parent / "static" / "dist" / "editor.js"
        if dist_path.exists():
            return Response(dist_path.read_text(encoding="utf-8"), media_type="application/javascript")
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

    # Serve theme JSON directly from code-server's installed extensions folder.
    _cs_ext_themes = Path.home() / ".config" / "code-server" / "extensions"

    @fastapi_app.get(mount_path + "/monaco_editor/cs_themes/{ext_id}/{theme_file:path}", include_in_schema=False)
    async def _serve_cs_extension_theme(ext_id: str, theme_file: str):
        base = (_cs_ext_themes / ext_id / "themes").resolve()
        target = (base / theme_file).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    # Vendored theme index for the bundled themes dir.
    _vendored_themes_dir = Path(__file__).with_name("themes") / "vendored"

    @fastapi_app.get(mount_path + "/monaco_editor/available_themes", include_in_schema=False)
    async def _available_themes():
        """Return all available themes: vendored + extension-installed."""
        import json as _json
        themes: list[dict] = []

        # 1) Vendored themes — scan subdirs for theme_index.json
        if _vendored_themes_dir.is_dir():
            for vendor_dir in sorted(_vendored_themes_dir.iterdir()):
                idx_file = vendor_dir / "theme_index.json"
                if not idx_file.is_file():
                    continue
                try:
                    idx = _json.loads(idx_file.read_text("utf-8"))
                    for t in idx.get("vendored", []):
                        themes.append({
                            "id": t["id"],
                            "label": t["label"],
                            "uiTheme": t.get("uiTheme", "vs-dark"),
                            "source": "vendored",
                            "sourceLabel": idx.get("source", vendor_dir.name),
                            "serveUrl": f"monaco_editor/themes/vendored/{vendor_dir.name}/{t['file']}",
                        })
                except Exception:
                    pass

        # 2) Extension-installed themes — scan registry
        try:
            from ..extension_registry import get_extension_list
            exts = get_extension_list()
            for ext in exts:
                ext_themes = ext.get("themes", [])
                if not ext_themes:
                    continue
                ext_id = ext.get("id", "")
                ext_path = ext.get("path", "")
                if not ext_id or not ext_path:
                    continue
                for t in ext_themes:
                    # path is like "./themes/dark-default.json" — extract filename
                    raw_path = t.get("path", "")
                    fname = raw_path.rsplit("/", 1)[-1] if "/" in raw_path else raw_path
                    label = t.get("label", fname)
                    tid = label.lower().replace(" ", "-").replace("(", "").replace(")", "")
                    # Serve via cs_themes route using the extension directory name
                    ext_dir_name = Path(ext_path).name
                    themes.append({
                        "id": f"ext:{ext_id}:{tid}",
                        "label": label,
                        "uiTheme": t.get("uiTheme", "vs-dark"),
                        "source": "extension",
                        "sourceLabel": ext.get("display_name", ext_id),
                        "serveUrl": f"monaco_editor/cs_themes/{ext_dir_name}/{fname}",
                    })
        except Exception as exc:
            print(f"[themes] extension theme scan failed: {exc}", flush=True)

        return {"themes": themes}

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
        # Best-effort: confirm code-server backend is ready so the readiness chain
        # (triggered by iframe JS) can skip the cold-start wait.
        try:
            from ..stores import _history_store
            from ..explorer_helper import get_project_root
            from ..code_server_shell_manager import ensure_code_server_shell

            project_root = _history_store.get_active_project() or str(get_project_root())
            if project_root:
                await ensure_code_server_shell(project_root)
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
            .fh-root { height: 100%; width: 100%; margin: 0; padding: 0; display: flex; flex-direction: column; }
            #te2-breadcrumbs {
              display: flex; align-items: center; padding: 2px 8px;
              background: #0b0f1a; border-bottom: 1px solid #333;
              font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              min-height: 22px; max-height: 22px; flex-shrink: 0;
              color: #ccc; overflow-x: auto; overflow-y: hidden;
              flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch;
            }
            #te2-breadcrumbs::-webkit-scrollbar { display: none; }
            #te2-breadcrumbs:empty { display: none; }
            #te2-breadcrumbs .monaco-breadcrumbs { flex: 1; min-width: 0; }
            .te2-bc-item { display: inline-flex; align-items: center; gap: 4px; padding: 0 4px; opacity: 0.8; cursor: pointer; white-space: nowrap; }
            .te2-bc-item:hover { opacity: 1; color: #e5e7eb; }
            .te2-bc-icon { display: inline-flex; align-items: center; width: 16px; height: 16px; flex-shrink: 0; }
            .te2-bc-icon svg { width: 16px; height: 16px; fill: currentColor; }
            .te2-bc-sym-icon { display: inline-flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0; margin-right: 2px; }
            .te2-bc-sym-icon svg { width: 14px; height: 14px; }
            .te2-bc-sep { opacity: 0.4; padding: 0 2px; }
            #fh-monaco { flex: 1; min-height: 0; min-width: 0; width: 100%; -webkit-touch-callout: none; user-select: none; }
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
        breadcrumbs_css = Link(
            rel="stylesheet",
            href="/apps/file_editor_cm6/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css",
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
                Link(rel="stylesheet", href="/static/vendor/codicons/codicon.css"),
                css,
                touch_css,
                bootstrap_bundle_css,
                breadcrumbs_css,
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
                    Div("", id="te2-breadcrumbs"),
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
