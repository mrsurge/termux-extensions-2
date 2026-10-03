from pathlib import Path
import subprocess
import sys

import pytest

from app.apps.code_te2.build_mypyc import build_commands
from app.apps.code_te2 import build_mypyc


@pytest.fixture(autouse=True)
def cached_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv('NO_CACHE', raising=False)
    monkeypatch.setattr(build_mypyc.shutil, 'which', lambda name: '/usr/bin/ccache')


def test_publishes_to_resolved_root_and_reuses_existing_cache() -> None:
    repo = Path('/checkout')
    snapshot, commands = build_commands(repo=repo, python='/venv/bin/python',
        cache_home=Path('/custom/cache'), compiler_cache=repo / '.codex-scratch/mypyc-build-cache',
        name='unique', activate=True)
    assert snapshot == Path('/custom/cache/code_te2/build/mypyc-snapshots/unique')
    assert commands[0][-1] == str(snapshot)
    assert commands[0][commands[0].index('--cache-dir') + 1] == '/checkout/.codex-scratch/mypyc-build-cache'
    assert commands[1][-1] == '/checkout/.codex-scratch/mypyc-active'
    assert commands[1][commands[1].index('--snapshot') + 1] == str(snapshot)


def test_no_activate_has_no_activation_command() -> None:
    _, commands = build_commands(repo=Path('/checkout'), python='/python', cache_home=Path('/cache'),
        compiler_cache=Path('/compiler'), name='unique', activate=False)
    assert len(commands) == 1


def test_failed_build_never_activates(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fail(command: list[str], **kwargs: object) -> None:
        calls.append(command)
        assert kwargs['cwd'] == build_mypyc.REPO
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(sys, 'argv', ['build_mypyc.py'])
    monkeypatch.setattr(build_mypyc.subprocess, 'run', fail)
    with pytest.raises(subprocess.CalledProcessError):
        build_mypyc.main()
    assert len(calls) == 1
    assert 'build' in calls[0]


def test_print_commands_never_runs_build(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError('dry run must not execute commands')

    monkeypatch.setattr(sys, 'argv', ['build_mypyc.py', '--print-commands'])
    monkeypatch.setattr(build_mypyc.subprocess, 'run', forbidden)
    build_mypyc.main()


def test_missing_ccache_fails_before_build(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(build_mypyc.shutil, 'which', lambda name: None)
    monkeypatch.setattr(sys, 'argv', ['build_mypyc.py'])
    monkeypatch.setattr(build_mypyc.subprocess, 'run', lambda *args, **kwargs: pytest.fail('build must not start'))
    with pytest.raises(SystemExit) as error:
        build_mypyc.main()
    assert error.value.code == 1
    message = capsys.readouterr().err
    assert '--no-cache' in message and 'NO_CACHE=1' in message


@pytest.mark.parametrize('mode', ['flag', 'env', 'cached'])
def test_cache_opt_out_reaches_compiler(monkeypatch: pytest.MonkeyPatch, mode: str) -> None:
    if mode != 'cached':
        monkeypatch.setattr(build_mypyc.shutil, 'which', lambda name: None)
    if mode == 'env':
        monkeypatch.setenv('NO_CACHE', '1')
    monkeypatch.setattr(sys, 'argv', ['build_mypyc.py', '--no-activate'] + (['--no-cache'] if mode == 'flag' else []))
    calls: list[object] = []
    def run(command: list[str], **kwargs: object) -> None:
        env = kwargs['env']
        assert isinstance(env, dict)
        assert env['NO_CACHE'] == ('0' if mode == 'cached' else '1')
        calls.append(command)
    monkeypatch.setattr(build_mypyc.subprocess, 'run', run)
    build_mypyc.main()
    assert len(calls) == 1
