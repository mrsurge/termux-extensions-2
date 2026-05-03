# File Editor CM6 Typed JSON-RPC Migration Plan

> Superseded as the primary planning reference by `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.
>
> Keep this document as historical/background context for the earlier typed JSON-RPC framing. For current sequencing, target architecture, host/template decomposition goals, and the one-server same-namespaces direction, use the North Star doc.
>
> Main-page/template progress is tracked in `docs/planning/FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`. The old in-app agent harness referenced by some historical notes has been removed; the live sidebar surface is the shortcut lane plus `/sidebar_ipc`.

## Intent

This plan is **not** just about collapsing multiple Socket.IO servers into one path.

The real problem is that `file_editor_cm6` currently relies on ad hoc message shapes across the frontend and backend:

- flat event-name RPC
- free-form payload objects
- many `dict` / `Any` / implicit-any style boundaries
- large JavaScript surfaces that effectively treat transport payloads as untyped

If the messaging layer stayed ad hoc, transport consolidation alone would not solve the core issue.

The actual goal is:

1. make frontend↔backend messaging intentional
2. give each surface a real JSON-RPC contract
3. make the payloads typed end-to-end
4. reduce or eliminate raw `any` / untyped payload flow at the transport boundary
5. only then consolidate transport plumbing where it helps

This plan therefore reframes the work as a **phased typed JSON-RPC migration**, with Socket.IO consolidation as a supporting phase rather than the primary objective.

## Primary Goals

- replace ad hoc Socket.IO request/response patterns with explicit JSON-RPC 2.0 contracts
- define stable namespaces and method names instead of relying on event-name-per-command transport
- make transport parsing and envelope validation happen exactly once
- keep destination-facing handlers operating on stripped, typed payloads
- move new or migrated frontend transport code into TypeScript first
- make backend contract code explicit and typed so static analysis can warn on mismatches
- keep rollout incremental with compatibility shims so current UI continues to function during migration

## Non-Goals

- rewriting the entire frontend to TypeScript in one pass
- replacing all internal or frontend↔frontend lanes in the first phase
- merging app-worker transports with runtime-owned TE2 transports such as `/te2_console` or TE2 MCP
- changing SSOT behavior just to fit the transport migration
- performing a risky big-bang rename of every event at once

## Why This Matters

The current system makes it too easy for transport payloads to drift:

- field names are not centrally declared
- different call sites infer different shapes
- frontend code often receives generic objects and branches on string event names
- backend handlers frequently accept raw `dict` payloads and validate them inline

That makes it difficult to:

- enforce or even observe the real contract
- remove `any` from frontend transport code
- tighten Python typing around payload parsing
- trust refactors across modules

The target state is a transport layer that is **intentionally typed from end to end**.

## Current Typing Constraints

`file_editor_cm6` already has TypeScript infrastructure, but it is not yet enforcing strong typing across the current transport surfaces.

Current `tsconfig.json` state:

- `"strict": true`
- `"noImplicitAny": false`
- `"strictNullChecks": false`
- `"allowJs": true`
- `"checkJs": false`

Implications:

- TypeScript modules can already be added and checked
- existing JavaScript transport-heavy files are currently included but not type-checked as JS
- large JS surfaces such as explorer/editor frontend code still behave effectively like `any` at the contract boundary

On the Python side, transport handlers mostly parse raw payload dicts inline. The long-term target is to make those boundaries explicit enough that `basedpyright`-style analysis can warn on mismatches and incomplete handling.

## Reference Contract Model

The model to follow is the one documented in:

- [JSON_RPC_SOCKETIO_CONTRACT.md](/data/data/com.termux/files/home/downloads/agent_log_server/JSON_RPC_SOCKETIO_CONTRACT.md)

The important parts to copy are:

- stable namespaces by concern
- Socket.IO event `rpc` for requests / client notifications
- Socket.IO event `rpc.notify` for server notifications
- JSON-RPC 2.0 envelopes on the wire
- backend-side parser / builder helpers
- frontend-side shared transport helpers
- per-namespace contract modules
- phased rollout with compatibility shims beside the legacy lane

The important parts **not** to copy blindly are the specific conversation-domain method names. `file_editor_cm6` needs its own surface-specific contract vocabulary.

## Current `file_editor_cm6` Transport Topology

### Worker-owned Socket.IO servers

The current worker-side layout is:

- `app/apps/file_editor_cm6/monaco_editor/editor_socketio.py`
  - creates `EDITOR_SIO`
  - registers namespace `/editor`
- `app/apps/file_editor_cm6/explorer_socketio.py`
  - creates `EXPLORER_SIO`
  - registers namespace `/explorer`
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_socketio.py`
  - creates `UI_IPC_SIO`
  - registers namespaces `/ui_ipc` and `/sidebar_ipc`
  - sets `max_http_buffer_size = 8 * 1024 * 1024`
