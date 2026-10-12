from pathlib import Path
import os
import sys
import sysconfig

import pytest

from scripts.restore_code_te2_snapshot import matching_sources, restore
from scripts.mypyc_build_workflow import source_digest


def fixture_domain(root: Path):
    file = root / 'module.py'
    file.write_text('value = 1\n')
    runtime = {'python': {'soabi': sysconfig.get_config_var('SOABI')},
               'machine': os.uname().machine, 'platform': sys.platform,
               'domainFingerprint': source_digest(root, {'module': str(file)})}
    domain = {'modules': {'module': 'module.py'}}
    return runtime, domain


def test_reuse_requires_identical_startup_sources(tmp_path):
    runtime, domain = fixture_domain(tmp_path)
    assert matching_sources(tmp_path, runtime, domain) == {'module': str(tmp_path / 'module.py')}
    (tmp_path / 'module.py').write_text('value = 2\n')
    with pytest.raises(RuntimeError, match='sources changed'):
        matching_sources(tmp_path, runtime, domain)


def test_reuse_rejects_wrong_abi(tmp_path):
    runtime, domain = fixture_domain(tmp_path)
    runtime['python']['soabi'] = 'wrong'
    with pytest.raises(RuntimeError, match='ABI'):
        matching_sources(tmp_path, runtime, domain)


def test_reuse_rejects_source_escape(tmp_path):
    runtime, domain = fixture_domain(tmp_path)
    domain['modules']['module'] = '../module.py'
    with pytest.raises((RuntimeError, ValueError)):
        matching_sources(tmp_path, runtime, domain)


def test_reuse_checks_wheel_digest_before_reading_zip(tmp_path):
    wheel = tmp_path / 'bad.whl'
    wheel.write_bytes(b'not a wheel')
    with pytest.raises(RuntimeError, match='checksum'):
        restore(wheel, '0' * 64, tmp_path / 'snapshot')


def test_container_mounts_verified_reuse_input_readonly(tmp_path):
    from scripts.build_linux_release_wheel import _container_run_command
    command = _container_run_command(
        engine='podman', image='builder', source=tmp_path, work=tmp_path,
        output=tmp_path, cargo_home=tmp_path, cargo_target=tmp_path,
        commit='a'*40, release_tag='0.2.353', source_date_epoch='1',
        reuse_wheel=tmp_path/'old.whl', reuse_sha256='b'*64,
    )
    assert command[-1] == 'builder'
    assert str(tmp_path/'old.whl') + ':/input-domain.whl:ro' in command
    assert 'TE2_REUSE_DOMAIN_WHEEL_SHA256=' + 'b'*64 in command
