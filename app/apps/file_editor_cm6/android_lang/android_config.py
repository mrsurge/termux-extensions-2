from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Optional


TERMUX_AAPT2_PATH = "/data/data/com.termux/files/usr/bin/aapt2"

IMPORTANT_GRADLE_PROPERTIES_KEYS = [
    "android.aapt2FromMavenOverride",
    "org.gradle.jvmargs",
    "android.useAndroidX",
    "android.enableJetifier",
    "kotlin.code.style",
    "android.nonTransitiveRClass",
    "android.nonFinalResIds",
]


def _pick_gradle_file(folder: Path) -> Optional[Path]:
    for name in ("build.gradle.kts", "build.gradle"):
        p = folder / name
        if p.is_file():
            return p
    return None


def _pick_settings_file(root: Path) -> Optional[Path]:
    for name in ("settings.gradle.kts", "settings.gradle"):
        p = root / name
        if p.is_file():
            return p
    return None


def discover_android_files(*, effective_root: Path, module: str) -> Dict[str, dict]:
    root_gradle = _pick_gradle_file(effective_root)
    module_gradle = _pick_gradle_file(effective_root / module)
    settings_gradle = _pick_settings_file(effective_root)
    gradle_props = effective_root / "gradle.properties"
    local_props = effective_root / "local.properties"
    versions_toml = effective_root / "gradle" / "libs.versions.toml"

    def _info(p: Optional[Path]) -> dict:
        if not p:
            return {"path": None, "exists": False, "kind": None}
        return {
            "path": str(p),
            "exists": p.exists(),
            "kind": "kts" if p.suffix == ".kts" else "groovy",
        }

    return {
        "rootBuildGradle": _info(root_gradle),
        "moduleBuildGradle": _info(module_gradle),
        "settingsGradle": _info(settings_gradle),
        "gradleProperties": {
            "path": str(gradle_props),
            "exists": gradle_props.exists(),
        },
        "localProperties": {
            "path": str(local_props),
            "exists": local_props.exists(),
        },
        "versionsCatalog": {
            "path": str(versions_toml),
            "exists": versions_toml.exists(),
        },
    }


def parse_properties_file(path: Path) -> Dict[str, str]:
    if not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {}
    out: Dict[str, str] = {}
    for line in text.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or raw.startswith("!"):
            continue
        if "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def update_properties_file(path: Path, updates: Dict[str, Any], *, create_missing: bool = False) -> Dict[str, Any]:
    result = {"changed": False, "created": False, "updated_keys": [], "missing_file": False}
    if not path.exists():
        if not create_missing:
            result["missing_file"] = True
            return result
        lines = []
        for key, value in updates.items():
            if value is None:
                continue
            lines.append(f"{key}={value}")
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        result["changed"] = bool(lines)
        result["created"] = True
        result["updated_keys"] = [k for k in updates.keys() if updates.get(k) is not None]
        return result

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        result["missing_file"] = True
        return result

    lines = text.splitlines()
    seen = set()
    changed = False
    updated_keys = []

    key_re = re.compile(r"^(\s*[^#!\s][^=]*?)\s*=\s*(.*)$")
    for i, line in enumerate(lines):
        m = key_re.match(line)
        if not m:
            continue
        key = m.group(1).strip()
        if key not in updates:
            continue
        seen.add(key)
        value = updates.get(key)
        if value is None:
            continue
        new_line = f"{key}={value}"
        if new_line != line:
            lines[i] = new_line
            changed = True
            updated_keys.append(key)

    for key, value in updates.items():
        if key in seen or value is None:
            continue
        lines.append(f"{key}={value}")
        changed = True
        updated_keys.append(key)

    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result["changed"] = changed
    result["updated_keys"] = updated_keys
    return result


