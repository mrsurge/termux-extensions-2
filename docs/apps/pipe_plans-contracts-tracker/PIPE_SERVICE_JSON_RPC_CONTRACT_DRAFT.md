# Pipe Service JSON-RPC Contract Draft

## Contract Goal

Provide one language-neutral protocol for framework-supervised service shells that perform blocking filesystem, git, and OS operations outside app hot paths.

The protocol must support Python and Rust framework routers, current `file_editor_cm6` consumers, and future service shells.

## Current Proof Slice

- `app/apps/file_explorer` declares its normal `app-worker` shell as
  `backend: pipe`.
- The `app-worker` still receives `${free_port}` / `TE_APP_WORKER_PORT`, still
  runs FastAPI/uvicorn for normal app-shell HTTP routes, and also runs
  `app.libs.app_worker --pipe`, which reserves stdin/stdout for msgspec JSONL
  protocol frames and sends logs to stderr.
- App backend service clients call the configured `app.libs.pipe_runtime`
  dispatcher to retrieve DTOs from the app-worker pipe boundary.
- The path `app_id` is the app boundary. Inside that app, `targetName` /
  `targetNid` select the addressed service or consumer. Pipe-capable app
  workers must reject envelopes addressed to a different identity before
  dispatching them to app code.
- File Explorer keeps the normal frontend API path. Its backend route calls
  `fs.listDirectory` through `app.libs.pipe_runtime` and adapts
  `FsDirectoryListing` back to the existing `{entries,path}` response.
- No silent fallback is allowed for this cutover. Missing pipe-backed app
  workers, timeout, protocol errors, or service errors are explicit backend
  failures.

## Stream Discipline

- `stdin`: protocol input only.
- `stdout`: protocol output only.
- `stderr`: all logs, progress text, debug output, warnings, tracebacks, and human-readable shell output.

Service shells must treat accidental writes to stdout as protocol corruption.

Legacy event-bus stdout metrics are not valid in protocol mode. Any worker or
service using stdout for JSON-RPC must move metrics/logging to stderr, a
framework log sink, or an explicit protocol notification.

## Framing

Initial framing target: newline-delimited JSON frames on stdout/stdin.

Rules:

- One complete JSON object per line.
- UTF-8 only.
- No human text on stdout.
- Large binary payloads use the byte payload codec, not raw stdout bytes.

A later byte-framed transport can preserve the same envelope and payload DTOs.

## Envelope

All request, response, notification, progress, cancel, and error messages use one envelope family.

```json
{
  "jsonrpc": "2.0",
  "protocolVersion": 1,
  "kind": "request",
  "id": "req-000001",
  "method": "fs.listDirectory",
  "originNid": 1100,
  "originName": "file_editor_cm6.explorer",
  "targetNid": 2100,
  "targetName": "service.fs",
  "projectGeneration": 42,
  "workspaceRoot": "/repo/root",
  "correlationId": "open-project-abc",
  "opId": "op-000123",
  "params": {}
}
```

## Envelope Fields

Required for all messages:

- `jsonrpc`: currently `"2.0"`.
- `protocolVersion`: integer protocol version.
- `kind`: one of `hello`, `request`, `response`, `notification`, `progress`, `cancel`, `error`.
- `originNid`: numeric sender identity.
- `originName`: symbolic sender identity.

Request fields:

- `id`: unique request id scoped to the origin router.
- `method`: service method name.
- `targetNid`: numeric target identity.
- `targetName`: symbolic target identity.
- `params`: method DTO.

Response fields:

- `id`: request id being answered.
- `result`: result DTO on success.

Error fields:

- `id`: request id when the error answers a request; absent for process-level errors.
- `error`: structured error object.

Optional routing/context fields:

- `projectGeneration`: project-switch generation guard.
- `workspaceRoot`: absolute project root for project-scoped operations.
- `correlationId`: groups a multi-step user action.
- `opId`: long-running operation id for progress and cancellation.
- `sequence`: monotonic sequence per origin when ordering matters.

## Correlation And Generation Rules

`correlationId` is required when one user action fans out into multiple service
requests or surface projections.

Required correlation families:

- project switch
- WBA reconnect/session reset/workspace-ready lifecycle
- open file plus sidecar/open-state replay
- recursive copy/move/delete
- search
- git clone/pull/push/fetch/commit
- any operation that emits progress before its terminal response

`projectGeneration` is required for every project-scoped fs/git/search result.
Consumers must drop stale generation results before they mutate backend state or
emit frontend projections.

