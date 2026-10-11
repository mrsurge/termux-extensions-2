"""Exercise the real ASGI export without a shared framework/runtime."""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from unittest.mock import AsyncMock

import httpx
import pytest

from app.apps.file_explorer import file_explorer as backend
from app.apps.file_explorer.http_app import MAX_BODY_BYTES
from app.libs.app_worker_asgi import explicit_asgi_application


def request(method, path, **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend.TE2_ASGI_APP), base_url='http://test') as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(run())


def test_worker_selects_explicit_export_and_imports_no_fastapi():
    assert explicit_asgi_application(backend, 'file_explorer') is backend.TE2_ASGI_APP
    result = subprocess.run([sys.executable, '-B', '-c',
        'import sys; import app.libs.app_worker; import app.apps.file_explorer.file_explorer; '
        'assert not any(n.split(".")[0] in {"fastapi", "pydantic", "pydantic_core"} for n in sys.modules)'],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize('hidden,expected', [('true',True), ('0',False), ('yes',True), ('off',False)])
def test_listing_query_and_existing_dto(monkeypatch, tmp_path, hidden, expected):
    call = AsyncMock(return_value={'path': str(tmp_path), 'entries': []})
    monkeypatch.setattr(backend, '_pipe_list_directory', call)
    result = request('GET', '/list', params={'path': str(tmp_path), 'hidden': hidden})
    assert result.status_code == 200
    assert result.json() == {'ok': True, 'data': {'entries': [], 'path': str(tmp_path)}}
    assert call.call_args.args == (tmp_path, expected)


@pytest.mark.parametrize('path', ['/download', '/resolve_symlink', '/properties'])
def test_required_query(path):
    assert request('GET', path).status_code == 422


def test_invalid_hidden_never_lists(monkeypatch):
    call = AsyncMock()
    monkeypatch.setattr(backend, '_pipe_list_directory', call)
    assert request('GET', '/list?hidden=perhaps').status_code == 422
    call.assert_not_awaited()


@pytest.mark.parametrize('path,method,allowed', [(path,'POST','GET') for path in ['/list','/download','/properties','/resolve_symlink']] + [(path,'GET','POST') for path in ['/intent','/mkdir','/delete','/rename','/copy','/move','/chmod','/extract','/chown','/sidebar/window/state','/sidebar/window/open_url']])
def test_methods(path, method, allowed):
    result = request(method, path)
    assert result.status_code == 405
    assert result.headers['allow'] == allowed


def test_unknown_and_slash_normalization():
    assert request('GET', '/unknown').status_code == 404
    response = request('GET', '/list/?path=%2Ftmp')
    assert response.status_code == 307
    assert response.headers['location'] == '/list?path=%2Ftmp'


@pytest.mark.parametrize('content', [b'', b'{', b'[]', b'null', b'"text"', b'{"path":1}', b'{"name":[]}'])
def test_invalid_body_cannot_mutate(content, tmp_path):
    assert request('POST', '/mkdir', content=content).status_code == 422
    assert not list(tmp_path.iterdir())


def test_oversized_and_wrong_content_type_bodies():
    assert request('POST', '/mkdir', content=b'x'*(MAX_BODY_BYTES+1)).status_code == 413
    assert request('POST', '/mkdir', content=b'{}', headers={'content-type':'text/plain'}).status_code == 422


def test_file_operations_and_errors(tmp_path):
    assert request('POST', '/mkdir', json={'path':str(tmp_path), 'name':'sub'}).status_code == 200
    assert request('POST', '/mkdir', json={'path':str(tmp_path), 'name':'sub'}).status_code == 400
    file = tmp_path/'a.txt'; file.write_text('content')
    assert request('POST','/copy',json={'source':str(file),'dest':str(tmp_path/'b.txt')}).status_code == 200
    assert request('POST','/rename',json={'path':str(file),'name':'c.txt'}).status_code == 200
    assert request('POST','/move',json={'source':str(tmp_path/'c.txt'),'dest':str(tmp_path/'sub')}).status_code == 200
    assert request('POST','/chmod',json={'path':str(tmp_path/'b.txt'),'mode':'600'}).status_code == 200
    properties = request('GET','/properties',params={'path':str(tmp_path/'b.txt')})
    assert properties.status_code == 200
    assert properties.json()['data']['mode_octal'] == '600'
    assert request('POST','/delete',json={'path':str(tmp_path/'b.txt')}).status_code == 200
    assert request('POST','/delete',json={'path':str(tmp_path/'b.txt')}).status_code == 404


@pytest.mark.parametrize('owner', [{'user':'user','group':'group'}, {'user':'user'}, {'group':'group'}])
def test_chown_overloads_preserve_selected_owner(monkeypatch,tmp_path,owner):
    calls = []
    monkeypatch.setattr(backend.shutil, 'chown', lambda path, **kwargs: calls.append((path,kwargs)))
    result = request('POST','/chown',json={'path':str(tmp_path), **owner})
    assert result.status_code == 200
    assert calls == [(str(tmp_path),owner)]


def test_archive_and_symlink_contracts(tmp_path):
    file = tmp_path/'source.txt'; file.write_text('text')
    link = tmp_path/'link.txt'; link.symlink_to(file)
    result = request('GET','/resolve_symlink',params={'path':str(link)})
    assert result.status_code == 200
    assert result.json()['data']['target'] == str(file)
    assert result.json()['data']['target_type'] == 'file'
    assert request('POST','/extract',json={'source':str(file),'directory':str(tmp_path)}).status_code == 400


def test_bulk_job_handlers_keep_progress_and_result(tmp_path,monkeypatch):
    from app.libs.jobs import Job, JobContext, JobManager
    manager = JobManager(state_file=tmp_path/'jobs.json')
    monkeypatch.setattr(manager,'save_state_async',lambda: None)
    monkeypatch.setattr(manager,'notify_job_update',lambda job: None)
    source = tmp_path/'source'; source.mkdir()
    (source/'file.txt').write_text('content')
    dest = tmp_path/'dest'; dest.mkdir()
    job = Job('bulk_copy', {'sources':[str(source)],'destination':str(dest)})
    backend.job_bulk_copy(JobContext(job,manager),job.params)
    assert (dest/'source'/'file.txt').read_text() == 'content'
    assert job.result['total_bytes'] == 7
    moved = tmp_path/'moved'; moved.mkdir()
    job = Job('bulk_move', {'sources':[str(dest/'source')],'destination':str(moved)})
    backend.job_bulk_move(JobContext(job,manager),job.params)
    assert (moved/'source'/'file.txt').read_text() == 'content'
    assert not (dest/'source').exists()


def test_download_streaming_ranges_and_missing_file(tmp_path):
    file = tmp_path/'data file.txt'; file.write_bytes(b'abcdefghij' * 20000)
    response = request('GET','/download',params={'path':str(file)})
    assert response.status_code == 200
    assert response.content == file.read_bytes()
    assert 'attachment;' in response.headers['content-disposition']
    assert response.headers['content-length'] == '200000'
    partial = request('GET','/download',params={'path':str(file)},headers={'range':'bytes=3-7'})
    assert partial.status_code == 206
    assert partial.content == b'defgh'
    assert request('GET','/download',params={'path':str(tmp_path/'missing')}).status_code == 404


@pytest.mark.parametrize('path', ['/sidebar/window/state','/sidebar/window/open_url'])
def test_sidebar_routes_keep_backend_pipe_owner(monkeypatch,tmp_path,path):
    call = AsyncMock(return_value={'ok':True})
    monkeypatch.setattr(backend,'_call_sidebar_rpc',call)
    assert request('POST',path,json={'host_id':'host','path':str(tmp_path)}).status_code == 200
    assert call.call_args.args[0] == 'sidebar.window.state.update'
    assert request('POST',path,json={}).status_code == 400


def test_intent_route_preserves_pipe(monkeypatch):
    call = AsyncMock(return_value={'ok':True})
    monkeypatch.setattr(backend.pipe_runtime,'call_async',call)
    response = request('POST','/intent',json={'intent':'document.open','context':{'clientId':'c','hostId':'h','presentationId':'p'},'payload':{'path':'/file'}})
    assert response.status_code == 200
    assert call.call_args.args[0] == 'app.intent.dispatch'


def test_partial_body_disconnect_and_stream_limit_never_mutate():
    calls = []
    async def command(body):
        calls.append(body)
        return {'ok':True}
    from app.apps.file_explorer.http_app import FileExplorerHTTP
    app = FileExplorerHTTP(query_handler=AsyncMock(), commands={'/mkdir':command})
    async def run(events):
        sent = []
        async def receive(): return events.pop(0)
        async def send(message): sent.append(message)
        await app({'type':'http','path':'/mkdir','method':'POST','headers':[],'query_string':b'','asgi':{'spec_version':'2.4'}},receive,send)
        return sent
    assert asyncio.run(run([{'type':'http.request','body':b'{','more_body':True},{'type':'http.disconnect'}])) == []
    sent = asyncio.run(run([{'type':'http.request','body':b'x'*(MAX_BODY_BYTES+1),'more_body':True}]))
    assert sent[0]['status'] == 413
    assert calls == []
