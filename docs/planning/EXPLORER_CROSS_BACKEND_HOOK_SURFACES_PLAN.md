# Explorer cross-backend hook surfaces plan

## Problem

Some backend domains still publish Explorer-facing state changes by emitting onto the Explorer frontend transport directly. That coupling is temporary and should not become the long-term architecture.

The desired boundary is:

- backend domain A changes its own state
- backend domain A publishes a backend hook event with a JSON-shaped payload
- Explorer backend code subscribes to that hook surface
- Explorer backend code decides whether and how to emit an Explorer RPC notification
- only the Explorer frontend mutates Explorer UI state

This keeps domain ownership aligned with transport ownership and avoids using frontend namespaces as ad hoc backend-to-backend buses.

## Parked temporary lane

The following cross-backend traffic is intentionally parked for now and should be replaced later by backend hook surfaces instead of direct Explorer transport emits:

- editor/backend-originated Explorer sync notifications
  - active file updates
  - breadcrumb navigate/open-drawer requests
  - draft/autosave content propagation
  - editor preference change propagation
- diagnostics / watcher-originated Explorer sync notifications
  - diagnostics detail updates
  - watcher file-change updates
  - watcher error / ENOSPC updates

## Target architecture

Introduce an Explorer-owned backend hook surface that accepts JSON-shaped payloads but is not itself a frontend transport.

Suggested shape:

1. producer backend calls a typed Explorer hook publisher
2. publisher dispatches to Explorer backend subscribers in-process / worker-local
3. Explorer backend normalizes payloads into Explorer RPC notification methods
4. Explorer RPC transport emits only Explorer-owned notifications

## Rules for the future cut

- No backend function should notify another backend function through frontend transports.
- No non-Explorer backend module should mutate Explorer frontend state directly.
- The Explorer transport remains Explorer-owned.
- Cross-domain state sync must go through backend hook surfaces first, then Explorer RPC if Explorer chooses to notify its frontend.

## Out of scope for the current pass

- designing the final hook API shape
- migrating the parked temporary lane to that hook API
- collapsing namespaces across domains

The current Explorer cut should only make the Explorer-owned transport/path JSON-RPC-native and leave the parked cross-backend lane documented here for later follow-up.
