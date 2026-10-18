"""Disposable owner fixtures; do not import the MCP package/live console."""
import asyncio
import json
import struct
from pathlib import Path
import msgspec
import httpx
from starlette.applications import Starlette
from app.libs.native_fws_log_owner import LogRequest, Options, Snapshot, fws_log_owner_routes, project
from app.libs.native_scaffold_owner import scaffold_owner_routes
from app.apps.code_te2.host.sidebar_shortcut_backend import project_shortcuts


def test_scaffold_owner_is_explicit_and_typed() -> None:
    calls: list[dict[str, object]] = []
    def create(payload: dict[str, object]) -> object:
        calls.append(payload)
        return {"ok": True, "app_id": payload["app_id"]}
    app = Starlette(routes=scaffold_owner_routes("fixture",lambda: [{"id":"template"}],lambda app_id: {"app_id":app_id},create))
    async def check() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://fixture") as client:
            assert (await client.get("/internal/scaffold/templates")).status_code==401
            headers={"x-te2-owner-key":"fixture"}
            assert (await client.get("/internal/scaffold/templates",headers=headers)).json()=={"templates":[{"id":"template"}]}
            assert (await client.post("/internal/scaffold/validate",headers=headers,json={"app_id":"x"})).json()=={"app_id":"x"}
            assert (await client.post("/internal/scaffold/create",headers=headers,json={"app_id":"x","project_root":"/fixture","command":"noop","port":1})).json()=={"ok":True,"app_id":"x"}
            assert (await client.post("/internal/scaffold/create",headers=headers,json={"app_id":"x","extra":True})).status_code==400
    asyncio.run(check())
    assert len(calls)==1 and calls[0]["overwrite"] is False and calls[0]["env"]=={}


def snapshot(root: Path,codec: str="text") -> Snapshot:
    return Snapshot(shell_id="fixture",status="running",created_at=1.0,updated_at=2.0,
                    stdout_log=str(root/"stdout.log"),stderr_log=str(root/"stderr.log"),log_codecs={"stdout":codec},
                    io_metadata_log=str(root/"io.jsonl"))


def test_log_projection_plain_json_rpc_and_metadata(tmp_path: Path) -> None:
    (tmp_path/"stdout.log").write_text('[worker] ready\n'+json.dumps({"jsonrpc":"2.0","id":1,"method":"fixture.open","params":{"a":1}})+'\n')
    (tmp_path/"io.jsonl").write_text(json.dumps({"version":1,"kind":"stdin_write","stream":"stdin","ts":12,"shell_id":"fixture","size":3,"preview":"abc"})+'\n')
    result=asyncio.run(project(LogRequest("inspect",snapshot(tmp_path),Options(query="fixture.open",include_io_metadata=True,include_stdin=True,include_timestamps=True))))
    data=result["data"]
    assert isinstance(data,dict)
    assert data["records"][0]["event_signature"]=="jsonrpc:method=fixture.open"
    assert data["total_returned"]==1
    assert data["io_metadata"][0]["ts"]==12
    assert data["io_metadata"][0]["preview"]=="abc"
    assert data["stream_meta"][0]["path"]==str(tmp_path/"stdout.log")
    tail=asyncio.run(project(LogRequest("tail",snapshot(tmp_path),Options(stream="stdout",lines=1))))
    assert len(tail["data"]["stdout"]["lines"])==1
    search=asyncio.run(project(LogRequest("search",snapshot(tmp_path),Options(query="ready",stream="stdout"))))
    assert search["data"]["stdout"]["matches"]==[{"line_number":1,"text":"[worker] ready"}]


def test_messagepack_search_and_inspection_are_frame_aware(tmp_path: Path) -> None:
    frames=[]
    for i in range(150):
        body=msgspec.msgpack.encode({"jsonrpc":"2.0","id":i,"method":f"fixture.{i}"})
        # Canonical persisted MessagePack values, independent of pipe framing.
        frames.append(body)
    (tmp_path/"stdout.log").write_bytes(b"".join(frames))
    result=asyncio.run(project(LogRequest("search",snapshot(tmp_path,"messagepack"),Options(query="fixture.149",stream="stdout"))))
    assert result["data"]["stdout"]["matches"][0]["line_number"]==150
    result=asyncio.run(project(LogRequest("inspect",snapshot(tmp_path,"messagepack"),Options(query="fixture.149",stream="stdout",lines=20))))
    assert result["data"]["records"][0]["event_signature"]=="jsonrpc:method=fixture.149"


def test_log_owner_authentication_precedes_paths() -> None:
    app=Starlette(routes=fws_log_owner_routes("fixture"))
    async def check() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://fixture") as client:
            assert (await client.post("/internal/fws-log/project",content=b"bad")).status_code==401
            assert (await client.post("/internal/fws-log/project",headers={"x-te2-owner-key":"fixture"},json={"operation":"inspect"})).status_code==400
    asyncio.run(check())


def test_worker_shortcut_projection_preserves_other_entries_and_replaces() -> None:
    shortcut={"id":"framework_app::terminal","app_id":"terminal","kind":"framework_app"}
    current=[{"id":"other","kind":"url"},{"id":"legacy","kind":"framework_app","app_id":"terminal"},False]
    result,replaced=project_shortcuts(current,shortcut)
    assert replaced and result==[{"id":"other","kind":"url"},shortcut]
    assert project_shortcuts([],shortcut)==([shortcut],False)


def test_worker_shortcut_updates_actual_owner_hooks(monkeypatch) -> None:
    from unittest.mock import AsyncMock
    from app.apps.code_te2 import stores
    from app.apps.code_te2.explorer.services import state_facts
    from app.apps.code_te2.host.sidebar_shortcut_backend import add_framework_shortcut
    calls: list[dict[str,object]]=[]
    class Preferences:
        def get_preferences(self): return {"ui":{"agentShortcuts":[]}}
        def update_preferences(self,*,ui): calls.append(ui); return {"ui":ui}
    class History:
        def get_active_project(self): return "/fixture"
    prefs=Preferences()
    monkeypatch.setattr(stores,"get_preferences_store",lambda:prefs)
    monkeypatch.setattr(stores,"get_history_store",lambda:History())
    publish=AsyncMock()
    monkeypatch.setattr(state_facts,"publish_preferences_changed",publish)
    shortcut={"id":"framework_app::terminal","kind":"framework_app","app_id":"terminal","label":"Terminal",
              "url":"/app/terminal?embed=1","load":"lazy","icon":None,"header":True,"last_used":0}
    result=asyncio.run(add_framework_shortcut({"shortcut":shortcut}))
    assert result["ok"] and result["count"]==1 and result["active_project"]=="/fixture"
    assert len(calls)==1
    publish.assert_awaited_once()
