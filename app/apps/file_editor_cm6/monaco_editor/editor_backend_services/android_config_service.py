# pyright: strict
from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

from fastapi import HTTPException

from ...android_lang.android_config import (
    collect_android_config,
    update_build_gradle,
    update_build_gradle_variants,
    update_properties_file,
)
from .payload_utils import as_payload_dict

JsonMap = dict[str, object]
ActiveProjectFn = Callable[[], str | None]
ProjectRootFn = Callable[[], Path]


def _as_json_map(data: object) -> JsonMap:
    if not isinstance(data, dict):
        return {}
    typed_data = cast(dict[object, object], data)
    out: JsonMap = {}
    for raw_key, raw_value in typed_data.items():
        if isinstance(raw_key, str):
            out[raw_key] = raw_value
    return out


def _nested_path(files: Mapping[str, object], key: str) -> str | None:
    entry = files.get(key)
    if not isinstance(entry, Mapping):
        return None
    typed_entry = cast(Mapping[str, object], entry)
    path_obj = typed_entry.get("path")
    return path_obj if isinstance(path_obj, str) else None


def _android_autodetect_payload(data: Mapping[str, object]) -> JsonMap:
    return {
        "files": data.get("files") if isinstance(data.get("files"), dict) else {},
        "gradleProperties": data.get("gradleProperties") if isinstance(data.get("gradleProperties"), dict) else {},
        "localProperties": data.get("localProperties") if isinstance(data.get("localProperties"), dict) else {},
        "buildConfig": data.get("buildConfig") if isinstance(data.get("buildConfig"), dict) else {},
        "modules": data.get("modules") if isinstance(data.get("modules"), list) else [],
        "variants": data.get("variants") if isinstance(data.get("variants"), dict) else {},
        "sourceSets": data.get("sourceSets") if isinstance(data.get("sourceSets"), list) else [],
        "termuxAapt2Path": data.get("termuxAapt2Path") if isinstance(data.get("termuxAapt2Path"), str) else "",
        "importantGradleProperties": (
            data.get("importantGradleProperties") if isinstance(data.get("importantGradleProperties"), list) else []
        ),
    }


def get_android_lsp_config(base_root: Path) -> JsonMap:
    try:
        from ...android_lang.android_lsp_config import get_android_lsp_config as _get_android_lsp_config

        raw_cfg = _get_android_lsp_config(base_root)
        return _as_json_map(raw_cfg)
    except Exception:
        return {"rootRel": "", "module": "app", "variant": "GeckoDebug"}


def resolve_android_roots(
    *,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
) -> tuple[Path, Path, str]:
    base_root = Path(active_project() or str(project_root()))
    effective_root = base_root
    cfg = get_android_lsp_config(base_root)
    root_rel_obj = cfg.get("rootRel")
    root_rel = str(root_rel_obj or "").strip()
    if root_rel:
        candidate = (base_root / root_rel).expanduser().resolve(strict=False)
        if candidate.exists() and candidate.is_dir():
            effective_root = candidate
    module_obj = cfg.get("module")
    module = str(module_obj or "app").strip() or "app"
    return base_root, effective_root, module


async def handle_android_config_get(
    *,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
) -> JsonMap:
    base_root, effective_root, module = resolve_android_roots(
        active_project=active_project,
        project_root=project_root,
    )
    data = _as_json_map(collect_android_config(effective_root=effective_root, module=module))
    data["projectRoot"] = str(base_root)
    data["effectiveRoot"] = str(effective_root)
    data["module"] = module
    try:
        from ...android_lang.android_lsp_config import update_android_autodetect

        update_android_autodetect(base_root, _android_autodetect_payload(data))
    except Exception:
        pass
    return {"ok": True, "data": data}


