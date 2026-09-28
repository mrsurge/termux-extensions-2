from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.apps.code_te2 import persistence_io as io
from app.apps.code_te2.preferences_store import PreferencesStore


@pytest.mark.parametrize("ascii_only,indent,newline", [
    (False, 2, False), (True, 2, True), (True, None, False),
])
def test_json_byte_format_matches_existing_stores(ascii_only, indent, newline):
    value = {"text": "λ 🐍", "nested": [None, True, -1, 1.25, {"unknown": "x"}]}
    expected = json.dumps(value, ensure_ascii=ascii_only, indent=indent)
    if newline:
        expected += "\n"
    payload = io.encode_json(value, ensure_ascii=ascii_only, indent=indent, trailing_newline=newline)
    assert payload == expected.encode("utf-8")
    assert io.decode_json(io.decode_utf8(payload)) == value


def test_utf8_matches_read_text(tmp_path: Path):
    path = tmp_path / "data.json"
    path.write_bytes(b'{\r\n"key":\r 1\n}')
    assert io.decode_utf8(io.read_bytes(path)) == path.read_text(encoding="utf-8")
    with pytest.raises(UnicodeDecodeError):
        io.decode_utf8(b"\xff")
    with pytest.raises(io.JsonDecodeError):
        io.decode_json(io.decode_utf8(b'\xef\xbb\xbf{}'))


@pytest.mark.parametrize("fixed", [True, False])
def test_atomic_replace_failure_preserves_destination_and_cleans_temporary(tmp_path: Path, fixed):
    path = tmp_path / "store.json"
    path.write_bytes(b"original")
    options = {"temporary_path": tmp_path / "store.tmp"} if fixed else {"temporary_prefix": ".store."}
    with patch.object(Path, "replace", side_effect=OSError("replace failed")):
        with pytest.raises(OSError, match="replace failed"):
            io.write_bytes_atomic(path, b"replacement", **options)
    assert path.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [path]


def test_io_does_not_create_parent_or_cache_reads(tmp_path: Path):
    path = tmp_path / "absent" / "store.json"
    with pytest.raises(FileNotFoundError):
        io.write_bytes_atomic(path, b"{}")
    path.parent.mkdir()
    io.write_bytes_atomic(path, b"first")
    assert io.read_bytes(path) == b"first"
    assert path.stat().st_mode & 0o777 == 0o600
    path.write_bytes(b"external")
    assert io.read_bytes(path) == b"external"


def test_preference_error_and_write_policies_stay_in_store(tmp_path: Path):
    # Exercise persistence without initialization/migration changing fixtures.
    store = PreferencesStore.__new__(PreferencesStore)
    store._path = tmp_path / "preferences.json"
    with pytest.raises(RuntimeError, match="doesn't exist"):
        store._read_from_disk()
    for content, error in [(b" ", "empty"), (b"[]", "not a dict"), (b"{", "invalid JSON")]:
        store.path.write_bytes(content)
        with pytest.raises(RuntimeError, match=error):
            store._read_from_disk()
    value = {"unknown": "λ", "editor": {"wordWrap": True}}
    store._write_to_disk(value)
    assert store.path.read_bytes() == json.dumps(value, ensure_ascii=False, indent=2).encode()
    assert store._read_from_disk() == value
    with patch.object(Path, "replace", side_effect=OSError("full")):
        with pytest.raises(RuntimeError, match="Failed to write preferences"):
            store._write_to_disk({})
    assert store._read_from_disk() == value
    assert not store.path.with_suffix(".tmp").exists()


def test_registry_format_fallback_and_migration_failure(tmp_path: Path, monkeypatch):
    from app.apps.code_te2 import extension_registry as registry

    path = tmp_path / "registry.json"
    monkeypatch.setattr(registry, "_REGISTRY_PATH", path)
    empty = registry.load_registry()
    for content in (b"{", b"[]", b'{}', b"\xff"):
        path.write_bytes(content)
        # Invalid UTF-8 historically propagates; syntax/schema errors fall back.
        if content == b"\xff":
            with pytest.raises(UnicodeDecodeError):
                registry.load_registry()
        else:
            assert registry.load_registry() == empty
    value = {"version": 2, "extensions": {}, "unknown": "λ"}
    registry._write_json_object_atomic(path, value)
    assert path.read_bytes() == (json.dumps(value, indent=2) + "\n").encode()
    monkeypatch.setattr(registry, "_migrate_registry_user_settings", lambda value: True)
    with patch.object(Path, "replace", side_effect=OSError("migration write failed")):
        with pytest.raises(OSError, match="migration write failed"):
            registry.load_registry()
    assert list(tmp_path.iterdir()) == [path]
