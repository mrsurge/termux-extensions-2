# FWS Structured Log Inspection Supplement

## Purpose

This note records what the current TE2 implementation has already proven, which follow-up capabilities were executed on the TE2 side, and which upstream improvements still matter for mixed-format shells.

It is a supplement to `docs/planning/FWS_STRUCTURED_LOG_INSPECTION.md`, not a replacement for it.

## Current State

The TE2-side implementation already proves a few important things:

1. JSON and JSON-RPC extraction are useful on real logs.
- `codex-app-server` output can already be parsed into:
  - JSON fragments
  - JSON-RPC classifications
  - method signatures such as `jsonrpc:method=item/completed`

2. The event-first model holds up.
- One raw line can carry multiple meaningful fragments.
- The inspector can preserve the raw event while annotating it with parsed structure.

3. Mixed-format shells are real.
- The workbench adapter is not a pure JSON-RPC log source.
- It emits plain prefixed telemetry such as:
  - `ipc_out`
  - `ipc_chunk`
- It can still carry structured payloads or JSON frames in some events.

So the design direction is still correct:
- generic
- event-first
- JSON/JSON-RPC-aware
- not app-specific

## What Current Testing Showed

### 1. Codex app-server

The current implementation fits JSON-RPC-heavy shells reasonably well.

It can already identify:
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `thread/tokenUsage/updated`
- `thread/status/changed`
- `turn/completed`

This is the strongest current proof that:
- JSON fragment extraction
- JSON-RPC classification
- signature counting

are worth keeping as first-class behavior.

### 2. Workbench adapter

The current implementation now fits prefix-heavy plain logs materially better.

Observed event families included:
- `ipc_out`
- `ipc_chunk`

What the TE2-side follow-up now fixes:
- stable plain prefixes are promoted into signatures such as:
  - `plain:ipc_chunk`
  - `plain:watcher`
- `summary.signature_counts` and `summary.top_signatures` now surface those plain event families directly
- minimal negative filters now exist for noisy event removal:
  - `exclude_query`
  - `exclude_signature`

What still remains imperfect:
- tail windows can still begin mid-line
- split-frame payloads are still a separate framing problem

This is not an argument for overfitting to the workbench adapter.
It is evidence that generic inspection for mixed-format shells needs a better plain-log event typing strategy.

## Implemented TE2-Side Follow-Ups

### 1. Clean Event Type Parsing And Counting

The TE2-side tool now has a cleaner, more directly usable event-type model.

For plain prefixed logs:
- the prefix is promoted into the event type and signature
- examples:
  - `plain:ipc_out`
  - `plain:ipc_chunk`

For JSON logs:
- preserve generic JSON fragment classification
- distinguish useful event-level types without inventing app semantics

For JSON-RPC logs:
- keep JSON-RPC first-class
- preserve request/notification/response/error classification
- keep method-based signatures and counts

The implemented result is:
- a user should be able to look at the returned counts and immediately see what the dominant event families are
- that count table should be usable for noise triage without manual raw-line archaeology

### 2. Exclusion Mechanism

The TE2-side tool now has a minimal negative filter surface.

Implemented:
- `exclude_query`
- `exclude_signature`

Why this matters:
- JSON-RPC shells often have delta spam
- plain shells often have chunk or heartbeat spam
- the current positive-only filter model is too weak when a single noisy event class dominates the event window

Examples of the intended use:
- exclude `jsonrpc:method=item/agentMessage/delta`
- exclude `plain:ipc_chunk`
- exclude a repeated raw-text family by query

This should stay narrow.
Do not add a large family of overlapping negative filters unless real usage proves they are needed.

## Mixed-Format Shell Guidance

The inspector should assume that a shell may emit:
- plain prefixed telemetry
- inline JSON fragments
- JSON-RPC payloads
- large lines mixing multiple structured fragments

That means:

1. One event may have multiple fragment lanes active.
- for example:
  - plain prefix
  - JSON object
  - JSON-RPC classification on top of that JSON object

2. JSON extraction is still valuable on plain-heavy shells.
- a shell does not need to be globally “a JSON shell” for object extraction to matter
- any line that carries embedded JSON should still benefit from generic fragment parsing

3. Prefix-heavy shells need a stronger plain-log event type model.
- the prefix is often the best generic event category available

4. Split-frame payloads are still a separate problem.
- if a structured payload is broken across multiple chunk events, fragment extraction on a single line is not enough
- that is a framing or reassembly problem, not a reason to drop object extraction

## Boundary Fidelity Still Matters

The current TE2 implementation still shows why upstream boundary metadata matters.

Observed issue:
- a tailed line can begin mid-event

That weakens all downstream interpretation, including:
- prefix typing
- JSON extraction
- event counts

So these remain important upstream asks:
- `partial_head`
- byte offsets
- explicit event-window metadata

Without that, mixed-format inspection will always have avoidable ambiguity at the edge of a returned tail window.

## Remaining Upstream Value

The upstream FWS implementation is already complete for the agreed V1 scope, but two further upstream improvements would still make the architecture cleaner:

1. plain-prefix signature promotion
2. minimal exclusions

Those belong upstream architecturally because they are generic inspection concerns, not TE2-specific semantics.

The current useful user-facing workflow is:

1. inspect a shell
2. see event types and counts
3. identify dominant noise classes
4. exclude the noisy class
5. inspect the remaining meaningful events

That workflow needs both:
- clean event-type counting
- exclusions

The TE2-side implementation now provides both. Upstream promotion would remove the need for this downstream patchwork.

## Escape Hatch Status

The programmable probe or heredoc-style escape hatch is still a design idea only.

Current status:
- documented as a downstream TE2-side concept
- not implemented as a live tool
- not tested end-to-end

So the current answer is:
- no, it has not been tested yet

The important separation remains:
- the primary inspection surface should stay small and generic
- the programmable probe remains a downstream fallback for cases the primary tool cannot express cleanly

## Scope Discipline

These follow-ups should not change the core discipline:

- do not overfit to `codex-app-server`
- do not overfit to the workbench adapter
- do not add app-specific finders
- do not explode the tool surface into many specialized variants

The intended shape is still:

1. one primary structured inspection tool
2. one small set of generic filters
3. one count-oriented event-type summary
4. one optional programmable fallback later

That is enough to improve real usage without creating cockpit syndrome.
