# pyright: strict, reportUnusedFunction=false
"""HTTP resource boundary for Monaco, themes and the TextMate WASM runtime.

Grammar discovery/content uses WBA RPC, not these static resource routes.
Keep resource URLs stable for native OTA/APK interception.
"""
from pathlib import Path

from fastapi import APIRouter, FastAPI
from starlette.responses import FileResponse, Response

from ..code_te2_paths import code_te2_paths


def register_monaco_editor_routes(fastapi_app: FastAPI | APIRouter, mount_path: str = "/ui") -> None:
    """Register Monaco static asset routes for the inline host editor runtime."""
    app_pkg_root = Path(__file__).resolve().parents[3]
    vendored_monaco = app_pkg_root / "static" / "vendor" / "monaco-editor-core"
    vscode_monaco_esm_dir = vendored_monaco / "esm"
    esm_ok = vscode_monaco_esm_dir.exists()
    vscode_monaco_lang_dir = vendored_monaco / "te2-lang"
    lang_ok = vscode_monaco_lang_dir.exists()

    async def _serve_static_with_css_shim(base_dir: Path, file_path: str, raw: str | None) -> Response | FileResponse:
        base = base_dir.resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        if target.suffix == ".css" and raw == "1":
            return FileResponse(str(target), media_type="text/css")
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
        return FileResponse(str(target))

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/esm/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_esm(file_path: str, raw: str | None = None) -> Response:
        if not esm_ok:
            return Response("monaco esm not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_esm_dir, file_path, raw)

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/lang/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_lang(file_path: str, raw: str | None = None) -> Response:
        if not lang_ok:
            return Response("te2-lang not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_lang_dir, file_path, raw)

    @fastapi_app.get(mount_path + "/monaco_editor/themes/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_theme_json(file_path: str) -> Response:
        base = Path(__file__).with_name("themes").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    cs_ext_themes = code_te2_paths().code_server_extensions_dir

    @fastapi_app.get(mount_path + "/monaco_editor/cs_themes/{ext_id}/{theme_file:path}", include_in_schema=False)
    async def _serve_cs_extension_theme(ext_id: str, theme_file: str) -> Response:
        base = (cs_ext_themes / ext_id / "themes").resolve()
        target = (base / theme_file).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    @fastapi_app.get(mount_path + "/monaco_editor/textmate/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_textmate(file_path: str) -> Response:
        base = Path(__file__).with_name("textmate").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target))