## NID Model

NIDs identify protocol participants. Request ids identify request/response pairs. They are separate concepts.

## App And Service Routing

Routing has three separate axes:

- The normal app route, such as `/api/app/{app_id}/...`, reaches the app
  backend.
- `targetName` and `targetNid` select the app-internal service or consumer
  within that backend's configured pipe runtime.
- `id` matches the response to the pending request; it does not select the
  service.

Apps opt into internal pipe routing by advertising service identity in launch
metadata, normally through shell subgroups plus `TE_PIPE_NAME` / `TE_PIPE_NID`.
The pipe routing layer must only dispatch a request to a participant advertising
the requested `targetName`. The pipe worker must also validate `targetName` and
`targetNid` against its own identity before calling the app dispatcher.

This gives two independent checks:

- framework-side selection prevents the request from going to the wrong running
  shell;
- process-side validation prevents a wrong envelope from being handled even if
  the shell selection layer is misconfigured.

Rules:

- Every participant has a stable symbolic name.
- Numeric NIDs are assigned by the pipe supervisor during `hello` unless a static range is explicitly reserved.
- Logs should include both `originNid` and `originName`.
- DTOs must not depend on a specific numeric NID value.

Reserved symbolic participants:

| Symbolic name                | Role                                       |
| ---------------------------- | ------------------------------------------ |
| `framework.python`           | Python framework router/supervisor         |
| `framework.rust`             | Rust spike router/supervisor               |
| `file_editor_cm6.explorer`   | Explorer backend consumer/projector        |
| `file_editor_cm6.editor`     | Editor backend consumer/projector          |
| `file_editor_cm6.main`       | Main host/UI IPC consumer/projector        |
| `file_editor_cm6.wbaWatcher` | WBA watcher normalization producer         |
| `service.fs`                 | Filesystem service shell                   |
| `service.git`                | Git service shell                          |
| `service.os`                 | OS/process helper service shell            |
| `service.search`             | Search service shell, if split from fs/git |

Suggested static ranges if static ids are needed:

| Range       | Owner                   |
| ----------- | ----------------------- |
| `1-99`      | framework routers       |
| `1000-1999` | app consumers/producers |
| `2000-2999` | service shells          |
| `9000-9999` | tests/fakes             |

## Request Ids

Request ids route exactly one response or terminal error to exactly one pending caller.

Rules:

- Request ids are generated by the origin router/client.
- Request ids must be unique among in-flight requests for that origin.
- Request ids are not reused until the prior request is terminal.
- Notifications do not carry `id`.
- Progress messages use `opId`, not `id`, unless they also need to reference the initiating request.

## Operation Ids

`opId` tracks long-running work and cancellation.

Used for:

- search
- git clone/pull/push/fetch
- git commit when it performs hooks or other long-running work
- large copy/move/delete
- recursive directory operations
- long diff/history operations

Cancellation shape:

```json
{
  "jsonrpc": "2.0",
  "protocolVersion": 1,
  "kind": "cancel",
  "originNid": 1100,
  "originName": "file_editor_cm6.explorer",
  "targetNid": 2300,
  "targetName": "service.search",
  "opId": "op-000123",
  "reason": "user_cancelled"
}
```

## Payload Codec

Payload values are one of three forms.

### Object Payload

Default form for JSON DTOs.

```json
{
  "payloadKind": "object",
  "value": {
    "path": "/repo/root/file.py"
  }
}
```

### String Payload

Used for text content where encoding is known.

```json
{
  "payloadKind": "string",
  "encoding": "utf-8",
  "value": "text content"
}
```

### Byte Payload

Used for binary content. Initial transport uses base64 inside JSON.

```json
{
  "payloadKind": "bytes",
  "encoding": "base64",
  "value": "AAEC"
}
```

Large payload upgrade path:

- preserve the same DTO field names
- replace base64 JSON value with a side-channel chunk reference only after the basic protocol is working

## Error Shape

```json
{
  "code": "fs.notFound",
  "message": "Path does not exist",
  "retryable": false,
  "details": {
    "path": "/repo/root/missing.py"
  }
}
```

Error rules:

- Expected misses are typed errors or typed miss results, not tracebacks.
- Native/library crashes are process-level failures handled by the framework supervisor.
- Permission, not-found, outside-root, git-no-head, and not-a-repo cases must be distinguishable.

## Core DTO Families

### FsDirectoryListing

