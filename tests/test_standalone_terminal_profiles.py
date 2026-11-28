from pathlib import Path
import shlex

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


def test_command_editor_roundtrip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(profiles, "_path", lambda: tmp_path / "profiles.json")
    command = """bash --rcfile '.venv with spaces/bin/activate' -i ''"""
    item = dict(id="p", name="Project", command=command, cwd="", enabled=True, env={"LABEL": "$HOME literal"})
    saved = profiles.save_command_profiles(dict(revision=0, default="p", profiles=[item]))
    assert saved.profiles[0].args == ["--rcfile", ".venv with spaces/bin/activate", "-i", ""]
    view = profiles.command_profiles(profiles.read_profiles()).profiles[0]
    assert shlex.split(view.command) == shlex.split(command)
    assert view.env == item["env"]
    for changes in ({"command": "bash '"}, {"env": {"bad=name": "value"}}):
        with pytest.raises(ValueError):
            profiles.save_command_profiles(dict(revision=1, default="p", profiles=[{**item, **changes}]))
    assert profiles.read_profiles() == saved
