# Search Pipe DTO Contract

## Goal

Define the `service.search` pipe DTOs needed to replace Code TE2 Explorer's Python file-name and file-content search producers while keeping the current Explorer frontend RPC payload stable.

The Explorer frontend must continue to use its existing lane:

- request: `explorer.search.run`
- response notification: `explorer.search.results.updated`

The Explorer backend is the adapter. It calls `service.search`, receives provider DTOs, and projects those DTOs into the existing frontend payloads.

## Non-Goals

- Do not change the Explorer visual/frontend contract in this slice.
- Do not move review search, diagnostics search, or Git changes search into `service.search` yet.
- Do not expose raw `rg --json` records as the app contract.
- Do not add HTTP fallback. Missing pipe support must fail explicitly once the pipe cutover is enabled.
- Do not make Rust own Explorer "more results" materialization in the baseline. Python owns the accumulated `searchId` cache and serves materialized windows from that cache.
- Do not treat repo-wide replace as a hidden extension of content search results.
  Replace preview/apply has a separate contract in `SEARCH_REPLACE_PIPE_DTO_CONTRACT.md`.

## Routing Requirements

All search service calls are project-scoped and must carry or inherit:

- `targetName: "service.search"`
- `originName: "file_editor_cm6.explorer"`
- `workspaceRoot` or request `root`
- `projectGeneration` when available
- `correlationId` for one frontend search action

Service responses and progress notifications must route back only to the initiating caller lane. They must not broadcast across app pipes or across multiple Explorer clients.

## Execution Requirements

- The framework/Rust side must run filesystem walking and ripgrep work off the pipe dispatcher path.
- Blocking search work should run on the framework service scheduler/lane used for read-heavy filesystem work.
- Result sets must not be bounded by hidden provider defaults. Limits are explicit request/session policy only, and every truncated response must expose why it was truncated plus a cursor or job/session identity that can materialize the omitted results.
- Paths returned to Code TE2 must be normalized POSIX project-relative paths plus absolute paths for compatibility.
- Absolute path inputs must be rejected if they escape `root`.

## Initial Required Methods

These methods are enough to replace the current Python producers without frontend changes.

| Method               | Purpose                                                         | Result DTO            |
| -------------------- | --------------------------------------------------------------- | --------------------- |
| `search.files.get`   | Bounded file/folder name search for the Explorer search overlay | `SearchFilesResult`   |
| `search.content.get` | Bounded content search for the Explorer search overlay          | `SearchContentResult` |

The provider may use `ignore`/`walkdir`/`globset` for file-name search and `ripgrep` crates or an equivalent Rust search implementation for content search. That implementation detail must not leak into DTOs.

## Request Identity Fields

The pipe envelope `method` is the authoritative request dispatcher. Request body fields `dto` and `version` are optional metadata for `SearchFilesRequest` and `SearchContentRequest`; callers may include them for schema clarity, but Code TE2 does not need to send them for the current cutover.

Framework provider adjustment if strict parity is desired:

- Add optional `dto` and `version` fields to Rust `SearchFilesRequest` and `SearchContentRequest`.
- Accept requests when those fields are absent.
- If present, validate `dto` matches the method-specific request DTO name and `version` is `1`.
- Keep response DTO identity strict: `SearchFilesResult` and `SearchContentResult` must include `dto` and `version`.

## Progressive Methods

These use the same item/match DTOs, but split delivery into routed notifications and materialized follow-up windows.

| Method / Notification  | Purpose                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `search.config.get`    | Return provider search configuration such as calculated/default thread count                    |
| `search.files.start`   | Start long-running file search, return `SearchJobStarted`                                       |
| `search.content.start` | Start long-running content search, return `SearchJobStarted`                                    |
| `search.job.cancel`    | Cancel by `jobId` / `opId`; used by overlay close, project switch, or stale generation teardown |
| `search.job.progress`  | Routed progress notification                                                                    |
| `search.job.result`    | Routed result notification using `SearchFilesResult` / `SearchContentResult` item shapes        |
| `search.job.done`      | Routed terminal success notification with final counts                                          |
| `search.job.error`     | Routed terminal failure notification                                                            |

Progressive search is not required for the first frontend-preserving cutover, but the DTOs below are shaped so they can be reused by the progressive path.

## Progressive Search Model

The progressive model has three layers:

