# Existing MCP tool ownership baseline

## Current port status (source only)

All 24 tools now have handler paths in native_mcp.rs (native-mcp plus the normal
Ferrous feature), with exact captured discovery metadata. Public endpoints remain
Python-backed: this is not activation or live acceptance. User explicitly rejected
partial/hybrid MCP forwarding; the next mount must expose the complete catalog.

Native app/debug/persisted-console services remain direct. Live console accesses
the real Python relay over a private capability-protected loopback owner API, not
a new registry. Scaffolding reuses the existing app library through typed owner
methods. FWS records/input use the framework's actual manager; log paths/codecs
come from exact manager snapshots and neutral Python log utilities preserve
classification/regex/IO metadata. Those utilities now use portable DTOs, with no
FastMCP/Pydantic imports. These service calls are not generic MCP/tool forwarding.

Sidebar mutation now targets the exact Code TE2 production pipe and its worker
stores/PreferencesChanged hook. It does not import worker stores in the bridge or
use debug/eval privilege. A matching mypyc domain refresh is required before live
validation. Owner client redirects, environment proxies and retries are disabled.
The historical map below records the retained Python baseline, not native routing.

## Historical baseline and port rationale

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

The dormant adapter also ports framework workers/status/eval directly to the
existing Rust debug owner when ferrous-framework-native is enabled. HTTP and MCP
share credential comparison/data dispatch; credentials are explicit, identities
are exact, and no evaluation is retried. Debug JSON is already enveloped and is
not nested in the app-action envelope. Six adapter tests plus shared admission
and pipe regressions are source evidence, not live evaluation/client acceptance.

Persisted console workers/tail/search are also ported in native_mcp_console.rs.
They resolve the existing cache-home transcript, perform read-only blocking I/O
off the executor, and return the Python-shaped results (not app-action wrappers).
Golden fixtures compare both implementations; no live relay is imported or reset.
Tail is newest-match/chronological output, search is earliest-match output, and
workers are historical/sorted. Forward reads add the reverse reader's 8 MiB record
ceiling; oversized manual records are skipped. Arbitrary scalar/Pydantic and full
error-content parity remain separate activation gates.

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
