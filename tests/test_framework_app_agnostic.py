"""Framework crates must not know built-in app identities, even in fixtures."""
from __future__ import annotations

import re
from pathlib import Path
from typing import cast

import msgspec

ROOT = Path(__file__).resolve().parents[1]


def identity_references(source: str, identities: set[str]) -> set[str]:
    found: set[str] = set()
    for identity in identities:
        escaped = re.escape(identity)
        # Qualified app identifiers are not generic protocol words. Include
        # uppercase environment keys, private imports, paths and fixture names.
        if "_" in identity or "-" in identity:
            if re.search(escaped, source, re.IGNORECASE):
                found.add(identity)
        else:
            # Single-word identities can also name legitimate framework
            # concepts (settings/terminal). Reject app addressing, not those
            # unrelated service/protocol keys.
            patterns = [
                rf"/(?:api/app|app|apps/by-id)/{escaped}(?:[/\"?#]|$)",
                rf"(?:get_app|running_app_for_id|running_app_exact|canonical_app_id)\s*\(\s*\"{escaped}\"",
                rf"(?:app_id|target_app|source_app|appId|targetApp)\"?\s*(?::|==|!=)\s*\"{escaped}\"",
            ]
            if any(re.search(pattern, source) for pattern in patterns):
                found.add(identity)
    return found


def test_framework_crates_have_no_builtin_app_identity_dependencies() -> None:
    identities: set[str] = set()
    for manifest in (ROOT / "app/apps").glob("*/manifest.json"):
        value = msgspec.json.decode(manifest.read_bytes(), type=dict[str, object])
        identity = value.get("id")
        if isinstance(identity, str):
            identities.add(identity)
        aliases = value.get("id_aliases", [])
        assert isinstance(aliases, list)
        identities.update(alias for alias in cast(list[object], aliases) if isinstance(alias, str))
        identities.add(manifest.parent.name)
    assert identities
    violations: list[str] = []
    # Actual JS/HTML/CSS/frontend assets are outside this source-code guard.
    # No Rust runtime module or test block is excluded.
    for path in (ROOT / "framework/rust/crates").rglob("*.rs"):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            hits = identity_references(line, identities)
            if hits:
                violations.append(f"{path.relative_to(ROOT)}:{number}: {sorted(hits)}")
    assert not violations, "Built-in app coupling in framework crates:\n" + "\n".join(violations)


def test_guard_distinguishes_generic_service_keys_from_app_addressing() -> None:
    identities = {"sample_editor", "terminal", "settings"}
    assert identity_references('app_id: "sample_editor"', identities) == {"sample_editor"}
    assert identity_references('"SAMPLE_EDITOR_BIN"', identities) == {"sample_editor"}
    assert identity_references('get_app("terminal")', identities) == {"terminal"}
    assert identity_references('targetApp":"terminal"', identities) == {"terminal"}
    assert identity_references('"/api/app/terminal/socket.io"', identities) == {"terminal"}
    assert not identity_references('payload.get("settings"); terminal.stream()', identities)
