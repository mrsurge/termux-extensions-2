import subprocess

import pytest

from framework.bootstrap import compiler_cache_preflight as preflight


def test_missing_ccache(monkeypatch):
    monkeypatch.setattr(preflight.shutil, 'which', lambda _: None)
    assert preflight.ccache_health()[0] is False


@pytest.mark.parametrize('kind', ['working', 'linker', 'timeout', 'oserror'])
def test_ccache_startup_health(monkeypatch, kind):
    monkeypatch.setattr(preflight.shutil, 'which', lambda _: '/path/ccache')
    def run(argv, **kwargs):
        assert argv == ['/path/ccache', '--version'] and kwargs['timeout'] == 10
        if kind == 'timeout':
            raise subprocess.TimeoutExpired(argv, 10)
        if kind == 'oserror':
            raise OSError('cannot execute')
        return subprocess.CompletedProcess(argv, 0 if kind == 'working' else 1,
            stdout='ccache version' if kind == 'working' else '', stderr='cannot locate symbol' if kind == 'linker' else '')
    monkeypatch.setattr(preflight.subprocess, 'run', run)
    healthy, diagnostic = preflight.ccache_health()
    assert healthy == (kind == 'working')
    assert bool(diagnostic) == (kind != 'working')