def parse_settings_modules(path: Optional[Path]) -> list[str]:
    if not path or not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []

    modules: list[str] = []
    for m in re.finditer(r"include\(([^)]*)\)", text):
        raw = m.group(1)
        for item in re.split(r"[,\n]", raw):
            val = item.strip().strip("'\"")
            if val.startswith(":"):
                val = val[1:]
            if val:
                modules.append(val)

    for m in re.finditer(r"include\s+([^\n]+)", text):
        raw = m.group(1)
        for item in re.split(r"[,\s]+", raw):
            val = item.strip().strip("'\"")
            if not val:
                continue
            if val.startswith(":"):
                val = val[1:]
            if val:
                modules.append(val)

    # Deduplicate while preserving order
    seen = set()
    out = []
    for m in modules:
        if m in seen:
            continue
        seen.add(m)
        out.append(m)
    return out


def list_source_sets(effective_root: Path, module: str = "app") -> list[str]:
    src_dir = effective_root / module / "src"
    if not src_dir.is_dir():
        return []
    names = []
    try:
        for entry in src_dir.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                names.append(entry.name)
    except Exception:
        return []
    return sorted(names, key=str.lower)


def _extract_value(patterns: list[re.Pattern[str]], text: str) -> Optional[int]:
    for pat in patterns:
        m = pat.search(text)
        if not m:
            continue
        try:
            return int(m.group(1))
        except Exception:
            continue
    return None


def _extract_bool(patterns: list[re.Pattern[str]], text: str) -> Optional[bool]:
    for pat in patterns:
        m = pat.search(text)
        if not m:
            continue
        val = m.group(1).strip().lower()
        if val in ("true", "false"):
            return val == "true"
    return None


def _find_block_span(text: str, start_pat: re.Pattern[str]) -> Optional[tuple[int, int]]:
    m = start_pat.search(text)
    if not m:
        return None
    i = m.start()
    brace = 0
    in_str: Optional[str] = None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == in_str and (i == 0 or text[i - 1] != "\\"):
                in_str = None
        else:
            if ch in ("\"", "'"):
                in_str = ch
            elif ch == "{":
                brace += 1
            elif ch == "}":
                brace -= 1
                if brace == 0:
                    return (m.start(), i + 1)
        i += 1
    return None


def parse_build_gradle(path: Optional[Path]) -> Dict[str, Any]:
    if not path or not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {}

    compile_sdk = _extract_value(
        [
            re.compile(r"compileSdk\s*=\s*(\d+)"),
            re.compile(r"compileSdkVersion\s+(\d+)"),
        ],
        text,
    )
    min_sdk = _extract_value(
        [
            re.compile(r"minSdk\s*=\s*(\d+)"),
            re.compile(r"minSdkVersion\s+(\d+)"),
        ],
        text,
    )
    target_sdk = _extract_value(
        [
            re.compile(r"targetSdk\s*=\s*(\d+)"),
            re.compile(r"targetSdkVersion\s+(\d+)"),
        ],
        text,
    )
    minify_enabled = _extract_bool(
        [
            re.compile(r"\bisMinifyEnabled\s*=\s*(true|false)"),
            re.compile(r"\bminifyEnabled\s+(true|false)"),
        ],
        text,
    )
    shrink_resources = _extract_bool(
        [
            re.compile(r"\bisShrinkResources\s*=\s*(true|false)"),
            re.compile(r"\bshrinkResources\s+(true|false)"),
        ],
        text,
    )

    abi: Dict[str, Any] = {}
    splits_span = _find_block_span(text, re.compile(r"\bsplits\s*\{"))
    if splits_span:
        splits_text = text[splits_span[0] : splits_span[1]]
        abi_span = _find_block_span(splits_text, re.compile(r"\babi\s*\{"))
        if abi_span:
            abi_text = splits_text[abi_span[0] : abi_span[1]]
            enable = _extract_bool([re.compile(r"\benable\s+(true|false)")], abi_text)
            if enable is not None:
                abi["enable"] = enable
            universal = _extract_bool([re.compile(r"\buniversalApk\s+(true|false)")], abi_text)
            if universal is not None:
                abi["universalApk"] = universal
            include: list[str] = []
            m = re.search(r"\binclude\s*\(([^)]*)\)", abi_text)
            if m:
                raw = m.group(1)
                for item in raw.split(","):
                    val = item.strip().strip("'\"")
                    if val:
                        include.append(val)
            else:
                m = re.search(r"\binclude\s+([^\n]+)", abi_text)
                if m:
                    raw = m.group(1)
                    for item in raw.split(","):
                        val = item.strip().strip("'\"")
                        if val:
                            include.append(val)
            if include:
                abi["include"] = include

    out: Dict[str, Any] = {}
    if compile_sdk is not None:
        out["compileSdk"] = compile_sdk
    if min_sdk is not None:
        out["minSdk"] = min_sdk
    if target_sdk is not None:
        out["targetSdk"] = target_sdk
    if minify_enabled is not None:
        out["minifyEnabled"] = minify_enabled
    if shrink_resources is not None:
        out["shrinkResources"] = shrink_resources
    if abi:
        out["abi"] = abi
    return out


