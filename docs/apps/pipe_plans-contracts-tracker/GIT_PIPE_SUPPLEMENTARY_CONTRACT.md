# Git Pipe Supplementary Contract

## Goal

Define the current Git pipe method and DTO contract that makes Code TE2 Git consumers treat the pipe as the origin for all Git data and Git mutations.

The adapter rule is: keep current frontend and backend projection payloads stable where possible, and keep Python Git code limited to thin pipe adapters/projection glue. There is no local Git fallback in `file_editor_cm6`.

Current state:

- The Rust framework `service.git` pipe provider implements the method set below through `framework_services/pipe/git_pipe_ops.rs`, backed by `framework_services/git_ops.rs`.
- Code TE2 app-side consumers use `app/apps/file_editor_cm6/worker_services/git_service.py` as the pipe adapter.
- Historical subprocess/GitPython producer paths such as `git_helper.py` are removed; `diff_helper.collect_diff(...)` is backed by `git.diff.hunks`.
- Any unsupported adapter option must fail loudly at the adapter boundary instead of silently falling back to a local Git implementation.

## Execution Requirements

- All get/read/list/diff/history operations must run on an async Rust/framework service path and must move blocking Git/libgit2/filesystem work off the pipe dispatcher path.
- Clone, pull, and push must start asynchronously and report progress by routed pipe notifications.
- Pipe request/response is for starting work or returning bounded read results. Long-running progress and completion are notification frames.
- No HTTP fallback and no locally generated Git fallback in `file_editor_cm6`.
- Notifications must route to the exact initiating caller lane by `targetNid`/`targetName`, not broadcast across app pipes.

## Method Set

| Method | Purpose |
|---|---|
| `git.snapshot.get` | Return repository status, branch, head, and path decorations as `GitSnapshot` |
| `git.headBlob` | Return file text at `HEAD` or requested rev as `GitHeadBlobResult` |
| `git.diff` | Return file-level patches/change rows as `GitDiffResult` |
| `git.diff.hunks` | Return current `diff_helper.collect_diff`-compatible hunks as `GitDiffHunks` |
| `git.worktreeChanges.get` | Return changed paths vs `HEAD` or a diff base as `GitWorktreeChanges` |
| `git.pathIndex.list` | Return tracked and untracked non-ignored file paths for search/name indexing |
| `git.commitInfo.get` | Return one commit by ref as `GitCommitInfoResult` |
| `git.history` | Return commit history, optionally path-scoped, as `GitHistoryResult` |
| `git.branchList` | Return current branch and branch choices as `GitBranchList` |
| `git.branchCheckout` | Checkout a branch/ref and return `GitMutationResult` |
| `git.branchCreate` | Create a branch and return `GitMutationResult` |
| `git.remoteList` | Return remotes as `GitRemoteList` |
| `git.remoteAdd` | Add a remote and return `GitMutationResult` |
| `git.stage` | Stage paths or all changes and return `GitMutationResult` |
| `git.unstage` | Unstage paths or all staged changes and return `GitMutationResult` |
| `git.restore` | Restore paths from a source commit/ref and return `GitMutationResult` |
| `git.commit` | Commit staged changes and return `GitMutationResult` |
| `git.resetHard` | Hard-reset to a ref and return `GitMutationResult` |
| `git.init` | Initialize a repository and return `GitMutationResult` |
| `git.clone` | Bounded clone call for non-progress callers; return `GitMutationResult` |
| `git.pull` | Bounded pull call for non-progress callers; return `GitMutationResult` |
| `git.push` | Bounded push call for non-progress callers; return `GitMutationResult` |
| `git.clone.start` | Start long-running clone, return `GitJobStarted` |
| `git.pull.start` | Start long-running pull, return `GitJobStarted` |
| `git.push.start` | Start long-running push, return `GitJobStarted` |
| `git.job.cancel` | Cancel by `jobId` or `opId`, return `GitJobCancelResult` |
| `git.job.progress` notification | Deliver `GitJobProgress` back to the exact caller lane |

## Shared Request Fields