async def handle_android_config_save(
    payload: Mapping[str, object] | None,
    *,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
) -> JsonMap:
    payload_map = as_payload_dict(payload)
    base_root, effective_root, module_default = resolve_android_roots(
        active_project=active_project,
        project_root=project_root,
    )
    module = str(payload_map.get("module") or module_default).strip() or module_default
    create_missing = bool(payload_map.get("createMissing", False))

    cfg = _as_json_map(collect_android_config(effective_root=effective_root, module=module))
    files = _as_json_map(cfg.get("files"))

    gradle_updates_obj = payload_map.get("gradleProperties")
    local_updates_obj = payload_map.get("localProperties")
    build_updates_obj = payload_map.get("buildGradle")

    if gradle_updates_obj is None:
        gradle_updates_obj = {}
    if local_updates_obj is None:
        local_updates_obj = {}
    if build_updates_obj is None:
        build_updates_obj = {}

    if (
        not isinstance(gradle_updates_obj, dict)
        or not isinstance(local_updates_obj, dict)
        or not isinstance(build_updates_obj, dict)
    ):
        raise HTTPException(status_code=400, detail="updates must be objects")

    gradle_updates = _as_json_map(cast(object, gradle_updates_obj))
    local_updates = _as_json_map(cast(object, local_updates_obj))
    build_updates = _as_json_map(cast(object, build_updates_obj))

    if "sdkDir" in local_updates and "sdk.dir" not in local_updates:
        local_updates["sdk.dir"] = local_updates.get("sdkDir")

    results: JsonMap = {"gradleProperties": {}, "localProperties": {}, "buildGradle": {}}

    gradle_props_path = Path(_nested_path(files, "gradleProperties") or (effective_root / "gradle.properties"))
    if gradle_updates:
        results["gradleProperties"] = update_properties_file(
            gradle_props_path,
            gradle_updates,
            create_missing=create_missing,
        )

    local_props_path = Path(_nested_path(files, "localProperties") or (effective_root / "local.properties"))
    if local_updates:
        results["localProperties"] = update_properties_file(
            local_props_path,
            local_updates,
            create_missing=create_missing,
        )

    build_path: Path | None = None
    module_build = _nested_path(files, "moduleBuildGradle")
    root_build = _nested_path(files, "rootBuildGradle")
    if module_build:
        build_path = Path(module_build)
    elif root_build:
        build_path = Path(root_build)

    if build_updates:
        results["buildGradle"] = update_build_gradle(build_path, build_updates)

    updated = _as_json_map(collect_android_config(effective_root=effective_root, module=module))
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module
    try:
        from ...android_lang.android_lsp_config import update_android_autodetect, update_android_lsp_config

        update_android_lsp_config(base_root, module=module)
        update_android_autodetect(base_root, _android_autodetect_payload(updated))
    except Exception:
        pass

    return {"ok": True, "data": {"results": results, "config": updated}}


def _normalize_android_source_set_name(name: object) -> str:
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    raw = str(name).strip()
    if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", raw):
        raw = re.sub(r"[^A-Za-z0-9_]", "_", raw)
        raw = re.sub(r"_+", "_", raw).strip("_")
        if not raw or not re.match(r"^[A-Za-z]", raw):
            raise HTTPException(status_code=400, detail="invalid source set name")
    return raw


def _create_android_source_set_dirs(
    *,
    effective_root: Path,
    module_name: str,
    name: object,
    include: dict[str, object] | None,
) -> tuple[str, list[str], list[str]]:
    include = include if isinstance(include, dict) else {}
    include_code = bool(include.get("code", True))
    include_res = bool(include.get("res", True))
    include_manifest = bool(include.get("manifest", False))

    normalized_name = _normalize_android_source_set_name(name)

    created: list[str] = []
    existing: list[str] = []

    src_root = (effective_root / module_name / "src").expanduser().resolve(strict=False)
    target_root = (src_root / normalized_name).expanduser().resolve(strict=False)
    if not str(target_root).startswith(str(effective_root.expanduser().resolve(strict=False))):
        raise HTTPException(status_code=400, detail="invalid source set path")

    def _touch_dir(path: Path) -> None:
        if path.exists():
            existing.append(str(path))
            return
        path.mkdir(parents=True, exist_ok=True)
        created.append(str(path))

    def _touch_file(path: Path, content: str) -> None:
        if path.exists():
            existing.append(str(path))
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        created.append(str(path))

    _touch_dir(target_root)
    if include_code:
        _touch_dir(target_root / "java")
        _touch_dir(target_root / "kotlin")
    if include_res:
        _touch_dir(target_root / "res")
    if include_manifest:
        _touch_file(
            target_root / "AndroidManifest.xml",
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\n"
            "</manifest>\n",
        )

    return normalized_name, created, existing