- Rust/framework provider: runs search work, emits routed progress/result/done/error frames, and honors cancellation.
- Python Explorer backend: owns the Explorer client session, caches result objects by `searchId`, applies UI presentation windows, and serves "more" requests from the cached result when possible.
- Explorer frontend: renders the initial window and exposes affordances to request more total results, more matches inside one file, or cancel by closing/replacing the overlay.

Initial UI presentation policy is explicit app policy, not a provider cap:

- The Explorer UI may initially display up to ten matches per file and fifty total visible matches.
- The Python Explorer backend should preserve the full result/cache behind that visible window when the provider has supplied it.
- The frontend must receive enough metadata to know whether a "more" affordance should be shown for the whole result set or for an individual file.
- A provider must not silently drop extra matches just because the first visible window is small.

Broad content-search product cap is also explicit app policy:

- Code TE2 sends `maxMatchesTotal: 700` for content search to avoid building unusable thousand-hit UI/cache payloads.
- This cap must not disable the progressive/parallel search path.
- When this cap stops provider collection, Rust reports `truncated: true`, `truncatedReason: "matchLimit"`, and `matchLimit: 700` on the terminal result/done metadata.
- The frontend should tell the user the search stopped at the configured match limit and ask them to narrow the query with text or filters.

Materialization ownership:

- `search.content.more` and `search.content.moreInFile` are not Rust pipe provider methods in the baseline.
- The Explorer frontend asks the Python Explorer backend for more results on the Explorer RPC lane.
- The Python Explorer backend slices the accumulated `searchId` cache and returns the requested window.
- If the Python cache is missing, stale, cancelled, or project-generation mismatched, the backend must fail explicitly instead of silently rerunning the search or falling back to a local Python producer.

Python cache optimization direction:

- Phase 1 compacts the Python-owned search cache without changing frontend DTOs or Rust pipe DTOs.
- `JsonObject` / plain dictionaries should remain acceptable at RPC and pipe boundaries, but the in-memory content cache should stop storing every match as repeated dictionaries.
- The internal cache uses compact typed structures such as slots dataclasses or tuple-like records for files, matches, and ranges.
- Store ranges as compact `(start, end)` values internally and project them back to `{ start, end }` only when emitting frontend DTOs.
- Store frontend-normalized values, such as zero-based display columns, once during cache insertion when that preserves current frontend behavior.
- Keep `lineText`, `snippet`, `matchText`, and match ranges in the cache for now. Do not trade away future cache-derived search options just to save memory prematurely.
- Phase 2 is search-specific boundary/codec cleanup: convert pipe search DTO payloads into strict Python search structures at the search layer, then construct minimal outgoing socket payloads instead of copying full pipe params/results. The Python Explorer session layer now parses routed pipe events into compact event context objects and emits minimal `search.job.*` payloads from session state.
- Cache-derived narrowing is a later optimization. It should only use complete, same-root, same-project-generation caches and must prove the new request is a subset before avoiding a new Rust search.

Cancellation boundaries:

- Overlay close should call the Explorer backend cancel path for the active `searchId` / `jobId`.
- Project switch should cancel every active search whose `root` or `projectGeneration` no longer matches the active project.
- Starting a replacement search from the same Explorer client should cancel or supersede the older search before rendering the new result.
- Cancel must be event/ack based. No polling loop is part of this contract.

## `SearchFilesRequest`

Request DTO for `search.files.get`.

`dto` and `version` in this example are optional request metadata. The envelope method `search.files.get` remains the required dispatcher.

```json
{
  "dto": "SearchFilesRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "query": "editor",
  "maxResults": 500,
  "includeHidden": false,
  "useIgnoreFiles": true,
  "includePatterns": [],
  "excludePatterns": []
}
```

Rules:

- `query` is the user search string after Explorer/backend validation.
- `maxResults` defaults to `500` and must be treated as a hard cap.
- `includePatterns` and `excludePatterns` are POSIX-style project-relative glob strings.
- `includeHidden: false` means dot-path segments are skipped.
- `useIgnoreFiles: true` means provider should honor Git/ripgrep ignore semantics where possible.

## `SearchFilesResult`

Response DTO for `search.files.get`.

```json
{
  "dto": "SearchFilesResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "query": "editor",
  "items": [
    {
      "path": "/repo/root/app/editor.ts",
      "relativePath": "app/editor.ts",
      "kind": "file",
      "name": "editor.ts"
    },
    {
      "path": "/repo/root/app/editor",
      "relativePath": "app/editor",
      "kind": "dir",
      "name": "editor"
    }
  ],
  "count": 2,
  "truncated": false
}
```

Rules:

