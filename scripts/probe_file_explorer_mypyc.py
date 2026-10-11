"""Build a standalone File Explorer compilation proof; never activate a worker.

Usage: python -B scripts/probe_file_explorer_mypyc.py --output <scratch-directory>
The output is experimental, not a wheel/runtime release payload.
"""
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
        parser.error('choose a new output directory; existing artifacts are preserved')
    sources = ['app/apps/file_explorer/http_app.py', 'app/apps/file_explorer/file_explorer.py',
               'app/apps/file_explorer/tab_store.py', 'app/apps/file_explorer/tab_service.py',
               'app/apps/file_explorer/terminal_log_io.py', 'app/apps/file_explorer/terminal_service.py']
    subprocess.run([sys.executable, '-B', '-m', 'mypy', '--strict', '--disallow-any-explicit',
                    '--follow-imports=silent', *sources], cwd=repo, check=True)
    from mypyc.build import mypycify
    from setuptools import setup
    output.mkdir(parents=True)
    os.chdir(repo)
    os.environ.setdefault('MAX_JOBS', '2')
    extensions = mypycify(['--strict', '--disallow-any-explicit', '--follow-imports=silent', *sources],
                         opt_level='2', multi_file=True, target_dir=str(output / 'csrc'))
    setup(name='te2-file-explorer-mypyc-probe', ext_modules=extensions,
          script_args=['build_ext', '--build-lib', str(output / 'lib'), '--build-temp', str(output / 'temp')])
    # Test real compiled call paths. Monkeypatching another compiled function
    # cannot intercept mypyc early-bound calls, so those interpreted fixtures
    # are intentionally outside this focused compiled smoke selection.
    probe = '''
from pathlib import Path
import sys
import app.apps.file_explorer as package
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
package.__path__ = [str(root / 'app/apps/file_explorer'), *package.__path__]
import app.apps.file_explorer.file_explorer as backend
import app.apps.file_explorer.http_app as http
assert str(backend.__file__).endswith('.so'), backend.__file__
assert str(http.__file__).endswith('.so'), http.__file__
import app.apps.file_explorer.tab_store as store
import app.apps.file_explorer.tab_service as service
assert str(store.__file__).endswith('.so'), store.__file__
assert str(service.__file__).endswith('.so'), service.__file__
import app.apps.file_explorer.terminal_service as terminal
import app.apps.file_explorer.terminal_log_io as log_io
assert str(terminal.__file__).endswith('.so'), terminal.__file__
assert str(log_io.__file__).endswith('.so'), log_io.__file__
import pytest
raise SystemExit(pytest.main(['-q', 'tests/test_file_explorer_asgi.py', 'tests/test_file_explorer_tabs.py', 'tests/test_file_explorer_terminal.py', '-k',
    'methods or required_query or unknown_and_slash or invalid_body or oversized '
    'or file_operations or download_streaming or partial_body or bulk_job '
    'or archive_and_symlink or chown_overloads or tab_persistence or failed_disk '
    'or corrupt_store or invalid_options or rooms_revisions or concurrent_creation '
    'or real_socketio or domain_validation or tab_sidebar '
    'or tab_terminal_lifecycle or exit_reconcile or foreign_and_uncontrolled '
    'or invalid_resize or disconnect_and_foreign_tab or terminal_import '
    'or cancelled_launch or existing_label']))
'''
    subprocess.run([sys.executable, '-B', '-c', probe, str(output / 'lib')], cwd=repo,
                   env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'), check=True)
    print(f'Built and smoke-validated standalone File Explorer proof: {output / "lib"}')
    print('No installed binary, worker selection or running process was changed.')


if __name__ == '__main__':
    main()
