# Git Pipe Supplementary Contract

## Goal

Define the missing Git pipe methods and DTOs needed to make Code TE2 Git consumers treat the pipe as the origin for all Git data and Git mutations.

The adapter rule is: keep current frontend and backend projection payloads stable where possible, and make Python modules thin pipe adapters until the old helper modules can be removed.

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
| `git.pull` | Synchronous pull for compatibility routes; return `GitMutationResult` |
| `git.push` | Synchronous push for compatibility routes; return `GitMutationResult` |
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
    "tracked": true
  }
}
```

On non-repo/untracked/no-diff cases, return the same DTO with empty `hunks` and a truthful `summary.tracked` value. Use `error` only for an actual provider failure or capped result.

### GitWorktreeChanges

Replaces `git_helper.get_worktree_changes` for search/review change lists.

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

Replaces the `git ls-files -co --exclude-standard` path in Explorer name search.

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

Replaces `git_helper.get_commit_info`.

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

## Python Adapter Targets

The Python side can remove local Git behavior by turning these modules into pipe adapters or deleting them after callers move:

| Current module/function family | Pipe replacement |
|---|---|
| `worker_services/git_service.py` snapshot/status | `git.snapshot.get` |
| `worker_services/git_service.py` head blob | `git.headBlob` |
| `git_helper.get_status` / `is_git_repository` | `git.snapshot.get` |
| `git_helper.get_commit_info` | `git.commitInfo.get` |
| `git_helper.get_worktree_changes` | `git.worktreeChanges.get` |
| `git_helper.list_branches` | `git.branchList` |
| `git_helper.checkout_branch` | `git.branchCheckout` |
| `git_helper.create_branch` | `git.branchCreate` |
| `git_helper.stage_all` / `stage_paths` | `git.stage` |
| `git_helper.unstage_all` / `unstage_paths` | `git.unstage` |
| `git_helper.commit_changes` | `git.commit` |
| `git_helper.restore_path` | `git.restore` |
| `git_helper.reset_hard` | `git.resetHard` |
| `git_helper.init_repository` | `git.init` |
| `git_helper.get_origin_url` / `get_remotes` / `add_remote` | `git.remoteList` / `git.remoteAdd` |
| `git_helper.get_commits` / `get_commits_for_path` | `git.history` |
| `diff_helper.collect_diff` | `git.diff.hunks` |
| Explorer name-search git index path | `git.pathIndex.list` |
| `app.libs.git_service` clone/pull/push jobs | `git.clone.start` / `git.pull.start` / `git.push.start` plus `git.job.progress` notifications |

## Routing And Scheduling Rules

- A start request records the initiating envelope identity: `originNid`, `originName`, `correlationId`, `opId`, `workspaceRoot`, and `projectGeneration`.
- Every progress notification targets that recorded identity exactly.
- Each job emits monotonic `sequence` values per `jobId`.
- Terminal job notification is exactly one of `succeeded`, `failed`, or `cancelled`.
- Blocking libgit2 calls run in a blocking thread/task pool. They must not run on the async dispatcher loop.
- Short get/read operations may return one response, but their blocking work still runs off-loop.
- Long operations return `GitJobStarted` quickly and emit progress/completion later.

## Adoption Shape

1. Keep current Explorer/frontend notifications unchanged.
2. Add Python pipe adapter functions that coerce these DTOs into existing `GitStatus`, `GitBranches`, `GitCommit`, diff payloads, and `explorer.job.progress` payloads.
3. Cut each consumer from direct helpers to pipe adapters.
4. Remove `app.libs.git_service` import/registration from `file_editor_cm6` once clone/pull/push use pipe jobs.
5. Delete or hollow out direct `git` subprocess/GitPython paths after all callers are pipe-backed.
