# Native editor-services worker: handoff design

## Prototype status

The independent `framework/native_editor_worker` crate now implements the
pipe-only vertical slice described in its [README](../../../framework/native_editor_worker/README.md).
It embeds system CPython with pinned PyO3, invokes a synchronous fixture service,
and exchanges structural values without Python codec/network imports. Linux
builds and subprocess tests pass; Pixel compilation/testing is pending.
No production launcher, Cargo workspace, HTTP/Socket.IO or WBA change was made.
The application asyncio loop adapter and full wire/error-schema parity remain
future work; the prototype is not the complete worker design below.

Proposed contract, not implemented behavior. Builds on the outbound and inbound
pipe seams through checkpoint `0b557949`; Pixel acceptance now includes the
inbound slice published through `c499e2aa`. No runtime replacement,
dependency installation, ABI selection or release change is authorized here.

## Source constraints

- `code_te2/main.py:te2_pipe_dispatch` currently returns `None`. Editor/Explorer
  operations are not secretly ordinary inbound framework-pipe methods. A pipe
  harness proves transport integration, not full editor service migration.
- Structural DTOs now live in `pipe_dto.py` as msgspec Structs. Public aliases
  remain in `pipe_protocol.py`; conversion/encoding lazily loads `pipe_codec.py`.
  Structural consumers avoid messagepack_stream/msgpack, but still import msgspec.
- `pipe_runtime.call_async` offloads a synchronous call; cancellation does not
  stop its thread or retract a sent request. Its timeout begins after write.
- Ordinary inbound dispatch is synchronous. Diagnostic admission is separate,
  bounded to one operation and posted to the running Python application loop.
- Worker facts and mutable domain state have an existing loop owner. The new
  native transport must not call these handlers on arbitrary Tokio threads.

## Ownership and execution

The intended executable remains an FWS-owned **separate worker**, not Python
embedded into the shared TE2 server. Native runtime threads own pipe/network I/O,
framing, envelope validation and connection lifetime. A dedicated Python owner
thread runs the application asyncio loop for domain services. Transport adapters
submit work to that owner through bounded mailboxes; callbacks execute without
holding native transport/registry locks.

For the first pipe-only harness, keep ordinary inbound delivery serial on its
own Python dispatch lane, matching current behavior. Do not quietly move all
legacy synchronous/async dispatch onto the application loop: current dispatch
uses `asyncio.run` for awaitables, which is incompatible with calling it directly
on an already-running loop. A later service adapter must explicitly schedule and
await domain coroutines on their owner loop.

Reply resolution must be independent of ordinary dispatch. A handler making a
nested outbound framework call must not prevent the reader from delivering its
response. Reserve a control/reply path separate from queued application requests.
Neither transport locks nor interpreter attachment may span blocking I/O waits.
PyO3 attachment, object lifetime and shutdown mechanics require a pinned-version
prototype on both Linux and Termux; this design does not assert ABI support.

## Values and identity

Decode MessagePack once in Rust; pass structural values through PyO3, not JSON or
another MessagePack blob. Preserve bytes versus strings, signed/unsigned integer
range, null, booleans, list/map structure and envelope defaults. Do not stringify
map keys or coerce unknown values. Existing accepted wire fixtures, invalid-value
fixtures and identity checks define parity before any schema tightening.

Python owns domain validation, document/project authority, drafts, migrations and
effects. Transport owns framing/type validity, request correlation and exact
worker/connection identity. Keep project generation, workspace, request ID,
correlation ID and operation ID unchanged. Never silently reroute a pending call
to a replacement worker or retry an uncertain mutation.

First remove the eager codec import from structural envelope consumers while
retaining the existing Python codec on the Python transport path. A future
native path should construct equivalent service values without importing that
codec. Replacing all msgspec Structs is a separate step, not a prerequisite for
testing the native I/O harness.

## Admission, cancellation and teardown

Prototype starting budgets, subject to measurements and approval: retain the
32 MiB wire-frame limit; bound each native application mailbox to 64 entries and
64 MiB of encoded-payload accounting, whichever is reached first. This is **not**
a total RSS bound: decoded Python objects can be larger. Account in-flight work
as well as queued work and bound nesting/container counts after parity review.
Control/reply admission needs an independent bounded reserve. These limits are
new prototype policy, not claims about the current Python queues.

- Reject excess new work explicitly before executing it. Never silently drop
  protocol chunks or accepted domain facts. A reply-path failure closes/fails the
  affected connection and pending calls rather than allowing an indefinite wait.
- Keep existing request timeout semantics in parity mode. An end-to-end deadline
  including admission/write would be an explicit later behavior change.
- Cancellation before execution may release queued admission. After execution or
  send, detach the waiter and fence late results; cancellation is not rollback.
- EOF, corrupt framing or byte-subscription gaps fence new admission and fail
  pending calls. Do not resynchronize by guessing a MessagePack boundary.
- Teardown stops producers, closes admission, cancels owned tasks, releases
  waiters, drains or rejects retained work explicitly, and joins native/Python
  owners before interpreter shutdown. Do not promise to kill an arbitrary
  blocked Python handler safely; a bounded shutdown failure belongs to the
  isolated worker process and its existing supervisor policy.

## Proof sequence

Keep the prototype in a small independent internal crate, outside the production
TE2 Cargo/build/release workflow. Test locally, commit/push, then pull and compile/
run the isolated harness on the Pixel. Integration with the main build is a later
gate, after results and user acceptance; do not replace the live framework.

1. Separate structural pipe DTO imports from codec imports, preserving public
   import names and all existing wire/error fixtures. No native runtime yet.
2. Approve an isolated Rust/PyO3 pipe harness with a tiny test service. Cover
   nested requests, duplicate/late replies, callback order, overload, shutdown,
   corruption and identity replacement; do not launch live Code TE2.
3. Validate interpreter discovery, CPython ABI and packaging on Linux and Termux.
   Keep the harness separate from normal manifests until parity is established.
4. Audit/adapt one real socket service to the existing Python owner loop, then
   add worker-local Axum/Socketioxide transport. No browser/WBA lane migration.
5. Remove Python networking imports only after all remaining server/client uses
   are accounted for, especially the run-profile FWS bridge. Measure full worker
   startup including native/interpreter initialization and first useful document.

WBA/FWS live-handle ownership remains a separate gate. Ferrous API availability
does not grant a new process access to another manager's existing child handles.
