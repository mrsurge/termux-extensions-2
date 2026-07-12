# Search Replace Pipe DTO Contract

## Goal

Define the repo-wide find/replace pipe DTOs for Code TE2 Explorer search. This
extends `service.search`; it does not replace Monaco's active-file find/replace
widget.

The target behavior is:

- Explorer frontend owns the replace UI and selected-match intent.
- Python Explorer backend owns the Explorer RPC adapter, visible projection, and
  cached preview/session state.
- Rust/framework `service.search` owns repository scanning and file mutation.
- Editor document open/save remains direct and is not moved onto the pipe by this
  contract.

## Non-Goals

- Do not route Monaco's active-file find/replace widget through this contract.
- Do not use HTTP fallback or Python local filesystem mutation fallback.
- Do not apply replacement edits from stale project generations.
- Do not apply edits without a prior preview identity or without file-content
  verification.
- Do not require Rust to retain all preview state in memory in order to apply.

## Method Set

| Method | Purpose | Result DTO |
| --- | --- | --- |
| `search.replace.preview.start` | Start a non-mutating repo-wide replace preview job | `SearchJobStarted` |
| `search.replace.apply.start` | Start applying selected verified replacement edits | `SearchJobStarted` |
| `search.job.cancel` | Cancel preview/apply jobs by `jobId`, `searchId`, or `opId` | `SearchJobCancelResult` |
| `search.job.progress` notification | Routed progress for preview/apply jobs | `SearchJobProgress` |
| `search.job.result` notification | Routed preview/apply result chunks | `SearchReplacePreviewResult` or `SearchReplaceApplyProgress` |
| `search.job.done` notification | Routed terminal success/cancel/truncation counts | `SearchJobDone` |
| `search.job.error` notification | Routed terminal failure | `SearchJobError` |

`search.content.start` remains the normal find-only content search path.
Replace preview uses separate DTOs because it must carry replacement text,
replacement preview, file hashes, and stable edit identities.

## Routing Requirements

Requests follow the same project-scoped routing as content search:

- `targetName: "service.search"`
- `originName: "file_editor_cm6.explorer"`
- `workspaceRoot` or request `root`
- `projectGeneration`
- `correlationId`

Notifications must route only to the initiating caller lane. They must not
broadcast replace previews or mutation progress to other app pipes.

## Replace Safety Model

Replace is a two-step operation.

1. Preview scans files and returns proposed edits.
2. Apply receives selected edits plus file verification data and writes files.

Rust must verify the current file content before applying edits. The baseline
verification field is `fileSha256`, calculated over the exact file bytes used to
produce the preview. If the file has changed, that file is skipped with
`status: "conflict"` and no edits are applied to that file.

Apply is atomic per file, not transaction-wide across the repository:

- For one file, either all selected edits for that file are applied or none are.
- Across multiple files, successful files may remain written even if later files
  conflict or fail.
- The result DTO must report every written, skipped, conflicted, or failed file.

Replacement edits must be applied in descending byte-offset order per file, or
by an equivalent algorithm that preserves the preview byte ranges.

## `SearchReplacePreviewStartRequest`

Request DTO for `search.replace.preview.start`.

```json
{
  "dto": "SearchReplacePreviewStartRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:replace-99",
  "query": "function openFile",
  "replacementText": "function launchFile",
  "isRegex": false,
  "isCaseSensitive": false,
  "isWholeWords": false,
  "includePatterns": ["*.ts"],
  "excludePatterns": ["dist/**"],
  "useIgnoreFiles": true,
  "contextChars": 75,
  "maxMatchesTotal": 700,
  "searchThreads": 4,
  "presentationWindow": {
    "maxInitialMatchesPerFile": 10,
    "maxInitialMatchesTotal": 50
  }
}
```

Rules:

- Search option semantics match `SearchContentStartRequest`.
- `replacementText` is the literal replacement text after frontend/backend input
  validation.
- Regex replacement syntax is explicit provider behavior. If capture
  interpolation is unsupported, regex replacement must fail with a structured
  error rather than silently applying literal text incorrectly.
- The preview job is non-mutating.
- `maxMatchesTotal` is an explicit app cap. If reached, terminal metadata must
  report `truncated: true`, `truncatedReason: "matchLimit"`, and `matchLimit`.

## `SearchReplacePreviewResult`

Routed inside `search.job.result` for preview jobs.

```json
{
  "dto": "SearchReplacePreviewResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "searchId": "replace-preview-abc123",
  "jobId": "replace-preview-abc123",
  "query": "function openFile",
  "replacementText": "function launchFile",
  "files": [
    {
      "path": "/repo/root/src/open.ts",
      "relativePath": "src/open.ts",
      "fileSha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      "matches": [
        {
          "matchId": "src/open.ts:12:8:7:24",
          "lineNumber": 12,
          "columnNumber": 8,
          "byteStart": 128,
          "byteEnd": 145,
          "matchedText": "function openFile",
          "replacementText": "function launchFile",
          "lineText": "export function openFile(path: string) {",
          "previewText": "export function launchFile(path: string) {",
          "lineRanges": [{ "start": 7, "end": 24 }],
          "replacementRanges": [{ "start": 7, "end": 26 }]
        }
      ],
      "matchCount": 1
    }
  ],
  "fileCount": 1,
  "matchCount": 1,
  "truncated": false
}
```

