from __future__ import annotations

import io
import json
import os
from pathlib import Path

import pytest

from scripts.mypyc_build_workflow import compiler_cache, generated_cache_inputs, report_cache_inputs


@pytest.mark.parametrize('mode', ['enabled', 'disabled', 'unavailable'])
def test_compiler_locale_is_stable_and_restored(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mode: str) -> None:
    monkeypatch.setenv('NO_CACHE', '1' if mode == 'disabled' else '0')
    monkeypatch.setenv('LANG', 'en_US.UTF-8')
    monkeypatch.setenv('LC_ALL', 'C.UTF-8')
    monkeypatch.delenv('LC_CTYPE', raising=False)
    monkeypatch.delenv('LC_MESSAGES', raising=False)
    monkeypatch.setattr('scripts.mypyc_build_workflow.ccache_health', lambda: (mode == 'enabled', 'test fallback'))
    def find_ccache(_name: str) -> str:
        return '/usr/bin/ccache'
    monkeypatch.setattr('scripts.mypyc_build_workflow.shutil.which', find_ccache)
    with pytest.raises(RuntimeError, match='test failure'):
        with compiler_cache(tmp_path, {'cc': ['/usr/bin/cc']}):
            for key in ('LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES'):
                assert os.environ[key] == 'C'
            raise RuntimeError('test failure')
    assert os.environ['LANG'] == 'en_US.UTF-8'
    assert os.environ['LC_ALL'] == 'C.UTF-8'
    assert 'LC_CTYPE' not in os.environ
    assert 'LC_MESSAGES' not in os.environ


def test_cache_inputs_report_content_not_timestamps(tmp_path: Path) -> None:
    source = tmp_path / 'csrc'
    source.mkdir()
    c = source / 'module.c'
    h = source / 'shared.h'
    c.write_text('int value = 1;')
    h.write_text('extern int value;')
    identity: dict[str, object] = {'cc': ['cc']}
    before = generated_cache_inputs(tmp_path, identity)
    previous = tmp_path / 'compile-inputs.json'
    previous.write_text(json.dumps(before))
    os.utime(c, None)
    output = io.StringIO()
    report_cache_inputs(previous, generated_cache_inputs(tmp_path, identity), output)
    assert '0 C sources, 0 headers' in output.getvalue()
    c.write_text('int value = 2;')
    h.write_text('extern long value;')
    output = io.StringIO()
    report_cache_inputs(previous, generated_cache_inputs(tmp_path, identity), output)
    assert '1 C sources, 1 headers' in output.getvalue()
    assert 'shared.h' in output.getvalue()


def test_missing_or_invalid_input_record_does_not_break_build(tmp_path: Path) -> None:
    previous = tmp_path / 'compile-inputs.json'
    output = io.StringIO()
    report_cache_inputs(previous, {}, output)
    assert 'No previous' in output.getvalue()
    previous.write_text('[]')
    report_cache_inputs(previous, {}, output)
    assert 'invalid' in output.getvalue()


def test_cache_inputs_detect_environment_and_removed_header(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / 'csrc'
    source.mkdir()
    header = source / 'old.h'
    header.write_text('extern int value;')
    monkeypatch.setenv('C_INCLUDE_PATH', '/first/include')
    previous = tmp_path / 'compile-inputs.json'
    previous.write_text(json.dumps(generated_cache_inputs(tmp_path, {'cc': ['cc']})))
    monkeypatch.setenv('C_INCLUDE_PATH', '/second/include')
    header.unlink()
    output = io.StringIO()
    report_cache_inputs(previous, generated_cache_inputs(tmp_path, {'cc': ['cc']}), output)
    assert '0 C sources, 1 headers' in output.getvalue()
    assert 'compiler environment changed=True' in output.getvalue()
    assert 'old.h' in output.getvalue()