```json
{
  "dto": "FsDirectoryListing",
  "version": 1,
  "root": "/repo/root",
  "path": "/repo/root/src",
  "resolvedPath": "/repo/root/src",
  "projectGeneration": 42,
  "entries": [
    {
      "name": "main.py",
      "path": "/repo/root/src/main.py",
      "relativePath": "src/main.py",
      "kind": "file",
      "size": 1234,
      "mtimeMs": 1780000000000,
      "isSymlink": false,
      "gitStatus": "modified",
      "draftState": null
    }
  ]
}
```

### FsReadResult

```json
{
  "dto": "FsReadResult",
  "version": 1,
  "path": "/repo/root/src/main.py",
  "content": {
    "payloadKind": "string",
    "encoding": "utf-8",
    "value": "print('hello')\n"
  },
  "stat": {
    "mtimeNs": 1780000000000000000,
    "size": 15,
    "mode": 33188
  },
  "sha256": "hex"
}
```

### FsWriteResult

```json
{
  "dto": "FsWriteResult",
  "version": 1,
  "path": "/repo/root/src/main.py",
  "atomic": true,
  "stat": {
    "mtimeNs": 1780000000000000000,
    "size": 15,
    "mode": 33188
  },
  "sha256": "hex"
}
```

### FileChangeBatch

```json
{
  "dto": "FileChangeBatch",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "source": "wbaWatcher",
  "changes": [
    {
      "path": "/repo/root/src/main.py",
      "relativePath": "src/main.py",
      "kind": "changed"
    }
  ]
}
```

`FileChangeBatch` is an invalidation/input DTO. It must not fabricate git status
or directory-listing results. Consumers may use it to request fresh
generation-tagged `FsDirectoryListing` or `GitSnapshot` data.

### GitSnapshot

```json
{
  "dto": "GitSnapshot",
  "version": 1,
  "root": "/repo/root",
  "projectPath": "/repo/root",
  "projectGeneration": 42,
  "isRepository": true,
  "hasHead": true,
  "branch": "main",
  "detached": false,
  "head": {
    "full": "abc123...",
    "short": "abc123"
  },
  "ahead": 1,
  "behind": 0,
  "staged": ["src/staged.py"],
  "unstaged": ["src/main.py"],
  "untracked": ["src/new.py"],
  "statuses": {
    "src/staged.py": "staged",
    "src/main.py": "modified",
    "src/new.py": "untracked"
  }
}
```

`GitSnapshot` is the first Explorer git DTO. It intentionally combines footer
summary fields and tree-decoration fields so Explorer never receives a status
footer generated from one git read and decorations generated from another.

`isRepository: false` is a valid git result, not a transport failure. In that
case the service returns empty `staged`, `unstaged`, `untracked`, and
`statuses`, with `hasHead: false`, `branch: null`, `detached: false`,
`ahead: 0`, and `behind: 0`.

`statuses` is the direct rel-path decoration map consumed by the current
Explorer tree. Valid values are:

- `clean`
- `modified`
- `staged`
- `staged_modified`
- `added`
- `deleted`
- `renamed`
- `conflict`
- `untracked`
- `ignored`

The Code TE2 adapter projects one accepted `GitSnapshot` into the existing
frontend notifications:

- `explorer.git.status.updated`: summary fields plus `projectPath`.
- `explorer.git.decorations.updated`: `{ "statuses": snapshot.statuses,
"projectPath": snapshot.projectPath }`.

Pipe/service failure must not reuse stale git data. The adapter must clear or
suppress git projections on failure rather than showing old branch/status
values as current.

Before the transport cutover, the existing in-process git producer must generate
this exact `GitSnapshot` DTO and Explorer must consume it through the same
adapter that the future pipe client will use. The pipe cutover then changes only
the producer origin from in-process to `service.git`.

#### `git.snapshot.get`

Initial Explorer request shape:

```json
{
  "method": "git.snapshot.get",
  "targetNid": 2200,
  "targetName": "service.git",
  "workspaceRoot": "/repo/root",
  "projectGeneration": 42,
  "params": {
    "root": "/repo/root",
    "includeStatus": true,
    "includeDecorations": true,
    "untracked": "normal"
  }
}
```

Rules:

- `root` must match `workspaceRoot` and the active app project root at the app
  adapter boundary.
- `untracked` is initially `"normal"` to match current Explorer behavior.
- The response `result` is one `GitSnapshot`.
- The framework/provider must treat expected git misses as typed DTO state, not
  process failure: non-repo, unborn HEAD, no upstream, no changes, and empty
  status are successful `GitSnapshot` results.
