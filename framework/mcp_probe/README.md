# Isolated MCP transport probe

Independent non-publishable Cargo workspace, pinned rmcp 3.5.1 with Tokio/Axum.
It does not modify the framework workspace or mount into the running runtime.
Only synthetic probe tools are exposed; no TE2 services, credentials, logs or
console registry are accessible. Bind is fixed to loopback with a free port;
request bodies are bounded to 64 KiB and waits to 5 seconds. Test cleanup stops
only the child probe process.

From the repo root (retain existing Cargo caches):

```bash
CARGO_TARGET_DIR="$PWD/framework/rust/target" cargo build --locked --manifest-path framework/mcp_probe/Cargo.toml -j 2
```

Run separately:

```bash
python framework/mcp_probe/test_probe.py
```

`TE2_MCP_PROBE_BIN` can select another built probe. Tests cover initialization,
schema discovery/nested payloads, validation/tool errors, session state/deletion,
wire cancellation/handler cleanup, Streamable HTTP's GET SSE channel and disconnect,
ingress bounds, and a real Python MCP SDK client. They use protocol 2025-11-25;
this is not full conformance or Android/client acceptance.

Raw rmcp returns 202 for session DELETE and 415 for malformed JSON. The isolated
http_compat.rs wrapper maps successful DELETE to 200 and JSON syntax/EOF errors
to HTTP 400 / JSON-RPC -32700, removing the installed Python SDK teardown warning.
True media-type errors, valid-JSON envelope validation, failed DELETE, notification
202 replies, streaming, and dispatcher errors are not broadly rewritten. Valid
requests are decoded only by rmcp; bounded bytes are retained to classify rejected
415 bodies, with syntax parsing only on that rejection path. No dispatch retry.
Eight tests cover the wrapper and underlying transports. Full HTTP/error/schema
parity remains an integration gate, not implied by these two corrections.
Initialization may use SSE even with JSON replies preferred; do not parse all
successful POST bodies as JSON. Cancellation may close the response stream
without a JSON-RPC result; tests verify no active handler remains instead.

`fixtures/python_tools.json` captures the 24 current Python tool descriptors,
including input/output schemas and annotations; it is a parity baseline, not
evidence those tools are implemented by this probe. Regenerate with:

```bash
python -B scripts/capture_te2_mcp_schema.py --output framework/mcp_probe/fixtures/python_tools.json
```

That script imports Python MCP only with disposable cache/config/data roots,
because console initialization truncates its configured transcript. Never import
the baseline server against live console storage. Existing Codex/Copilot ALS
integration uses /te2_mcp_http; legacy /te2_mcp remains unchanged. Disabling the
legacy option is deferred until release preparation after explicit approval.

Next gates: port all tool semantics/results to their native owners, resolve exact
console relay access without shadow state, schema parity, mount/proxy/headers,
real Codex/Copilot acceptance, cancellation/no-retry behavior for mutations,
and separate legacy-disable/release decisions.
See TOOL_OWNERS.md for the complete 24-tool owner map.

## Dormant native framework-tool slices

The optional native-mcp adapter now implements the complete 24-tool catalog with
the normal Ferrous feature (12 applicable tools without it). Default features and
public MCP routing remain unchanged. Native handlers invoke their real owners:
direct framework services, exact worker pipes and narrow private Python service/
library APIs, never a generic FastMCP tool forwarder or separate FWS manager.
Private APIs require a fresh paired-bootstrap capability and literal loopback;
the Rust owner client never redirects, uses environment proxies or retries.

Persisted console uses read-only off-loop JSONL access; forward records gain the
existing reverse 8 MiB ceiling. Sidebar changes require a fresh matching Code TE2
domain/worker hook, not just a framework build. Console/log/scaffold owner APIs
require the new framework/bridge pair. No public native endpoint or live mutation
is enabled by these source changes. Verify from the repo root separately:

```bash
python -B framework/mcp_probe/test_console_reference.py
```

```bash
cargo test --locked --manifest-path framework/rust/Cargo.toml -p te2-server --features native-mcp native_mcp -j 2
```

```bash
cargo test --locked --manifest-path framework/rust/Cargo.toml -p te2-server --features native-mcp apps_lifecycle::tests -j 2
```

```bash
cargo test --locked --manifest-path framework/rust/Cargo.toml -p te2-server --features native-mcp runtime_debug -j 2
```

```bash
cargo check --locked --manifest-path framework/rust/Cargo.toml -p te2-server -j 2
```

No public native MCP endpoint or live launch is enabled by those tests. Preserve
mutations' owner/cancellation/no-retry behavior at later integration. Native tests
currently use fixture owners; real lifecycle and client acceptance is pending.
