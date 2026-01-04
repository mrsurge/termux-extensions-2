from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict


DEFAULT_LSP_CONFIG = {
    "rootRel": "",
    "module": "app",
    "variant": "GeckoDebug",
}


def _config_path(project_root: Path) -> Path:
    root = project_root.expanduser().resolve(strict=False)
    return root / ".code_cm6" / "lang" / "android" / "android_build_config.json"


def load_android_build_config(project_root: Path) -> Dict[str, Any]:
    path = _config_path(project_root)
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def save_android_build_config(project_root: Path, data: Dict[str, Any]) -> None:
    path = _config_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(data or {})
    payload.setdefault("version", 1)
    payload["updatedAtMs"] = int(time.time() * 1000)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def get_android_lsp_config(project_root: Path) -> Dict[str, str]:
    cfg = load_android_build_config(project_root)
    lsp = cfg.get("lsp") if isinstance(cfg.get("lsp"), dict) else {}
    root_rel = str(lsp.get("rootRel") or DEFAULT_LSP_CONFIG["rootRel"]).strip()
    module = str(lsp.get("module") or DEFAULT_LSP_CONFIG["module"]).strip() or DEFAULT_LSP_CONFIG["module"]
    variant = str(lsp.get("variant") or DEFAULT_LSP_CONFIG["variant"]).strip() or DEFAULT_LSP_CONFIG["variant"]
    return {"rootRel": root_rel, "module": module, "variant": variant}


def update_android_lsp_config(
    project_root: Path,
    *,
    root_rel: str | None = None,
    module: str | None = None,
    variant: str | None = None,
) -> Dict[str, str]:
    cfg = load_android_build_config(project_root)
    lsp = cfg.get("lsp") if isinstance(cfg.get("lsp"), dict) else {}
    if root_rel is not None:
        lsp["rootRel"] = str(root_rel).strip()
    if module is not None:
        lsp["module"] = str(module).strip() or DEFAULT_LSP_CONFIG["module"]
    if variant is not None:
        lsp["variant"] = str(variant).strip() or DEFAULT_LSP_CONFIG["variant"]
    cfg["lsp"] = lsp
    save_android_build_config(project_root, cfg)
    return get_android_lsp_config(project_root)


def update_android_autodetect(project_root: Path, autodetect: Dict[str, Any]) -> None:
    cfg = load_android_build_config(project_root)
    cfg["autodetect"] = dict(autodetect or {})
    save_android_build_config(project_root, cfg)
