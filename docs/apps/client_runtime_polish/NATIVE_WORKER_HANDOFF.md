# Native editor-services worker: handoff design

## Branch implementation status

User approved the actual Code TE2 shellspec cutover rather than another fixture
slice. `framework/native_editor_worker` now builds `code-te2-worker`, a Hyper /
Socketioxide listener with a PyO3-hosted Python application loop. The real domain
handlers/lifecycle run unchanged behind native socket and pipe adapters. The
original pipe-only fixture executable remains for regression coverage.

See the [build and validation notes](../../../framework/native_editor_worker/README.md).
This is a source-checkout experiment, not integrated into wheel/release builds.
The listener cutover at `8e46ae91` has user-confirmed Pixel live acceptance. The Pixel
fixture build exposed the EOF race fixed in `638f62b8`; user waived its rerun.
No shared framework/worker restart was performed by the agent.

The following design records the wider target. Native HTTP/server transport and
frontend RPC payload codecs are implemented. The codec checkpoint `72e0b13b`
has user-confirmed Pixel build/run acceptance with no observed live errors.
Python retains domain-envelope validation. Remaining Python
Socket.IO clients, WBA codecs, disk I/O and startup benefits still need inventory
and measurement. Each subsequent slice requires its own live acceptance.

## Architectural destination and sequencing

The subsequent persistence byte slice installs Rust read/atomic-write methods
before domain startup for the three stores already using `persistence_io.py`.
JSON, locking/schema policy and other disk consumers remain Python-owned.
Interpreted tools retain a reference implementation; native failures never fall
back or retry. This slice requires separate Pixel live acceptance.

Follow PLAN.md §6, "Coherent end goal": Rust owns the dependency-heavy I/O
perimeter; Python retains domain policy/state behind a narrow PyO3 boundary.
Finish the native boundaries, remove displaced external imports, then compile
the connected local domain graph with mypyc. Prefer cohesive compilation units
where compatible; preserve interpreted parity and Linux/Termux ABI validation.

Keep msgspec for now. Its omission is a late gate after the native conversion
and mypyc stage, once all remaining codec/Struct/validation responsibilities have
tested replacements. Mypyc does not replace input validation. The current
rmpv-to-Python object conversion remains the baseline, not a demonstrated
performance optimum; optimizing that allocation path is not the next slice.

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
   The user subsequently approved switching the branch's real app shellspec;
   release/build integration remains separate until live parity is established.
4. Audit/adapt one real socket service to the existing Python owner loop, then
   add worker-local Hyper/Socketioxide transport. No browser/WBA lane migration.
5. Remove Python networking imports only after all remaining server/client uses
   are accounted for, especially the run-profile FWS bridge. Measure full worker
   startup including native/interpreter initialization and first useful document.

WBA/FWS live-handle ownership remains a separate gate. Ferrous API availability
does not grant a new process access to another manager's existing child handles.
