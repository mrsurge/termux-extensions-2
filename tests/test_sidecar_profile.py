from __future__ import annotations

import json
from pathlib import Path
from typing import cast
from unittest.mock import patch
from _pytest.capture import CaptureFixture

from app.apps.code_te2 import sidecar_profile
from app.apps.code_te2.project_sidecar import ProjectSidecar


def test_sidecar_profile_reports_bounded_content_free_windows(tmp_path: Path, capsys: CaptureFixture[str]) -> None:
    sidecar_path = tmp_path / "secret-project.json"
    with (
        patch.object(sidecar_profile, "ENABLED", True),
        patch.object(sidecar_profile, "_samples", cast(object, {})),
        patch.object(sidecar_profile, "_emitted", cast(object, set())),
        patch.object(ProjectSidecar, "get_sidecar_path", return_value=sidecar_path),
    ):
        sidecar = ProjectSidecar("/secret/project")
        sidecar.save()
        sidecar.reload()
        sidecar_profile.emit_window("worker_start")
        sidecar_profile.emit_window("worker_start")
        sidecar.save()
        sidecar_profile.emit_window("first_full_boot_snapshot")

    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 2
    assert all(line.startswith("[sidecar_profile] ") for line in lines)
    assert "secret" not in "\n".join(lines)
    first = cast(dict[str, object], json.loads(lines[0].removeprefix("[sidecar_profile] ")))
    second = cast(dict[str, object], json.loads(lines[1].removeprefix("[sidecar_profile] ")))
    first_operations = cast(dict[str, dict[str, object]], first["operations"])
    second_operations = cast(dict[str, dict[str, object]], second["operations"])
    assert first["phase"] == "worker_start"
    assert first_operations["save.inclusive"]["count"] == 1
    assert first_operations["load.read_text"]["count"] == 1
    assert first_operations["save.fsync"]["count"] == 1
    assert second["phase"] == "first_full_boot_snapshot"
    assert second_operations["save.inclusive"]["count"] == 1
    assert "load.read_text" not in second_operations


def test_sidecar_profile_is_inert_without_runtime_debug(capsys: CaptureFixture[str]) -> None:
    with (
        patch.object(sidecar_profile, "ENABLED", False),
        patch.object(sidecar_profile, "_samples", cast(object, {})),
        patch.object(sidecar_profile, "_emitted", cast(object, set())),
    ):
        sidecar_profile.record("save.fsync", 1_000_000)
        sidecar_profile.emit_window("worker_start")
    assert capsys.readouterr().err == ""
