# Explicit app boundaries and Python dependency reduction

## Objective and scope

Remove FastAPI/Pydantic from supported TE2 app-worker runtime paths, then replace
Python FastMCP/MCP transport where appropriate so the normal installation does
not regain Pydantic/cryptography transitively. Keep Python policy/orchestration
typed and independently testable; expose explicit ASGI/DTO/lifespan boundaries
that remain suitable for later mypyc compilation or native hosting.

Investigation and Terminal slice 1 are approved. Later slices need concrete scope
approval. No package uninstall, shared framework restart, deployment, native build
or changes in dependent repositories are authorized by the Terminal slice.
The preceding editable-build/asset-cleanup work is checkpointed at `15c0b514`.

## Established reusable contracts

- `app/libs/app_worker_asgi.py`: explicit `TE2_ASGI_APP`, reserved loop probe,
  application-owned mounts/lifespan and paired worker lifecycle. Do not create
  another supervisor or HTTP server for an app.
- File Explorer `http_app.py` / `tab_service.py`: explicit routing, bounded body
  reads, typed handlers and Socket.IO composition. Starlette response primitives
  are reusable without a FastAPI application/schema engine.
- Code TE2: Rust serving/PyO3 domain is the architecture target, not something every
  small app must adopt immediately. Retained Python HTTP module is a parity fixture.
- Uvicorn remains useful. Direct ASGI exposes routing and lifecycle rather than
  hiding them behind introspection; typed DTO/domain functions stay independent
  of the transport and compilation choice.
- Preserve current HTTP/WebSocket/RPC paths, wrappers, status/error shapes,
  identity/credential checks, readiness and ownership. Static typing is not a
  substitute for cheap validation of unknown remote inputs, body limits, paths,
  shell IDs or mutations. Use small explicit checks/msgspec DTOs, not Pydantic.

## Source-backed target inventory

| Owner | Current work remaining | Migration seam |
| --- | --- | --- |
| Terminal | FastAPI router/WebSocket plus four Pydantic request DTOs; backend mostly typed, frontend already strict TS/bundled | Explicit app-owned ASGI routing and typed DTOs; preserve Node PTY/headless stream and MessagePack protocol |
| File Editor | FastAPI routes and untyped browser orchestration | Typed backend/ASGI, TS entrypoint/minified bundle and inline CSS |
| Archive Manager | Four FastAPI routes; ~1,174-line browser module | Typed backend/ASGI and modular strict TS/browser build |
| Aria Downloader | Ten FastAPI routes; ~1,054-line browser module | Same workflow, preserving aria2 shell/process and polling behavior |
| Settings | ~291-line browser module; framework-backed settings | Strict TS/browser build only; do not invent a Python settings authority |
| ALS-RS wrapper/template | FastAPI stub files; actual ALS-RS shell launches native `als-rs` | Verify stub use; migrate the proxy-shell template so new wrappers do not reintroduce FastAPI |
| Generic app worker | Lazy `app_worker_fastapi.py` compatibility path | Retire after supported built-ins/templates migrate; explicitly decide external legacy-router policy |
| Runtime bridge | FastAPI root mounting console and two FastMCP HTTP apps | Explicit ASGI/typed composition, then native MCP replacement |

Each app owns its backend, shellspec and protocols. Share neutral ASGI/type/build
primitives, not another app's source. Convert browser source to strict TS with
one minified entrypoint and inline template CSS where applicable; do not refactor
Terminal's already-typed frontend unnecessarily.

## Console/MCP ownership and dependency evidence

Console data plane: `app/te2_console_runtime.py` uses Python Socket.IO at
`/te2_console_ws/socket.io`, not FastMCP. MCP console tools call its live in-process
functions through `Te2ConsoleClient`. The runtime bridge currently eagerly imports
and initializes MCP mounts alongside it. Do not import this live console module
in diagnostic probes: initialization resets transcript files.

User clarification: the console question concerned FastAPI, not FastMCP. Console
Socket.IO itself does not need FastAPI; its containing runtime-bridge application
does. Slice 4 removes that composition dependency without replacing console state.

TE2 MCP: `app/te2_mcp/server.py` declares 24 tools, two separately constructed
FastMCP servers: legacy SSE `/te2_mcp` and Streamable HTTP `/te2_mcp_http`.
Pydantic models also back console transcript projection. Tools include native
framework capabilities, Python FWS/log helpers, scaffold/validation, HTTP adapters
to framework endpoints, and direct console state—not uniformly native methods.
Inventory schemas and effects before migration; preserve tool names/results,
exact-worker targeting, timeout/no-retry semantics and explicit eval credentials.

Installed metadata/source checks show:

- FastAPI requires Pydantic, which requires native pydantic-core.
- FastMCP 3.4.7 requires fastmcp-slim[client,server]; slim retains Pydantic,
  pydantic-settings, Python MCP SDK and Authlib. Authlib/joserfc and the SDK's
  pyjwt[crypto] pull in cryptography. Switching to slim does not meet the goal.
