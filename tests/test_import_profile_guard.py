import os
from pathlib import Path

import pytest

from scripts.profile_code_te2_import import check_event


def test_reads_allowed(tmp_path: Path) -> None:
    check_event(tmp_path, "open", ("/etc/hosts", "r", 0))


def test_scratch_write_allowed(tmp_path: Path) -> None:
    check_event(tmp_path, "open", (str(tmp_path / "prefs.json"), "w", os.O_CREAT))


def test_scratch_descriptor_allowed(tmp_path: Path) -> None:
    with (tmp_path / "bytecode").open("wb") as stream:
        check_event(tmp_path, "open", (stream.fileno(), "wb", 0))


def test_external_descriptor_rejected(tmp_path: Path) -> None:
    with (tmp_path / "outside").open("wb") as stream:
        with pytest.raises(RuntimeError, match="blocked descriptor"):
            check_event(tmp_path / "isolated", "open", (stream.fileno(), "wb", 0))


@pytest.mark.parametrize("event,args", [
    ("open", ("/etc/profile", "w", os.O_WRONLY)),
    ("socket.connect", ()), ("socket.bind", ()),
    ("subprocess.Popen", ()), ("os.fork", ()),
    ("os.rename", ("/etc/hosts", "/etc/hosts2")),
])
def test_guard_rejects(tmp_path: Path, event: str, args: tuple[object, ...]) -> None:
    with pytest.raises(RuntimeError, match="profile blocked"):
        check_event(tmp_path, event, args)
