# Search result memory safety

## Goal and approved scope

Preserve content matches, including minified/generated files, without copying a
whole matching line per occurrence. Keep the existing Rust search provider,
Python per-file search-session cache, pipe transport and guarded replacement
workflow. No ignore-rule changes, frontend publication, runtime restart or
release is part of this slice.

## Evidence

Searching `toml` found 371 literal occurrences on the ~18.8 MB line in the local
Monaco bootstrap source map. The former `line_text.to_owned()` per occurrence
predicts ~6.5 GiB of duplicated strings, before serialization. The existing pipe
encoder rejects frames over 32 MiB only after serialization; the scheduler
previously logged notification rejection without cancelling the producer.
This explains the observed failure mechanism; no controlled reproduction of the
original OOM was needed or attempted.

VS Code reference: `../code-server/lib/vscode/src/vs/workbench/services/search/`
`node/ripgrepTextSearchEngine.ts` groups line matches; `common/search.ts`
`TextSearchMatch` maps elided preview ranges separately from original ranges.

## Implementation

1. Borrow valid UTF-8 matching-line input rather than first allocating a full
   duplicate. Build bounded UTF-8 previews directly from that scan input.
2. Keep original file line/column and source-byte coordinates independent of
   preview-relative ranges. Display fields are not replacement identity.
3. Retain every occurrence. Bound line/snippet/match display strings to 4096
   bytes each, without copying full large match text first. Preserve existing
   guarded-file snapshot/hash policy for replacement admission.
4. Split progressive results into conservative 256 KiB byte-budgeted batches;
   move hits and reuse per-file metadata. Existing Python sessions append these
   batches to the same file record. No new schema, network read or file-read pass.
5. Required notification rejection sets the existing shared cancellation flag
   and delivery-failure metric. Match enumeration observes that flag too.
6. Regress huge single-line searches, Unicode/multiline previews, exact edit
   identity, progressive batching and pipe-delivery failure. Record results in
   TRACKER.md; live activation is a separate gate.

## Boundaries

This removes line-length-times-hit-count amplification, not all possible memory
growth from unlimited results. Non-progressive callers retain their full result
set, and current producers accumulate a file's compact hits before publication.
The existing transport size guard remains defense in depth, not a producer
allocation budget. Huge input lines may still require a line buffer; multiline
search still reads a full file. No claim of constant-memory arbitrary searches.

The change is Rust framework-owned; it does not require Code TE2 mypyc rebuilding
or client OTA. An approved framework rebuild/restart is needed for live use.

## Follow-up — multiline search correctness and desktop input

User reports that the memory-safety change regressed multiline searches. Restore
that behavior without reverting bounded previews, per-file result reuse,
byte-budgeted batches or delivery-failure cancellation. Pair the correction with
desktop Shift+Enter newline entry so multiline queries need not be pasted.
This section is an approved plan update, not implementation approval.

Source observations, not a confirmed diagnosis:

- `framework_services/search_ops.rs` still routes actual newline queries to
  `search_content_multiline_with_options`, with LF/CRLF normalization and
  multiline literal/regex matchers. Existing provider-only multiline tests do
  not establish end-to-end correctness.
- `content_multiline_match_dto` now uses bounded preview text for both `line_text`
  and `snippet`, with preview-relative ranges and independent source-byte targets.
  Trace this projection through Python `explorer/services/search_sessions.py`
  and the results renderer before choosing a fix; do not assume enumeration,
  presentation or replacement identity is the failing layer.
- The active `src/explorer/search/content-query-widget.ts` composes
  `SearchFindInput` directly with flexible height and change events. It does not
  install an explicit newline shortcut. The nearby full vendored SearchWidget
  has an insertAtCursor newline pattern, but is not the active composition.

One implementation slice:

1. Capture a minimal failing multiline query and expected matches. Follow its
   unchanged value from input through request admission, Rust enumeration,
   progressive pipe results, retained Python projection and rendered hits.
2. Correct the proven regression while keeping source coordinates separate from
   clipped display coordinates. No full minified-line copies or replacement
   identity derived from previews. Preserve all matching occurrences.
3. Add explicit Shift+Enter insertion at the search selection/caret using the
   existing input API and change pipeline. Keep focus, flexible-height sizing,
   selection replacement and ordinary Enter/Escape behavior; guard IME composition
   and avoid duplicate newline/input handling. Retain multiline paste behavior.
4. Regress literal and regex multiline queries, LF/CRLF, Unicode, multiple hits,
   clipped/large matches, progressive versus non-progressive output, displayed
   highlights/navigation and exact guarded replacement coordinates. Include
   cross-layer coverage rather than only direct DTO/helper assertions.
5. Re-run huge-single-line memory/serialized-size and rejected-delivery tests;
   validate frontend typecheck/build and keyboard behavior. Record evidence and
   user live acceptance in the tracker.

Activation depends on the proven fix: Rust changes need a matching framework;
frontend changes need host build and client asset publication/reload. Python
changes, if necessary, need matching Code TE2 mypyc activation or the approved
interpreted runtime. None of those runtime transitions is authorized by this
documentation update. No Android source, APK, transport redesign or unrelated
search feature is in this slice.
