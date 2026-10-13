# Dependency reduction tracker

- [x] Scope approved: investigate FastAPI/FastMCP, console/MCP ownership and alternatives.
- [x] Inventory supported app entrypoints/ASGI contracts and frontend typing state.
- [x] Trace Pydantic/cryptography dependency paths in installed metadata.
- [x] Distinguish ALS-RS native runtime from stale FastAPI requirement.
- [x] Include maintainer-owned Framework-Shells in coordinated ASGI migration plan.
- [x] Identify ALS Python SDK MCP/KB server as separate transitive dependency owner.
- [x] Compare Rust MCP candidates and legacy SSE transport caveat.
- [x] Record renamed-wheel alternatives and deferred shared-library/pipe ideas.
- [x] Approve first concrete implementation slice.
- [x] Terminal migration/type/lifecycle/transport regressions.
- [x] Terminal live acceptance after approved app-worker restart.
- [ ] Other app/frontend/template migrations.
  - [x] File Editor backend scope approved; explicit ASGI/strict types implemented.
  - [x] File Editor isolated backend/worker regression tests.
  - [x] File Editor backend live acceptance after app-worker restart.
  - [ ] File Editor frontend strict TypeScript/minification.
- [ ] Framework-Shells coordinated migration and updated release metadata.
- [ ] Runtime bridge/console typed ASGI migration.
- [ ] Rust MCP POC and transport/client/schema acceptance.
- [ ] ALS dependency/MCP work separately scoped and validated.
- [ ] Clean target dependency-resolution and installed release acceptance.

Investigation evidence: read-only source/installed metadata inspection only. No runtime imports,
package uninstall/install, framework/app/harness restart, Rust builds or dependency
changes were performed. Local TE2 installed metadata is older than checkout source;
requirements/source and release metadata remain authority for later resolution.
No nested-repository source was edited. Earlier uncommitted source/asset/build
work and unrelated user files remain preserved. No performance/size win is claimed
before measurement. Web references and compatibility details are in PLAN.md.

## Terminal slice 1

Checkpoint `15c0b514` was pushed before implementation. Console clarification is
recorded in PLAN: Socket.IO is independent of FastAPI, but its runtime-bridge host
still uses it; that composition is slice 4.

Terminal backend now exports `TE2_ASGI_APP`, with app-owned HTTP, raw WebSocket
and `/socket.io` routing in `http_app.py`. Four msgspec request shapes replace
Pydantic and are shared by HTTP and lifecycle admission. Domain handlers and
Node broker/frame/checkpoint machinery remain unchanged. HTTP bodies are bounded
to 1 MiB; malformed/disconnected requests do not reach mutations. Readiness and
worker-service startup remain in the existing generic worker hooks, not ASGI boot.

Validation: 95 Python tests passed across Terminal transport/lifecycle/Node-runtime and worker ASGI
regressions plus new explicit-boundary tests; strict `ty` on changed Terminal
modules; frontend typecheck/build and 24 Node tests passed. The new tests cover
HTTP dispatch/envelopes, DTO defaults/invalid input, body limits/disconnect,
slash/query handling, domain errors, real Engine.IO WebSocket handshake, raw
MessagePack codec rejection and connection cleanup. TestClient emits one upstream
httpx deprecation warning. Source-owned imports are checked independently of
Framework-Shells' still-scheduled dependency migration.

User reports the Terminal slice working live; acceptance recorded before its
checkpoint commit. No agent-initiated runtime transition was performed.

No dependency declarations, Node workers, other apps, Android source or shared
runtime were changed/restarted by the agent. This backend
slice does not require Code TE2 mypyc or a native Cargo rebuild. Installed global
dependencies remain until the other consumers and nested repos are migrated.

## File Editor backend slice

Terminal live acceptance was checkpointed in `ae2b02ba`. User approved this
backend-only sub-slice using the blocking input tool; frontend modernization
remains separate. `app/apps/file_editor/main.py` now exports `TE2_ASGI_APP`,
composed in app-owned `http_app.py`. The four routes retain status/read/write
envelopes, home-directory and symlink resolution checks, exact sidebar state
publication and the existing serving hook. Domain functions are annotated with
`dict[str, object]`, not `Any`. Write admission uses a msgspec shape, and bodies
have a 32 MiB ingress bound including JSON escaping overhead; read responses
retain their previous size behavior. App-owned errors preserve structured detail
without FastAPI or an unsafe type cast into Starlette's string-only exception.

Validation: 72 Python tests passed covering File Editor, File Explorer intents,
Terminal ASGI and generic worker ASGI/loading contracts. Changed File Editor
modules pass `ty`; `git diff --check` is clean. New regressions cover Unicode and
empty writes, invalid UTF-8 reads, missing files, home/symlink escape rejection,
sidebar identities/state, invalid bodies, body bounds/disconnect, slash/query
routing and no FastAPI/Pydantic app-owned imports. One upstream TestClient/httpx
deprecation warning remains. No shared runtime/app restart, dependency metadata,
frontend build/OTA, Android, nested repository or native build changes occurred.
User reports the File Editor backend working live; acceptance recorded before
checkpoint commit. No agent-initiated runtime transition was performed.