All Git request DTOs should accept these fields unless the method explicitly does not need them:

```json
{
  "root": "/repo/root",
  "projectGeneration": 42,
  "relativePath": "src/file.ts",
  "paths": ["src/file.ts"],
  "base": "HEAD",
  "rev": "HEAD"
}
```

Rules:

- `root` is the repository/workspace root. If omitted, the service may use envelope `workspaceRoot`.
- `projectGeneration` echoes into result DTOs for stale-drop guards.
- Paths are project/repo-relative POSIX paths.
- Absolute path inputs must be normalized and rejected if outside `root`.

## DTOs

### GitJobStarted

Returned by `git.clone.start`, `git.pull.start`, and `git.push.start`.

```json
{
  "dto": "GitJobStarted",
  "version": 1,
  "jobId": "job-abc123",
  "opId": "op-abc123",
  "type": "git_clone",
  "operation": "clone",
  "root": "/repo/root",
  "projectGeneration": 42,
  "status": "running",
  "message": "Starting clone"
}
```

Compatibility notes:

- `type` must be one of `git_clone`, `git_pull`, or `git_push` so the existing Explorer progress handler can consume it with minimal adaptation.
- `jobId` is the Explorer/job UI identity. `opId` is the pipe cancellation/correlation identity. They may be equal.

### GitJobProgress

Sent as a pipe notification frame with `kind: "notification"`, `method: "git.job.progress"`, `opId`, `targetNid`, and `targetName` set to the initiating caller.

```json
{
  "dto": "GitJobProgress",
  "version": 1,
  "jobId": "job-abc123",
  "opId": "op-abc123",
  "type": "git_clone",
  "operation": "clone",
  "root": "/repo/root",
  "projectGeneration": 42,
  "status": "running",
  "message": "Cloning: 42% (receiving)",
  "progress": {
    "completed": 42,
    "total": 100,
    "detail": "receiving"
  },
  "sequence": 7
}
```

Terminal success:

```json
{
  "dto": "GitJobProgress",
  "version": 1,
  "jobId": "job-abc123",
  "opId": "op-abc123",
  "type": "git_clone",
  "operation": "clone",
  "root": "/repo/root",
  "projectGeneration": 42,
  "status": "succeeded",
  "message": "Cloned repository",
  "progress": {
    "completed": 100,
    "total": 100,
    "detail": "done"
  },
  "result": {
    "path": "/repo/root"
  },
  "sequence": 8
}
```

Terminal failure/cancel uses the same DTO with `status: "failed"` plus `error`, or `status: "cancelled"`.

### GitJobCancelResult

```json
{
  "dto": "GitJobCancelResult",
  "version": 1,
  "jobId": "job-abc123",
  "opId": "op-abc123",
  "ok": true,
  "status": "cancelled"
}
```

### GitDiffResult

Returned by `git.diff` when a caller needs file-level patch/change rows rather
than editor hunk DTOs.

```json
{
  "dto": "GitDiffResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "base": "HEAD",
  "files": [
    {
      "relativePath": "src/file.ts",
      "status": "modified",
      "patch": {
        "payloadKind": "string",
        "encoding": "utf-8",
        "value": "diff --git a/src/file.ts b/src/file.ts\n..."
      },
      "contentSuppressed": false
    }
  ]
}
```

Whole-file deleted and untracked bodies are status-only here as well. Return the
file row with `contentSuppressed: true` and
`suppressedReason: "wholeFileStatusOnly"` instead of materializing the full file
body into a patch. Modified files with any diff body line over `8192` bytes are
also status-only with `suppressedReason: "oversizedDiffLine"` and
`lineByteLimit: 8192`.

### GitDiffHunks

This is intentionally shaped to adapt directly to the current `diff_helper.collect_diff` return payload.

```json
{
  "dto": "GitDiffHunks",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "relativePath": "src/file.ts",
  "base": "HEAD",
  "hunks": [
    {
      "oldStart": 12,
      "oldLines": 1,
      "newStart": 12,
      "newLines": 2,
      "lines": [
        { "type": "del", "text": "old" },
        { "type": "add", "text": "new" }
      ]
    }
  ],
  "summary": {
    "added": 1,
    "deleted": 1,
    "tracked": true,
    "status": "modified"
  }
}
```