async def handle_android_source_set_create(
    payload: Mapping[str, object] | None,
    *,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
) -> JsonMap:
    payload_map = as_payload_dict(payload)
    base_root, effective_root, module_default = resolve_android_roots(
        active_project=active_project,
        project_root=project_root,
    )
    name = payload_map.get("name")
    module_name = str(payload_map.get("module") or module_default or "app").strip() or "app"
    include_obj = payload_map.get("include")
    include = _as_json_map(cast(object, include_obj)) if isinstance(include_obj, dict) else None
    normalized_name, created, existing = _create_android_source_set_dirs(
        effective_root=effective_root,
        module_name=module_name,
        name=name,
        include=include,
    )

    updated = _as_json_map(collect_android_config(effective_root=effective_root, module=module_name))
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module_name
    try:
        from ...android_lang.android_lsp_config import update_android_autodetect

        update_android_autodetect(base_root, _android_autodetect_payload(updated))
    except Exception:
        pass

    return {
        "ok": True,
        "data": {"created": created, "existing": existing, "name": normalized_name, "config": updated},
    }


async def handle_android_variant_create(
    payload: Mapping[str, object] | None,
    *,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
) -> JsonMap:
    payload_map = as_payload_dict(payload)
    base_root, effective_root, module_default = resolve_android_roots(
        active_project=active_project,
        project_root=project_root,
    )
    name = payload_map.get("name")
    kind = str(payload_map.get("type") or "").strip()
    if kind not in ("buildType", "flavor"):
        raise HTTPException(status_code=400, detail="invalid variant type")
    module_name = str(payload_map.get("module") or module_default or "app").strip() or "app"
    dimension_raw = payload_map.get("dimension")
    dimension = str(dimension_raw).strip() if dimension_raw is not None else ""
    flavor_dimension = dimension or None
    create_source_set = bool(payload_map.get("createSourceSet", False))

    normalized_name = _normalize_android_source_set_name(name)

    cfg = _as_json_map(collect_android_config(effective_root=effective_root, module=module_name))
    files = _as_json_map(cfg.get("files"))
    module_build = _nested_path(files, "moduleBuildGradle")
    root_build = _nested_path(files, "rootBuildGradle")
    build_path = Path(module_build or root_build or "")
    if not build_path or not build_path.is_file():
        raise HTTPException(status_code=400, detail="build.gradle not found")

    result = update_build_gradle_variants(
        build_path,
        kind=kind,
        name=normalized_name,
        flavor_dimension=flavor_dimension,
    )
    result_map = _as_json_map(result)
    error_obj = result_map.get("error")
    if isinstance(error_obj, str) and error_obj:
        raise HTTPException(status_code=400, detail=error_obj)

    created: list[str] = []
    existing: list[str] = []
    if create_source_set:
        _, created, existing = _create_android_source_set_dirs(
            effective_root=effective_root,
            module_name=module_name,
            name=normalized_name,
            include={"code": True, "res": True, "manifest": False},
        )

    updated = _as_json_map(collect_android_config(effective_root=effective_root, module=module_name))
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module_name
    try:
        from ...android_lang.android_lsp_config import update_android_autodetect

        update_android_autodetect(base_root, _android_autodetect_payload(updated))
    except Exception:
        pass

    return {
        "ok": True,
        "data": {
            "result": result_map,
            "created": created,
            "existing": existing,
            "name": normalized_name,
            "config": updated,
        },
    }
