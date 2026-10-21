"""Typed ingress validation without building, importing native code or starting apps."""
from __future__ import annotations

import json
from importlib.machinery import EXTENSION_SUFFIXES
from pathlib import Path
import sys

import pytest
from starlette.exceptions import HTTPException
from starlette.requests import Request

from app.apps.code_te2.http_contracts import path_parameter
from app.apps.code_te2.mypyc_overlay import _CompiledFinder, _manifest_object, install


def test_resource_path_parameter_requires_the_declared_string_converter() -> None:
    scope: dict[str, object] = {"type": "http", "path_params": {"file": "themes/a.json"}}
    assert path_parameter(Request(scope), "file") == "themes/a.json"
    for value in (None, 3, ["themes/a.json"]):
        bad_scope: dict[str, object] = {"type": "http", "path_params": {"file": value}}
        with pytest.raises(HTTPException) as failure:
            path_parameter(Request(bad_scope), "file")
        assert failure.value.status_code == 400
    with pytest.raises(HTTPException):
        path_parameter(Request(scope), "missing")


def test_manifest_object_validates_keys_without_coercion() -> None:
    manifest: dict[str, object] = {"schemaVersion": 2, "modules": {"app.demo": "demo.py"}}
    assert _manifest_object(manifest, "manifest") == manifest
    invalid_objects: tuple[object, ...] = (None, list[object](), {1: "not a string key"})
    for invalid in invalid_objects:
        with pytest.raises(ValueError):
            _manifest_object(invalid, "manifest")


def test_legacy_overlay_rejects_malformed_input_before_changing_import_state(tmp_path: Path) -> None:
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    output.mkdir()
    cases: tuple[tuple[object, type[Exception]], ...] = (
        ([], ValueError),
        ({"compiled_sources": "not a list", "modules": {}}, ValueError),
        ({"compiled_sources": [5], "modules": {}}, ValueError),
        ({"compiled_sources": [], "modules": {"app.demo": 5}}, ValueError),
        ({"compiled_sources": ["app/demo.py"], "modules": {"app.demo": str(source / "app/demo.py")}}, RuntimeError),
    )
    original_path = list(sys.path)
    original_finders = list(sys.meta_path)
    for payload, failure in cases:
        (output / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
        with pytest.raises(failure):
            install(str(source), str(output))
        assert sys.path == original_path
        assert sys.meta_path == original_finders


def test_valid_legacy_overlay_selects_only_manifest_modules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source"
    output = tmp_path / "output"
    binary = output / "lib/app" / f"demo{EXTENSION_SUFFIXES[0]}"
    binary.parent.mkdir(parents=True)
    # The finder validates a file and constructs its loader without importing it.
    # No native code is built or loaded by this test.
    binary.touch()
    manifest: dict[str, object] = {
        "compiled_sources": ["app/demo.py"],
        "modules": {"app.demo": str(source / "app/demo.py"), "app.other": str(source / "app/other.py")},
    }
    (output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setattr(sys, "meta_path", list(sys.meta_path))
    assert install(str(source), str(output)) == 1
    finder = sys.meta_path[0]
    assert isinstance(finder, _CompiledFinder)
    assert finder.names == {"app.demo"}
    assert finder.find_spec("app.other") is None
    assert finder.find_spec("app.demo") is not None
    assert sys.path[-1] == str(output / "lib")
