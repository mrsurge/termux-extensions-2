# Native editor-services: pipe boundary inventory

Source-backed inventory after persistence checkpoint `69e0072e`. No runtime or
transport changes are implemented by this document.

## Two protocols, not one

| Boundary | Current owner | Wire contract | Keep in Python |
| --- | --- | --- | --- |
| Framework ↔ Code TE2 worker | Rust app-worker bridge; Python app_worker/pipe_runtime | Concatenated MessagePack PipeEnvelope maps, 32 MiB frame bound | Service dispatch, project/document policy |
| Code TE2 ↔ WBA child | Python workbench_adapter_shell_manager + FWS; JS stdio protocol | MessagePack JSON-RPC-shaped requests; typed reply/push/startup records | Application push interpretation, domain effects |
| Browser ↔ WBA | JS WBA server | Existing direct intelligence Socket.IO lane | Nothing; not a Python networking migration |
| Drawer PTY ↔ projection | FWS + Python terminal backend | Raw log bytes, offsets, generation/checkpoint contract | Pyte parser and terminal policy for now |

Neither of the first two streams uses newline JSON or a length prefix. Do not
copy the standalone Terminal's separate length-prefixed pipe framing here.

## Framework pipe

Source: `app/libs/app_worker.py`, `pipe_runtime.py`, `pipe_protocol.py`,
`messagepack_stream.py`; Rust `app_worker_pipe_bridge.rs` and
`framework_services/pipe/protocol.rs`.

- Python owns a dedicated stdin reader, incremental decode and strict envelope
  conversion. Protocol stdout is separate from application logging. Corrupt or
  truncated framing closes the transport, rather than guessing a new boundary.
- Envelope identity includes origin/target NID/name, workspace/project generation,
  request ID, correlation/op IDs and sequence. Preserve validation and routing.
- `call_async` runs the synchronous request path in a thread. Pending replies
  have one-slot queues; duplicate replies use nonblocking insertion. Writes share
  a lock. Close fails pending requests; timeouts remove their pending entry.
- Cancelling an async caller does not stop an already-running `to_thread` call
  or undo a sent mutation. Native cancellation must not invent retry semantics.
- Rust already separates service dispatch from an ordered writer thread with a
  256-frame queue. Admission fails explicitly when full/disconnected. This is a
  frame-count bound, not a total-byte budget.
- Current Python codec imports both msgspec (encoding/envelope conversion) and
  msgpack (incremental decoding). Moving only encoding will not remove either
  dependency from the whole worker.

## WBA child control pipe

Source: `workbench_adapter_shell_manager.py`, WBA
`src/server/stdio-protocol.ts` and `src/protocol/pipe-codec.ts`.

- Shell manager owns launch/adoption, exact shell identity, one output-byte
  subscription, writer lock, request IDs/futures and ordered push delivery.
- Request admission checks optional expected shell identity and live pipe
  capabilities. Binary writes currently reach `get_pipe_state().process.stdin`
  because the Python FWS text convenience method cannot carry MessagePack.
- Request timeout currently covers waiting for the reply **after** write/drain;
  it is not a deadline encompassing lock acquisition and stdin drain.
- Reader distinguishes reply/push/startup records; stdout is not a log parser.
  Reader errors fail pending RPCs. Subscription cleanup cancels reader/push tasks
  and unsubscribes from the exact shell.
- Pending pushes coalesce contiguous diagnostics for one owner by URI, while
  retaining order relative to other events. The deque and pending-request map
  have no explicit count/byte admission cap in this module. A native bridge
  needs specified bounds and explicit failure, not arbitrary event dropping.
- Push accounting currently re-encodes decoded payloads to count their bytes.
  A future decoder could carry frame-size metadata; do not alter DTOs or claim
  measured savings from this observation alone.

## Ferrous reuse and ownership constraint

Current Cargo pin: Ferrous tag `0.2.14`. Audited `src/native_runtime.rs`:

- `spawn_rendered_shellspec_with_overrides_blocking` preserves the shellspec
  contract already used by TE2's Rust launcher.
- `write_to_pipe_blocking(shell_id, &[u8])` is binary-safe. In contrast, async
  `write_to_pipe` and `write_to_shell` accept strings; do not use those for codec
  bytes or perform a lossy text conversion.
- `subscribe_output_bytes`/`subscribe_output` provide bounded byte subscriptions;
  lifecycle events and PTY resizing also exist.
- A full native output subscription is removed by the publisher, with dropped
  accounting. A protocol adapter must treat a gap/closure as fatal to that stream
  and fail pending calls; silently resubscribing into a partial frame is unsafe.
- This establishes API availability, **not** cross-process adoption compatibility.
  A separate editor-services executable cannot assume that creating another
  manager grants access to Python-owned live pipe handles. Choose explicit
  ownership at launch or an existing manager-owned service boundary before coding.

Python FWS callers remain in WBA/watchexec managers (eager), code-server,
run-profile/page-preview managers and terminal paths (demand imports). The shared
run-profile FWS Socket.IO bridge also owns active-route and terminal fact restore.
Eliminating Python FWS or Socket.IO requires auditing all of these, not replacing
only the WBA write call.

## Implemented first transport seam

`app/libs/pipe_transport.py` now defines `EnvelopeTransport` and the default
`StdioEnvelopeTransport`. `pipe_runtime.configure_transport` accepts an envelope
sink; existing `configure_stdio_transport` wraps the borrowed binary stream.
Runtime retains request IDs, pending replies, shared writer serialization,
notification listeners, identity validation and service dispatch. The adapter
owns encoding and write/flush, including the diagnostic `before_write` callback
immediately before exposing bytes and under the runtime writer lock.

`close_transport` is transport-neutral; `close_stdio_transport` remains the
worker EOF/error entrypoint. Closing detaches future writes and releases waiters;
it neither closes borrowed stdout nor retracts an in-flight write that already
captured its transport. Configure is setup, not live transport migration. Errors
and reply timeout semantics are unchanged. No native codec/dependency removal
is claimed: stdin decoding and framing still belong to `app_worker`.

## Implemented inbound delivery seam

`app/libs/pipe_inbound.py` supplies `InboundEnvelopeRouter.deliver` for already
validated envelopes. Its injected callbacks route replies and notifications to
the runtime, offer requests to the existing debug admission owner, and dispatch
ordinary requests synchronously on the caller thread. It has no queue, codec,
reader, retry policy or event-loop owner. Unknown kinds retain the process-error
reply; unmatched responses/notifications retain their diagnostic messages.

The worker still owns incremental stdin decode, schema-error replies, EOF and
corruption handling, pending-call closure and debug shutdown. A malformed
envelope with intact framing receives an error and permits the next frame;
corrupt/truncated bytes terminate the stream. RuntimeDebugPipe's opt-in checks,
single-operation admission, loop handoff and release-before-write are unchanged.

## Recommended next slice (approval required)

Specify the native worker's event-loop/thread handoff and bounded admission
before implementing one lane with PyO3. No Python callbacks while holding native
transport locks; no redundant serialize/deserialize loop across PyO3. Preserve
Python domain authority, direct browser/WBA traffic and framework process isolation.
WBA child ownership migration is a separate gate, not an incidental consequence.
