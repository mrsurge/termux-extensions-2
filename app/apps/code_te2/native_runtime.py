"""Code TE2-owned Python/domain policy for native worker preparation."""
from __future__ import annotations

import sys
from collections.abc import MutableMapping
from importlib import metadata
from pathlib import Path

from app.cli.native_runtime import NativeRuntimeContext, NativeRuntimeResult
from app.release_runtime import ReleaseRuntimeError
from app.release_runtime import code_te2 as release_runtime


def select_editable_domain(project_root: Path, env: MutableMapping[str, str]) -> None:
    if env.get('CODE_TE2_FORCE_INTERPRETED') == '1':
        env['CODE_TE2_MYPYC_DIR'] = ''
        print('[te2] Code TE2 domain: interpreted (CODE_TE2_FORCE_INTERPRETED=1). '
              'The selected snapshot is unchanged.', flush=True)
        return
    if 'CODE_TE2_MYPYC_DIR' in env:
        return
    selected = project_root / '.codex-scratch' / 'mypyc-active'
    try:
        selected.stat()
    except FileNotFoundError:
        env['CODE_TE2_MYPYC_DIR'] = ''
        print('[te2] Code TE2 domain: interpreted (no editable mypyc snapshot). '
              'To compile/activate: python -B app/apps/code_te2/build_mypyc.py', flush=True)
    else:
        env['CODE_TE2_MYPYC_DIR'] = str(selected)


def prepare_runtime(context: NativeRuntimeContext) -> NativeRuntimeResult:
    env: dict[str, str] = {
        'CODE_TE2_HOST_PYTHON_EXECUTABLE': sys.executable,
        'CODE_TE2_HOST_PACKAGE_ROOT': str(context.project_root),
    }
    if context.packaged:
        if context.environment.get('CODE_TE2_FORCE_INTERPRETED') == '1':
            raise SystemExit('CODE_TE2_FORCE_INTERPRETED=1 is only supported for editable installs; '
                             'packaged Code TE2 requires its matched compiled domain.')
        try:
            runtime = release_runtime.packaged_runtime(metadata.version('te2'))
        except ReleaseRuntimeError as exc:
            raise SystemExit(f'Binary release native-worker payload is unusable: {exc}; refusing a Cargo fallback.') from exc
        env.update({
            'CODE_TE2_MYPYC_DIR': str(runtime.domain),
            'CODE_TE2_PYTHON_CACHE_PREFIX': str(runtime.executable.parent.parent / '.disabled-bytecode-cache'),
            'CODE_TE2_PYTHON_HOME': str(runtime.python_home) if runtime.python_home else sys.base_prefix,
            'CODE_TE2_PYTHON_EXECUTABLE': str(runtime.python_executable) if runtime.python_executable else sys.executable,
        })
        if runtime.source_root is not None:
            env.update(CODE_TE2_PYTHON_ISOLATED='1', CODE_TE2_PYTHON_SOURCE=str(runtime.source_root))
            return NativeRuntimeResult(env, executable=runtime.executable)
        return NativeRuntimeResult(env, ('CODE_TE2_PYTHON_ISOLATED', 'CODE_TE2_PYTHON_SOURCE'), runtime.executable)
    selection = dict(context.environment)
    select_editable_domain(context.project_root, selection)
    env.update(CODE_TE2_MYPYC_DIR=selection['CODE_TE2_MYPYC_DIR'],
               CODE_TE2_PYTHON_HOME=sys.base_prefix, CODE_TE2_PYTHON_EXECUTABLE=sys.executable)
    return NativeRuntimeResult(env, ('CODE_TE2_PYTHON_CACHE_PREFIX', 'CODE_TE2_PYTHON_ISOLATED', 'CODE_TE2_PYTHON_SOURCE'))