The diff producer must preserve file identity even when no line corpus is
returned. On non-repo/no-diff cases, return the same DTO with empty `hunks` and
a truthful `summary.tracked` value. Use `error` only for an actual provider
failure or capped result.

Whole-file deleted and untracked bodies are status-only in this DTO. The Rust
producer must not materialize the deleted/untracked file body into hunk lines for
Explorer "by changes" overlays or any other app-origin pipe caller. For those
statuses, return empty `hunks` and keep the row/link usable through
`relativePath`, `summary.status`, and the existing worktree-change metadata:

```json
{
  "dto": "GitDiffHunks",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "relativePath": "deleted.log",
  "base": "HEAD",
  "hunks": [],
  "summary": {
    "added": 0,
    "deleted": 0,
    "tracked": true,
    "status": "deleted",
    "contentSuppressed": true,
    "suppressedReason": "wholeFileStatusOnly",
    "displayText": "Deleted file"
  }
}
```

Modified tracked files keep normal hunk production unless any diff body line in
that file exceeds `8192` bytes. A single oversized body line is treated as a
minified/generated-file memory hazard, so the whole file diff becomes
status-only while preserving the row/link:

```json
{
  "dto": "GitDiffHunks",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "relativePath": "static/dist/host.js",
  "base": "HEAD",
  "hunks": [],
  "summary": {
    "added": 0,
    "deleted": 0,
    "tracked": true,
    "status": "modified",
    "contentSuppressed": true,
    "suppressedReason": "oversizedDiffLine",
    "displayText": "Diff omitted: contains a line over 8 KB",
    "lineByteLimit": 8192
  }
}
```

Do not add broad truncation or sampling to modified hunks until a separate
caller-visible limit/cursor contract is designed.

### GitWorktreeChanges

Replaces the retired `git_helper.get_worktree_changes` producer for search/review change lists.

```json
{
  "dto": "GitWorktreeChanges",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "base": "HEAD",
  "isRepository": true,
  "changes": [
    {
      "path": "src/file.ts",
      "code": "M",
      "originalPath": null
    },
    {
      "path": "new.txt",
      "code": "??",
      "originalPath": null
    }
  ],
  "truncated": false
}
```

### GitPathIndex

Replaces any local `git ls-files -co --exclude-standard` producer path when a Git-backed path index is needed.

```json
{
  "dto": "GitPathIndex",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "isRepository": true,
  "paths": [
    "app/main.py",
    "docs/readme.md"
  ],
  "source": "git-index",
  "truncated": false
}
```

If not a repository, return `isRepository: false` and an empty `paths` list so the Python caller can fall back to filesystem search without running git locally.

### GitCommitInfoResult

Replaces the retired `git_helper.get_commit_info` producer.

```json
{
  "dto": "GitCommitInfoResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "found": true,
  "commit": {
    "hash": "0123456789abcdef",
    "shortHash": "0123456",
    "summary": "message",
    "author": "User",
    "date": "2026-06-24T12:00:00-05:00"
  }
}
```

### GitBranchList

Use the existing DTO name, but keep a compatibility adapter that can produce the current Python `GitBranches` shape.

```json
{
  "dto": "GitBranchList",
  "version": 1,
  "root": "/repo/root",
  "current": "main",
  "branches": [
    { "name": "main", "current": true, "remote": false },
    { "name": "origin/main", "current": false, "remote": true }
  ]
}
```

### GitRemoteList

```json
{
  "dto": "GitRemoteList",
  "version": 1,
  "root": "/repo/root",
  "remotes": [
    {
      "name": "origin",
      "fetchUrl": "https://example.invalid/repo.git",
      "pushUrl": "https://example.invalid/repo.git"
    }
  ]
}
```

### GitMutationResult

Use for all bounded mutations.

