from __future__ import annotations

import pytest

from app.cli import console_cli, run_rust_framework
from app.cli.console_usage import CONSOLE_USAGE
from framework.bootstrap import bootstrap


def test_bootstrap_help_lists_console_commands_without_runtime_preparation(monkeypatch, capsys):
    monkeypatch.setattr(bootstrap, "_build_env", lambda *_: pytest.fail("runtime preparation"))
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda *a, **k: pytest.fail("subprocess"))
    with pytest.raises(SystemExit) as result:
        bootstrap.main(["--help"])
    assert result.value.code == 0
    output = capsys.readouterr().out
    assert CONSOLE_USAGE in output
    assert "te2 framework <command>" in output


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_console_help_is_routed_without_bootstrap_or_live_requests(monkeypatch, capsys, flag):
    monkeypatch.setattr(run_rust_framework.sys, "argv", ["te2", "console", flag])
    monkeypatch.setattr(run_rust_framework, "_load_bootstrap_module", lambda: pytest.fail("bootstrap"))
    for name in ("_cmd_list_workers", "_cmd_eval", "_cmd_tail", "_cmd_search"):
        monkeypatch.setattr(console_cli, name, lambda *_: pytest.fail("console operation"))
    assert run_rust_framework.main() == 0
    assert capsys.readouterr().out == CONSOLE_USAGE


@pytest.mark.parametrize("command", ["list-workers", "eval", "tail", "search"])
def test_command_specific_help_remains_available(command, capsys):
    with pytest.raises(SystemExit) as result:
        console_cli.main([command, "--help"])
    assert result.value.code == 0
    assert f"te2 console {command}" in capsys.readouterr().out


def test_missing_console_command_remains_nonzero(capsys):
    assert console_cli.main([]) == 1
    assert capsys.readouterr().err == CONSOLE_USAGE