Rules:

- `lineNumber` and `columnNumber` are 1-based provider/editor coordinates.
- `byteStart` and `byteEnd` are byte offsets into the current file bytes used to
  compute `fileSha256`.
- `lineRanges` are zero-based ranges in `lineText` for matched text.
- `replacementRanges` are zero-based ranges in `previewText` for replacement
  text.
- `matchId` must be stable for the preview result and unique inside the preview.
- Hit-bearing preview result frames should follow the same atomic file delivery
  rule as content search: one matched file per routed result frame.

## `SearchReplaceApplyStartRequest`

Request DTO for `search.replace.apply.start`.

```json
{
  "dto": "SearchReplaceApplyStartRequest",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "correlationId": "explorer-client-1:replace-apply-99",
  "previewSearchId": "replace-preview-abc123",
  "replacementText": "function launchFile",
  "files": [
    {
      "relativePath": "src/open.ts",
      "fileSha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      "edits": [
        {
          "matchId": "src/open.ts:12:8:7:24",
          "byteStart": 128,
          "byteEnd": 145,
          "replacementText": "function launchFile"
        }
      ]
    }
  ]
}
```

Rules:

- `previewSearchId` identifies the Explorer/Python preview session. Rust does
  not need to retain that preview, but the field preserves traceability.
- `files` contains only user-selected files/matches.
- `relativePath` must stay under `root`; absolute escaped paths are invalid.
- Rust must reject overlapping edits inside one file.
- Rust must verify `fileSha256` before writing.
- Rust must write text files atomically per file.
- Binary files must be rejected unless a later explicit binary-replace contract
  is added.

## `SearchReplaceApplyProgress`

Routed inside `search.job.result` for apply jobs when per-file progress should be
reported before terminal done.

```json
{
  "dto": "SearchReplaceApplyProgress",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "jobId": "replace-apply-def456",
  "previewSearchId": "replace-preview-abc123",
  "files": [
    {
      "relativePath": "src/open.ts",
      "status": "written",
      "replacementsApplied": 1,
      "fileSha256Before": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      "fileSha256After": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d"
    }
  ]
}
```

## `SearchReplaceApplyResult`

Aggregate apply DTO, emitted as the final `search.job.result` payload before
`search.job.done`. The terminal `SearchJobDone` notification keeps scalar
counts/status only, matching the existing search job contract.

```json
{
  "dto": "SearchReplaceApplyResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "jobId": "replace-apply-def456",
  "previewSearchId": "replace-preview-abc123",
  "status": "completed",
  "filesRequested": 1,
  "filesWritten": 1,
  "filesSkipped": 0,
  "filesConflicted": 0,
  "filesFailed": 0,
  "replacementsRequested": 1,
  "replacementsApplied": 1,
  "files": [
    {
      "relativePath": "src/open.ts",
      "status": "written",
      "replacementsApplied": 1,
      "fileSha256Before": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      "fileSha256After": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d"
    }
  ]
}
```

File status values:

| Status | Meaning |
| --- | --- |
| `written` | File was verified and all selected edits were applied |
| `skipped` | File was intentionally skipped by selection or policy |
| `conflict` | Current file hash did not match the preview hash |
| `failed` | Provider hit an I/O, encoding, permission, or validation error |

## Python Explorer Adapter Shape

Python stays the Explorer adapter:

- Add Explorer RPC methods for preview/apply intent, for example
  `explorer.search.replace.preview` and `explorer.search.replace.apply`.
- Preview calls `pipe_runtime.call_async("search.replace.preview.start", ...)`.
- Apply calls `pipe_runtime.call_async("search.replace.apply.start", ...)`.
- Routed `search.job.*` notifications should reuse existing search session
  routing where practical, keyed by `searchId` / `jobId` and
  `projectGeneration`.
- Python may cache preview DTOs by `searchId` for frontend selection and resend
  selected verified edits to Rust.
- Missing/stale/cancelled preview cache must fail explicitly. Do not rerun
  preview or mutate from stale state as a fallback.

## Frontend Projection Shape

The Explorer frontend may project preview matches using the existing search
result list, but replace-specific state must include:

- replacement text
- preview identity (`searchId`, `jobId`, `correlationId`)
- selected file/match ids
- conflict/error summaries after apply
- disabled apply action until preview results exist and at least one match is
  selected

The current active-file Monaco find/replace command remains the existing
`ui.host.editor.find` -> editor notification path and is not changed by this
contract.

## Cutover Checklist

- [ ] Add Rust DTOs and method dispatch for `search.replace.preview.start`.
- [ ] Add Rust DTOs and method dispatch for `search.replace.apply.start`.
- [ ] Add per-file atomic writer with SHA-256 verification and overlap checks.
- [ ] Add Python Explorer RPC contracts and adapter functions.
- [ ] Add Python preview cache/session handling for replace selections.
- [ ] Add frontend replace UI affordance in the Explorer search overlay.
- [ ] Add tests for preview, apply, conflict, cancellation, and stale generation.
