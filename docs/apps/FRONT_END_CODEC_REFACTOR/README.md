# Frontend Codec And Transport Refactor Tracker

## Status

- Planning and source audit: in progress
- Implementation: Phase 1 complete and live-validated
- Initial application scope: `app/apps/file_editor_cm6`
- First migration target: Explorer frontend/backend communication
- Second migration target: editor frontend/Python communication
- Separate later target: direct editor/WBA language-intelligence traffic

Current checkpoint: Code TE2 `0.2.297` opts the Explorer namespace into strict
`msgpack-v1` over Socket.IO. The shared frontend transport remains
codec-injectable so UI IPC keeps its existing object/JSON behavior. Python uses
the shared `frontend_rpc_codec.py` boundary, and default-off stdout codec metrics
are available through `FILE_EDITOR_CM6_RPC_CODEC_METRICS=1`. No Explorer JSON
fallback is implemented. Live Explorer request, notification, file-operation,
search, and reconnect behavior has been validated against the running app.

## Goal

Move Code TE2 frontend communication toward versioned binary MessagePack
contracts while preserving backend authority, explicit UI-domain ownership, and
the broadcast behavior that is genuinely useful.

The performance targets are high-volume or latency-sensitive paths such as:

- streamed search results
- editor/WBA language intelligence
- large diagnostics and state projections
- document, draft, and edit payloads where serialization size is material

Opening a directory is not itself a performance target. Directory listing is an
early codec target because it is a bounded, well-understood request/reply path,
not because directory expansion needs a dedicated transport.

## End State

The desired end state is:

1. Frontend application envelopes use a versioned MessagePack codec.
2. Python uses `msgspec` for MessagePack encoding, decoding, and envelope
   validation.
3. TypeScript owns matching wire types and one reusable codec boundary.
4. Worker-owned Socket.IO namespaces share one canonical physical Engine.IO
   mount where they run in the same JavaScript realm.
5. Socket.IO rooms remain available for project-scoped and multi-client facts.
6. Personal request/reply and personal stream traffic is never broadcast merely
   because it shares a namespace with broadcast traffic.
7. A dedicated raw WebSocket is introduced only for a measured hot stream that
   benefits from independent backpressure or lower framing overhead.
8. Language-intelligence transport is assessed independently from editor/Python
   RPC because the editor talks directly to WBA for that work.
9. Decoded protocol tracing remains available without requiring JSON on the
   live wire.
10. Rust remains a protocol-agnostic proxy until a measured reason exists to
    move codec or routing ownership into Rust.

## Terminology

- **Physical transport**: one HTTP long-polling, WebSocket, or WebTransport
  connection.
- **Engine.IO path**: the HTTP/WebSocket mount used to establish a Socket.IO
  Manager connection.
- **Namespace**: a logical Socket.IO lane multiplexed by Socket.IO over an
  Engine.IO connection when the clients use the same Manager.
- **Room**: a server-owned Socket.IO subscriber group used for targeted fanout.
- **Codec**: the application-envelope serializer, initially JSON object encoding
  and later MessagePack bytes.
- **Personal traffic**: a response or stream intended only for the initiating
  client/session.
- **Project traffic**: a backend fact relevant to all clients currently
  rendering the same project.
- **Hot lane**: latency-sensitive or high-volume traffic that may justify an
  independently managed transport and backpressure boundary.

## Source-Backed Current Topology

### Worker Socket.IO server

`socketio_gateway.py` creates one Python `AsyncServer` and registers:

- `/rpc/editor`
- `/rpc/explorer`
- `/ui_ipc`
- `/sidebar_ipc`
- `/terminal`

WBA is a separate Node-owned Socket.IO server and owns `/wba`.

### Physical mount paths

The Rust service proxy maps these public aliases to the same Python app-worker
Socket.IO ASGI service:

