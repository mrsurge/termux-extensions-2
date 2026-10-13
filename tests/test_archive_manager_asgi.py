"""Archive Manager transport/domain regressions; no shared job/runtime writes."""
from __future__ import annotations

import asyncio
import builtins
import importlib
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import AsyncMock
import zipfile

import pytest
from starlette.testclient import TestClient

from app.apps.archive_manager import backend
from app.apps.archive_manager.http_app import MAX_BODY_BYTES
from app.libs.app_worker_asgi import explicit_asgi_application


def request(method, path, **kwargs):
    return TestClient(backend.TE2_ASGI_APP).request(method, path, **kwargs)


@pytest.fixture
def home(tmp_path, monkeypatch):
    from app.utils import paths
    monkeypatch.setattr(paths, "HOME_DIR", tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def archive(home):
    path = home / "example.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("visible.txt", "text")
        archive.writestr("nested/code.py", "print(1)")
        archive.writestr(".hidden", "hidden")
    return path


def test_explicit_worker_export_and_lifespan(monkeypatch):
    assert explicit_asgi_application(backend, "archive_manager") is backend.TE2_ASGI_APP
    assert not hasattr(backend, "archive_manager_bp")
    serving = AsyncMock()
    monkeypatch.setattr(backend, "te2_app_backend_serving", serving)
    with TestClient(backend.TE2_ASGI_APP) as client:
        assert client.get("/ping").json() == {"ok": True, "data": {"message": "archive-manager ready"}}
    serving.assert_not_awaited()


def test_filesystem_defaults_order_hidden_and_archive_detection(home):
    (home / "folder").mkdir()
    (home / "b.txt").write_text("text")
    (home / ".hidden").write_text("hidden")
    (home / "z.zip").touch()
    response = request("GET", "/browse")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "filesystem"
    assert data["path"] == str(home)
    assert [entry["name"] for entry in data["entries"]] == ["folder", "b.txt", "z.zip"]
    assert data["entries"][0]["size"] is None
    assert data["entries"][1]["size"] == 4
    assert data["entries"][2]["is_archive"] is True
    assert any(entry["name"] == ".hidden" for entry in request("GET", "/browse?hidden=true").json()["data"]["entries"])


def test_real_archive_browse_and_internal_navigation(archive):
    response = request("GET", "/browse", params={"path": str(archive)})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "archive"
    assert [entry["name"] for entry in data["entries"]] == ["nested", "visible.txt"]
    assert data["entries"][0]["type"] == "directory"
    nested = request("GET", "/browse", params={"path": str(archive), "internal": "/nested/"}).json()["data"]
    assert nested["internal"] == "nested"
    assert nested["entries"][0]["name"] == "code.py"
    assert nested["entries"][0]["internal"] == "nested/code.py"
    assert ".hidden" in [entry["name"] for entry in request("GET", "/browse", params={"path": str(archive), "hidden": "yes"}).json()["data"]["entries"]]


def test_missing_denied_unsupported_and_corrupt_archives(home, monkeypatch):
    assert request("GET", "/browse", params={"path": str(home / "missing.zip")}).status_code == 404
    assert request("GET", "/browse", params={"path": "/outside-authorized-home"}).status_code == 403
    file = home / "file.txt"
    file.write_text("text")
    assert request("GET", "/browse", params={"path": str(file)}).status_code == 400
    file.rename(home / "bad.zip")
    response = request("GET", "/browse", params={"path": str(home / "bad.zip")})
    assert response.status_code == 500
    assert "Failed to browse archive" in response.json()["detail"]


def test_launch_preserves_query_and_guards(archive, home):
    response = request("POST", "/archives/launch", json={
        "archive_path": str(archive), "internal": "/nested/", "filesystem_path": str(home),
        "destination": str(home / "new folder"), "show_hidden": True,
    })
    assert response.status_code == 200
    data = response.json()["data"]
    query = parse_qs(urlparse(data["app_url"]).query)
    assert data["archive_path"] == str(archive)
    assert query == {"archive": [str(archive)], "internal": ["nested"], "path": [str(home)], "destination": [str(home / "new folder")], "hidden": ["1"]}
    assert request("POST", "/archives/launch", json={}).status_code == 400
    assert request("POST", "/archives/launch", json={"archive_path": "/outside"}).status_code == 403


def test_extraction_calls_real_job_signature_and_retains_job_envelope(archive, home, monkeypatch):
    from app.libs.jobs import Job
    calls = []
    class Manager:
        def create_job(self, job_type, params):
            calls.append((job_type, params))
            return Job(job_type=job_type, params=params, id="job-test")
    monkeypatch.setattr(backend, "job_manager", Manager())
    response = request("POST", "/archives/extract", json={"archive_path": str(archive), "items": ["visible.txt"], "destination": str(home / "output"), "options": {"overwrite": True}})
    assert response.status_code == 200
    assert response.json()["data"]["id"] == "job-test"
    assert response.json()["data"]["type"] == "extract_archive"
    assert calls == [("extract_archive", {"archive_path": str(archive), "items": ["visible.txt"], "destination": str(home / "output"), "options": {"overwrite": True}})]
    assert request("POST", "/archives/extract", json={}).status_code == 400
    assert len(calls) == 1


def test_real_selected_archive_extraction_job_handler(archive, home, monkeypatch):
    from app.libs.archiver_service import job_extract_archive
    from app.libs.jobs import Job, JobContext, JobManager
    destination = home / "output"
    manager = JobManager(state_file=home / "isolated-jobs.json")
    monkeypatch.setattr(manager, "save_state_async", lambda: None)
    monkeypatch.setattr(manager, "notify_job_update", lambda job: None)
    job = Job("extract_archive", {"archive_path": str(archive), "items": ["visible.txt"], "destination": str(destination)})
    job_extract_archive(JobContext(job, manager), job.params)
    assert (destination / "visible.txt").read_text() == "text"
    assert not (destination / "nested" / "code.py").exists()
    assert job.status == "succeeded"
    assert job.result["destination"] == str(destination)


@pytest.mark.parametrize("path", ["/archives/launch", "/archives/extract"])
@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"null", b'{"archive_path":3}', b'{"options":3,"internal":3}', b'{"items":[3],"show_hidden":{}}'])
def test_invalid_command_bodies_do_not_create_jobs(path, body, monkeypatch):
    class Manager:
        def create_job(self, job_type, params):
            pytest.fail("invalid request created a job")
    monkeypatch.setattr(backend, "job_manager", Manager())
    assert request("POST", path, content=body).status_code == 422


