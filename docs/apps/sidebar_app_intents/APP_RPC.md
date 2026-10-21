# Owned app RPC over the framework pipe

## Scope and activation

The first 0.2.356 slice replaced backend CWD lookup and restore-state publication
for Terminal, File Explorer and File Editor. Stage B now wires ALS backend
file/project actions, CWD/state, review/draft calls and reverse mentions/facts to
the same conduit. Frontend sockets, terminal streams and console registrations
remain unchanged. Existing app intents and their operation owners remain available.

Activate matching framework and Code TE2 domain builds (new mypyc snapshot when
compiled), plus fresh ordinary app workers. Terminal/File Editor opt into existing
HTTP-plus-pipe worker mode; HTTP readiness stays unchanged. The initial slice
needed no frontend publication. ALS now needs its matching native binary and
caller-proof frontend, including a checkpointed vendored snapshot and native-client
OTA/reload; no APK mapping changes are introduced. Existing processes retain old imports. This is a
coordinated cutover, not a mixed-version socket fallback: missing exports, routes
or handlers reject without fallback/replay. Manifest policy is not proof that an
older running handler implements the advertised method.

## Relay contract

`app.libs.app_rpc.call_app_rpc` sends `app.rpc.call` on the owned framework pipe:

```json
{"targetApp":"code_te2","service":"sidebar","version":1,
 "method":"cwd.get","context":null,"payload":{}}
```

Receiver manifests declare `ipc.services.<service>` with exact `version`,
`callers` and `methods` lists. Missing declarations/wildcards do not admit calls.
Names are bounded ASCII addresses; at most 64 services and 64 entries per selected
list. Registry aliases resolve to canonical app IDs. The framework derives caller
app/shell from the owned route, checks both current worker incarnations and relays
`app.rpc.deliver` on that target's pipe:

```json
{"service":"sidebar","version":1,"method":"cwd.get",
 "context":null,"payload":{},
 "source":{"appId":"file_explorer","shellId":"framework-owned-shell"}}
```

Caller-supplied source is rejected. Context/payload are opaque **JSON-compatible
values inside the existing MessagePack envelope**, not arbitrary Python objects
or a new binary codec. Receiver backends own schema validation and execution.
The framework remaps correlation IDs, retains opId, and returns receiver results
and structured errors only through the originating pipe. No HTTP self-call,
Socket.IO client, new manager, durable queue or frontend authority is introduced.

Admission reuses 16 outstanding source/target slots and bounded pipe writers.
Defaults remain 64 KiB serialized request parameters, a 15-second receiver
deadline and 1 MiB serialized replies. A receiver may declare method-specific
`limits` inside its service export, without the broker knowing domain semantics:

```json
{"version":1,"callers":["example"],"methods":["read","commit"],
 "limits":{"commit":{"timeoutMs":180000}}}
```

The optional per-method fields are `requestBytes`, `replyBytes` and `timeoutMs`;
omitted fields retain defaults. Each byte limit must be 1 byte through 8 MiB, and
the deadline 1–180000 milliseconds. Limits may name only declared methods; unknown
fields, invalid values and caller-supplied limits reject. The 8 MiB ceiling is
below the existing 32 MiB pipe-frame ceiling; it is not an assertion that every
draft/review response fits. Selected ALS operation profiles are described below.

Each in-flight generic RPC reserves its actual serialized request size plus the
receiver's maximum reply size from **both** routes' shared 32 MiB allowances
(once for a self-call). Saturation rejects before delivery; cancellation, timeout,
disconnect and completion release reservations. These allowances bound admitted
serialized work, not exact RSS or arbitrary receiver result construction. Ordinary
control calls retain their defaults. ALS/Code TE2 manifests opt selected review
publish/file-edit requests and draft/review responses into 8 MiB limits and 60
seconds. Project open/create use 180 seconds. ALS local waits are 20/65/185 seconds
respectively; its project UI uses 190 seconds. These caps reject whole oversized
operations rather than claiming every arbitrary full model fits.

`app.rpc.route.get` is a read-only owned-route query using the same target/service/
version/method policy, with null context/payload. It returns available:false only
when both a managed running app and owned route are absent. A starting/stale or
closed managed route is an error, not standalone selection. An available route
does not prove semantic support in an independently installed older binary.

