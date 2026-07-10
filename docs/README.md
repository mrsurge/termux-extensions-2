# Documentation Guide

Current source code is authoritative. This documentation tree contains a mix of
current reference material, app notes, investigations, and completed or
superseded plans. Do not infer that a path or architecture is live merely
because a planning document describes it.

## Layout

| Path | Contents |
| --- | --- |
| `apps/` | App-specific guides, contracts, and historical implementation notes |
| `core/` | Current shared-service boundaries plus explicitly historical notes |
| `planning/` | Design records, investigations, phase plans, and migration history |
| `extensions/` | Historical extension documentation |
| `pngs/` | Documentation screenshots |

Some individual documents predate the Rust framework cutover and still mention
removed Python framework modules or older Code TE2 paths. Use them to understand
intent or prior decisions, then verify the claim against:

1. current source;
2. `AGENTS.md` for workflow and ownership rules;
3. `.repo_memory.md` for concise durable architecture;
4. the root `README.md` for supported install and launch behavior.

New documents should say whether they are a current contract, an investigation,
or a historical plan. Prefer updating the concise root guidance when a durable
runtime fact changes instead of adding another competing overview.
