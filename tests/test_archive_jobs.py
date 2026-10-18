"""Real app-owned archive jobs, with isolated state and no shared runtime."""
from __future__ import annotations

import time
from pathlib import Path
import zipfile
import threading

import pytest
from starlette.testclient import TestClient

from app.apps.archive_manager import backend
from app.apps.file_explorer import file_explorer
from app.libs.app_jobs import AppJobs
from app.libs.jobs import Job, JobCancelled, JobContext, JobManager
from app.libs.archive_operations import job_create_archive


@pytest.fixture
def clients(tmp_path, monkeypatch):
    from app.utils import paths
    monkeypatch.setattr(paths, 'HOME_DIR', tmp_path)
    monkeypatch.setenv('HOME', str(tmp_path))
    jobs = AppJobs('archive_manager', frozenset({'extract_archive', 'create_archive', 'test_archive'}))
    manager = JobManager(tmp_path / 'archive-jobs.json')
    monkeypatch.setattr(manager, 'save_state_async', lambda: None)
    jobs._manager = manager
    monkeypatch.setattr(backend, 'JOBS', jobs)
    explorer = AppJobs('file_explorer', frozenset({'extract_archive', 'bulk_copy', 'bulk_move'}))
    explorer._manager = JobManager(tmp_path / 'explorer-jobs.json')
    monkeypatch.setattr(explorer.manager, 'save_state_async', lambda: None)
    monkeypatch.setattr(file_explorer.HTTP_APP, 'jobs', explorer)
    return TestClient(backend.TE2_ASGI_APP), TestClient(file_explorer.TE2_ASGI_APP), jobs


def finish(client, job):
    deadline = time.monotonic() + 5
    while job['status'] in ('pending', 'running') and time.monotonic() < deadline:
        time.sleep(.01)
        job = client.get('/jobs/' + job['id']).json()['data']
    assert job['status'] == 'succeeded', job
    return job


def test_create_update_test_and_explorer_extract(clients, tmp_path):
    archive_client, explorer_client, jobs = clients
    source = tmp_path / 'hello.txt'
    source.write_text('hello')
    target = tmp_path / 'bundle.zip'
    response = archive_client.post('/archives/create', json={'archive_path': str(target), 'sources': [str(source)]})
    assert response.status_code == 200, response.text
    created = finish(archive_client, response.json()['data'])
    assert created['progress']['completed'] == 1
    source.write_text('updated')
    extra = tmp_path / 'extra.txt'
    extra.write_text('extra')
    finish(archive_client, archive_client.post('/archives/create', json={'archive_path': str(target), 'sources': [str(source), str(extra)], 'options': {'update': True}}).json()['data'])
    with zipfile.ZipFile(target) as archive:
        assert archive.read('hello.txt') == b'updated'
        assert archive.read('extra.txt') == b'extra'
    finish(archive_client, archive_client.post('/archives/test', json={'archive_path': str(target)}).json()['data'])
    assert explorer_client.get('/jobs').json()['data'] == []
    assert explorer_client.get('/jobs/' + created['id']).status_code == 404
    out = tmp_path / 'output'
    params = {'archive_path': str(target), 'destination': str(out), 'items': ['hello.txt'], 'options': {'overwrite': 'rename'}}
    extracted = finish(explorer_client, explorer_client.post('/jobs', json={'type': 'extract_archive', 'params': params}).json()['data'])
    assert (out / 'hello.txt').read_text() == 'updated'
    assert not (out / 'extra.txt').exists()
    finish(explorer_client, explorer_client.post('/jobs', json={'type': 'extract_archive', 'params': params}).json()['data'])
    assert (out / 'hello (1).txt').read_text() == 'updated'
    assert explorer_client.delete('/jobs/' + extracted['id']).status_code == 200
    assert explorer_client.get('/jobs/' + extracted['id']).status_code == 404
    assert archive_client.post('/jobs', json={'type': 'bulk_move', 'params': {}}).status_code == 422
    jobs.manager._save_state()
    restored = JobManager(jobs.manager._state_file)
    assert created['id'] in restored.list_jobs()