- `/editor_ws/socket.io`
- `/explorer_ws/socket.io`
- `/ui_ipc_ws/socket.io`
- `/terminal_ws/socket.io`

Although the upstream server is shared, the browser clients currently configure
different Engine.IO `path` values. Socket.IO includes that path in its Manager
cache identity, so these aliases create separate physical Manager connections
instead of multiplexing the namespaces over one connection.

This can be improved without removing Socket.IO: point worker-owned namespaces
at one canonical public path and retain the existing logical namespaces.

### Rust proxy

The Rust WebSocket bridge forwards text, binary, ping/pong, and close frames
without interpreting Socket.IO. MessagePack binary frames do not require a new
Rust proxy protocol.

### Existing Python codec support

`msgspec` is already a runtime dependency. `socketio_jsonrpc.py` already uses a
`msgspec.Struct` and `msgspec.convert` to validate incoming RPC envelopes after
Socket.IO has decoded the JSON representation.

The first codec migration therefore changes the serialization boundary. It does
not require rewriting Explorer or editor dispatchers.

### Active transport behavior

The current frontend clients explicitly request WebSocket transport. HTTP
long-polling and transport upgrade remain supported by the server/proxy surface,
but are not the active Code TE2 frontend path.

## Current Traffic Classification

| Message family | Current scope | Desired ownership | Initial transport direction |
| --- | --- | --- | --- |
| Explorer directory list request/reply | Personal | Initiating Explorer session | MessagePack over Socket.IO |
| Explorer bootstrap listings | Personal | Connecting Explorer session | MessagePack over Socket.IO |
| Search start/cancel/more requests | Personal | Initiating Explorer session | MessagePack over Socket.IO first |
| Search progress/results/done/error | Personal stream | Initiating search session | Benchmark for dedicated binary stream |
| Watcher file changes | Project | Backend project fact/projector | Socket.IO project room |
| Git status and decorations | Project | Backend project fact/projector | Socket.IO project room |
| Diagnostics projection | Project | Backend project fact/projector | Socket.IO project room |
| Draft/review decorations | Project | Backend project fact/projector | Socket.IO project room |
| Active file/open state | Project | Backend open-state authority | Socket.IO project room |
| Explorer preferences/bootstrap state | Personal or app-global | Backend-owned snapshot/fact | Socket.IO, scope explicitly |
| File create/move/delete effects | Project fact after mutation | Backend filesystem fact/projector | Request personally; broadcast resulting fact |
| Editor/Python commands and snapshots | Personal or editor room | Editor backend contract | MessagePack over Socket.IO after Explorer |
| Editor document/draft/edit projections | Multi-client when shared | Backend/editor projector | Retain room/fanout behavior |
| Editor/WBA language features | Personal hot lane | Direct editor/WBA contract | Separate audit; do not route through Python |
| Terminal stream | Personal hot stream | Terminal backend | Out of initial scope |

## Confirmed Scoping Facts

### Search is already personal

Each `ExplorerDispatcher` creates its own `ExplorerSearchSessions` service. The
search service receives an `emit_personal` callback bound to that Explorer
connection. Search job progress and result notifications are not intentionally
project-broadcast.

The transport refactor must preserve that ownership and make it easier to prove
in tests and metrics.

### Directory listing is already personal

`explorer.list` builds one directory listing and replies through
`emit_personal`. Mutations are different: after a create, move, rename, or
delete, the backend publishes the affected-directory fact so every client
rendering that project can reconcile.

That split is correct:

```text
read/list intent -> personal response
filesystem mutation -> authoritative state change -> project projection
```

### Not every Explorer action should be mirrored

The target is not an Explorer where all frontend intent is mirrored to all
clients. The target is an Explorer where backend facts with shared meaning are
projected to the clients that need them.

Requests, cursors, transient search state, modal state, and directory-read
responses remain personal unless a concrete shared-state contract says
otherwise.

## Codec Direction

### Initial envelope

