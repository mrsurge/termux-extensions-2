# Explorer RPC Contract and Cutover Plan

## Intent

This document covers the transport and contract half of the Explorer ask:

1. make Explorer a real JSON-RPC surface
2. define typed request/result/notification shapes end to end
3. remove active ad hoc Explorer payload paths
4. keep the current namespace topology for now
5. use a phased cutover rather than a big-bang break

This is the document that ties the frontend and backend decomposition plans together.

## Current State Snapshot

The first Explorer RPC scaffold already exists:

- TS contract: `app/apps/file_editor_cm6/src/explorer/rpc/contract.ts`
- shared transport: `app/apps/file_editor_cm6/src/rpc/transport.ts`
- namespace constants: `app/apps/file_editor_cm6/src/rpc/namespaces.ts`
- Python contract: `app/apps/file_editor_cm6/explorer_rpc_contract.py`
- RPC namespace: `app/apps/file_editor_cm6/explorer_rpc_socketio.py`
- RPC notifier: `app/apps/file_editor_cm6/explorer_rpc_emit.py`
- namespace registration: `app/apps/file_editor_cm6/explorer_socketio.py`

The important correction from the user is already locked in:

- **do not delete namespaces yet**
- **do not do Socket.IO server consolidation first**
- **Explorer first means: RPC, then strict typing, then decomposition**

So this plan keeps both namespaces mounted:

- `/explorer`
- `/rpc/explorer`

for now.

## Non-Goals

- merging the Explorer, Editor, UI IPC, and Terminal servers right now
- removing `/explorer` in this document
- expanding this plan to the Editor namespace yet
- treating transport consolidation as the primary win

## Explorer RPC Contract Rules

1. Wire format is JSON-RPC 2.0.
2. Socket.IO request event is `rpc`.
3. Socket.IO server notification event is `rpc.notify`.
4. Method names are namespaced by concern, not by transport event name.
5. Requests, results, and notifications are typed in both TS and Python.
6. `unknown` / `object` is allowed only at the immediate parse boundary.
7. No new active Explorer feature work should introduce `explorer:event` payloads.
8. Legacy `/explorer` remains mounted only as a compatibility lane until an explicit later removal plan.

## Explorer-Initiated Editor Open Ownership

Explorer-originated "open this file in the editor" belongs to the Explorer-to-host contract, not to the public Editor transport.

The target ownership is:

1. Explorer emits a typed request on `/rpc/explorer`.
2. The host resolves path and project context.
3. The host forwards the open internally over the private `/editor` lane.
4. The host awaits editor-open completion and then returns a typed Explorer RPC result.

The anti-pattern to remove is Explorer UI calling ad hoc host globals such as `window.appOpenFile(...)` / `window.appOpenFileRel(...)` that are thin wrappers around `editor_open_request`. That makes Explorer depend on Editor-lane details and recreates open/jump ordering bugs as scattered frontend sequences instead of one serialized host-owned operation.

`/editor` remains a private host<->editor transport. Explorer should not add new public behavior by reaching into that lane directly or by treating host globals over that lane as its public control surface.

## Capability Ownership vs Transport Ownership

One of the core cleanup goals is to stop confusing "the lane a thing currently travels on" with "the subsystem that should own that capability."

The current code still has some methods living under Explorer because Explorer was the first practical control surface, not because Explorer is the right long-term owner. That is tolerable as a staged cutover, but it should be treated as temporary containment rather than the target model.

The intended direction is:

1. **Explorer RPC** owns Explorer-model behavior: tree listing, expand/collapse state, file search, Explorer-specific actions, and Explorer-driven notifications.
2. **Domain APIs** own cross-feature capabilities such as editor open/reveal, watcher controls, agent mention flow, prefs updates, and asset vendoring.
3. **Host/backend control hooks** are the canonical ownership point for those domain APIs.
4. **Frontend-specific lanes** (Explorer UI lane, Editor lane, sidebar/UI IPC lanes) are transport adapters into those backend-owned capabilities, not the capability owner themselves.

