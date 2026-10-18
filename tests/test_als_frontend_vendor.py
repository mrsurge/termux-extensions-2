from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("vendor_als_frontend", ROOT / "scripts/vendor_als_frontend.py")
assert spec is not None and spec.loader is not None
vendor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vendor)


def test_committed_snapshot_checksums_and_version():
    manifest = vendor.check()
    assert manifest["version"] == "0.2.132"
    assert manifest["proxy_prefix"] == "/api/app/als-rs/proxy"
    assert manifest["source_tree_sha256"] != manifest["tree_sha256"]


def test_text_projection_matches_declared_proxy_roots_and_preserves_framework_api():
    raw = b'''import '/static/a.js'; fetch("/api/data"); fetch('/api/app/code_te2/x');
const socket='/ws/terminal'; const css=`/static/fonts/a`; url( /static/image.svg)'''
    result = vendor.proxy_text(raw, ".js")
    assert b"'/api/app/als-rs/proxy/static/a.js'" in result
    assert b'"/api/app/als-rs/proxy/api/data"' in result
    assert b"'/api/app/code_te2/x'" in result
    assert b"'/api/app/als-rs/proxy/ws/terminal'" in result
    assert b"url(/api/app/als-rs/proxy/static/image.svg)" in result
    assert vendor.proxy_text(b"\x00asm\xff", ".wasm") == b"\x00asm\xff"


@pytest.fixture
def source(tmp_path, monkeypatch):
    source = tmp_path / "als"
    static = source / vendor.STATIC_PATH
    for path in vendor.REQUIRED:
        target = static / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("import '/static/runtime.js';")
    (static / "unused.map").write_text("map")
    (source / "LICENSE").write_text("fixture license")
    (source / "pyproject.toml").write_text('[project]\nversion="0.2.132"\n')
    monkeypatch.setattr(vendor.subprocess, "check_output", lambda args, **kwargs:
        "abcdef" if "rev-parse" in args else "\0".join(f"{vendor.STATIC_PATH}/{name}" for name in vendor.REQUIRED))
    monkeypatch.setattr(vendor.subprocess, "run", lambda *args, **kwargs: type("Result", (), {"returncode": 0})())
    return source


def test_snapshot_is_complete_projected_and_reusable(source, tmp_path):
    output = tmp_path / "vendor"
    first = vendor.snapshot(source, output)
    assert len(first["files"]) == len(vendor.REQUIRED)
    assert not (output / "static/unused.map").exists()
    assert b"/api/app/als-rs/proxy/static/runtime.js" in (output / "static/dist/codex_agent.js").read_bytes()
    assert vendor.check(output) == first
    assert vendor.snapshot(source, output) == first


def test_tampered_or_unknown_vendor_content_is_not_overwritten(source, tmp_path):
    output = tmp_path / "vendor"
    vendor.snapshot(source, output)
    (output / "unrelated-user-file").write_text("keep")
    with pytest.raises(ValueError, match="Unknown content"):
        vendor.snapshot(source, output)
    assert (output / "unrelated-user-file").read_text() == "keep"


def test_missing_runtime_input_is_a_build_failure(source, tmp_path):
    (source / vendor.STATIC_PATH / vendor.REQUIRED[0]).unlink()
    with pytest.raises(ValueError, match="Required ALS resource"):
        vendor.snapshot(source, tmp_path / "vendor")