Disconnect, timeout, queue rejection or
oversized reply fails without replay; after dispatch, the outcome may be unknown.
Framework-task cancellation clears routing waiters, not accepted work. Cancelling
the Python await does not add a remote cancellation protocol; its existing pipe
wait may continue until reply/deadline. The compatibility helper keeps its outer
budget at least 20 seconds.

## Sidebar service version 1

Runtime-inspected file/project DTOs live in the already-interpreted
`ui_ipc/sidebar_rpc_contract.py`: SidebarCallerTarget, SidebarFileOpen and
SidebarProjectRequest. The host dispatcher remains compiled. Mypyc can erase
nullable runtime field annotations into `type`, which msgspec then enforces
incorrectly; import success and static typing alone do not qualify these DTOs.
Keep strict validation/unknown-field rejection and test actual compiled calls
with numeric coordinates and qualified presentation identity, including nulls.
The dispatcher's lazy Sidebar module import must initialize that exact module,
not depend on a previous CWD request warming mypyc's module reference. The real
codegen regression in `tests/test_mypyc_runtime_protocols.py` opens a file first.

- `cwd.get`: Terminal/File Explorer/ALS, empty payload, existing backend active-project
  CWD snapshot. No client focus lookup or project activation.
- `window.state.update`: four declared callers; updates an **existing** shared
  slot owned by the authenticated app. Supplied app/base URL/token aliases must
  agree with that slot. Closed/missing/cross-app slots reject. App backends still
  validate file/tab/shell state and construct URLs. The existing URL/ledger owner
  validates/canonicalizes and commits, followed by its normal global projection.

Nonempty presentation context and activation are rejected for these backend facts.
No fake Sidebar SID, changed client foreground/order/presentation or new slot.
Console names are observability, not authority. Foreground/open actions still use
their exact-presentation hooks. `call_sidebar_rpc` retains its Python interface
only as a migration adapter; its app_id argument cannot select source identity.

## ALS / mention delivery

Mentions enter the originating surface's own backend. Bind requested client to
its connection, then validate exact client/slot/presentation/qualified page proof.
Code TE2 resolves the conversation from backend Sidebar state. App identity is
not proof of which page/conversation requested the action.

Preserve existing fields: path, optional lineNo/endLineNo/col/endCol/content,
source and explicit conversation identity. Owner-typed validation, coordinate
units and ALS content formatting remain unchanged; no invented attachment API
or silently truncated identifiers at the broker. Pipe size limits and ALS's
existing content policy are distinct.

Standalone socket acknowledgement confirms emission, not ALS acceptance/insertion.
The pipe path returns the existing ALS owner's operation/conversation receipt and
queued outcome after its composer/draft path accepts the request.
Even that is not frontend-render acknowledgement. Require explicit conversation;
no global last-focus fallback or uncertain insertion retry.

Reverse ALS document/project actions retain originating client/presentation proof
and reuse Code TE2's hooks. Shared membership differs from per-client foreground.
ALS's pipe now binds the existing AppState/SocketIo owners before listener
readiness; the initial CWD call follows readiness flush. Code TE2 recognizes an
owned managed route without manufacturing a socket SID. Only absence selects
explicit standalone integration; failure after selection does not choose another
lane. Reverse review requests exclude their originating app; facts are best-effort
projections, not reasons to retry committed project mutations. Independent
ALS/TE2 installations must be upgraded together before live validation.

## ALS cutover design and implementation — 2026-10-21

The read-only survey confirms the existing ALS Sidebar socket is more than its
file-open/mention path. Implement the following as coordinated stages; do not
claim socket retirement after moving only the visible file-link feature. This
section records the approved source design; runtime transitions remain separate.

### Type and transport invariants

- No new TypeScript `any` or Python `Any`, implicit-any parameters, untyped
  containers or casts that merely assert a decoded payload is a DTO. Use concrete
  request/result/error DTOs and discriminated method/event variants. Boundary
  `unknown`/`object` values must be validated before domain access. Rust's existing
  JSON-compatible relay value stays opaque only at the generic transport layer;
  each operation decodes into its own typed shape before execution.
