from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict, cast

from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar

from app.apps.file_editor_cm6.android_lang.android_dependency_model import build_dependency_model_v1
from app.apps.file_editor_cm6.android_lang.android_fingerprints import (
    compute_draft_fingerprint,
    compute_repo_fingerprint,
    compute_sync_fingerprint,
)
from app.apps.file_editor_cm6.android_lang.android_sidecar import (
    AndroidTe2Sidecar,
    resolve_cache_root,
    resolve_lsp_project_id,
    resolve_project_cache_dir,
)


def update_android_sidecar_for_project(
    *,
    project_root: Path,
    effective_project_root: Path,
    module: str = "app",
    variant: str = "GeckoDebug",
) -> Path:
    """Build + persist Sprint-A Android sidecar and return its path.

    - lspProjectId is bound to project_root (stable across rootRel changes)
    - fingerprints/model are computed against effective_project_root (rootRel-aware)
    """

    proj_root = project_root.expanduser().resolve(strict=False)
    eff_root = effective_project_root.expanduser().resolve(strict=False)

    repo_fp = compute_repo_fingerprint(eff_root)

    drafts = []
    try:
        sidecar = ProjectSidecar.load_or_create(str(proj_root))
        drafts = sidecar.list_project_drafts()
    except Exception:
        drafts = []

    draft_fp = compute_draft_fingerprint(effective_project_root=eff_root, drafts=drafts)

    extra_sync_files = [
        f"{module}/build.gradle",
        f"{module}/build.gradle.kts",
        "gradle/libs.versions.toml",
    ]
    sync_fp = compute_sync_fingerprint(
        effective_project_root=eff_root,
        module=module,
        variant=variant,
        extra_files=extra_sync_files,
    )

    lsp_project_id = resolve_lsp_project_id(project_root=proj_root)
    cache_root = resolve_cache_root()
    project_cache_dir = resolve_project_cache_dir(cache_root=cache_root, lsp_project_id=lsp_project_id)
    sidecar_path = project_cache_dir / "te2_android_sidecar.json"

    existing: Dict[str, Any] = AndroidTe2Sidecar(sidecar_path).load()
    existing_sync = str((existing or {}).get("syncFingerprint") or "")
    keep_cached = bool(existing_sync and existing_sync == sync_fp)

    dep_model = build_dependency_model_v1(effective_project_root=eff_root, module=module, variant=variant)

    # Preserve resolved artifact list + indices if still valid for the same syncFingerprint.
    if keep_cached:
        try:
            prev_resolved = (((existing or {}).get("dependencyModel") or {}).get("gradle") or {}).get("resolvedArtifacts")
            if isinstance(prev_resolved, list) and prev_resolved:
                # dep_model is a TypedDict; cast for mutation via dict methods.
                dep_any = cast(Dict[str, Any], dep_model)
                gradle = dep_any.get("gradle")
                if not isinstance(gradle, dict):
                    gradle = {"gradleUserHome": str(Path.home() / ".gradle"), "resolvedArtifacts": []}
                    dep_any["gradle"] = gradle
                gradle["resolvedArtifacts"] = prev_resolved
        except Exception:
            pass

    payload: Dict[str, Any] = {
        "version": 1,
        "lspProjectId": lsp_project_id,
        "effectiveProjectRoot": str(eff_root),
        "repoFingerprint": repo_fp,
        "draftFingerprint": draft_fp,
        "syncFingerprint": sync_fp,
        "lastGradleCompile": {
            "repoFingerprint": None,
            "variant": variant,
            "module": module,
            "finishedAtMs": 0,
            "exitCode": 0,
        },
        "dependencyModel": dep_model,
        "updatedAtMs": int(time.time() * 1000),
    }

    if keep_cached:
        for k in ("dependencyIndex", "shadowIndex", "gradleDraftFingerprint"):
            if k in (existing or {}):
                payload[k] = (existing or {}).get(k)

    AndroidTe2Sidecar(sidecar_path).save(payload)
    return sidecar_path