Retain the current request, success, error, and notification semantics during
the codec cutover. Encode map-like envelopes first so field names remain visible
after decoding and schema evolution remains straightforward.

Conceptual request:

```text
{
  version: 1,
  id: "explorer_...",
  method: "explorer.list",
  params: {...}
}
```

Conceptual notification:

```text
{
  version: 1,
  method: "search.job.result",
  params: {...}
}
```

The first implementation may preserve the current `jsonrpc: "2.0"` field to
reduce migration risk, but MessagePack encoding is not JSON-RPC on the wire.
After both sides are proven, rename generic `JsonRpc*` transport types to `Rpc*`
and replace the JSON-specific version marker with the Code TE2 codec version.

### Python boundary

- Reuse long-lived `msgspec.msgpack.Encoder` and `Decoder` instances.
- Decode bytes once at namespace ingress.
- Validate the envelope during decode/convert.
- Pass normalized typed values into the existing dispatcher.
- Encode once at result/notification egress.
- Do not make feature handlers aware of bytes or MessagePack.

### TypeScript boundary

- Add one reusable MessagePack codec module.
- Keep encode/decode at transport ingress and egress.
- Keep method-specific frontend code operating on typed objects.
- Make the shared Socket.IO RPC client codec-injectable so Explorer can opt in
  without silently migrating UI IPC.
- Reject malformed or unsupported envelopes before dispatching notifications.

### Socket.IO binary framing caveat

Sending a MessagePack `Uint8Array` as ordinary Socket.IO event data preserves
Socket.IO compatibility, acknowledgements, namespaces, rooms, and reconnect
behavior. It may still use Socket.IO binary attachment framing around the
application bytes.

Therefore MessagePack-over-Socket.IO is the compatibility-first baseline, not
an assumed final answer for every hot path.

## Codec Negotiation And Debugging

### Direction

Use connection authentication metadata to declare a versioned codec, for
example:

```text
rpcCodec: "msgpack-v1"
```

The backend validates the requested codec before sending namespace bootstrap
notifications. Unsupported or stale clients receive a clear connection error.

### JSON fallback

Explorer does not retain a JSON fallback. It requires `msgpack-v1` during
namespace authentication. The shared transport's identity/object codec remains
only because UI IPC has not entered this migration yet.

Do not introduce mixed per-client JSON and MessagePack operation as a debugging
feature. Mixed codecs complicate project-room broadcasts because every payload
must be encoded per subscriber or per codec room.

### Debug tracing

Binary wire data does not remove observability. Add opt-in decoded tracing at
the codec boundary rather than retaining JSON for inspection.

Proposed trace fields:

- direction
- namespace/lane
- codec version
- method
- request/correlation ID
- encoded byte count
- encode/decode duration
- request latency
- result/error disposition
- malformed-frame count

The implemented first-slice flag is:

```text
FILE_EDITOR_CM6_RPC_CODEC_METRICS=1
```

It emits one JSON record per Explorer encode/decode operation to stdout and is
declared as `0` in the app-worker shellspec by default.

Frontend debug builds may expose a decoder helper for console eval, such as a
debug-only `window.__te2RpcCodec.decode(...)` surface. Payload content logging
should be separately gated from metadata logging.

## Socket.IO Topology Direction

### Keep logical namespaces

Logical namespaces continue to express UI-domain ownership:

- editor
- Explorer
- UI IPC
- Sidebar IPC
- terminal

They are useful routing and lifecycle boundaries even when all use MessagePack.

### Consolidate the worker-owned physical path

Use one canonical public Engine.IO path for Python worker namespaces. Preserve
old aliases only for a bounded cutover if required by asset-version skew, then
remove them.

Expected result in one JavaScript realm:

```text
one Socket.IO Manager / physical WebSocket
  -> /rpc/editor
  -> /rpc/explorer
  -> /ui_ipc
  -> /terminal
```

