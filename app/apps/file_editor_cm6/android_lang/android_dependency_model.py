from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Dict, Optional


def _read_local_properties_sdk_dir(project_root: Path) -> Optional[str]:
    p = project_root / "local.properties"
    if not p.is_file():
        return None
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    for line in text.splitlines():
        if line.strip().startswith("sdk.dir="):
            raw = line.split("=", 1)[1].strip()
            return raw.replace("\\:", ":")
    return None


def _best_effort_compile_sdk(*, module_dir: Path) -> Optional[int]:
    # Keep this intentionally cheap: scan build.gradle(.kts) for common patterns.
    candidates = [module_dir / "build.gradle", module_dir / "build.gradle.kts"]
    for p in candidates:
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        # Groovy: compileSdkVersion 34
        m = re.search(r"compileSdkVersion\s+(\d+)", text)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                pass

        # Kotlin DSL: compileSdk = 34
        m = re.search(r"compileSdk\s*=\s*(\d+)", text)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                pass

    return None


def _resolve_android_sdk_root(project_root: Path) -> Optional[Path]:
    env_root = (os.getenv("ANDROID_SDK_ROOT") or os.getenv("ANDROID_HOME") or "").strip()
    if env_root:
        p = Path(env_root).expanduser()
        if p.exists():
            return p

    lp = _read_local_properties_sdk_dir(project_root)
    if lp:
        p = Path(lp).expanduser()
        if p.exists():
            return p

    # Common default on Android Studio installs (best-effort).
    p = Path.home() / "Android" / "Sdk"
    if p.exists():
        return p

    return None


def _pick_android_jar(*, sdk_root: Path, compile_sdk: Optional[int]) -> Optional[str]:
    platforms = sdk_root / "platforms"
    if not platforms.is_dir():
        return None

    if compile_sdk is not None:
        jar = platforms / f"android-{int(compile_sdk)}" / "android.jar"
        if jar.is_file():
            return str(jar)

    # Fallback: pick highest android-XX that has android.jar.
    best = None
    best_num = -1
    try:
        for child in platforms.iterdir():
            if not child.is_dir():
                continue
            m = re.match(r"android-(\d+)$", child.name)
            if not m:
                continue
            n = int(m.group(1))
            jar = child / "android.jar"
            if jar.is_file() and n > best_num:
                best_num = n
                best = jar
    except Exception:
        return None

    return str(best) if best else None


def build_dependency_model_v1(*, effective_project_root: Path, module: str, variant: str) -> Dict:
    root = effective_project_root.expanduser().resolve(strict=False)
    module_dir = root / module

    compile_sdk = _best_effort_compile_sdk(module_dir=module_dir)

    sdk_root = _resolve_android_sdk_root(root)
    android_jar = _pick_android_jar(sdk_root=sdk_root, compile_sdk=compile_sdk) if sdk_root else None

    java_home = (os.getenv("JAVA_HOME") or "").strip() or None
    jmods = None
    if java_home:
        try:
            cand = (Path(java_home).expanduser() / "jmods")
            if cand.is_dir():
                jmods = str(cand)
        except Exception:
            jmods = None

    gradle_user_home = (os.getenv("GRADLE_USER_HOME") or "").strip()
    if not gradle_user_home:
        gradle_user_home = str(Path.home() / ".gradle")

    generated: Dict[str, object] = {}

    # Generated roots (best-effort, cheap checks)
    try:
        gen_root = module_dir / "build" / "generated"
        if gen_root.is_dir():
            # Common build config path
            bc = gen_root / "source" / "buildConfig"
            if bc.is_dir():
                generated["buildConfigRoots"] = [str(bc)]

            # Common view binding output roots vary; record the whole generated dir as a safe hint.
            generated["viewBindingRoots"] = [str(gen_root)]
    except Exception:
        pass

    # R symbols (bounded search under module/build)
    r_symbols: Dict[str, str] = {}
    try:
        build_dir = module_dir / "build"
        if build_dir.is_dir():
            rjar = None
            rtxt = None
            max_files = 5000
            seen = 0
            for dirpath, _dirs, files in os.walk(build_dir):
                for name in files:
                    seen += 1
                    if seen > max_files:
                        break
                    if name == "R.jar" and rjar is None:
                        rjar = str(Path(dirpath) / name)
                    elif name == "R.txt" and rtxt is None:
                        rtxt = str(Path(dirpath) / name)
                    if rjar and rtxt:
                        break
                if seen > max_files or (rjar and rtxt):
                    break
            if rjar:
                r_symbols["rJar"] = rjar
            if rtxt:
                r_symbols["rTxt"] = rtxt
    except Exception:
        pass

    if r_symbols:
        generated["rSymbols"] = r_symbols

    built_at_ms = int(time.time() * 1000)

    out: Dict[str, object] = {
        "builtAtMs": built_at_ms,
        "variant": variant,
        "module": module,
        "androidSdk": {
            "androidJar": android_jar,
            "compileSdk": compile_sdk,
        },
        "jvm": {
            "javaHome": java_home,
            "jrtOrJmods": jmods,
        },
        "gradle": {
            "gradleUserHome": gradle_user_home,
            "resolvedArtifacts": [],
        },
        "generated": generated,
    }

    # Remove nulls for compactness.
    # Keep keys present but values None for schema stability? For now drop only top-level nulls in subdicts.
    try:
        if out.get("androidSdk"):
            out["androidSdk"] = {k: v for k, v in out["androidSdk"].items() if v is not None}
        if out.get("jvm"):
            out["jvm"] = {k: v for k, v in out["jvm"].items() if v is not None}
        if out.get("generated") == {}:
            out.pop("generated", None)
    except Exception:
        pass

    return out