- `app/apps/file_editor_cm6/terminal_socketio.py`
  - creates `TERMINAL_SIO`
  - registers namespace `/terminal`
  - calls `attach_terminal_socketio_server(...)`

### Worker ASGI mounts

`app/apps/file_editor_cm6/main.py` mounts:

- `/editor_ws/socket.io`
- `/explorer_ws/socket.io`
- `/ui_ipc_ws/socket.io`
- `/terminal_ws/socket.io`

### Main-process websocket proxies

The main process currently duplicates almost the same websocket proxy logic in:

- `services/editor_transport.py`
- `services/explorer_transport.py`
- `services/ui_ipc_transport.py`
- `services/terminal_transport.py`

### Frontend connection points

Current client-side connection points include:

- host explorer in `main.js`
- host/editor-facing UI state via `/ui_ipc`-bridged host modules and remaining host entrypoint assembly
- UI IPC / sidebar IPC in `src/host/connections/ui-ipc.ts`
- inline editor runtime in `monaco_editor/m_editor_app.ts`
- terminal frontend in `static/js/terminal.js`

## Current Contract Maturity By Surface

### Explorer

Explorer is already close to a proto-contract:

- one request lane: `explorer_send`
- one notification / reply lane: `explorer:event`
- message shape: `{ type, payload, id? }`
- backend dispatch: `type -> handle_*`
- frontend router strips the transport once, then dispatches on `type`

That is not JSON-RPC yet, but it is structurally close.

### Editor

Editor is more complex.

The current `/editor` namespace mixes several concerns:

- SSOT snapshot and shared state broadcast
- host↔iframe relay
- file open / save / draft / diagnostics coordination
- workbench adapter request/response traffic

Some of that traffic is already RPC-shaped, especially the `editor_workbench_*` request/response slice, but the namespace as a whole is not one coherent contract yet.

### UI IPC / Sidebar IPC

UI IPC already demonstrates that multiple namespaces can live on one server, but it is not the first candidate for typed public contract migration.

### Terminal

Terminal is a later surface for this migration. It has its own protocol pressures and should not dictate the first typed-RPC pattern.

## Recommendation

### Migration order

Start with **Explorer first**, then **Editor workbench**, then the broader **Editor** namespace.

This recommendation is **not** based only on ease.

It is based on which surface gives the best first proving ground for typed transport discipline:

- Explorer is already structurally close to a routed contract
- Explorer lets us prove the parser / builder / router / compatibility pattern on a full surface
- Editor workbench is the next best slice because it is already request/response shaped
- The broader editor namespace should be decomposed only after we have proven the pattern on a simpler surface

### Socket.IO consolidation order

Do **not** make shared-path Socket.IO consolidation Phase 1 anymore.

Instead:

1. build typed JSON-RPC lanes and compatibility shims first
2. consolidate the shared Socket.IO path/server later, once the contract boundaries are clearer

Transport consolidation is still desirable, but it should follow the contract migration rather than lead it.

## Target Contract Model For `file_editor_cm6`

The long-term target is:

- one shared JSON-RPC transport utility on the frontend
- one backend JSON-RPC parser / builder pattern per surface
- stable namespaces by concern
- typed methods and typed notifications
- compatibility shims beside legacy namespaces during rollout

Likely namespace direction:

- `/rpc/explorer`
- `/rpc/editor`
- `/rpc/ui` or another UI-focused namespace if host/UI surface methods need their own lane

Open question:

- the editor workbench slice may either live under `/rpc/editor` with method families like `editor.workbench.openFile`, or under a narrower namespace if that separation proves cleaner