def _apply_single_re(patterns: list[re.Pattern[str]], text: str, replacement: str) -> tuple[str, bool]:
    for pat in patterns:
        new_text, n = pat.subn(replacement, text, count=1)
        if n:
            return new_text, True
    return text, False


def update_build_gradle(path: Optional[Path], updates: Dict[str, Any]) -> Dict[str, Any]:
    result = {"changed": False, "missing": []}
    if not path or not path.is_file():
        result["missing"] = list(updates.keys())
        return result
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        result["missing"] = list(updates.keys())
        return result

    changed = False

    if "compileSdk" in updates:
        value = updates["compileSdk"]
        if value is not None:
            repls = [
                re.compile(r"(compileSdk\s*=\s*)\d+"),
                re.compile(r"(compileSdkVersion\s+)\d+"),
            ]
            new_text, did = _apply_single_re(repls, text, r"\g<1>" + str(value))
            text = new_text
            if did:
                changed = True
            else:
                result["missing"].append("compileSdk")

    if "minSdk" in updates:
        value = updates["minSdk"]
        if value is not None:
            repls = [
                re.compile(r"(minSdk\s*=\s*)\d+"),
                re.compile(r"(minSdkVersion\s+)\d+"),
            ]
            new_text, did = _apply_single_re(repls, text, r"\g<1>" + str(value))
            text = new_text
            if did:
                changed = True
            else:
                result["missing"].append("minSdk")

    if "targetSdk" in updates:
        value = updates["targetSdk"]
        if value is not None:
            repls = [
                re.compile(r"(targetSdk\s*=\s*)\d+"),
                re.compile(r"(targetSdkVersion\s+)\d+"),
            ]
            new_text, did = _apply_single_re(repls, text, r"\g<1>" + str(value))
            text = new_text
            if did:
                changed = True
            else:
                result["missing"].append("targetSdk")

    if "minifyEnabled" in updates:
        value = updates["minifyEnabled"]
        if value is not None:
            repls = [
                re.compile(r"(\bisMinifyEnabled\s*=\s*)(true|false)"),
                re.compile(r"(\bminifyEnabled\s+)(true|false)"),
            ]
            new_text, did = _apply_single_re(repls, text, r"\g<1>" + str(value).lower())
            text = new_text
            if did:
                changed = True
            else:
                result["missing"].append("minifyEnabled")

    if "shrinkResources" in updates:
        value = updates["shrinkResources"]
        if value is not None:
            repls = [
                re.compile(r"(\bisShrinkResources\s*=\s*)(true|false)"),
                re.compile(r"(\bshrinkResources\s+)(true|false)"),
            ]
            new_text, did = _apply_single_re(repls, text, r"\g<1>" + str(value).lower())
            text = new_text
            if did:
                changed = True
            else:
                result["missing"].append("shrinkResources")

    if "abi" in updates and isinstance(updates["abi"], dict):
        abi_updates = updates["abi"]
        splits_span = _find_block_span(text, re.compile(r"\bsplits\s*\{"))
        if not splits_span:
            result["missing"].append("abi")
        else:
            splits_text = text[splits_span[0] : splits_span[1]]
            abi_span = _find_block_span(splits_text, re.compile(r"\babi\s*\{"))
            if not abi_span:
                result["missing"].append("abi")
            else:
                abi_text = splits_text[abi_span[0] : abi_span[1]]
                abi_changed = False
                if "enable" in abi_updates:
                    repls = [re.compile(r"(\benable\s+)(true|false)")]
                    new_abi, did = _apply_single_re(repls, abi_text, r"\g<1>" + str(abi_updates["enable"]).lower())
                    abi_text = new_abi
                    abi_changed = abi_changed or did
                if "universalApk" in abi_updates:
                    repls = [re.compile(r"(\buniversalApk\s+)(true|false)")]
                    new_abi, did = _apply_single_re(repls, abi_text, r"\g<1>" + str(abi_updates["universalApk"]).lower())
                    abi_text = new_abi
                    abi_changed = abi_changed or did
                if "include" in abi_updates and isinstance(abi_updates["include"], list):
                    include_list = [str(x) for x in abi_updates["include"] if str(x).strip()]
                    if include_list:
                        if re.search(r"\binclude\s*\(", abi_text):
                            new_line = "include(" + ", ".join([f"\"{x}\"" for x in include_list]) + ")"
                            abi_text, did = _apply_single_re(
                                [re.compile(r"\binclude\s*\([^)]*\)")],
                                abi_text,
                                new_line,
                            )
                        else:
                            new_line = "include " + ", ".join([f"'{x}'" for x in include_list])
                            abi_text, did = _apply_single_re(
                                [re.compile(r"\binclude\s+[^\n]+")],
                                abi_text,
                                new_line,
                            )
                        abi_changed = abi_changed or did
                if abi_changed:
                    splits_text = splits_text[: abi_span[0]] + abi_text + splits_text[abi_span[1] :]
                    text = text[: splits_span[0]] + splits_text + text[splits_span[1] :]
                    changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
    result["changed"] = changed
    return result


