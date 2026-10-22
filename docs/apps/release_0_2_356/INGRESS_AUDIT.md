# WBA and network PyO3 ingress — 2026-10-22

This is conversion-boundary work, not a transport replacement. External wire
formats, request ownership and direct binary forwarding remain unchanged.

## Source-backed surface map

| Surface | Current path | Relevant conversion |
|---|---|---|
| Framework results/intents | native pipe reader → control_bytes → existing inbound router | Original frame bytes; previous slice implemented and user reports rebuilt/running |
| WBA control stdout | FWS OutputReader → WbaStream → adapter stdout consumer | Former native Value → Python graph; approved byte-handoff source described below |
| Editor/Explorer/host network RPC | web.rs validates RPC → socket_event → Backend.call → native_worker.submit → namespace owner | Value → Python graph, then return graph → Value for ACK; next scoped candidate |
| Other socket lifecycle/events | Backend.call and namespace handlers | Same generic conversion, but not all inputs have a retained MessagePack RPC frame |
| Native HTTP domain helpers | Backend.call for startup/grammar/theme/icon helpers | Constructed native request values, not a raw incoming MessagePack payload |
| Direct WBA↔editor sockets | Framework protocol-agnostic WebSocket proxy → Node WBA ↔ frontend | No Code TE2 Python conversion; leave alone |
| FWS observer/calls | Bridge.fws_read/fws_call and native_fws.py | Separate typed/native↔generic conversion; not changed by this slice |

Sources: native worker code_te2.rs, web.rs, rpc_codec.rs, wba_codec.rs,
app/apps/code_te2/native_socketio.py, wba_pipe_codec.py,
workbench_adapter_shell_manager.py, and framework Rust proxy_transport.rs.

## Approved WBA inbound source

The existing framer owns the original pending bytes. `Stream::feed_with` keeps
its existing native validation and framing/error control flow, projecting either
legacy values or exact original-frame copies. `feed_frames` uses the latter;
no additional per-marker capture layer or re-encoding is needed. Noncanonical
integer encodings and binary marker bytes remain exact. This still allocates a
native validation graph and copies frames; it is not zero-copy or an RSS result.

`wba_stream.rs` owns the actual PyO3 WbaStream class used by the native worker and
the isolated probe. Its new feed_frames returns bounded validated PyBytes records.
Python's `_NativeStream` decodes them with a cached msgspec Decoder(object), then
the unchanged stdout consumer validates record/payload maps and kinds, correlates
replies, and queues/coalesces pushes. Do not invent a stricter WBA schema during
this representation change: scalar/non-map values remain for the existing domain
owner to reject, and custom/extension values remain native-rejected.

Native batch-error behavior is preserved: if a later frame in a feed is corrupt,
the call fails without publishing earlier frames from that same call. Partial
frames stay subscription-local; replacement drops them, finish rejects truncation.
The native pending parser still retries incomplete frames from their start after
new chunks arrive. Incremental parsing is a possible later investigation, not
silently changed here. There are no new queues, retries or fallback transports.

Old native graph feed remains for older Python callers and the comparison probe;
new Python native selection requires feed_frames and fails with rebuild guidance
if absent. Interpreted tools/tests without configured native codec retain their
existing reference stream; a broken configured native codec does not fall back.
OutputSource expresses only the consumer's existing async get() requirement;
real subscription/close ownership stays OutputReader, with no queue-policy change.

### What this does not optimize

This is WBA's backend control plane: readiness, backend RPC replies and forwarded
events such as diagnostics. Language-intelligence responses sent directly over
the WBA browser socket do not traverse this Python codec. Provider publication,
browser rendering, socket transports and outbound WBA encoding are unchanged.
No frontend/OTA or Node/WBA source build is needed. Adoption needs matching native
worker and Python domain/mypyc code, separately from this source qualification.

### Qualification and reproduction

`examples/wba_boundary_probe.rs` uses the real shared PyO3 stream and actual
Python adapter. Its helper also runs the real stdout consumer with an isolated
async source to verify startup/reply/push order and disabled telemetry without
outbound serialization. Disposable inventory-audited roots prevent live state,
shells or network use; no production worker is launched. Optional explicit
BOUNDARY_PROBE_MYPYC_DIR changes only probe imports, never the active selector.

