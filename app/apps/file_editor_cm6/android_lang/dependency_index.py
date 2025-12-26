from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path
from typing import Iterable


def _scan_zip_for_classes(*, zf: zipfile.ZipFile, max_classes: int) -> tuple[set[str], set[str]]:
    classes: set[str] = set()
    packages: set[str] = set()
    try:
        for entry in zf.namelist():
            if len(classes) >= max_classes:
                break
            if not entry.endswith(".class"):
                continue
            if entry.startswith("META-INF/"):
                continue
            cls = entry[:-6].replace("/", ".")
            classes.add(cls)
            if "." in cls:
                packages.add(cls.rsplit(".", 1)[0])
    except Exception:
        pass
    return classes, packages


def scan_artifact_classes(*, artifact_path: Path, max_classes: int) -> tuple[set[str], set[str]]:
    """Scan a .jar or .aar for .class names (no bytecode parsing)."""

    classes: set[str] = set()
    packages: set[str] = set()

    try:
        suffix = artifact_path.suffix.lower()
        if suffix == ".jar":
            with zipfile.ZipFile(artifact_path, "r") as zf:
                return _scan_zip_for_classes(zf=zf, max_classes=max_classes)

        if suffix == ".aar":
            with zipfile.ZipFile(artifact_path, "r") as aar:
                # Primary classes
                if "classes.jar" in aar.namelist():
                    raw = aar.read("classes.jar")
                    with zipfile.ZipFile(io.BytesIO(raw), "r") as jar:
                        c, p = _scan_zip_for_classes(zf=jar, max_classes=max_classes)
                        classes.update(c)
                        packages.update(p)

                # Embedded jars under libs/
                for entry in aar.namelist():
                    if len(classes) >= max_classes:
                        break
                    if not entry.startswith("libs/") or not entry.endswith(".jar"):
                        continue
                    try:
                        raw = aar.read(entry)
                        with zipfile.ZipFile(io.BytesIO(raw), "r") as jar:
                            remaining = max_classes - len(classes)
                            c, p = _scan_zip_for_classes(zf=jar, max_classes=remaining)
                            classes.update(c)
                            packages.update(p)
                    except Exception:
                        continue
    except Exception:
        pass

    return classes, packages


def build_dependency_index(
    *,
    android_jar: Path | None,
    resolved_artifacts: Iterable[Path],
    r_jar: Path | None,
    max_artifacts: int = 25,
    max_total_classes: int = 150_000,
) -> dict:
    """Build a bounded class/package index for draft-time diagnostics."""

    all_classes: set[str] = set()
    all_packages: set[str] = set()
    scanned: list[str] = []

    artifacts: list[Path] = []
    if android_jar and android_jar.exists():
        artifacts.append(android_jar)
    if r_jar and r_jar.exists():
        artifacts.append(r_jar)

    for p in resolved_artifacts:
        if len(artifacts) >= max_artifacts:
            break
        try:
            if p.exists():
                artifacts.append(p)
        except Exception:
            continue

    for p in artifacts:
        if len(all_classes) >= max_total_classes:
            break

        remaining = max_total_classes - len(all_classes)
        c, pkgs = scan_artifact_classes(artifact_path=p, max_classes=remaining)
        all_classes.update(c)
        all_packages.update(pkgs)
        scanned.append(str(p))

    return {
        "version": 1,
        "builtAtMs": int(time.time() * 1000),
        "scannedArtifacts": scanned,
        "classes": sorted(all_classes),
        "packages": sorted(all_packages),
    }


def ensure_compiled_dependency_index(*, sidecar_path: Path, te2_sidecar: dict, effective_project_root: Path) -> dict:
    """Ensure te2_sidecar has a usable dependencyIndex (best-effort, cached by syncFingerprint)."""

    try:
        sync_fp = str((te2_sidecar or {}).get("syncFingerprint") or "")
        existing = (te2_sidecar or {}).get("dependencyIndex") or {}
        if isinstance(existing, dict) and existing.get("syncFingerprint") == sync_fp and existing.get("classes"):
            return te2_sidecar

        dep = (te2_sidecar or {}).get("dependencyModel") or {}
        android_jar_s = ((dep.get("androidSdk") or {}).get("androidJar") or "").strip()
        r_jar_s = (((dep.get("generated") or {}).get("rSymbols") or {}).get("rJar") or "").strip()

        resolved = ((dep.get("gradle") or {}).get("resolvedArtifacts") or [])
        if not isinstance(resolved, list):
            resolved = []

        # If we don't have resolved artifacts yet, try to fetch them via gradle (bounded).
        if not resolved:
            try:
                from app.apps.file_editor_cm6.android_lang.gradle_resolve import resolve_artifacts_via_gradle

                resolved = resolve_artifacts_via_gradle(
                    project_root=effective_project_root,
                    cache_dir=sidecar_path.parent,
                    timeout_s=60,
                )
                dep.setdefault("gradle", {})["resolvedArtifacts"] = resolved
                te2_sidecar["dependencyModel"] = dep
            except Exception:
                resolved = []

        android_jar = Path(android_jar_s).expanduser() if android_jar_s else None
        r_jar = Path(r_jar_s).expanduser() if r_jar_s else None
        resolved_paths = [Path(p).expanduser() for p in resolved if isinstance(p, str) and p.strip()]

        idx = build_dependency_index(android_jar=android_jar, resolved_artifacts=resolved_paths, r_jar=r_jar)
        idx["syncFingerprint"] = sync_fp
        te2_sidecar["dependencyIndex"] = idx

        from app.apps.file_editor_cm6.android_lang.android_sidecar import AndroidTe2Sidecar

        AndroidTe2Sidecar(sidecar_path).save(te2_sidecar)
        return te2_sidecar
    except Exception:
        return te2_sidecar