```json
{
  "dto": "GitMutationResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "operation": "stage",
  "ok": true,
  "changedPaths": ["src/file.ts"],
  "statusInvalidated": true
}
```

After any `statusInvalidated: true` mutation, the Python adapter should request `git.snapshot.get` and publish the existing Explorer/main/editor projections from that pipe snapshot.

## Job Request DTOs

### git.clone.start

```json
{
  "url": "https://example.invalid/repo.git",
  "destination": "/projects/repo",
  "branch": null,
  "depth": null,
  "projectGeneration": 42
}
```

### git.pull.start

```json
{
  "root": "/repo/root",
  "remote": "origin",
  "branch": null,
  "rebase": false,
  "projectGeneration": 42
}
```

### git.push.start

```json
{
  "root": "/repo/root",
  "remote": "origin",
  "branch": null,
  "force": false,
  "projectGeneration": 42
}
```

### git.job.cancel

```json
{
  "jobId": "job-abc123",
  "opId": "op-abc123",
  "reason": "user_cancelled"
}
```

## Current Python Adapter State

The app-side Git adapter is `worker_services/git_service.py`. It calls the pipe
provider, validates DTO names, coerces returned DTOs into existing app
projection payloads, and fails loudly when a requested option is not supported.

| Current consumer/source boundary | Pipe replacement |
|---|---|
| Snapshot/status/decorations | `git.snapshot.get` |
| Head blob reads | `git.headBlob` |
| Commit info | `git.commitInfo.get` |
| Worktree change lists | `git.worktreeChanges.get` |
| Git-backed path index | `git.pathIndex.list` |
| Branch list/checkout/create | `git.branchList` / `git.branchCheckout` / `git.branchCreate` |
| Remote list/add | `git.remoteList` / `git.remoteAdd` |
| Stage/unstage/commit/restore/reset/init | `git.stage` / `git.unstage` / `git.commit` / `git.restore` / `git.resetHard` / `git.init` |
| History | `git.history` |
| Editor diff hunk helper | `git.diff.hunks` |
| File-level diff rows | `git.diff` |
| Clone/pull/push jobs | `git.clone.start` / `git.pull.start` / `git.push.start` plus `git.job.progress` notifications |

Historical local producers such as `git_helper.py`, direct `git` subprocess
calls, GitPython/pygit2 producers, and app-local clone/pull/push job producers
are not part of the active Code TE2 Git data path.

Current adapter limitations:

- `git.restore` supports the default restore source through the app adapter; non-default source refs are rejected at the adapter boundary until the app projection contract needs them.
- `git.pull` and `git.pull.start` reject `rebase: true` at the app adapter boundary.
- `git.push` and `git.push.start` reject `force: true` at the app adapter boundary.
- Active push cancellation is best-effort where libgit2 exposes progress/cancellation hooks; cancellation is still honored before queued jobs and before push negotiation.

## Routing And Scheduling Rules

- A start request records the initiating envelope identity: `originNid`, `originName`, `correlationId`, `opId`, `workspaceRoot`, and `projectGeneration`.
- Every progress notification targets that recorded identity exactly.
- Each job emits monotonic `sequence` values per `jobId`.
- Terminal job notification is exactly one of `succeeded`, `failed`, or `cancelled`.
- Blocking libgit2 calls run in a blocking thread/task pool. They must not run on the async dispatcher loop.
- Short get/read operations may return one response, but their blocking work still runs off-loop.
- Long operations return `GitJobStarted` quickly and emit progress/completion later.

## Adoption State

1. Current Explorer/frontend notification shapes stay unchanged.
2. `worker_services/git_service.py` is the Python pipe adapter and projection seam.
3. Explorer Git status/decorations/search/commands/jobs, main host Git UI, UI IPC branch actions, state/diff-base metadata, `read_head_blob_text(...)`, and `diff_helper.collect_diff(...)` are pipe-backed.
4. No app-worker HTTP route owns the Explorer Git data path; Git data production stays behind the pipe adapter.
5. Future Git expansion should extend this pipe contract first, then add app adapter projection code only where a current frontend/backend payload needs it.
