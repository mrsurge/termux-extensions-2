from pathlib import Path
import subprocess

import pytest

from framework.bootstrap import bootstrap


@pytest.mark.parametrize("flag", ["--version", "--build-info"])
def test_identity_forwards_without_runtime_preparation(tmp_path, monkeypatch, flag):
    binary = tmp_path / "te2-server"
    binary.write_bytes(b"test binary")
    binary.chmod(0o755)
    calls = []
    monkeypatch.setattr(bootstrap, "_build_env", lambda *_: pytest.fail("runtime preparation"))
    monkeypatch.setattr(bootstrap, "_prepare_native_workers", lambda *a, **k: pytest.fail("worker build"))
    def run(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, '{"name":"te2-server","version":"0.2.353"}')
    monkeypatch.setattr(bootstrap.subprocess, "run", run)
    assert bootstrap.main([flag, "--server-bin", str(binary)]) == 0
    assert calls == [[str(binary), "--build-info"]]


def test_missing_identity_binary_never_builds(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda *a, **k: pytest.fail("unexpected subprocess"))
    with pytest.raises(SystemExit, match="Identity queries never build"):
        bootstrap.main(["--version", "--server-bin", str(tmp_path / "missing")])


def test_cached_identity_resolves_without_build(tmp_path, monkeypatch):
    binary = tmp_path / "cached-server"
    binary.write_bytes(b"binary")
    binary.chmod(0o755)
    monkeypatch.setattr(bootstrap, "packaged_server_path", lambda: None)
    monkeypatch.delenv("TE2_SERVER_BIN", raising=False)
    monkeypatch.delenv("TE2_SERVER_CARGO_MANIFEST", raising=False)
    monkeypatch.delenv("TE2_SERVER_NO_BUILD_CACHE", raising=False)
    def cached(args, env, manifest, *, build):
        assert build is False
        return bootstrap.ServerCommand([str(binary)])
    monkeypatch.setattr(bootstrap, "_cached_server_command", cached)
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(argv, 0, '{"name":"te2-server","version":"0.2.353"}'))
    assert bootstrap.main(["--version"]) == 0


def test_explicit_cargo_identity_uses_existing_target(tmp_path, monkeypatch):
    binary = tmp_path / "target/release/te2-server"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"binary")
    binary.chmod(0o755)
    monkeypatch.delenv("TE2_SERVER_BIN", raising=False)
    monkeypatch.delenv("CARGO_TARGET_DIR", raising=False)
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(argv, 0, '{"name":"te2-server","version":"0.2.353"}') if argv == [str(binary), "--build-info"] else pytest.fail("wrong target"))
    assert bootstrap.main(["--version", "--cargo-manifest", str(tmp_path / "Cargo.toml")]) == 0


@pytest.mark.parametrize("flag", ["--version", "--build-info"])
def test_packaged_identity_uses_selected_binary(tmp_path, monkeypatch, flag):
    binary = tmp_path / "packaged-server"
    binary.write_bytes(b"binary")
    binary.chmod(0o755)
    monkeypatch.setattr(bootstrap, "packaged_server_path", lambda: binary)
    monkeypatch.delenv("TE2_SERVER_BIN", raising=False)
    monkeypatch.delenv("TE2_SERVER_CARGO_MANIFEST", raising=False)
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(argv, 0, '{"name":"te2-server","version":"0.2.353"}') if argv == [str(binary), "--build-info"] else pytest.fail("wrong binary"))
    assert bootstrap.main([flag]) == 0


def test_linux_builder_installs_opt_dependencies_at_image_time():
    root = Path(__file__).resolve().parents[1] / "release/linux-wheel"
    dockerfile = (root / "Dockerfile").read_text()
    script = (root / "build-inside-container.sh").read_text()
    assert "-r /opt/te2-runtime-requirements.txt mypy==2.3.0" in dockerfile
    assert "mypy==2.3.0" not in script
    assert "--target /work/code-te2-dependencies" in script
