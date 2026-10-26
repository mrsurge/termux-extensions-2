from __future__ import annotations

from pathlib import Path

import pytest

from framework.bootstrap import bootstrap


@pytest.mark.parametrize(("runtime", "console", "flags", "expected"), [
    ("0", "0", [], (False, False)),
    ("0", "1", [], (False, True)),
    ("1", "0", [], (True, False)),
    ("0", "0", ["--debug-console"], (False, True)),
    ("1", "1", ["--no-runtime-debug", "--no-debug-console"], (False, False)),
])
def test_console_flag_is_independent_and_exports_explicit_policy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    runtime: str, console: str, flags: list[str], expected: tuple[bool, bool],
) -> None:
    monkeypatch.setenv("TE2_RUNTIME_DEBUG", runtime)
    monkeypatch.setenv("TE2_DEBUG_CONSOLE", console)
    for kind in ("CONFIG", "DATA", "CACHE", "RUNTIME"):
        monkeypatch.setenv(f"TE2_{kind}_HOME", str(tmp_path / kind.lower()))
    monkeypatch.setattr(bootstrap, "merge_login_shell_path", lambda env: dict(env))
    monkeypatch.setattr(bootstrap, "_ensure_framework_shells_env", lambda env, args: None)
    monkeypatch.setattr(bootstrap, "_reserve_local_port", lambda host: 12345)
    args = bootstrap._parse_args(flags)
    assert (args.runtime_debug, args.debug_console) == expected
    env = bootstrap._build_env(args)
    assert env["TE2_RUNTIME_DEBUG"] == str(int(expected[0]))
    assert env["TE2_DEBUG_CONSOLE"] == str(int(expected[1]))


def test_bootstrap_policy_precedes_app_import_and_has_no_extra_fetch() -> None:
    repo = Path(__file__).resolve().parents[1]
    source = (repo / "app/templates/app_shell.html").read_text()
    assert "window.__te2BuiltinConsoleEnabled = typeof bootstrap.debug_console === 'boolean'" in source
    assert source.index("window.__te2BuiltinConsoleEnabled") < source.index("const module = await import(scriptUrl)")


@pytest.mark.parametrize(("mode", "expected"), [("on", True), ("off", False), ("status", None)])
def test_logging_command_sends_one_bounded_request_without_proxy_or_redirect(
    mode: str, expected: bool | None, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    import io
    import json
    import urllib.request
    from app.cli import console_cli

    calls: list[urllib.request.Request] = []

    class Opener:
        def open(self, request: urllib.request.Request, *, timeout: int) -> io.BytesIO:
            calls.append(request)
            assert timeout == 10
            return io.BytesIO(b'{"enabled":true,"scope":"new_app_pages"}')

    def build_opener(*handlers: object) -> Opener:
        assert isinstance(handlers[0], urllib.request.ProxyHandler)
        assert handlers[0].proxies == {}
        assert isinstance(handlers[1], urllib.request.HTTPRedirectHandler)
        return Opener()

    monkeypatch.setattr(urllib.request, "build_opener", build_opener)
    assert console_cli.main(["logging", mode, "--url", "http://127.0.0.1:12345"]) == 0
    assert len(calls) == 1
    assert calls[0].full_url == "http://127.0.0.1:12345/api/console/logging"
    assert calls[0].get_header("X-te2-console-control") == "logging"
    assert calls[0].data is None if expected is None else json.loads(calls[0].data or b'{}') == {"enabled": expected}
    assert 'new_app_pages' in capsys.readouterr().out


@pytest.mark.parametrize("reply", [b'{}', b'{"enabled":"yes","scope":"new_app_pages"}', b' ' * 4097, None])
def test_logging_command_failure_has_no_fallback_or_replay(
    reply: bytes | None, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import io
    import urllib.request
    from app.cli import console_cli

    calls = 0

    class Opener:
        def open(self, request: urllib.request.Request, *, timeout: int) -> io.BytesIO:
            nonlocal calls
            calls += 1
            if reply is None:
                raise OSError("disconnected")
            return io.BytesIO(reply)

    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: Opener())
    assert console_cli.main(["logging", "on", "--url", "http://127.0.0.1:12345"]) == 1
    assert calls == 1
