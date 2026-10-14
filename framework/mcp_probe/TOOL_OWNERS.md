# Existing MCP tool ownership baseline

All 24 discovered names are captured in fixtures/python_tools.json. No production
tool is implemented by the synthetic probe. Keep schemas, defaults, result
envelopes, error semantics and annotations stable during the actual port.

First dormant framework adapter implemented in
framework/rust/crates/te2-server/src/native_mcp.rs, behind non-default native-mcp.
It provides te2_apps_reload, te2_app_start and te2_app_open using the same AppState
and lifecycle service entrypoints as HTTP/pipe callers; it is not mounted into
any public router. Four fixture tests prove schema/metadata equality, validation,
result envelope, exact owner invocation and no retry. Existing lifecycle tests
and default-feature check pass. These are source tests, not real launch/client
acceptance or full FastMCP error-content formatting parity.

The discovery baseline is generated with by_alias=True so `_meta` is the wire
name. Earlier probe capture used Python's internal `meta`; the verified fixture
was corrected before native metadata equality was claimed.

| Tools | Current implementation | Intended boundary |
|---|---|---|
| te2_framework_workers, te2_framework_status, te2_framework_eval | app/libs/framework_debug_client.py | Rust runtime_debug_http/runtime_debug_pipe; explicit credential and exact worker identity, no automatic eval retry |
| te2_wba_status, te2_wba_eval | app/libs/wba_debug_client.py | Exact Code TE2/WBA debug owner through framework pipe; no replacement child, restart or shadow state |
| te2_console_workers, te2_console_tail, te2_console_search | app/te2_mcp/console_store.py | Read-only persisted transcript projection; preserve bounded reverse reads, filtering and record defaults |
| te2_console_workers_live, te2_console_eval | app/te2_console_runtime.py via te2_console_client.py | Existing process-owned live relay; native MCP needs a narrow typed bridge, not another registry or transcript-inferred liveness |
| te2_mcp_status | app/te2_mcp/server.py | Runtime-owned status/path projection; existing mode label is stale for HTTP, so changing it requires explicit compatibility decision |
| te2_fws_running, te2_fws_shell_get, te2_fws_log_tail, te2_fws_log_search, te2_fws_log_inspect, te2_fws_shell_write | app/te2_mcp/framework_shells_client.py | Exact framework-owned Ferrous/FWS capabilities; preserve codecs/log projection/auth/input behavior and avoid independent manager authority |
| te2_apps_reload, te2_app_start, te2_app_open | app/te2_mcp/framework_apps_client.py | Rust apps_lifecycle/registry/launch ownership; direct services after integration, no unnecessary HTTP self-call or uncertain mutation replay |
| te2_apps_templates, te2_scaffold_proxy_wrapper, te2_validate_proxy_wrapper | app/extensions/apps/scaffold.py | App discovery/scaffold/validation contracts; preserve user-local roots, overwrite permission and validation before registry/start |
| te2_sidebar_add_app_shortcut | app/te2_mcp/sidebar_shortcuts_client.py | Code TE2 worker-owned preferences and notification hook; do not import Code TE2 stores into a separate MCP process |

The FWS Python adapter currently uses shared-manager reads with HTTP stdin
submission/fallback and Python log analysis. A native replacement must reproduce
the result projections and correct manager ownership, not simply point at a new
manager or return raw native records under the old schema. Framework HTTP FWS
routes proxy to the Ferrous runtime; source authority remains that live owner.

The current Sidebar adapter imports Code TE2 stores into the bridge and broadcasts
through explorer_manager. This historical path does not establish correct native
worker authority. The port needs a worker hook before retiring this implementation.
The activate parameter is presently accepted without being applied; do not invent
new behavior during a parity-only port without an approved decision.

Next concrete integration slice should inventory exact framework capabilities,
choose in-process native MCP versus independent service, and define a typed
console/worker bridge with auth, cancellation and no-retry contracts. This map
is not authorization to wire production endpoints or alter tools.