```bash
env CARGO_TARGET_DIR="$HOME/.cache/te2/code_te2/build/cargo-target" \
  PYO3_PYTHON="$PWD/.jitenv/bin/python" \
  cargo build --release --locked --offline \
  --manifest-path framework/native_editor_worker/Cargo.toml \
  --example wba_boundary_probe -j 2
```

Run each smoke/measurement as its own command:

```bash
"$HOME/.cache/te2/code_te2/build/cargo-target/release/examples/wba_boundary_probe" 11
```

```bash
env BOUNDARY_PROBE_MYPYC_DIR="$PROBE_SNAPSHOT" \
  "$HOME/.cache/te2/code_te2/build/cargo-target/release/examples/wba_boundary_probe" 11
```

The probe reports the actual codec module path. Use a matching new overlay, not
an assumed-current active selector. Initial compiled measurements used the
focused overlay at `.codex-scratch/wba-frames-codegen-20261022/test_compiled_wba_adapter_uses0`;
subsequent codegen coverage additionally compiles the stdout consumer itself.

Local Linux x86_64, CPython 3.14.4, msgspec 0.21.1, release profile, 11 rotating-order
samples with three warmups per mode. Median batch means in microseconds per
record (ready 300 iterations/batch, diagnostics 10, reply 5, binary 10):

| Fixture / wire bytes | Interpreted graph | Interpreted bytes | Compiled graph | Compiled bytes |
|---|---:|---:|---:|---:|
| Ready / 70 | 2.81 | 2.18 | 3.00 | 2.34 |
| Diagnostics 256 / 25,185 | 722.28 | 507.87 | 691.53 | 529.80 |
| Reply 512 / 46,273 | 1,839.37 | 1,260.36 | 1,805.64 | 1,144.79 |
| Binary 256 KiB / 290,868 | 282.73 | 310.12 | 282.42 | 304.74 |

The compiled sample reduces nested diagnostics/reply conversion ~23%/~37%; binary
is ~8% slower. These are synthetic fixtures, not live traces or network/rendering
benchmarks. Both modes use 64 KiB feed chunks; native partial-read processing and
all copies/validation are included. The interpreter is already attached; no total
request latency, attachment cost, allocation/RSS or live backpressure is measured.
Ordinary system load was uncontrolled; do not infer global speedups from this table.

Parity covers four nested/Unicode/binary fixtures across chunk sizes, nine scalar/
container cases, reserved/UTF-8/extension/truncation errors, exact native frame
bytes, replacement ownership and same-feed failure behavior. Source tests include
diagnostics metrics/coalescing and consumer startup/reply/push handling.

Final source validation: 44 native full-worker tests and 22 focused Python tests/
two subtests pass; the latter includes a fresh three-module mypyc fixture for
the adapter, stdout consumer and pipe_codec. Its compiled consumer accepts a
reply through the new adapter and correlates it correctly. The real-PyO3 probe
tests startup/reply/push in the interpreted consumer with both interpreted and
compiled adapters; it reports both module paths. Do not claim a full compiled
live-worker event-storm test from those distinct isolated checks. Strongest
strict/extra/all-Any check passes all 247 Code TE2 source files; probe/test helpers
pass ordinary strict mypy. No new dependencies or permanent typing-policy changes.

An initial single-module mypyc fixture hit a generated-header naming mismatch;
the normal grouped three-module build passes. This was probe construction, not
evidence that the full accepted domain build or runtime was broken.

## Network RPC follow-up — planned, not implemented

The three MessagePack RPC lanes already have native binary/size/duplicate-key/
depth/node validation; compressed-mode requests still use their existing guarded
framing. web.rs then wraps decoded data with namespace/SID/event and Backend.call
recursively constructs Python values. The next bounded proposal should retain
the validated original RPC bytes and hand them to Python alongside **native-owned**
socket identity, before the same handler/namespace dispatch. Avoid serializing a
new socket_event dictionary merely to gain a byte-shaped argument.

Do not trust payload-supplied namespace/SID/client ownership. Preserve handshake
auth, connect/disconnect control admission, per-lane negotiation, parse-error
response versus disconnect behavior, request IDs, ACK/event behavior, cancellation
and 120-second Future handling. Retain graph handling for other socket/HTTP
operations unless separately measured; do not apply the WBA result to all APIs.
Outbound ACK/emits stay unchanged until independently qualified. Test actual
dispatch with fragmented/binary/null data and stale/disconnected client contexts.

Network edits require a concrete follow-up approval; no source/network/runtime
change is authorized by this audit's placement in the plan.