This plan intentionally leaves that second-level editor split open until the current ad hoc editor lanes are decomposed more carefully.

## Typing Rules For The Migration

### Frontend rules

- all new transport / contract / parser / router code should be written in TypeScript
- do **not** add new `any` in transport-facing code
- use `unknown` at the wire boundary, then parse/validate into explicit types
- once routing is complete, downstream feature code should receive stripped typed payloads, not raw envelopes
- JS consumers may remain temporarily, but only behind thin typed adapters

Practical implication:

- do not pretend large legacy JS files are already typed
- instead, move the transport edge and router into TS first
- then progressively shrink the untyped JS boundary

### Backend rules

- transport entry points should parse generic payloads once
- contract modules should expose typed parser/builders for requests, responses, and notifications
- method names and result shapes should be declared centrally
- downstream handlers should operate on typed parsed params instead of raw payload dicts when possible
- prefer `TypedDict`, `Literal`, small dataclasses, and explicit result/error builders over open-ended dict flow

### Error rules

- use JSON-RPC error envelopes on the new lanes
- include structured `error.data`
- do not invent parallel ad hoc error wrappers inside the new RPC namespaces

## Proposed Module Layout

### Frontend

Create a shared RPC layer modeled after the reference app:

- `app/apps/file_editor_cm6/src/rpc/namespaces.ts`
- `app/apps/file_editor_cm6/src/rpc/registry.ts`
- `app/apps/file_editor_cm6/src/rpc/transport.ts`

Then add per-surface contract modules:

- `app/apps/file_editor_cm6/src/rpc/explorer/contract.ts`
- `app/apps/file_editor_cm6/src/rpc/explorer/client.ts`
- `app/apps/file_editor_cm6/src/rpc/explorer/router.ts`
- `app/apps/file_editor_cm6/src/rpc/editor/contract.ts`
- `app/apps/file_editor_cm6/src/rpc/editor/client.ts`
- `app/apps/file_editor_cm6/src/rpc/editor/router.ts`

The current JS-heavy explorer/editor modules can call into those typed adapters during rollout.

### Backend

Add explicit backend contract helpers, for example:

- `app/apps/file_editor_cm6/explorer_rpc_contract.py`
- `app/apps/file_editor_cm6/editor_rpc_contract.py`

Those modules should own:

- JSON-RPC request parsing
- method validation
- params normalization
- success response builders
- error response builders
- notification method mapping when applicable

## Phased Rollout

### Phase 0: Shared RPC scaffolding

Build the common contract infrastructure first.

Deliverables:

- frontend `namespaces.ts`, `registry.ts`, `transport.ts`
- backend JSON-RPC parser / builder helpers
- compatibility policy for legacy lanes
- session or dev toggle for suppressing duplicate legacy handling when the RPC lane is active

Rules for this phase:

- no surface migration yet without shared transport helpers
- no new ad hoc request/response event patterns during the transition

### Phase 1: Explorer contract inventory

Inventory the current Explorer message space and give it intentional names.

Tasks:

- enumerate current request `type` values
- enumerate current notification / reply `type` values
- classify each one as:
  - request/response method
  - server notification
  - compatibility-only legacy event
- define dotted method names and typed params/results

Likely Explorer request families:

- explorer list/refresh/open dirs
- project open/create/list
- git actions
- search/review actions
- extension-management actions
- UI preferences updates where Explorer currently owns the request path

Likely Explorer notification families:

- explorer tree/list updates
- active file changes
- diagnostics detail updates
- git status / progress updates
- review entry updates
- project-opened / project-active updates

### Phase 2: Explorer JSON-RPC lane

Add `/rpc/explorer` beside legacy `/explorer`.

Deliverables:

- frontend Explorer RPC client and router
- backend Explorer RPC parser/dispatcher
- compatibility mirror from legacy Explorer messages to the new RPC lane
- typed normalized payloads passed into Explorer UI code

Important point:

the first win here is not “Explorer becomes TypeScript overnight.”

The first win is:

- the transport edge becomes intentional
- the parser strips the envelope once
- the UI receives typed normalized payloads instead of raw free-form transport blobs

### Phase 3: Explorer typing pass

Once the Explorer RPC lane exists, use it to shrink the JS `any` boundary.

