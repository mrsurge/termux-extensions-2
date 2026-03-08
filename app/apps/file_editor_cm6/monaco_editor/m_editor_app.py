# app/apps/file_editor_cm6/monaco_editor/m_editor_app.py
#
# Monaco iframe editor surface (mounted under /ui).
# Serves editor_iframe.html (static) and supporting JS/CSS/theme routes.
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
    async def _cm6_monaco_iframe(app_id: str | None = None):
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

        iframe_html = Path(__file__).parent / "editor_iframe.html"
        return FileResponse(str(iframe_html), media_type="text/html")