def test_admission_guards(clients, tmp_path):
    client, _, _ = clients
    source = tmp_path / 'source.txt'
    source.write_text('source')
    target = tmp_path / 'existing.zip'
    target.write_bytes(b'original')
    for payload, status in [
        ({'archive_path': str(target), 'sources': [str(source)]}, 409),
        ({'archive_path': str(tmp_path / 'bad.7z'), 'sources': [str(source)]}, 422),
        ({'archive_path': str(target), 'sources': []}, 422),
        ({'archive_path': str(target), 'sources': [str(source)], 'options': {'password': 'no'}}, 422),
    ]:
        assert client.post('/archives/create', json=payload).status_code == status
    assert target.read_bytes() == b'original'
    assert client.post('/jobs', json={'type': 'extract_archive', 'params': {'archive_path': str(target), 'items': ['../escape']}}).status_code == 422
    assert client.get('/jobs').json()['data'] == []
    assert client.get('/jobs/unknown').status_code == 404


@pytest.mark.parametrize('name', ['../escape.txt', '/absolute.txt', '..\\escape.txt'])
def test_unsafe_members_fail_without_escape(clients, tmp_path, name):
    client, _, _ = clients
    archive = tmp_path / 'unsafe.zip'
    with zipfile.ZipFile(archive, 'w') as writer:
        writer.writestr(name, 'bad')
    job = client.post('/jobs', json={'type': 'extract_archive', 'params': {'archive_path': str(archive), 'destination': str(tmp_path / 'out')}}).json()['data']
    deadline = time.monotonic() + 5
    while job['status'] in ('pending', 'running') and time.monotonic() < deadline:
        time.sleep(.01)
        job = client.get('/jobs/' + job['id']).json()['data']
    assert job['status'] == 'failed'
    assert not (tmp_path / 'escape.txt').exists()
    assert not list((tmp_path / 'out').rglob('*.txt'))


def test_cancelled_zip_write_preserves_original(tmp_path, monkeypatch):
    from app.utils import paths
    monkeypatch.setattr(paths, 'HOME_DIR', tmp_path)
    source = tmp_path / 'source.txt'
    source.write_text('new')
    target = tmp_path / 'archive.zip'
    with zipfile.ZipFile(target, 'w') as writer:
        writer.writestr('old.txt', 'old')
    original = target.read_bytes()
    manager = JobManager(tmp_path / 'jobs.json')
    monkeypatch.setattr(manager, 'save_state_async', lambda: None)
    job = Job('create_archive', {'archive_path': str(target), 'sources': [str(source)], 'options': {'overwrite': True}})
    def cancel(**kwargs):
        job.request_cancel()
    monkeypatch.setattr(job, 'update_progress', cancel)
    with pytest.raises(JobCancelled):
        job_create_archive(JobContext(job, manager), job.params)
    assert target.read_bytes() == original
    assert not list(tmp_path.glob('.te2-archive-*'))


def test_cancel_route_and_running_delete_guard(clients, tmp_path, monkeypatch):
    from app.libs import jobs as library
    client, _, _ = clients
    entered, release = threading.Event(), threading.Event()
    def blocked(ctx, params):
        entered.set()
        release.wait(2)
        ctx.check_cancelled()
    monkeypatch.setitem(library._JOB_HANDLERS, 'test_archive', blocked)
    archive = tmp_path / 'a.zip'
    with zipfile.ZipFile(archive, 'w') as writer:
        writer.writestr('a', 'a')
    job = client.post('/archives/test', json={'archive_path': str(archive)}).json()['data']
    assert entered.wait(2)
    try:
        assert client.delete('/jobs/' + job['id']).status_code == 409
        assert client.post('/jobs/' + job['id'] + '/cancel').status_code == 200
    finally:
        release.set()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get('/jobs/' + job['id']).json()['data']
        if job['status'] == 'cancelled':
            break
        time.sleep(.01)
    assert job['status'] == 'cancelled'


def test_output_symlink_escape_is_rejected(clients, tmp_path):
    client, _, _ = clients
    out = tmp_path / 'out'
    out.mkdir()
    elsewhere = tmp_path / 'outside'
    elsewhere.mkdir()
    (out / 'nested').symlink_to(elsewhere, target_is_directory=True)
    archive = tmp_path / 'a.zip'
    with zipfile.ZipFile(archive, 'w') as writer:
        writer.writestr('nested/file.txt', 'bad')
    job = client.post('/archives/extract', json={'archive_path': str(archive), 'destination': str(out)}).json()['data']
    deadline = time.monotonic() + 5
    while job['status'] in ('pending', 'running') and time.monotonic() < deadline:
        time.sleep(.01)
        job = client.get('/jobs/' + job['id']).json()['data']
    assert job['status'] == 'failed'
    assert not list(elsewhere.iterdir())
