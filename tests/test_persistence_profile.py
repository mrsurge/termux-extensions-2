from pathlib import Path

import pytest

from scripts import profile_persistence_boundary as probe


def test_copy_is_private_and_preserves_source(tmp_path: Path) -> None:
    source = tmp_path / "source.json"
    source.write_bytes(b'{"unknown": [1, "hello"]}')
    target = tmp_path / "isolated/config.json"
    probe.copy_bounded(source, target)
    assert source.read_bytes() == target.read_bytes()
    assert target.stat().st_mode & 0o777 == 0o600
    target.write_bytes(b"{}")
    assert source.read_bytes() != target.read_bytes()


def test_oversized_input_does_not_create_target(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(probe, "MAX_BYTES", 8)
    source = tmp_path / "source.json"
    source.write_bytes(b"123456789")
    target = tmp_path / "copy.json"
    with pytest.raises(ValueError, match="size bound"):
        probe.copy_bounded(source, target)
    assert not target.exists()