Sidebar windows in different browser/iframe realms cannot share an in-memory
Socket.IO Manager with the host realm. WBA also remains physically separate
because it is a different upstream service.

### Do not recreate namespaces prematurely

Replacing Socket.IO with one generic raw WebSocket would require Code TE2 to own
at least:

- lane/type identifiers
- request correlation
- notification routing
- reconnect policy
- heartbeat/liveness
- subscription and fanout groups
- backpressure policy
- cancellation
- connection bootstrap and replay
- protocol/version negotiation

That can be justified for a measured hot path, but not as an automatic result
of adopting MessagePack.

## Raw WebSocket Candidate Policy

A message family may move to a dedicated raw binary WebSocket when measurements
show one or more of these conditions:

- Socket.IO framing is a material part of end-to-end latency.
- The stream produces enough traffic to interfere with control-plane messages.
- Independent backpressure or cancellation is valuable.
- The traffic is personal and does not use rooms or broadcast fanout.
- Its lifecycle can be expressed with a small domain-specific contract without
  rebuilding a general Socket.IO replacement.

A separate hot-lane socket is not inherently wasteful. It may intentionally
isolate ordered, high-volume traffic from control and broadcast traffic.

## Search Direction

Search is the first raw-WebSocket candidate, but not the first implementation
step.

Sequence:

1. Establish baseline search transport and render measurements.
2. Move Explorer envelopes to MessagePack over Socket.IO.
3. Measure again with representative name, content, change, and large-result
   searches.
4. Identify time spent in backend search, pipe delivery, Python projection,
   encoding, Socket.IO framing, frontend decoding, queuing, and rendering.
5. Prototype a dedicated MessagePack WebSocket only if Socket.IO/framing or
   shared-lane backpressure remains material.

A dedicated search stream should remain personal and use explicit
`searchId`/correlation ownership. It must not become a second project-state bus.

## Directory Tree Direction

Directory listing is an early codec proving path, not an early raw-WebSocket
target.

Keep `explorer.list` as a personal request/reply operation. Keep mutation-driven
directory reconciliation as backend facts projected to project clients.

Reconsider the transport only if measurements show a meaningful problem after
MessagePack and physical-path consolidation.

## Editor Direction

### Editor/Python RPC

After Explorer proves the codec:

- encode editor/Python requests and notifications with the same versioned
  MessagePack envelope
- preserve request correlation and timeout behavior
- preserve editor room broadcasts where multiple clients need state
- keep document/model code unaware of serialization
- benchmark large snapshots, diagnostics, draft diffs, and edit projections

### Editor/WBA language intelligence

Language intelligence is a separate direct editor-to-WBA lane. Migrating the
editor/Python namespace does not optimize hover, completion, symbols, semantic
tokens, inlay hints, or other WBA requests.

The WBA audit must measure:

- frontend encode/decode
- Socket.IO packet/framing overhead
- Node adapter dispatch
- code-server/ext-host round-trip
- payload size and result shaping
- queueing and concurrency behavior

Possible WBA outcomes include keeping Socket.IO, using its custom parser,
placing MessagePack bytes inside existing events, or introducing a dedicated
binary language-feature WebSocket. No outcome is selected before measurement.

## HTTP Long-Polling And Upgrade Policy

Current Code TE2 clients request WebSocket directly. Preserve that behavior
during codec and path migration.

Do not add polling-first connection establishment merely because Socket.IO
supports it. Polling adds request/header overhead and is unnecessary in the
controlled TE2/Android environments unless a supported deployment proves that
WebSocket cannot connect reliably.

Keep server/proxy polling support temporarily while topology changes are being
validated. Decide whether to remove it only after confirming every supported
client uses WebSocket successfully and no recovery path depends on polling.

## Performance And Observability Baseline

Record before/after measurements for representative payloads rather than relying
on serializer microbenchmarks alone.

Required metrics:

- logical payload bytes before encoding
- encoded bytes
- Socket.IO packet/frame count where observable
- encode and decode duration on both sides
- enqueue-to-handler latency
- handler/service duration
- time to first search result
- time to final search result
- frontend queue-to-render duration
- cancellation latency
- reconnect/bootstrap completion time
- malformed, unsupported-codec, and stale-version counts

Representative scenarios:

- root and nested directory listing
- Explorer reconnect/bootstrap with many open directories
- small name search
- large content search
- paged search-more and search-more-in-file
- diagnostics-heavy project
- large draft diff/editor snapshot
- concurrent Git/watcher broadcast during a search stream
- multiple clients on the same project

## Implementation Phases

### Phase 0: Baseline And Contract Inventory

- [ ] Capture current physical Socket.IO connection count by browser realm.
- [ ] Capture representative JSON payload sizes and request latency.
- [ ] Confirm search events remain initiating-session scoped under multiple
      clients.
- [ ] Confirm directory-list replies remain initiating-session scoped.
- [ ] Add or identify test fixtures for malformed envelopes and errors.
- [ ] Record WBA language-feature baseline separately.

Exit condition: current behavior and performance are reproducible before codec
changes.

### Phase 1: Explorer MessagePack Codec

- [x] Add the TypeScript MessagePack codec dependency/module.
- [x] Add reusable Python `msgspec` MessagePack encoders/decoders.
- [x] Make shared frontend RPC transport codec-injectable.
- [x] Opt only Explorer into `msgpack-v1`.
- [x] Decode Explorer request bytes before existing envelope dispatch.
- [x] Encode Explorer acknowledgements and notifications.
- [x] Preserve personal versus project emission scope.
- [x] Add codec/version negotiation at namespace connect.
- [x] Add decoded metadata tracing behind a flag.
- [x] Validate request, notification, error, reconnect, and malformed-frame paths.

Exit condition: Explorer uses MessagePack without changing feature semantics or
multi-client ownership.

### Phase 2: Canonical Worker Socket.IO Path

- [ ] Define one canonical public Engine.IO path for Python worker namespaces.
- [ ] Move editor, Explorer, UI IPC, and terminal clients to that path where
      applicable.
- [ ] Verify same-realm namespaces share one Socket.IO Manager/WebSocket.
- [ ] Verify different browser realms reconnect independently.
- [ ] Verify per-namespace auth, connect bootstrap, and disconnect cleanup.
- [ ] Remove obsolete public path aliases after the bounded cutover.

Exit condition: logical namespaces remain separate while redundant same-realm
physical connections are removed.

### Phase 3: Search Transport Decision

- [ ] Re-run search benchmarks after Phases 1 and 2.
- [ ] Attribute latency across service, pipe, Python, codec, transport, and render
      stages.
- [ ] Test concurrent broadcast traffic during large searches.
- [ ] Decide whether Socket.IO remains adequate.
- [ ] If justified, prototype one dedicated personal MessagePack search stream.
- [ ] Compare frame count, latency, cancellation, reconnect, and implementation
      complexity.
- [ ] Keep only the measured winner; do not retain duplicate production paths.

Exit condition: search transport is selected from evidence and has one
authoritative production path.

### Phase 4: Editor/Python MessagePack Codec

- [ ] Reuse the Explorer-proven codec and version contract.
- [ ] Encode editor/Python requests, responses, and notifications.
- [ ] Preserve room-scoped editor projections.
- [ ] Validate save, open, draft, diagnostics, edit, and reconnect flows.
- [ ] Benchmark large editor payloads and normal low-volume commands.
- [ ] Remove editor JSON application envelopes after validation.

Exit condition: editor/Python communication uses the versioned binary codec with
no behavior regression.

### Phase 5: WBA Language-Intelligence Audit

- [ ] Measure representative hover, completion, symbols, semantic tokens, inlay
      hints, and diagnostics flows.