- Transport/protocol failure, malformed DTO, wrong `dto`, wrong `root`, or stale
  `projectGeneration` are adapter failures and must not publish stale git
  projections.

### GitMutationResult

```json
{
  "dto": "GitMutationResult",
  "version": 1,
  "root": "/repo/root",
  "operation": "stage",
  "ok": true,
  "changedPaths": ["src/main.py"],
  "statusInvalidated": true
}
```

### GitDiffResult

```json
{
  "dto": "GitDiffResult",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "base": "HEAD",
  "paths": ["src/main.py"],
  "files": [
    {
      "relativePath": "src/main.py",
      "status": "modified",
      "patch": {
        "payloadKind": "string",
        "encoding": "utf-8",
        "value": "diff --git ..."
      }
    }
  ]
}
```

### GitHeadBlobResult

```json
{
  "dto": "GitHeadBlobResult",
  "version": 1,
  "root": "/repo/root",
  "relativePath": "src/main.py",
  "found": true,
  "content": {
    "payloadKind": "string",
    "encoding": "utf-8",
    "value": "HEAD text"
  },
  "head": "abc123"
}
```

### GitBranchList

```json
{
  "dto": "GitBranchList",
  "version": 1,
  "root": "/repo/root",
  "current": "main",
  "branches": [
    {
      "name": "main",
      "current": true,
      "remote": false
    }
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
      "fetchUrl": "git@example/repo.git",
      "pushUrl": "git@example/repo.git"
    }
  ]
}
```

### EditorBaselineSnapshot

```json
{
  "dto": "EditorBaselineSnapshot",
  "version": 1,
  "path": "/repo/root/src/main.py",
  "relativePath": "src/main.py",
  "disk": {
    "found": true,
    "sha256": "hex"
  },
  "head": {
    "found": true,
    "sha256": "hex"
  },
  "projectGeneration": 42
}
```

### SearchResultBatch

```json
{
  "dto": "SearchResultBatch",
  "version": 1,
  "root": "/repo/root",
  "projectGeneration": 42,
  "opId": "op-000123",
  "complete": false,
  "results": [
    {
      "path": "/repo/root/src/main.py",
      "relativePath": "src/main.py",
      "kind": "content",
      "line": 12,
      "column": 5,
      "preview": "matched text"
    }
  ]
}
```

## Method Namespace Draft

Filesystem:

- `fs.stat`
- `fs.read`
- `fs.writeAtomic`
- `fs.listDirectory`
- `fs.createDirectory`
- `fs.createFile`
- `fs.rename`
- `fs.copy`
- `fs.move`
- `fs.delete`

Git:

- `git.snapshot.get`
- `git.headBlob`
- `git.diff`
- `git.stage`
- `git.unstage`
- `git.restore`
- `git.commit`
- `git.branchList`
- `git.branchCheckout`
- `git.branchCreate`
- `git.remoteList`
- `git.remoteAdd`
- `git.history`
- `git.init`
- `git.clone`
- `git.pull`
- `git.push`

Search:

- `search.files`
- `search.content`
- `search.changes`

OS:

- `os.which`
- `os.envGet`
- `os.spawnChecked`

Protocol:

- `protocol.hello`
- `protocol.capabilities`
- `protocol.shutdown`

## Ordering Rules

- A response must not be applied if its `projectGeneration` is older than the consumer's active generation.
- Progress events for an `opId` are ordered by `sequence` when available.
- `FileChangeBatch` can invalidate git/listing state, but it should not directly fabricate git results.
- Consumers project DTOs into current frontend notifications; DTO producers do not emit frontend-specific notification names.
- Store mutations happen before backend projection notifications.
- Surface projections stay lane-local: Explorer emits Explorer RPC notifications, editor emits editor RPC notifications, host emits UI IPC notifications, and sidebar emits sidebar IPC/backend app-state notifications.

## Project Bootstrap Replay Order

Protocol DTOs must preserve enough information for the app/framework layer to
replay project state in this order:

1. active project metadata
2. adapter/project readiness
3. open-state / active-file projection
4. root tree / open directories
5. last-known git projection or pending-refresh marker
6. watcher status/error projection
7. diagnostics detail/counts projection
8. draft/review projection
9. preferences/sidebar-window projection where relevant

Service shells do not own this replay policy. They return DTOs with generation
and correlation metadata so the app/framework projector can enforce it.

## Compatibility Rule

The current in-process route can carry this envelope before the pipe exists.

That means the first implementation target is not the pipe itself. The first implementation target is making current producers and consumers agree on this contract.