- Framework-Shells 0.0.64 still declares FastAPI; its Python API/Ferrous host
  composition imports it. User confirms its single dashboard page is event-
  hydrated, so the same explicit-ASGI workflow fits. The maintainer owns this repo.
- ALS-RS itself is native; user confirms its FastAPI requirement is stale. Its
  adjacent source requirements still declare it, so pip installs it regardless.
  Legacy `als_deprecated` code exists; supported-runtime metadata must be separated
  from optional/retired legacy paths instead of inferring active use from imports.
- ALS `mcp_agent_pty_server.py` uses `mcp.server.fastmcp`, the Python SDK's FastMCP,
  not TE2's standalone `fastmcp` import. Thus removal of the standalone dependency
  alone does not remove the SDK's Pydantic/crypto graph. Coordinate a separate ALS
  MCP/KB migration or explicit packaging boundary; never disrupt the active harness.

These are local installed/source observations, not a newly resolved clean release
lock. Completion needs clean Android/Linux dependency-resolution proof, not merely
deleting lines in TE2 requirements.

## Rust MCP decision to qualify

Preferred candidate: official [rmcp](https://github.com/modelcontextprotocol/rust-sdk),
which uses Tokio and has Streamable HTTP server support. Choose a pinned compatible
release/MSRV and compile an independent protocol sample before adopting it.
Current upstream intentionally omits legacy two-endpoint HTTP+SSE; retaining
`/te2_mcp` compatibility or explicitly migrating all clients is a required gate,
not equivalent to SSE responses inside Streamable HTTP.

The name FastMCP is ambiguous across unrelated Rust crates. In particular
[fastmcp-rust](https://github.com/Dicklesworthstone/fastmcp_rust) explicitly requires
asupersync, excludes Tokio adapters and pins nightly Rust; it is not an automatic
drop-in for TE2's Tokio/Axum server. Compare protocol/transport/toolchain fit before
selecting a crate by its name. No crate dependency is changed by this plan.

Native MCP can invoke framework services directly. Console eval/list must reach
the existing exact live relay until that relay is migrated; it cannot read a
separate shadow registry in another process. A typed, narrowly scoped bridge is
acceptable; moving console networking/state is a distinct follow-up decision.

## Ordered implementation slices and validation gates

1. Terminal explicit ASGI + msgspec/dataclass request boundary, existing strict
   frontend checks; isolated HTTP/WebSocket/lifecycle/stream regressions. No Node
   broker rewrite, transport change, runtime restart or other-app source reuse.
2. File Editor, Archive and Aria owner-scoped route/typing/browser slices; Settings
   frontend and proxy-shell scaffold stubs. Preserve download/stream/error behavior.
3. Framework-Shells standalone/Ferrous host explicit ASGI composition and its
   dependency metadata; independent repository approval/tests/release pin updates.
   Dashboard hydration remains Socket.IO; preserve retained public API consumers.
4. Runtime bridge explicit ASGI and typed console DTOs; keep current MCP mounts
   temporarily. Update obsolete Python-server assertions to current ownership.
5. Rust MCP POC: initialization, tools/list/call, schema parity, errors, sessions,
   disconnect/cancellation, legacy SSE gate and Streamable HTTP client acceptance.
   Then migrate framework tools, adapt console tools without duplicate state.
6. ALS coordinated stale-requirement cleanup and MCP/KB plan; independently scoped
   implementation/release work. Maintain exact harness/tool contracts.
7. Remove obsolete compatibility/dependency declarations only after all supported
   consumers migrate. Prove install closures lack unwanted Pydantic/cryptography
   on Linux and Termux; build/installed-wheel/native asset/device acceptance follows.

## Packaging alternatives and deferred architecture

Renaming distributions to fastapi-te2/fastmcp-te2/pydantic-te2 does not make pip
treat them as satisfying upstream requirements with original names. It requires
coordinated metadata forks and ongoing API/security maintenance, and does not
remove imports. For an interim build-only problem, ordinary matching native wheels
under original names in the controlled GitHub wheelhouse are preferable; verify
every runtime dependency rather than fork the entire stack. Architectural removal
and avoiding Android compilation are related but distinct goals.

A shared Rust source crate can centralize DTO/framing/network primitives, but is
normally linked into each executable. Actual binary deduplication requires a
stable C-ABI cdylib/opaque-handle boundary or another deployment design; generic
Tokio/Axum types and Rust dylibs are not a free stable runtime ABI. Measure artifact
contributions before deciding this is worth loader/ABI/package complexity.

Framework-owned worker Socket.IO namespaces routed over the existing pipe are
plausible, but require client/SID/namespace ownership, readiness, room routing,
bounded backpressure, cancellation, disconnection and mutation-replay contracts.
This is deferred transport architecture, not part of removing FastAPI/FastMCP.
