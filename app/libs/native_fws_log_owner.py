"""Read-only log projection from exact native-manager snapshots, without MCP."""
from __future__ import annotations
import asyncio
import hmac
import re
import time
from pathlib import Path
from typing import cast
import msgspec
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

class Snapshot(msgspec.Struct, forbid_unknown_fields=True):
    shell_id: str
    status: str
    created_at: float
    updated_at: float
    stdout_log: str
    stderr_log: str
    log_codecs: dict[str, str]
    io_metadata_log: str | None = None

class Options(msgspec.Struct, forbid_unknown_fields=True):
    stream: str = "both"
    lines: int = 200
    limit: int = 100
    query: str = ""
    regex: bool = False
    ignore_case: bool = False
    format: str = ""
    signature: str = ""
    exclude_query: str = ""
    exclude_signature: str = ""
    include_io_metadata: bool = False
    include_stdin: bool = False
    include_timestamps: bool = False
    include_output_metadata: bool = False

class LogRequest(msgspec.Struct, forbid_unknown_fields=True):
    operation: str
    snapshot: Snapshot
    options: Options

def _stats(path: Path) -> dict[str, object]:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return {"path":str(path),"size":0,"mtime":None,"age_seconds":None}
    return {"path":str(path),"size":stat.st_size,"mtime":stat.st_mtime,"age_seconds":max(0,time.time()-stat.st_mtime)}

def _search(path: Path, codec: str, options: Options) -> list[dict[str, object]]:
    limit = max(1,min(options.limit,1000))
    if not options.query or not path.exists():
        return []
    matcher = re.compile(options.query,re.IGNORECASE if options.ignore_case else 0) if options.regex else None
    needle = options.query.lower() if options.ignore_case else options.query
    matches: list[dict[str, object]] = []
    def visit(text: str, ordinal: int) -> bool:
        haystack = text.lower() if options.ignore_case and not options.regex else text
        if bool(matcher.search(text)) if matcher else needle in haystack:
            matches.append({"line_number":ordinal,"text":text})
        return len(matches)<limit
    if codec == "messagepack":
        from framework_shells.log_window import LineIndex
        index = LineIndex(path,codec="messagepack")
        try:
            cursor = 0
            while True:
                window = index.window(action="current",current=cursor,count=100,shift=100,max_bytes=1024*1024-64)
                records = window.records
                for offset,record in enumerate(records):
                    ordinal = window.start+offset+1
                    if ordinal <= cursor:
                        continue
                    if not visit(record.text,ordinal):
                        return matches
                end = window.end
                if end<=cursor or window.at_tail:
                    break
                cursor = end
        finally:
            index.close()
    else:
        with path.open("r",encoding="utf-8",errors="replace") as handle:
            for ordinal,line in enumerate(handle,1):
                if not visit(line.rstrip("\n"),ordinal):
                    break
    return matches

async def project(request: LogRequest) -> dict[str, object]:
    # Lazy imports are library helpers, not another manager or MCP server.
    from framework_shells.log_inspection import inspect_log_file, read_event_window
    from framework_shells.io_metadata import read_io_metadata
    from framework_shells.log_projection import Codec
    from .fws_log_analysis import build_inspect_result
    snapshot, options = request.snapshot, request.options
    stream = (options.stream or "both").strip().lower()
    if request.operation not in {"tail","search","inspect"} or stream not in {"stdout","stderr","both"}:
        raise ValueError("Invalid log operation/stream")
    payload: dict[str, object] = {"shell_id":snapshot.shell_id,"status":snapshot.status,
                                  "created_at":snapshot.created_at,"updated_at":snapshot.updated_at}
    for name in ("stdout","stderr"):
        if stream not in {name,"both"}:
            continue
        path = Path(snapshot.stdout_log if name=="stdout" else snapshot.stderr_log)
        codec = snapshot.log_codecs.get(name,"text")
        stats = await asyncio.to_thread(_stats,path)
        if request.operation == "search":
            stats["matches"] = await asyncio.to_thread(_search,path,codec,options)
        elif request.operation == "tail" and codec != "messagepack":
            window = await read_event_window(path,lines=max(0,options.lines),max_bytes=4096)
            stats.update({key:value for key,value in window.items() if key!="records"})
            stats["lines"] = [record.get("text", "") for record in window["records"]]
        else:
            window = await inspect_log_file(path,codec=cast(Codec,codec),stream=name,lines=max(0,options.lines),max_bytes=4096,
                                            query=options.query or None if request.operation=="inspect" else None,
                                            exclude_query=options.exclude_query or None,regex=options.regex,ignore_case=options.ignore_case)
            stats.update(window)
            if request.operation == "tail":
                stats["lines"] = [record.get("text", "") for record in window["records"]]
                _ = stats.pop("records",None)
                _ = stats.pop("summary",None)
        payload[name] = stats
    if request.operation == "inspect":
        if options.include_io_metadata and snapshot.io_metadata_log:
            payload["io_metadata"] = await read_io_metadata(Path(snapshot.io_metadata_log),limit=max(1,min(options.lines or 200,5000)),
                                                           max_bytes=4096*512,include_output=options.include_output_metadata,
                                                           include_stdin=options.include_stdin,include_timestamps=options.include_timestamps)
        result = build_inspect_result(shell_id=snapshot.shell_id,status=snapshot.status,payload=payload,
                                      mode="search" if options.query else "tail",query=options.query or None,
                                      format_filter=options.format or None,signature_filter=options.signature or None,
                                      regex=options.regex,ignore_case=options.ignore_case,exclude_query=options.exclude_query or None,
                                      exclude_signature=options.exclude_signature or None,record_limit=None if not options.query else max(1,min(options.limit,1000)))
        payload = result.model_dump(mode="json")
    return {"ok":True,"data":payload,"source":"framework_shells.direct"}

def fws_log_owner_routes(token: str) -> list[Route]:
    async def endpoint(request: Request) -> JSONResponse:
        if not token or not hmac.compare_digest(token.encode(),request.headers.get("x-te2-owner-key","").encode()):
            return JSONResponse({"error":"fwsLogOwner.unauthorized"},status_code=401)
        body = bytearray()
        async for chunk in request.stream():
            if len(body)+len(chunk)>256*1024:
                return JSONResponse({"error":"fwsLogOwner.bodyTooLarge"},status_code=413)
            body.extend(chunk)
        try:
            parsed = msgspec.json.decode(body,type=LogRequest)
        except msgspec.DecodeError:
            return JSONResponse({"error":"fwsLogOwner.invalidRequest"},status_code=400)
        return JSONResponse(await project(parsed))
    return [Route("/internal/fws-log/project",endpoint,methods=["POST"])]