- `relativePath` is the canonical project-relative path used by Explorer opens/expands.
- `kind` is exactly `file` or `dir`.
- `count` is the number of returned items, not a full repo total unless the provider can compute the total without extra cost.
- `truncated` is true when `maxResults` stopped collection or a provider-side cap was hit.

Explorer projection to the current frontend payload:

```json
{
  "mode": "name",
  "query": "editor",
  "results": [
    {
      "path": "/repo/root/app/editor.ts",
      "rel": "app/editor.ts",
      "type": "file",
      "name": "editor.ts"
    }
  ],
  "count": 1,
  "truncated": false
}
```

## `SearchContentRequest`

Request DTO for `search.content.get`.

`dto` and `version` in this example are optional request metadata. The envelope method `search.content.get` remains the required dispatcher.

```json
{
  "dto": "SearchContentRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "query": "function openFile",
  "isRegex": false,
  "isCaseSensitive": false,
  "isWholeWords": false,
  "includePatterns": ["*.ts"],
  "excludePatterns": ["dist/**"],
  "useIgnoreFiles": true,
  "contextChars": 75,
  "searchThreads": 4
}
```

Rules:

- `maxFiles`, `maxMatchesPerFile`, `maxMatchesTotal`, and `maxFileSizeBytes` are optional explicit caps. If absent, the provider must not invent a default that truncates content results.
- `maxFiles` caps returned file groups only when the caller explicitly sends it.
- `maxMatchesPerFile` caps returned matches inside one file only when the caller explicitly sends it.
- `maxMatchesTotal` caps returned match rows across all files only when the caller explicitly sends it. Code TE2 uses this as the broad-search product cap and expects `truncatedReason: "matchLimit"` plus `matchLimit`.
- `maxFileSizeBytes` skips files above the explicit byte limit only when the caller explicitly sends it.
- If any explicit cap stops complete collection, the result must set `truncated: true`, identify the truncation reason, and expose a materialization cursor or `searchId`.
- Hidden global, per-file, total-match, or file-size truncation is invalid for Code TE2 search.
- `contextChars` defaults to `75` and controls snippet width around the first visible match.
- `searchThreads` is optional caller policy for progressive/parallel content search. If absent, Rust uses its calculated default.
- Regex validation errors should be returned as structured pipe errors, not as partial success DTOs.

## `SearchThreadConfig`

Response DTO for `search.config.get`.

```json
{
  "dto": "SearchThreadConfig",
  "version": 1,
  "availableParallelism": 8,
  "calculatedSearchThreads": 7,
  "defaultSearchThreads": 7,
  "minSearchThreads": 1,
  "maxSearchThreads": 64,
  "rustEnvVar": "TE2_RUST_SEARCH_THREADS",
  "source": "availableParallelismMinusOne"
}
```

Rules:

- The default formula is `available_parallelism - 1`, with a floor of `1` and fallback of `4` if the system query fails.
- `TE2_RUST_SEARCH_THREADS` may override the framework default when the framework itself is launched with it.
- Code TE2 app workers must not rely on Rust reading `SEARCH_THREADS`; that env var is worker-owned and is propagated by Python as request `searchThreads`.
- Request-level `searchThreads` wins over the framework default for that job and is clamped by the provider's min/max bounds.
- `search.config.get` is informational and cheap; it does not start a repository scan.

## `SearchContentResult`

Response DTO for `search.content.get`.

```json
{
  "dto": "SearchContentResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "query": "function openFile",
  "files": [
    {
      "path": "/repo/root/src/open.ts",
      "relativePath": "src/open.ts",
      "matches": [
        {
          "lineNumber": 12,
          "columnNumber": 8,
          "lineText": "export function openFile(path: string) {",
          "snippet": "export function openFile(path: string) {",
          "matchText": "function openFile",
          "lineRanges": [{ "start": 7, "end": 24 }],
          "snippetRanges": [{ "start": 7, "end": 24 }]
        }
      ]
    }
  ],
  "fileCount": 1,
  "matchCount": 1,
  "truncated": false,
  "searchId": "search-abc123",
  "jobId": "search-abc123",
  "complete": true,
  "totalFileCount": 1,
  "totalMatchCount": 1,
  "nextGlobalCursor": null,
  "matchLimit": 700
}
```

Rules:

- `lineNumber` is 1-based.
- `columnNumber` is 1-based and should be editor-compatible.
- `lineRanges` and `snippetRanges` are zero-based offsets into `lineText` and `snippet` respectively.
- `lineText` is the full matched line without trailing newline.
- `snippet` is the bounded display text used by Explorer.
- `matchText` is the matched string for the primary match represented by this row.
- `fileCount` is the number of returned file groups.
- `matchCount` is the number of returned match rows.
- `truncated` is true if any file/result/provider cap stopped complete collection.
- `searchId`, `jobId`, `complete`, `totalFileCount`, `totalMatchCount`, and `nextGlobalCursor` are optional additive fields for progressive/materialized results.
- If `truncated` is caused by the Code TE2 broad-search product cap, the DTO must expose `truncatedReason: "matchLimit"` and `matchLimit`. This is a stop-and-narrow signal, not a Python materialization cursor.
- If `truncated` is caused by some other global result cap, the DTO must expose that clearly enough for a UI materialization action, for example `truncatedReason: "maxMatchesTotal"` or a follow-up cursor/job id.
- If truncation is caused by per-file capping, the provider must expose per-file materialization metadata before Code TE2 should enable that cap.
- Per-file result objects may include optional progressive metadata: `fileMatchCount`, `matchesReturned`, `fileTruncated`, and `nextMatchCursor`.

Explorer projection to the current frontend payload:

```json
{
  "mode": "content",
  "query": "function openFile",
  "results": [
    {
      "path": "/repo/root/src/open.ts",
      "rel": "src/open.ts",
      "matches": [
        {
          "line": 12,
          "column": 7,
          "text": "export function openFile(path: string) {",
          "snippet": "export function openFile(path: string) {"
        }
      ]
    }
  ],
  "file_count": 1,
  "match_count": 1,
  "truncated": false
}
```

The legacy `column` field is zero-based because the current Explorer payload was shaped that way. The provider DTO uses 1-based `columnNumber`; the backend adapter subtracts one for legacy projection.

## `SearchPresentationWindow`

Optional DTO fragment for the Explorer/Python presentation window. This is not a Rust provider truncation policy.

```json
{
  "maxInitialMatchesPerFile": 10,
  "maxInitialMatchesTotal": 50
}
```

Rules:

- This fragment describes the first visible Explorer overlay window.
- The Python Explorer backend may use this to project a smaller frontend payload while retaining the complete provider result in memory.
- The Rust provider must not use this fragment to stop searching unless the request also contains an explicit provider cap such as `maxFiles`, `maxMatchesPerFile`, or `maxMatchesTotal`.
- If the result exceeds this window, the frontend should receive `truncated: true` plus per-file/global materialization metadata from the Python adapter.

## Hit Delivery And Progress Coalescing

Progressive content search uses separate delivery rules for hits and non-hit progress.

Rules:

- Hit-bearing `SearchContentResult` frames are atomic. One matched file is delivered in one routed `search.job.result` notification.
- Hit-bearing frames must not wait for a batch threshold. If Rust has a matched file, Python should receive it immediately so it can cache/project it.
- No-hit/progress/count-only notifications may be coalesced. The current Rust provider emits progress at a count-based cadence of 256 scanned files and relies on terminal `search.job.done` for authoritative final counts.
- Progress coalescing is not truncation and must not drop hit-bearing `search.job.result` frames.
- Consumers must treat each `SearchContentResult` inside `SearchJobResult.result` as an atomic hit file. `fileCount` should normally be `1`; `matchCount` is the match count for that one file, while `totalFileCount` / `totalMatchCount` are running totals when present.

## `SearchContentStartRequest`

Progressive request DTO for `search.content.start`. It uses the same search fields as `SearchContentRequest` and adds routed job/session metadata.

```json
{
  "dto": "SearchContentStartRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "query": "function openFile",
  "isRegex": false,
  "isCaseSensitive": false,
  "isWholeWords": false,
  "includePatterns": ["*.ts"],
  "excludePatterns": ["dist/**"],
  "useIgnoreFiles": true,
  "contextChars": 75,
  "searchThreads": 4,
  "presentationWindow": {
    "maxInitialMatchesPerFile": 10,
    "maxInitialMatchesTotal": 50
  }
}
```

Rules:

- `correlationId` identifies one frontend search action and must be echoed on routed notifications when provided.
- `presentationWindow` is optional and exists for app/UI projection. It is not a provider stop condition.
- Explicit provider caps use the same optional fields as `SearchContentRequest`.
- `searchThreads` uses the same optional per-job semantics as `SearchContentRequest`.
- The provider should assign and return `jobId` and `searchId` in `SearchJobStarted`.

## `SearchJobStarted`

Progressive start result for `search.files.start` and `search.content.start`.

