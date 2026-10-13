# Aria Downloader backend

`main.py` owns typed aria2 RPC/domain and Framework-Shells operations.
`http_app.py` exports ten explicit routes through `TE2_ASGI_APP`, using neutral
`app.libs.te2_asgi` transport helpers rather than FastAPI/Pydantic.

Existing public routes under `/api/app/aria_downloader`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | API status |
| GET | `/status` | aria2 version/global statistics |
| GET | `/downloads` | Active/waiting/stopped task projection |
| POST | `/add` | Add URI |
| POST | `/control` | Individual/bulk task controls |
| POST | `/settings` | Global/per-download options |
| GET | `/shells` | Framework shell list |
| GET | `/shell` | Tracked shell and optional log tails |
| POST | `/shell/spawn` | Start and track aria2 shell |
| POST | `/shell/action` | Adopt/remove/stop/kill/restart tracked shell |

Success `{ok:true,data:...}` and error `{detail:...}` envelopes remain. Mutations
require bounded JSON objects (1 MiB), followed by app-owned field checks. The
previous stdlib JSON decoder behavior is retained. Blocking aria2 HTTP requests
run off the ASGI loop; shell-manager methods remain async. The generic worker
owns serving/readiness and lifecycle; ASGI lifespan only acknowledges messages.

Stop/Kill refetch the record after `terminate_shell` (which returns None); a
missing record clears tracking. Restart uses existing terminate/spawn APIs, not
the nonexistent manager `restart_shell`. It retains command, cwd, label,
autostart and newly recorded launch environment, updates the tracked shell ID,
and does not automatically retry uncertain mutations. Older/adopted records
without saved environment use an empty override, preserving inherited defaults;
they cannot reconstruct historic manual environment overrides from this file.

Explicit Start and Restart always pass `autostart=True` to the manager so a child
process is launched immediately. The saved `autostart` compatibility field is
retained but never gates an explicit action; this does not implement automatic
framework/app-start restoration. No startup scan/replay is added.

Validate with `ty check app/apps/aria_downloader/main.py
app/apps/aria_downloader/http_app.py` and
`python -m pytest -q tests/test_aria_downloader_asgi.py`. Use isolated TE2 data,
config and cache roots for tests/import diagnostics. Tests substitute aria2 and
the shell manager; they never spawn/terminate a real shell or contact live aria2.

Activation requires an approved ordinary Aria app-worker restart, not a framework
restart, Code TE2 mypyc rebuild or Cargo build. This backend slice changes no
frontend assets; strict TS/bundling and native client publication remain separate.