def _line_indent(text: str, pos: int) -> str:
    line_start = text.rfind("\n", 0, pos) + 1
    line = text[line_start:pos]
    return re.match(r"\s*", line).group(0)


def _infer_indent_step(block_text: str, base_indent: str) -> str:
    for line in block_text.splitlines()[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        indent = re.match(r"\s*", line).group(0)
        if len(indent) > len(base_indent):
            return indent[len(base_indent):]
    return "  "


def _variant_exists(block_text: str, name: str, *, is_kts: bool) -> bool:
    if is_kts:
        return re.search(rf"create\\(\\s*[\"']{re.escape(name)}[\"']\\s*\\)", block_text) is not None
    return re.search(rf"\\b{re.escape(name)}\\s*\\{{", block_text) is not None


def _insert_variant_entry(
    text: str,
    *,
    android_span: tuple[int, int],
    block_name: str,
    name: str,
    flavor_dimension: Optional[str],
    is_kts: bool,
) -> tuple[str, bool, bool]:
    """Insert variant entry into buildTypes/productFlavors. Returns (text, changed, exists)."""
    android_text = text[android_span[0]:android_span[1]]
    block_span = _find_block_span(android_text, re.compile(rf"\\b{block_name}\\s*\\{{"))
    android_indent = _line_indent(text, android_span[0])
    step = _infer_indent_step(android_text, android_indent)
    block_indent = android_indent + step
    inner_indent = block_indent + step

    if is_kts:
        entry_lines = [f'{inner_indent}create(\"{name}\") {{']
        if flavor_dimension:
            entry_lines.append(f'{inner_indent}{step}dimension = \"{flavor_dimension}\"')
        entry_lines.append(f"{inner_indent}}}")
    else:
        entry_lines = [f"{inner_indent}{name} {{"]        
        if flavor_dimension:
            entry_lines.append(f'{inner_indent}{step}dimension \"{flavor_dimension}\"')
        entry_lines.append(f"{inner_indent}}}")
    entry_text = "\n".join(entry_lines) + "\n"

    if block_span:
        block_text = android_text[block_span[0]:block_span[1]]
        if _variant_exists(block_text, name, is_kts=is_kts):
            return text, False, True
        insert_pos = android_span[0] + block_span[1] - 1
        text = text[:insert_pos] + entry_text + text[insert_pos:]
        return text, True, False

    block_lines = [
        f"{block_indent}{block_name} {{",
        entry_text.rstrip("\n"),
        f"{block_indent}}}",
    ]
    block_text = "\n".join(block_lines) + "\n"
    insert_pos = android_span[1] - 1
    text = text[:insert_pos] + "\n" + block_text + text[insert_pos:]
    return text, True, False


def _ensure_flavor_dimension(
    text: str,
    *,
    android_span: tuple[int, int],
    flavor_dimension: str,
    is_kts: bool,
) -> tuple[str, bool]:
    android_text = text[android_span[0]:android_span[1]]
    if re.search(r"\\bflavorDimensions\\b", android_text):
        return text, False
    android_indent = _line_indent(text, android_span[0])
    step = _infer_indent_step(android_text, android_indent)
    line = (
        f'{android_indent}{step}flavorDimensions += \"{flavor_dimension}\"'
        if is_kts
        else f'{android_indent}{step}flavorDimensions \"{flavor_dimension}\"'
    )
    insert_pos = android_span[0] + android_text.find("{") + 1
    text = text[:insert_pos] + "\n" + line + text[insert_pos:]
    return text, True


def update_build_gradle_variants(
    path: Optional[Path],
    *,
    kind: str,
    name: str,
    flavor_dimension: Optional[str] = None,
) -> Dict[str, Any]:
    result = {"changed": False, "exists": False, "error": None}
    if not path or not path.is_file():
        result["error"] = "missing_file"
        return result
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        result["error"] = "read_failed"
        return result

    is_kts = path.suffix.lower() == ".kts"
    android_span = _find_block_span(text, re.compile(r"\\bandroid\\s*\\{"))
    if not android_span:
        result["error"] = "android_block_missing"
        return result

    block_name = "buildTypes" if kind == "buildType" else "productFlavors"
    text, changed, exists = _insert_variant_entry(
        text,
        android_span=android_span,
        block_name=block_name,
        name=name,
        flavor_dimension=flavor_dimension if kind == "flavor" else None,
        is_kts=is_kts,
    )
    result["exists"] = exists
    result["changed"] = changed

    if kind == "flavor" and flavor_dimension:
        android_span = _find_block_span(text, re.compile(r"\\bandroid\\s*\\{"))
        if android_span:
            text, dim_changed = _ensure_flavor_dimension(
                text,
                android_span=android_span,
                flavor_dimension=flavor_dimension,
                is_kts=is_kts,
            )
            result["changed"] = result["changed"] or dim_changed

    if result["changed"]:
        path.write_text(text, encoding="utf-8")

    return result


def collect_android_config(*, effective_root: Path, module: str) -> Dict[str, Any]:
    files = discover_android_files(effective_root=effective_root, module=module)
    gradle_props_path = Path(files["gradleProperties"]["path"])
    local_props_path = Path(files["localProperties"]["path"])
    module_gradle = files["moduleBuildGradle"]["path"]
    settings_gradle = files["settingsGradle"]["path"]

    gradle_props = parse_properties_file(gradle_props_path)
    local_props = parse_properties_file(local_props_path)
    build_cfg = parse_build_gradle(Path(module_gradle) if module_gradle else None)
    modules = parse_settings_modules(Path(settings_gradle) if settings_gradle else None)

    from .gradle_variants import detect_variants_from_gradle

    variants = detect_variants_from_gradle(
        effective_project_root=effective_root,
        module=module,
    )
    source_sets = list_source_sets(effective_root, module)

    return {
        "files": files,
        "gradleProperties": gradle_props,
        "localProperties": local_props,
        "buildConfig": build_cfg,
        "modules": modules,
        "variants": variants,
        "sourceSets": source_sets,
        "termuxAapt2Path": TERMUX_AAPT2_PATH,
        "importantGradleProperties": IMPORTANT_GRADLE_PROPERTIES_KEYS,
    }