- [ ] Separate code-server/ext-host latency from transport overhead.
- [ ] Evaluate MessagePack within Socket.IO versus an alternative parser or raw
      binary lane.
- [ ] Preserve direct editor/WBA ownership and avoid routing the hot path through
      Python or the worker event bus.
- [ ] Implement only the evidence-backed transport change.

Exit condition: language-intelligence transport has measured latency ownership
and a deliberate codec/transport contract.

### Phase 6: Cleanup And JSON Retirement

- [ ] Remove temporary JSON codec fallback.
- [ ] Rename generic transport types away from `JsonRpc*` where the wire is no
      longer JSON-RPC.
- [ ] Remove stale path aliases and compatibility handlers.
- [ ] Keep protocol-version rejection and decoded debug tracing.
- [ ] Update active architecture documentation and `.repo_memory.md` with the
      implemented end state.

Exit condition: one supported codec per migrated lane, no stale compatibility
surface, and durable source-aligned documentation.

## Decision Log

| Decision | Status | Rationale |
| --- | --- | --- |
| Use MessagePack for frontend application envelopes | Direction accepted | Binary codec, existing `msgspec`, typed validation |
| Start with Explorer | Direction accepted | Bounded personal requests plus project notifications exercise both scopes |
| Preserve Socket.IO initially | Direction accepted | Keeps acknowledgements, reconnect, rooms, and namespaces during codec cutover |
| Keep directory listing personal | Confirmed current behavior | It is a read response, not shared project state |
| Keep mutation effects project-scoped | Confirmed direction | Backend facts must reconcile all project clients |
| Treat search as personal | Confirmed current behavior | Search sessions are dispatcher/connection owned |
| Give search a dedicated raw socket | Open, measurement gated | Potential hot-stream and backpressure benefit |
| Consolidate worker Engine.IO paths | Planned | Current aliases prevent Manager reuse across namespaces |
| Keep clients WebSocket-only | Current direction | Controlled environment; avoids polling overhead |
| Remove server polling support | Open | Requires supported-client verification |
| Migrate editor/Python after Explorer | Planned | Reuse proven codec without risking editor first |
| Optimize WBA with editor/Python migration | Rejected assumption | WBA is a separate direct lane |
| Permanent mixed JSON/MessagePack clients | Not recommended | Complicates broadcast encoding and contract ownership |
| Preserve decoded protocol tracing | Planned | Binary wire format must remain observable |

## Risks

- Socket.IO binary attachment framing may reduce expected MessagePack gains for
  small messages.
- Mixed codec clients can complicate broadcasts during rollout.
- Consolidating physical paths changes Manager sharing and may expose namespace
  connection-order assumptions.
- One shared physical connection can create ordered-delivery contention between
  a hot stream and control traffic.
- A dedicated raw socket can become a second general-purpose protocol if its
  scope is not held to one measured domain.
- MessagePack extension types can create cross-language coupling; avoid them in
  the first codec version.
- Logging decoded payload content can expose file contents; metadata tracing and
  content tracing must be separately gated.

## Non-Goals

- Making directory expansion a benchmark-driven hot path.
- Routing editor keystrokes, model sync, terminal streaming, or WBA language
  requests through the worker event bus.
- Replacing every Socket.IO namespace with a separate raw WebSocket mount.
- Building a general Socket.IO replacement before a measured need exists.
- Moving frontend codec ownership into the Rust proxy during the first phases.
- Keeping two permanent production codecs for convenience.

## Reassessment Points

Reassess architecture after:

1. Explorer MessagePack is running with metrics.
2. Worker namespaces share the canonical physical path.
3. Search is benchmarked under concurrent project broadcasts.
4. Editor/Python MessagePack is proven.
5. WBA language-feature latency is decomposed by stage.

At each point, update this tracker with measured results and either advance or
close the corresponding raw-transport proposal.
