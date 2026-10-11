"""Compile the shared projection and Code TE2 adapter without runtime activation."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    output = args.output.resolve()
    if output.exists():
        parser.error('choose a fresh output; existing artifacts are preserved')
    sources = ['app/libs/terminal_runtime/log_reader.py',
               'app/libs/terminal_runtime/screen_projection.py',
               'app/libs/terminal_runtime/pyte_parser.py',
               'app/apps/code_te2/terminal_log_io.py',
               'app/apps/code_te2/terminal_screen_projection.py']
    checks = ['--strict', '--disallow-any-explicit', '--follow-imports=silent']
    subprocess.run([sys.executable, '-B', '-m', 'mypy', *checks, *sources], cwd=repo, check=True)
    from mypyc.build import mypycify
    from setuptools import setup
    output.mkdir(parents=True)
    os.chdir(repo)
    os.environ.setdefault('MAX_JOBS', '2')
    extensions = mypycify([*checks, *sources], opt_level='2', multi_file=True,
                         target_dir=str(output / 'csrc'))
    setup(name='te2-shared-terminal-probe', ext_modules=extensions,
          script_args=['build_ext', '--build-lib', str(output / 'lib'),
                       '--build-temp', str(output / 'temp')])
    probe = '''
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
import app.libs.terminal_runtime as shared
import app.apps.code_te2 as editor
shared.__path__ = [str(root / 'app/libs/terminal_runtime'), *shared.__path__]
editor.__path__ = [str(root / 'app/apps/code_te2'), *editor.__path__]
from app.libs.terminal_runtime import screen_projection, pyte_parser
from app.apps.code_te2 import terminal_screen_projection, terminal_log_io
for module in (screen_projection, pyte_parser, terminal_screen_projection, terminal_log_io):
    assert module.__file__.endswith('.so'), module.__file__
import pytest
raise SystemExit(pytest.main(['-q', 'tests/test_shared_terminal_projection.py',
    'app/apps/code_te2/tests/test_terminal_screen_projection.py']))
'''
    subprocess.run([sys.executable, '-B', '-c', probe, str(output / 'lib')], cwd=repo,
                   env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'), check=True)
    print(f'Compiled projection proof: {output / "lib"}; no activation or restart')


if __name__ == '__main__':
    main()
