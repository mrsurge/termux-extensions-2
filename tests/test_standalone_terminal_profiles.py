from pathlib import Path

import pytest

from app.apps.terminal import profiles


def test_standalone_profile_resolution_and_revision(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(profiles, "_path", lambda: tmp_path / "profiles.json")
    assert profiles.launch_profile(None) is None
    p = {"id": "test", "name": "Local", "executable": "/bin/sh", "cwd": "", "args": ["-i", "two words"]}
    profiles.save_profiles({"revision": 0, "default": "test", "profiles": [p]})
    assert profiles.launch_profile(None) == profiles.launch_profile("test")
    current = profiles.launch_profile(None)
    assert current and current.args == ["-i", "two words"]
    assert profiles.launch_profile("system") is None
    with pytest.raises(ValueError, match="changed elsewhere"):
        profiles.save_profiles({"revision": 0})
    with pytest.raises(ValueError, match="enabled"):
        profiles.save_profiles({"revision": 1, "default": "test", "profiles": [{**p, "enabled": False}]})
    with pytest.raises(ValueError):
        profiles.save_profiles({"revision": 1, "profiles": [{**p, "id": "system"}]})
    profiles.save_profiles({"revision": 1, "profiles": [{**p, "enabled": False}]})
    assert profiles.launch_profile(None) is None
    with pytest.raises(ValueError, match="disabled"):
        profiles.launch_profile("test")
