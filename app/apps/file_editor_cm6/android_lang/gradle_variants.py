from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable


_NAME_CALL_RE = re.compile(r"\b(?:create|maybeCreate|getByName)\(\s*[\"']([^\"']+)[\"']\s*\)")
_FLAVOR_BLOCK_RE = re.compile(r"\bproductFlavors\s*\{")
_BUILD_TYPES_BLOCK_RE = re.compile(r"\bbuildTypes\s*\{")

# Kotlin DSL commonly uses: buildTypes { release { ... } }
_BLOCK_NAME_RE = re.compile(r"^\s*([A-Za-z0-9_\-]+)\s*\{\s*$")


def _find_gradle_file(*, effective_project_root: Path, module: str) -> Path | None:
    for name in ("build.gradle.kts", "build.gradle"):
        p = effective_project_root / module / name
        if p.exists() and p.is_file():
            return p
    return None


def _extract_block_lines(text: str, start_pat: re.Pattern[str]) -> list[str]:
    """Return the lines of the first {...} block that starts with start_pat."""

    m = start_pat.search(text)
    if not m:
        return []

    i = m.start()
    brace = 0
    in_str: str | None = None
    out: list[str] = []

    # Very small "brace matching" scanner; not a full Kotlin parser.
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
                    # include final brace line
                    j = text.find("\n", i)
                    if j == -1:
                        out.append(text[m.start() :].splitlines()[-1])
                    break
        i += 1

    # Slice the entire block text (from start of keyword to matching close)
    block_text = text[m.start() : i + 1]
    return block_text.splitlines()


def detect_variants_from_gradle(*, effective_project_root: Path, module: str = "app") -> dict:
    """Best-effort variant detection from build.gradle(.kts).

    Returns: {"module": str, "flavors": [..], "buildTypes": [..], "variants": [..]}
    """

    gradle_file = _find_gradle_file(effective_project_root=effective_project_root, module=module)
    if not gradle_file:
        return {"module": module, "flavors": [], "buildTypes": ["Debug", "Release"], "variants": ["Debug", "Release"]}

    try:
        text = gradle_file.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {"module": module, "flavors": [], "buildTypes": ["Debug", "Release"], "variants": ["Debug", "Release"]}

    flavors: list[str] = []
    for line in _extract_block_lines(text, _FLAVOR_BLOCK_RE):
        for m in _NAME_CALL_RE.finditer(line):
            name = m.group(1).strip()
            if name and name not in flavors:
                flavors.append(name)
        m2 = _BLOCK_NAME_RE.match(line)
        if m2:
            name = m2.group(1).strip()
            if name in ("productFlavors", "create", "maybeCreate", "getByName"):
                continue
            if name and name not in flavors:
                flavors.append(name)

    build_types: list[str] = []
    for line in _extract_block_lines(text, _BUILD_TYPES_BLOCK_RE):
        for m in _NAME_CALL_RE.finditer(line):
            name = m.group(1).strip()
            if name and name not in build_types:
                build_types.append(name)
        m2 = _BLOCK_NAME_RE.match(line)
        if m2:
            name = m2.group(1).strip()
            if name in ("buildTypes", "getByName", "create", "maybeCreate"):
                continue
            if name and name not in build_types:
                build_types.append(name)

    # Debug exists implicitly even if not declared.
    if "debug" not in {x.lower() for x in build_types}:
        build_types.insert(0, "debug")
    if "release" not in {x.lower() for x in build_types}:
        build_types.append("release")

    def _cap(s: str) -> str:
        s = (s or "").strip()
        return s[:1].upper() + s[1:] if s else ""

    bt_caps = [_cap(bt.lower()) for bt in build_types]

    variants: list[str] = []
    if flavors:
        for fl in flavors:
            for bt in bt_caps:
                variants.append(f"{_cap(fl)}{bt}")
    else:
        variants = bt_caps

    return {
        "module": module,
        "flavors": flavors,
        "buildTypes": bt_caps,
        "variants": variants,
        "gradleFile": str(gradle_file),
    }