This means the Explorer frontend should be the primary consumer of the actual Explorer bus. If another frontend needs "something that currently happens to live on Explorer," that is usually a signal that the capability belongs in a deeper IDE-control layer and should later be exposed through a more appropriate domain API.

`ui_ipc` / `sidebar_ipc` can still serve as an external control-plane bucket for cases that do not fit the core IDE domain model cleanly yet, but even there the transport should not redefine ownership. The transport is an access path; the backend capability remains the thing being modeled.

For this Explorer task, do **not** use that broader ownership discussion as a reason to move Explorer frontend behavior into host/sidebar modules. The immediate work is to decompose Explorer inward into `src/explorer/*.ts` files while keeping Explorer UI behavior owned by Explorer.

## Method Family Inventory

The current Explorer RPC contract already identifies the main method families:

### Tree / filesystem

- `explorer.list`
- `explorer.refresh`
- `explorer.file.create`
- `explorer.dir.create`
- `explorer.entry.rename`
- `explorer.entry.delete`
- `explorer.entry.copy`
- `explorer.entry.move`
- `explorer.entries.copy`
- `explorer.entries.move`
- `explorer.entries.delete`
- `explorer.openDirs.set`

### Git

- `explorer.git.status.get`
- `explorer.git.stage`
- `explorer.git.unstage`
- `explorer.git.stageAll`
- `explorer.git.unstageAll`
- `explorer.git.restore`
- `explorer.git.commit`
- `explorer.git.push`
- `explorer.git.pull`
- `explorer.git.reset`
- `explorer.git.init`
- `explorer.git.clone`
- `explorer.git.branches.list`
- `explorer.git.commits.list`
- `explorer.git.diffBase.set`

### Projects

- `explorer.project.open`
- `explorer.project.create`
- `explorer.project.list`
- `explorer.editor.open`

### Search / review

- `explorer.search.run`
- `explorer.review.list`
- `explorer.review.save`
- `explorer.review.discard`

### Watcher / prefs / misc

- `explorer.watcher.config.get`
- `explorer.watcher.mode.set`
- `explorer.watcher.limit.raise`
- `explorer.prefs.ui.update`
- `explorer.prefs.agentIcon.vendor`
- `explorer.mention.agent`
- `explorer.cm6.mirror`
- `explorer.pulse.alive`

### Extensions

- `explorer.extensions.list`
- `explorer.extensions.install`
- `explorer.extensions.uninstall`
- `explorer.extensions.toggle`
- `explorer.extensions.configure`
- `explorer.extensions.configSchema.get`
- `explorer.extensions.customSettings.get`
- `explorer.extensions.customSettings.set`
- `explorer.extensions.workspaceSettings.get`
- `explorer.extensions.workspaceSettings.set`
- `explorer.extensions.adapter.restart`

These families should stay, but the contract should be split into smaller files.

## Target RPC Contract File Layout

### Frontend

```text
app/apps/file_editor_cm6/src/explorer/rpc/
  contract.ts
  methods.ts
  notifications.ts
  requests.ts
  responses.ts
  parsers.ts
  client.ts
```

### Backend

```text
app/apps/file_editor_cm6/explorer/contracts/
  requests.py
  results.py
  notifications.py
  errors.py
```

The current single-file contract modules are an acceptable scaffold, but not the end state.

## Required Contract Types

The RPC cutover is incomplete unless these surfaces are explicit:

- request params per method family
- result types per method family
- notification payload types per notification family
- JSON-RPC error payload types
- typed request parser return objects
- typed notification parser return objects
- typed client wrapper return types

That means:

- no generic “payload object” flow once parsing is done
- no frontend call site guessing whether `result.payload` or `result.settings` exists
- no backend emitter guessing which notification shape the UI expects

## Cutover Strategy

### Phase 1 — Freeze the method vocabulary

Before more feature work lands, freeze the Explorer method and notification names.