- Existing unrelated typing debt is not permission to add more. The user's
  separate laundry list remains independent; touched interfaces must not leak
  dynamic values through nominally typed signatures. Run strict TS/Python checks
  where applicable, plus Rust checking/tests; do not add suppressions to pass.
- Select transport once from explicit launch context: ALS `--stdio` uses its
  framework pipe for migrated backend integration, with **no socket fallback**
  on timeout, missing capability or disconnect. Standalone ALS retains its
  existing explicit socket integration. Never infer pipe ownership from a URL,
  console ID, port or environment hint alone. Do not send a mutation on both lanes.
- Preserve stdin/stdout MessagePack framing, stderr diagnostics, listener-before-
  readiness order and current EOF/shutdown semantics. This does not implement
  reconnectable UDS or promise that ALS currently survives a framework pipe EOF.

### Stage A — bounded bidirectional ALS pipe

Stage A was separately approved and implemented on 2026-10-21; this does not
itself authorize Stage B. Stage B was subsequently approved on 2026-10-21 for
semantic owner wiring, caller proof, bounded bulk/deadline policies and regression
builds; installation/restarts/pushes and new dependencies remain excluded.
The ALS client is installed before router startup, with typed
transport DTOs, bounded reader/async dispatcher/writer and close cleanup. Semantic
handler binding was dormant at the Stage A checkpoint. Stage B now binds the
semantic owner and advertises actual methods in both manifests. Source contract
and exact limits: sibling ALS `FRAMEWORK_STDIO.md`. Joint activation/live acceptance remain
pending; no running app was changed by test compilation.

Relevant ALS source: `rust/crates/als-server/src/framework_pipe.rs`, `lib.rs`,
`state.rs`, `http.rs`, and `sidebar_ipc/pipe.rs`. The original readiness-only
implementation has been replaced by correlated outbound calls and async dispatch.

1. Keep one owned reader/writer and add bounded outstanding request correlation,
   asynchronous handler admission and orderly close/timeout cleanup. The reader
   must continue taking replies while a handler awaits another app call; no
   synchronous request handler on the sole intake thread.
2. Install the pipe handle before HTTP startup CWD fetch (`http::build_router`
   currently starts that task), and bind inbound handlers to the actual ALS
   AppState/SocketIo owners before admitting service requests. Do not build a
   second composer, conversation store, client registry or HTTP self-call path.
3. Validate framework origin, target, operation/correlation and service/version;
   echo correlation/opId on all replies, including unsupported-method errors.
   Bound queues by count/bytes; block neither the async loop nor intake on stdout.
   Shutdown releases all pending waiters once, with no execution replay.
4. Declare exports in TE2's ALS wrapper manifest and Code TE2's manifest only for
   implemented handlers. Old peers fail explicitly. Manifest advertisement does
   not establish runtime method support; no fabricated Sidebar SID or implicit
   fallback to an independently connected socket.

### Stage B — semantic parity through existing owners

Approved implementation scope as above; semantic migration is implemented at
source, not an activated runtime claim. The first prerequisite was the receiver-owned
method limits and shared byte admission described under Relay contract.

Keep the same app frontend namespaces and own-backend user-intent flow. A small
typed ALS integration facade can retain callers while choosing the explicit
pipe/standalone transport. Share operation implementations, not transports.

| Direction | Existing operations/events to preserve | Owner or admission seam |
| --- | --- | --- |
| ALS → Code TE2 | `sidebar.file.open`, `sidebar.file.edit` | Exact-presentation document-open owner; existing agent file-edit tracking/navigation policy |
| ALS → Code TE2 | `sidebar.cwd.get`, `sidebar.window.state.update` | CWD snapshot and existing shared-slot ledger; no focus mutation through state publication |
| ALS → Code TE2 | `sidebar.project.lookup/open/create` | Existing project services, consent/save-mode guards and explicit originating-client context |
| ALS → Code TE2 | `sidebar.agentEdits.publish/clear/list/documentState.get/decide` where used | Existing stateless review/inline-agent document and decision owners; no echo loops |
| ALS MCP → Code TE2 | `sidebar.drafts.list`, `sidebar.draftState.get`, `sidebar.draft.clear` | Keep ALS authenticated `/ipc` admission and existing Code TE2 draft owner; no new draft store |
| Code TE2 → ALS | `sidebar.mention` | Existing exact client/slot/conversation routing, then ALS composer owner acceptance receipt |
| Code TE2 → ALS | `sidebar.cwd.set`, `sidebar.project.opened`, `sidebar.window.focused` | Existing host-UI/focus projections; focus is not fallback authority for mentions/file opens |
| Code TE2 → ALS | `sidebar.agentEdits.documentState.get`, `sidebar.agentEdits.decide` | Existing ALS document/decision handlers and publication back to Code TE2; preserve operation identity |