```json
{
  "dto": "SearchJobStarted",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "opId": "search-abc123",
  "kind": "content",
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "status": "running",
  "message": "Searching"
}
```

Rules:

- `jobId` identifies the cancellable running provider job.
- `searchId` identifies the materializable result/session. It may equal `jobId` for the simple implementation.
- `opId` is a compatibility alias for existing job/progress patterns; new consumers should prefer `jobId` and `searchId`.

## `SearchJobProgress`

Routed notification for `search.job.progress`.

```json
{
  "dto": "SearchJobProgress",
  "version": 1,
  "jobId": "search-abc123",
  "opId": "search-abc123",
  "kind": "content",
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "status": "running",
  "message": "Scanned 120 files",
  "filesScanned": 120,
  "filesMatched": 7,
  "matchesFound": 19,
  "sequence": 4
}
```

## `SearchJobResult`

Routed notification for `search.job.result`. It carries result data using the same item/match shapes as `SearchFilesResult` or `SearchContentResult`.

```json
{
  "dto": "SearchJobResult",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "kind": "content",
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "sequence": 5,
  "result": {
    "dto": "SearchContentResult",
    "version": 1,
    "root": "/repo/root",
    "projectGeneration": 42,
    "query": "function openFile",
    "files": [
      {
        "path": "/repo/root/src/open.ts",
        "relativePath": "src/open.ts",
        "matches": [
          {
            "lineNumber": 12,
            "columnNumber": 8,
            "lineText": "export function openFile(path: string) {",
            "snippet": "export function openFile(path: string) {",
            "matchText": "function openFile",
            "lineRanges": [{ "start": 7, "end": 24 }],
            "snippetRanges": [{ "start": 7, "end": 24 }]
          }
        ]
      }
    ],
    "fileCount": 1,
    "matchCount": 1,
    "truncated": false,
    "searchId": "search-abc123",
    "jobId": "search-abc123",
    "complete": false,
    "totalFileCount": 7,
    "totalMatchCount": 12,
    "filesScanned": 131
  }
}
```

Rules:

- `sequence` is monotonically increasing per `jobId`.
- Notifications must be routed to the initiating pipe caller lane only.
- Python may cache these atomic hit files by `searchId` and project a frontend-sized visible window without asking Rust to recompute.
- For content search, `result.fileCount` should normally be `1` because hit-bearing files are delivered atomically. `result.matchCount` is the match count for that file.

## Python Backend Materialization Methods

These are Explorer backend RPC/session methods, not Rust pipe methods.

| Method                       | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `explorer.search.more`       | Materialize the next global content-search result window for a search   |
| `explorer.search.moreInFile` | Materialize additional matches for one file inside an existing search   |
| `explorer.search.cancel`     | Cancel/supersede the active backend search session for an Explorer lane |

## `ExplorerSearchMoreRequest`

Request DTO for `explorer.search.more`. This materializes the next global content-search window from the Python-owned `searchId` cache.

```json
{
  "dto": "ExplorerSearchMoreRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "searchId": "search-abc123",
  "cursor": "global:50",
  "limit": {
    "maxMatchesPerFile": 10,
    "maxMatchesTotal": 50
  }
}
```

## `ExplorerSearchMoreResult`

Response DTO for `explorer.search.more`. It reuses the content result shape and adds materialization identity.

```json
{
  "dto": "ExplorerSearchMoreResult",
  "version": 1,
  "searchId": "search-abc123",
  "windowKind": "global",
  "result": {
    "dto": "SearchContentResult",
    "version": 1,
    "root": "/repo/root",
    "projectGeneration": 42,
    "query": "function openFile",
    "files": [],
    "fileCount": 0,
    "matchCount": 0,
    "truncated": false,
    "searchId": "search-abc123",
    "complete": false,
    "nextGlobalCursor": "global:100"
  }
}
```

Rules:

- Python serves this from its accumulated result cache without a Rust provider round trip.
- If the cache is unavailable or stale, return a structured Explorer RPC error.
- `limit` is a materialization window size, not a provider search cap.

## `ExplorerSearchMoreInFileRequest`

Request DTO for `explorer.search.moreInFile`. This materializes additional matches for one file from the Python-owned `searchId` cache.

```json
{
  "dto": "ExplorerSearchMoreInFileRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "searchId": "search-abc123",
  "relativePath": "src/open.ts",
  "cursor": "file:src/open.ts:10",
  "maxMatches": 50
}
```

## `ExplorerSearchMoreInFileResult`