Work:

- split the TS method and notification constants into smaller files
- split the Python contract helpers the same way
- document every method family and payload shape in code, not only in prose

Deliverable:

- one obvious source-of-truth contract family on each side

### Phase 2 — Convert all active frontend calls to typed RPC client wrappers

Goal:

- frontend code stops sending raw string methods from scattered call sites
- call sites use typed methods grouped by domain
- Explorer-originated file opens stop using `window.appOpenFile*` and instead use a typed `explorer.editor.open(...)` wrapper

Example target shape:

```ts
explorerRpc.git.commit(params)
explorerRpc.search.run(params)
explorerRpc.editor.open(params)
explorerRpc.extensions.list()
```

not:

```ts
request('explorer.git.commit', payload)
```

from every view file.

### Phase 3 — Convert all active backend producers to typed RPC notifications

Goal:

- any producer that notifies Explorer uses the typed notifier helper
- no active producer emits legacy `explorer:event` payloads for new code paths

This includes:

- diagnostics bridge
- watcher bridge
- editor-driven active-file updates
- project-open updates
- review / draft updates
- extension-related notifications

### Phase 4 — Make `/rpc/explorer` first-class instead of just a legacy adapter

Right now the RPC namespace still translates into the legacy dispatcher shape.

That is acceptable as a rollout scaffold, but not the end state.

Target:

1. RPC transport parses request envelopes
2. RPC router resolves method families directly
3. RPC handlers call the same typed backend domain handlers as the legacy lane
4. legacy translation becomes a thin fallback, not the core implementation

This phase explicitly includes Explorer-originated editor open:

- request enters through Explorer RPC
- host-side routing performs the private `/editor` work
- Explorer no longer needs to know about `editor_open_request`

### Phase 5 — Leave `/explorer` mounted but demote it to compatibility-only

At this phase:

- active frontend code uses `/rpc/explorer`
- active backend producers use RPC notifications
- `/explorer` remains mounted for compatibility only
- new Explorer feature work is forbidden from targeting the legacy payload path

This is the correct intermediate state for the user’s current direction.

### Phase 6 — Only later, decide whether to remove or keep the legacy namespace idle

That decision is explicitly outside this document’s execution scope.

For now the legacy namespace stays mounted.

## Relationship To Frontend and Backend Decomposition

The RPC plan does not replace the decomposition plans. It depends on them.

### Frontend dependency

The RPC client needs a real TS Explorer app tree so that:

- notification routing is not trapped inside `static/js/explorer.js`
- method wrappers live in `src/explorer/rpc/`
- feature modules consume typed result types

### Backend dependency

The RPC cutover needs backend package decomposition so that:

- request parsing, handler dispatch, and notification building are not all inside `explorer_ws.py`
- the RPC namespace can call typed handler modules directly
- notification producers can share one typed notifier

## Sequencing Across The Three Explorer Workstreams

The intended order is:

1. establish the RPC method/notification contract structure
2. move the frontend Explorer app into `src/explorer/`
3. split the backend into the `explorer/` package
4. change the RPC namespace from “legacy adapter” to “first-class route”
5. keep `/explorer` mounted as compatibility only

That preserves the user’s requested shape:

- real RPC first
- type-safe pieces
- decomposition on both sides
- no premature namespace deletion

## Exit Criteria

This RPC plan is complete only when all of the following are true:

1. all active Explorer frontend calls use typed RPC wrappers
2. all active Explorer backend notifications use the typed RPC notifier path
3. method, result, and notification types are explicit in both TS and Python
4. `/rpc/explorer` is a first-class route, not only a legacy message adapter
5. `/explorer` is still mounted but no longer needed by active Explorer code paths

## Background Reference

This Explorer-specific plan sits under the broader migration direction already captured in:

- `docs/planning/FILE_EDITOR_CM6_SOCKETIO_CONSOLIDATION_PLAN.md`

That broader doc stays useful as background. This document is the concrete Explorer contract execution plan.
