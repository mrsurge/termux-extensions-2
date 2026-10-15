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