Response DTO for `explorer.search.moreInFile`.

```json
{
  "dto": "ExplorerSearchMoreInFileResult",
  "version": 1,
  "searchId": "search-abc123",
  "root": "/repo/root",
  "projectGeneration": 42,
  "file": {
    "path": "/repo/root/src/open.ts",
    "relativePath": "src/open.ts",
    "matches": [],
    "fileMatchCount": 42,
    "matchesReturned": 50,
    "fileTruncated": true,
    "nextMatchCursor": "file:src/open.ts:60"
  }
}
```

Rules:

- `relativePath` is the stable file key; absolute `path` is compatibility/display data.
- `maxMatches` is a materialization window size for this request only.
- If `fileTruncated` is false or `nextMatchCursor` is null/absent, no more per-file affordance should be shown.

## `SearchJobDone`

Routed terminal success notification for `search.job.done`.

```json
{
  "dto": "SearchJobDone",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "kind": "content",
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "status": "done",
  "fileCount": 167,
  "matchCount": 700,
  "filesScanned": 9134,
  "filesMatched": 167,
  "matchesFound": 700,
  "cancelled": false,
  "truncated": true,
  "truncatedReason": "matchLimit",
  "matchLimit": 700
}
```

## `SearchJobError`

Routed terminal failure notification for `search.job.error`.

```json
{
  "dto": "SearchJobError",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "kind": "content",
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:search-99",
  "status": "error",
  "code": "invalidRegex",
  "message": "Invalid regular expression"
}
```

## `SearchJobCancelRequest`

Request DTO for `search.job.cancel`.

```json
{
  "dto": "SearchJobCancelRequest",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "root": "/repo/root",
  "projectGeneration": 42,
  "reason": "overlayClosed"
}
```

## `SearchJobCancelResult`

Cancel result for `search.job.cancel`.

```json
{
  "dto": "SearchJobCancelResult",
  "version": 1,
  "jobId": "search-abc123",
  "searchId": "search-abc123",
  "opId": "search-abc123",
  "ok": true,
  "status": "cancelled",
  "reason": "overlayClosed"
}
```

## Python Explorer Adapter Shape

Python is the Explorer adapter and session/cache owner, not the search producer:

- `explorer/search.py::start_file_search(...)` calls `search.files.start` and returns `SearchJobStarted`.
- `explorer/search.py::start_content_search(...)` calls `search.content.start` and returns `SearchJobStarted`.
- If the app worker is launched with `SEARCH_THREADS=<positive integer>`, `explorer/search.py::start_content_search(...)` includes that value as request `searchThreads`; explicit frontend/benchmark `searchThreads` wins over the env value.
- `explorer/search.py::cancel_search_job(...)` calls `search.job.cancel` and returns `SearchJobCancelResult`.
- `explorer/contracts/search_review.py` owns projection helpers back to the current frontend payload.
- `explorer/services/search_sessions.py` owns the Python `searchId` cache, result accumulation, visible-window projection, materialization, and stale/cancelled session rejection.
- `explorer/handlers/search.py` handles `changes` search only; name/content search must go through progressive search sessions.
- Progressive search adds a Python session cache keyed by `searchId` so the frontend can request more total results or more matches in one file without rerunning the search.

The progressive cutover uses `pipe_runtime.call_async("search.files.start", ...)`, `pipe_runtime.call_async("search.content.start", ...)`, routed search job notifications, and `pipe_runtime.call_async("search.job.cancel", ...)`. Python keeps the Explorer frontend projection and materialization cache; Rust remains the search producer.

## Cutover Checklist

- [x] Document DTOs and projection boundary.
- [x] Make Python file-name search generate `SearchFilesResult` internally.
- [x] Make Python content search generate `SearchContentResult` internally.
- [x] Make Explorer RPC handler project provider DTOs before frontend notification.
- [x] Add Rust `service.search` provider methods.
- [x] Replace Python local provider bodies with pipe calls.
- [x] Remove local Python/ripgrep search subprocess fallback after pipe cutover is proven.
- [x] Document progressive search DTOs, presentation-window policy, materialization cursors, and cancel semantics.
- [x] Implement progressive `search.files.start` / `search.content.start` jobs.
- [x] Implement Python Explorer `explorer.search.more` and `explorer.search.moreInFile` materialization from the backend `searchId` cache.
- [x] Wire overlay close, replacement search, and project switch to `search.job.cancel`.
- [x] Add optional per-job `searchThreads`, `SEARCH_THREADS` worker-env propagation, and `search.config.get` discovery.
