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

Current SDK compatibility detail: rmcp session DELETE returns 202; installed
Python MCP SDK expects 200 and logs a termination warning. Calls still pass.
Qualify an SDK update or narrow compatibility handling before production adoption.
Malformed JSON currently returns 415; this is captured behavior, not proof of
parity with the prior Python endpoint's error contract.
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
