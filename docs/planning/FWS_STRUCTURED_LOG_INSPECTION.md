# FWS Structured Log Inspection Plan

## Purpose

Framework-shell logs are line-oriented pipe output. A single logical event can be an extremely long line containing nested JSON objects, arrays, and protocol-shaped payloads such as JSON-RPC. The current fallback pattern for inspecting those logs is usually an ad hoc Python heredoc against raw log files.

This document defines a generic inspection surface intended to replace a large portion of that heredoc workflow with a reusable MCP tool and a stronger event data model.

JSON-RPC is the first important target because it is common and structurally rich, but the design must remain generic and stop at protocol-shape classification rather than app-specific interpretation.

## Problem

Current pain points:

- Framework-shells output is line-oriented, so one event can be a massive single line.
- Raw `tail` and `search` are useful for simple string queries but weak for object- or array-level inspection.
- Agents fall back to one-off Python heredocs that are:
  - inconsistent
  - hard to reuse
  - hard to compare across sessions
  - hard to expose through MCP in a stable way
- Searching by broad terms like `error` is noisy when logs contain normal envelopes such as `error: null`.
- One returned line may contain multiple meaningful structured fragments.
- Some logs are JSON or JSON-RPC; others are plain-text server logs with little or no structure.

## Goal

Provide a generic structured log inspection surface for framework-shell logs that can:

1. Search for structured fragments inside a single event line.
2. Search and classify event types across many lines.
3. Distinguish multiple objects, arrays, and fragments within one long line.
4. Return structured summaries instead of forcing raw heredoc parsing for common inspection tasks.
5. Stay extensible to multiple log formats without overfitting to any single producer.

## Non-Goals

Initial versions should not attempt to solve these completely:

- perfect reconstruction of truly multi-line logical events from plain line logs
- app-specific semantic extraction such as `userMessage` or `agentMessage` helpers baked into the tool contract
- replacing all raw log access or all heredoc workflows
- enforcing one canonical schema for every possible log source

The tool should reduce the need for heredocs, not outlaw them.

## FWS V1 Scope

The upstream V1 scope should stay disciplined.

The event model remains generic, but the first-class parser and classifier support should be limited to:

1. `plain`
2. `json`
3. `jsonrpc`

The intended rule is:

- `json` is the structural parser
- `jsonrpc` is a protocol classifier on top of parsed JSON
- neither one becomes an app-specific semantic layer

FWS V1 should include:

- one generic `inspect_logs(...)` surface
- boundary fidelity metadata
- raw event text plus parsed JSON fragments
- first-class JSON-RPC kinds and signatures
- one REST route
- optionally one CLI command

FWS V1 should explicitly defer:

- `logfmt`
- `http`
- `traceback`
- NDJSON or alternate framing
- deep object-path filters
- app- or workflow-specific helpers

## Core Data Model

The inspection model should be event-first.

Each returned record represents one raw framework-shell log event as received from the line-oriented log source.

Recommended record shape:

- `stream`
- `ordinal`
- `line_number` when available
- `raw_length`
- `text`
- `body`
- `prefix`
- `text_truncated`
- `formats_detected`
- `event_signature`
- `kinds`
- `fragments`
- `json_payloads`

Recommended fragment shape:

- `format`
- `start`
- `end`
- `summary`
- `parsed`
- `path_index` or equivalent future path metadata

Important rule:

- the raw event line remains primary
- parsed fragments are annotations on top of the raw event
- the tool should not pretend that one line always equals one semantic message

## Parser Lanes

The inspection surface should support parser lanes.

V1 lanes:

1. `plain`
- fallback when nothing more structured is detected

2. `json`
- balanced object/array extraction anywhere in the line
- detect and return multiple fragments from one event

3. `jsonrpc`
- generic JSON-RPC shape detection only
- examples:
  - `{"id":...,"method":...,"params":...}`
  - `{"id":...,"result":...}`
  - `{"id":...,"error":...}`
- this is protocol-aware classification, not app-specific semantics

First-class JSON-RPC classification in V1 should include:

- `jsonrpc:request`
- `jsonrpc:notification`
- `jsonrpc:response`
- `jsonrpc:error`

First-class JSON-RPC signatures in V1 should include:

- `jsonrpc:method=<name>`
- `jsonrpc:error`
- `jsonrpc:result`

Extensibility requirement:

- lanes must be additive
- adding a new lane should not require rewriting the event model
- future lanes could include logfmt, HTTP, traceback, syslog-ish forms, NDJSON, or custom framework emitters

## Query Surface

The inspection tool should provide generic query primitives, not app-specific finders.

### 1. Raw Event Search