@pytest.mark.parametrize("name", ["archive", "hidden"])
def test_invalid_query_boolean_never_browses(monkeypatch, name):
    browse = AsyncMock()
    monkeypatch.setattr(backend, "browse", browse)
    assert request("GET", f"/browse?{name}=bad").status_code == 422
    browse.assert_not_called()


def test_routing_limits_and_partial_disconnect(monkeypatch):
    assert request("GET", "/unknown").status_code == 404
    assert request("POST", "/ping").headers["allow"] == "GET"
    assert request("GET", "/archives/extract").status_code == 405
    response = request("GET", "/browse/?path=%2Fhome", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/browse?path=%2Fhome"
    assert request("POST", "/archives/extract", content=b"{}", headers={"content-length": str(MAX_BODY_BYTES + 1)}).status_code == 413
    assert request("POST", "/archives/extract", content=b"{}", headers={"content-type": "text/plain"}).status_code == 422
    command = AsyncMock()
    monkeypatch.setattr(backend, "extract_archive", command)
    async def run():
        messages = iter([{"type": "http.request", "body": b"{", "more_body": True}, {"type": "http.disconnect"}])
        async def receive():
            return next(messages)
        send = AsyncMock()
        await backend.TE2_ASGI_APP({"type": "http", "path": "/archives/extract", "method": "POST"}, receive, send)
        send.assert_not_awaited()
    asyncio.run(run())
    command.assert_not_called()


def test_sync_domain_handler_runs_off_event_loop(monkeypatch):
    import threading
    caller = threading.get_ident()
    threads = []
    def browse(**kwargs):
        threads.append(threading.get_ident())
        return {"ok": True, "data": {}}
    monkeypatch.setattr(backend, "browse", browse)
    assert request("GET", "/browse").status_code == 200
    assert threads and threads[0] != caller


def test_backend_imports_no_fastapi_or_pydantic(monkeypatch):
    from app.apps.archive_manager import http_app
    original = builtins.__import__
    def checked(name, globals=None, locals=None, fromlist=(), level=0):
        if (globals or {}).get("__name__", "").startswith("app.apps.archive_manager") and name.split(".")[0] in {"fastapi", "pydantic"}:
            raise AssertionError(name)
        return original(name, globals, locals, fromlist, level)
    monkeypatch.setattr(builtins, "__import__", checked)
    importlib.reload(http_app)
    importlib.reload(backend)