Source anchors: ALS `sidebar_ipc.rs`, `ui_rpc.rs`, `ipc.rs` and
`static/js/codex_agent/rpc/ui/client.ts`; TE2 `ui_ipc/sidebar_ws.py`,
`sidebar_mention_routing.py`, and `host/{project_backend,draft_state_backend,
agent_edit_review_backend}.py`. The table is a parity inventory, not permission to
broaden an authenticated MCP proxy's three-method draft allowlist.

Two source-backed seams must be addressed rather than copied into the new lane:

- ALS file.open already forwarded exact caller proof. Project open/create UI
  requests previously sent path/options only; they now reuse the same helper and
  forward proof through the existing frontend/own-backend boundary for validation
  at Code TE2. This is metadata on user intent, not frontend-owned routing or a
  new frontend transport. Project membership is shared; foreground is client-local.
- Code TE2's mention resolver and agent-review forwarding currently rely on
  registered Sidebar socket peers. Replace pipe-mode liveness/admission with
  actual broker route/export checks; retain standalone socket policy separately.
  Do not keep a dummy socket registration merely to satisfy these checks.

### Payload budgets and compatibility

The broker's default 64 KiB request/1 MiB reply control budgets cannot carry some
full draft/review models: draft state includes full content plus generated diff
and optional disk text, while review ledgers can contain several sources. Selected
methods therefore use the explicit 8 MiB ceilings above. Regression fixtures
exercise full UTF-8 text beyond 1 MiB and whole-request rejection before enqueue.
This is synthetic boundary qualification, not measured coverage of every user's
project. The existing 32 MiB physical pipe ceiling is unchanged; count/byte
admission and explicit whole-operation oversized errors remain. No model content
is truncated or limit globally removed; larger/paged model protocols are separate
work if real workloads exceed the chosen budget.

Keep normal CWD/state control defaults small. Project operations may await consent
or longer work: qualify their deadline/ack semantics rather than assuming the
control deadline means a failed mutation. Do not retry uncertain project actions.
Mention receipts retain the acceptance-versus-visible-insertion distinction above.

### Tests, publication and live gate

- Synthetic paired-pipe tests: fragmented/coalesced MessagePack, wrong origin/
  target/version/correlation, old unsupported handlers, simultaneous opposite-
  direction calls, saturation/byte limits, late replies, shutdown/cancellation.
- Owner regressions: exact two-client routing, stale/closed presentations,
  explicit conversation, queued/live mentions, project consent/guards, CWD/state
  restoration, agent-review round trips without echo, MCP draft access and denial.
- Full-model boundary fixtures for non-ASCII/large content and oversized failure;
  no partial data/mutation replay. Verify pipe mode never constructs a Sidebar
  socket and standalone mode still follows its supported socket integration.
- ALS Rust tests and frontend strict typecheck/build if caller proof changes;
  Code TE2 strict checks, focused Python/Rust regressions and affected frontend
  builds. Check the source diff for explicit/implicit any escapes.
- Activate matching framework, Code TE2 domain/mypyc and installed ALS native
  binary together; publish current ALS frontend snapshot/OTA if changed. Source
  edits or an old installed ALS wheel are not activation. No APK should be needed
  unless implementation identifies a genuinely new native route requirement.
- User live validation after the connected model is ready: multiple main pages,
  shared/independent ALS conversations, file opens in/outside project, project
  switches, mentions, drafts/review, reconnect and standalone behavior. Restarts,
  installation, publication, commits/pushes remain separately approved actions.