- substring search
- regex search
- case-sensitive / case-insensitive modes
- stream filter

### 2. Structured Fragment Search

- format filter, such as `json` or `jsonrpc`
- signature filter, such as `jsonrpc:method=*`
- generic JSON-RPC classification should be directly filterable without requiring app-specific helpers

### 3. Event-Type / Signature Discovery

- list event signatures and counts
- examples:
  - `jsonrpc:method=item/completed`
  - `jsonrpc:error`
  - `jsonrpc:result`
  - `plain`

### 4. Multi-Fragment Search

- find events containing both an object and an array
- find events containing multiple JSON fragments

### 5. Long-Line Disambiguation

- summarize the structured fragments inside a long line
- prefer parsed payload summaries over clipped raw text

## Current TE2 MCP Direction

The current TE2 MCP implementation is a useful first step, but it must be understood as generic structured log inspection rather than a Codex RPC helper.

Current useful behaviors:

- parses and classifies long lines into generic `kinds`
- extracts JSON objects and arrays from within a line
- detects generic JSON-RPC shape
- returns a structured summary over matched events
- preserves raw text while annotating it with parsed structure

Current caveats:

- search is still raw-line first, structured second
- one large event line can still contain many logical messages packed into one JSON object
- some `tail` outputs can begin mid-line because the underlying tail source is line-window oriented rather than semantic-event oriented
- broad raw queries such as `error` remain noisy

These caveats are acceptable for v1 but should inform future improvements.

## Advisory Inspection Hints

An optional shell-level hint is reasonable as long as it stays advisory.

Recommended shape:

```yaml
inspect_hints:
  - json
  - jsonrpc
```

Rules:

- hints influence parser priority or default UX only
- hints do not override actual detection
- hints do not become required shell metadata
- hints do not smuggle app-specific semantics into shell records

This is a future-friendly addition, not a hard dependency for FWS V1.

## Why This Replaces Much of the Python-Heredoc Pattern

A good generic inspector replaces many heredoc cases because it can provide:

- deterministic returned structure
- reusable query primitives
- transport through MCP instead of ad hoc shell snippets
- consistent summaries for long/noisy logs
- safer handling of huge single-line events

Python heredocs should remain fallback for:

- highly custom one-off analysis
- experiments before the generic tool grows the needed parser lane
- exotic log formats not yet supported

## Programmable Escape Hatch

The inspection surface should keep one programmable escape hatch for cases where the generic parser lanes are not enough.

This should not replace the generic inspector. It should sit on top of it and operate on selected log data rather than on raw log files.

Recommended TE2-side shape:

- `te2_fws_log_probe`

Recommended inputs:

- `shell_id`
- `stream`
- `selector`
  - `tail`
  - `line_range`
  - `ordinal_range`
  - `query` with optional context window
- `language`
  - `python`
  - `javascript`
- `input_mode`
  - `raw_events`
  - `structured_records`
  - `both`
- `code`

Recommended execution model:

- select a log slice or event range from framework-shells
- pass the selected data into a Python or JavaScript runtime as in-memory objects
- return the result as tool output

Recommended runtime bindings:

- `records`
- `raw_events`
- `meta`

Recommended output shape:

- `result`
- `stdout`
- `stderr`
- `records_used`
- `truncated`
- `timing_ms`

Important rules:

- this is an escape hatch, not the primary workflow
- it does not run inside the target shell
- it analyzes selected log data from that shell
- it should remain generic and should not bake in app-specific helpers

This gives operators a principled alternative to ad hoc heredocs without forcing the main inspection tool to grow every niche feature immediately.

## Framework-Shells Improvements That Would Help Upstream

Because the same maintainer controls both repos, some improvements belong in `framework-shells` rather than TE2-side patchwork.

### 1. Add a native structured inspection API

Preferred upstream addition:

- `inspect_logs(shell_id, ...)`

It should operate directly in `framework-shells` rather than forcing TE2 to build a parser layer over `tail` and `search` responses.

Benefits:

- one authoritative parser implementation
- reusable by TE2 and any other consumer
- less duplicated log parsing in app-level repos

### 2. Preserve complete line boundaries in tail results

Current tail-like behavior can begin on a partial line when a window is cut in awkwardly.

Upstream improvement:

- guarantee returned events begin on full line boundaries
- if not possible, mark the first returned record as `partial_head=true`

### 3. Return byte offsets and line offsets

Useful fields for each returned event:

- `line_number`
- `byte_start`
- `byte_end`
- `partial_head`
- `partial_tail`

These would make follow-up retrieval and exact slicing much easier.

### 4. Support raw + parsed modes together

Upstream responses should preserve:

- raw event text
- parsed fragments
- summary fields

Do not force callers to choose between raw and parsed output.

### 5. Add parser-lane registration / extensibility hooks

Framework-shells should have an internal parser registry so new formats can be added without rewriting core APIs.

Possible model:

- parser interface with `detect(event)` and `parse(event)`
- ordered lane execution
- additive annotations on the same event record

### 6. Keep structured filtering narrow in V1

The initial upstream filters should stay small and generic:

- `format`
- `signature`

Deeper path filtering can be deferred until the basic inspection surface proves itself.

### 7. Add event-signature aggregation upstream

A frequent workflow is: “what kinds of events exist in this shell right now?”

Upstream aggregation should support:

- top signatures
- counts by signature
- counts by parser lane
- counts by prefix

### 8. Add optional NDJSON / event framing support for future emitters

Some producers could emit a framed event stream more reliably than raw ad hoc lines.

Framework-shells should leave room for:

- NDJSON-friendly capture paths
- event metadata enrichment at capture time
- future log channels with stronger framing than plain stdout/stderr lines

## Tool-Surface Discipline

The overall tool surface should stay small.

This effort is trying to replace a noisy heredoc habit with a reliable inspection path, not create a cockpit full of overlapping tools that are hard to choose between.

Recommended shape:

1. one primary inspection tool
- generic
- event-first
- structured

2. one programmable escape hatch
- for custom one-off analysis
- clearly marked as the fallback path

3. existing raw tail/search tools
- retained for simple direct use
- not expanded into many app-specific variants

Practical rule:

- prefer improving the generic event inspector before adding new specialized tools
- add a new tool only when the capability cannot be expressed cleanly as:
  - a new parser lane
  - a new generic query/filter
  - or the programmable probe escape hatch

## Downstream TE2 Layout Follow-Up

The upstream FWS V1 scope and the downstream TE2 layout cleanup are related, but they are not the same task.

The current TE2 MCP implementation still lives under:

- `app/apps/file_editor_cm6/mcps/te2_mcp/`

That is the wrong long-term home for a TE2 runtime-wide MCP surface.

Recommended downstream follow-up after the upstream FWS scope is stable:

1. keep the current TE2 MCP logic
- do not revert the existing structured inspection work just because the source layout is wrong
- preserve reusable pieces such as the generic log-analysis code, models, and framework-shells client

2. move the TE2 MCP package to a runtime-level home under `app/`
- the final home should be a TE2 runtime-owned package rather than a `file_editor_cm6` subpackage
- example direction: a root-level `app/te2_mcp/` package or equivalent runtime-level layout

3. keep the boundary clear
- `framework-shells` upstream owns the generic inspection primitive
- TE2 owns the MCP transport, downstream UX, and any optional probe escape hatch
- `file_editor_cm6` should not remain the source-layout owner for TE2 runtime-wide MCP code

4. treat this as layout cleanup, not feature redefinition
- the move should preserve behavior and narrow the ownership boundary
- avoid mixing the package move with unrelated inspection-surface changes

## Preferred V1 Workflow

For TE2 MCP consumers, the preferred workflow should become:

1. identify the shell with `te2_fws_running`
2. start with `te2_fws_log_inspect`
3. inspect `summary`, `event_signature`, `kinds`, and parsed fragments
4. fall back to raw `te2_fws_log_tail` or `te2_fws_log_search` only when needed
5. use shell heredoc parsing only as the exceptional fallback

## Validation Corpus

The design should be tested against multiple noisy sources.

Required corpus types:

1. JSON-RPC-heavy observed app-server logs
2. another unknown noisy long-line log type
3. ordinary plain-text server logs

The tool is only successful if it remains useful across these categories without app-specific logic.

## Open Design Questions

1. Should structured path filtering live in TE2 MCP first or be pushed directly into `framework-shells`?
2. Should event signatures be best-effort strings or a more formal typed schema?
3. Should large parsed payloads be clipped per fragment, or should the tool support a later `fetch full fragment` follow-up path?
4. How much multi-line reconstruction is worth supporting in v1 versus explicitly deferring?
5. Should `inspect_hints` live on shell metadata in V1 or wait until after the base inspector is stable?

## Recommendation

Near term:

- keep improving the TE2-side inspection tool as a generic long-event inspector
- do not add app-specific semantic helpers to the contract
- keep FWS V1 narrow around `plain`, `json`, and `jsonrpc`
- treat JSON-RPC as first-class protocol classification, not domain interpretation

Medium term:

- move the core inspection logic into `framework-shells`
- let TE2 MCP become a thin transport and UX layer over that stronger upstream API