Deliverables:

- move Explorer transport/routing logic into TS modules
- convert high-churn Explorer message handling helpers to TS where practical
- reduce reliance on untyped `type` + payload branching deep in UI code

Possible follow-up:

- enable stricter TS settings incrementally once the critical transport modules are off the JS path

This phase exists specifically because leaving the Explorer transport layer in unchecked JS defeats the purpose of the contract migration.

### Phase 4: Editor workbench sub-contract

Migrate the request/response workbench slice next.

Why this slice:

- it already has `request_id`
- it already acts like request/response
- it is the cleanest editor-side candidate for JSON-RPC ack responses

Current examples include:

- open file
- hover
- completions
- semantic tokens
- symbols
- folding ranges
- grammars list/load

Target direction:

- one editor RPC request event
- one typed response shape via ack
- typed notification lane where needed
- elimination of event-name-per-method for the migrated workbench methods

### Phase 5: Editor namespace decomposition

After the workbench lane is migrated, classify the rest of `/editor`.

The current editor namespace mixes:

- SSOT snapshot
- shared state broadcasts
- diagnostics readiness coordination
- host↔iframe relays
- workbench adapter calls

This phase should separate those concerns into intentional contract families:

- state snapshot / state notifications
- editor action requests
- workbench RPC
- compatibility-only relay traffic

Do not migrate the full editor namespace as though it is one thing when it is actually several overlapping sub-protocols.

### Phase 6: Shared transport consolidation

Once Explorer and at least part of Editor are using the same typed RPC transport utilities, revisit Socket.IO consolidation.

At that point, consolidate toward:

- one worker-owned Socket.IO server
- one worker ASGI mount path
- one main-process websocket proxy path
- namespaces preserved by concern

Possible shared path:

- `/cm6_ws/socket.io`

Legacy path aliases can remain temporarily during rollout.

At this point, consolidation becomes much safer because the contract boundaries are already explicit.

### Phase 7: Remaining surfaces

After Explorer and Editor establish the pattern:

- evaluate UI IPC / sidebar IPC
- evaluate terminal
- decide which lanes should become typed JSON-RPC and which should remain internal/private control planes

Not every Socket.IO surface must become a public-style RPC namespace in the same phase.

## Risks and Caveats

### Large JS surfaces are still a real risk

Even with TS infrastructure present, leaving major transport logic in unchecked JS keeps the effective type boundary weak.

### Editor is not one protocol

Treating `/editor` as one monolithic contract too early will hide important distinctions between:

- state sync
- UI relay
- workbench RPC

### Shared server settings still matter

If/when transport consolidation happens, preserve the current UI IPC max buffer requirement:

- `max_http_buffer_size = 8 * 1024 * 1024`

### Compatibility shims are mandatory

Do not cut over legacy event lanes in one jump. Mirror and suppress duplicates intentionally.

### Main-process ownership boundaries still matter

This migration should not accidentally move worker-lifetime app behavior into runtime-owned TE2 territory.

## Validation Plan

Implementation phases should validate both typing and behavior.

### Static validation

- `cd app/apps/file_editor_cm6 && npm run --silent typecheck`
- `cd app/apps/file_editor_cm6 && node build.mjs`
- `python -m py_compile` on touched Python modules

Typing goal:

- contract modules and transport modules should be annotation-clean enough that Python static analysis can warn on mismatches instead of silently accepting raw payload drift

### Smoke validation

Per repo policy, smokes should be run as separate commands, not chained before setup with `&&`.

Recommended smoke order by rollout:

1. migrate one lane
2. smoke that lane
3. build if needed
4. re-smoke if feasible

Surface checks should include:

- Explorer request/response flows
- Explorer live updates
- Editor workbench requests
- Editor state notifications
- cross-surface relays that depend on Explorer or Editor
- no duplicate UI handling when both legacy and RPC lanes are present

## Final Direction

The desired end state is:

- every important frontend↔backend surface communicates through an intentional typed RPC contract
- raw ad hoc payload blobs stop leaking through the app
- frontend transport code stops defaulting to `any`
- backend payload handling stops defaulting to open-ended `dict` flow
- Socket.IO remains the transport, but the contract becomes explicit, typed, and phased

That is the real point of this migration.
