# WBA Runtime Evaluation

The Python evaluator cannot execute arbitrary JavaScript inside an already-running
WBA. WBA now supplies its own trusted evaluator, enabled only at process startup
by `TE2_RUNTIME_DEBUG`, on the existing length-framed MessagePack stdin/stdout pipe.
This works on Node and Bun and adds no listener, polling loop, or production eval
endpoint. WBA's HTTP `/cmd` and browser Socket.IO dispatcher reject these methods.

## Completion Investigation

Live reproduction with basedpyright 1.40.1 and Bun, 2026-09-20:

- Python provider registration to Monaco registration: approximately 80 ms.
- First completion: browser-to-WBA 92 ms, dispatch/preparation about 56 ms,
  extension-host pending reply 10,040 ms, result conversion about 7 ms. WBA
  returns 733 items, approximately 194 ms after the browser's 10-second deadline.
- Next request: 430 ms end-to-end, 278 ms extension-host reply, 32 items. Different
  input/result sizes prevent attributing the difference solely to cache warming.
- The page was visible during reproduction. Trace proves the delay is inside the
  extension-host request path, not which internal basedpyright stage consumed it.
  The user reports other LSPs do not have this delay.

Previously the browser allowed 10 s but WBA allowed 8 s + 5 s for the provider.
`protocol/completion-timeouts.ts` now owns the shared contract: 30 s provider,
45 s operation (5 s sync + 5 s missing-provider wait + provider + 5 s margin),
195 s outer RPC. The outer budget covers two existing gate admissions, activation
then completion: each can queue for operation + 5 s and run for operation; add
5 s transport margin. Only actual contention uses that allowance. It does not
let a provider run for 195 s and does not add latency to fast replies. Disconnect
still rejects pending frontend requests. Tests exercise the real dispatcher,
gate, pending-request owner, browser codec/transport and completion shim with an
injected clock, including a 29-second provider response after queueing.

Source comparison (read-only; no upstream or extension edits):

- Local code-server VS Code source at `591199df409fbf59b4b52d5ad4ee0470152a9b31`,
  `src/vs/workbench/services/language/common/languageService.ts:287`, activates
  `onLanguage:<id>` and `onLanguage` when rich language features are requested.
  WBA `activateLanguage` sends the same events; document opening/hydration already
  activates the language rather than waiting for the first completion request.
- VS Code `src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts:615` and
  `src/vs/workbench/api/common/extHostLanguageFeatures.ts:1166` await completion
  providers with cancellation tokens, with no fixed 10-second deadline in those
  methods. Local Monaco fork `src/vs/editor/contrib/suggest/browser/suggest.ts:293`
  reuses prior provider results and queries provider groups. No generic first
  completion pre-warm was found in these inspected paths. Our callback currently
  discards its Monaco cancellation token; fixing that is a separate change.
- [Basedpyright v1.40.1 language-server source](https://github.com/DetachHead/basedpyright/blob/v1.40.1/packages/pyright-internal/src/languageServerBase.ts#L1124)
  awaits workspace selection before running the completion provider. Document
  opening calls `setFileOpened`; analyzer service schedules background reanalysis.
- [CompletionProvider.getCompletions](https://github.com/DetachHead/basedpyright/blob/v1.40.1/packages/pyright-internal/src/languageService/completionProvider.ts#L422)
  calls `program.loadStdlibModules` before collecting suggestions. Its auto-import
  path builds a module-symbol map with `bindUnboundUserCode: true`.
  [Program.loadStdlibModules](https://github.com/DetachHead/basedpyright/blob/v1.40.1/packages/pyright-internal/src/analyzer/program.ts#L1199)
  looks up top-level stdlib imports. These are plausible cold-request costs, not
  measured attribution of the captured delay. Registration is not proof that all
  completion data is already prepared.

Next investigation, if needed: extension/LS-side spans around workspace readiness,
stdlib loading, symbol-map building and candidate generation, using the same query
and document state for comparisons. The initial slice changed deadlines only.

### Approved Completion Warm-Up

A later evaluation-only experiment sent one completion request on the already-open
Python document, without edits or UI publication. It took 2.50 s; subsequent typed
completion returned 733 suggestions in 1.83 s end-to-end (1.57 s inside the
extension-host path). The user reported a substantial improvement. This was not a
controlled A/B because cursor position and background analysis differed.

`extensions/intelligence/completion-warmup.ts` now coordinates the approved
production behavior: provider registration and successful open/hydration schedule
one request per matching provider/language/project session. It prefers an available
foreground document and uses line 1, column 1 with an explicit invocation context.
The request has the existing 30-second provider budget, but holds no interactive
operation gate and never changes document text, cursor, focus, or UI suggestions.
Warm-ups run serially among themselves; user operations remain independent.

Registration before document synchronization and registration after an already-open
document are both supported, including pattern-only selectors. Real requests mark
the same one-shot key; failures are contained, not retried on each tab switch.
Project/host resets invalidate pending scheduling and permit a new session attempt.
Discarded result caches are released only to the same host connection. Metadata-only
`completion.warmup.begin/end/failed` trace events remain runtime-debug gated; the
warm-up itself does not require debug mode. No evaluation probe is installed by
this policy. Reloading the built WBA and production live acceptance remain user-owned.

## Target And Transport

```text
te2 framework wba-status / wba-eval, or te2_wba_status / te2_wba_eval MCP
  -> existing credential-protected framework evaluation route
  -> exact Code TE2 Python worker (app, shell, bridge instance)
  -> lazy workbench_runtime_debug.request_wba helper on the owning loop
  -> existing adapter_rpc MessagePack pipe, with expected WBA shell identity
  -> WBA runtime.debug.status / runtime.debug.eval, with WBA process identity
```

WBA is a child diagnostic target, not a fake browser console worker. Parent
discovery remains `te2 framework list-workers`. Status discovers the current WBA
shell and process UUID; evaluation requires both. A replaced parent, WBA shell,
or WBA process is rejected rather than silently retargeted. Status never launches
WBA. A restarted Python worker can adopt an existing WBA, so a page refresh or
Python restart alone is not proof that a newly built WBA evaluator has loaded.

CLI uses the existing private local credential file. MCP must receive an explicit
credential and never retrieves that local file on behalf of a caller. No new Rust
protocol or endpoint is required. The Python relay program quotes all JavaScript
as data; its generated program also counts toward the Python 32 KiB code limit.

```sh
te2 framework list-workers
te2 framework wba-status --app code_te2 --shell PARENT_SHELL --instance PARENT_INSTANCE
te2 framework wba-eval --app code_te2 --shell PARENT_SHELL --instance PARENT_INSTANCE \
  --wba-shell WBA_SHELL --wba-instance WBA_INSTANCE --code 'wb.providers().completions'
```

Status data is inside the parent evaluator's `data.value`; it includes `shellId`,
`instanceId`, PID, runtime and busy state. WBA eval retains both projections:
`data.value.value` is the WBA result. Check both `truncated` indicators before
treating a returned object as complete.

## Evaluation Semantics

- `wb`: the actual live WorkbenchClient, not a detached copy.
- `state`: the adapter server state.
- `trace`: bounded completion timing recorder (`snapshot`, `clear`, `enabled`).
- `probe`: persistent process-local scratch object for installed probes and cleanup.
- Expressions return their result. Statements can assign `result`; `await`,
  dynamic imports, method wrapping and state mutation are supported.

Evaluation runs on WBA's event loop, not a worker thread or sandbox. One evaluation
may be outstanding at a time. A caller timeout does not stop JavaScript, undo a
mutation or release WBA admission while an async evaluation is still outstanding.
Synchronous infinite loops can stall WBA. Never automatically retry an uncertain
evaluation. Explicitly clean up timers, listeners and wrappers installed by a probe.

Code is limited to 32 KiB, result traversal to 2048 units/depth 12, strings to
4096 characters and encoded results to 64 KiB; error messages are bounded too.
Projection skips accessors and cycles rather than invoking getters/toJSON.
Inspect Maps/Sets explicitly, for example `[...someMap.entries()]`. These bounds
are not a security boundary against trusted evaluated code.

Example temporary probe, supplied through evaluation, not patched onto disk:

```js
if (probe.originalCompletions) throw new Error('Probe already installed');
probe.originalCompletions = wb.completions;
probe.calls = [];
wb.completions = async function (...args) {
  const start = performance.now();
  try { return await probe.originalCompletions.apply(this, args); }
  finally {
    probe.calls.push({ elapsedMs: performance.now() - start });
    if (probe.calls.length > 64) probe.calls.shift();
  }
};
result = 'installed';
```

Read with `probe.calls`. Remove after outstanding calls settle:

```js
if (probe.originalCompletions) wb.completions = probe.originalCompletions;
delete probe.originalCompletions;
delete probe.calls;
result = 'removed';
```

## Completion Trace

Under runtime-debug, the source contains a bounded metadata-only recorder from
process startup, in addition to the arbitrary evaluator. This records no document
text or completion items and emits no periodic log stream. Turn off further WBA
recording with `trace.enabled = false`; clear stored entries with `trace.clear()`.
There are at most 256 WBA events; old events expire as new ones arrive.

Phases distinguish language activation, extension activation notifications,
per-language/per-handle provider registration, provider emission/replay, completion
dispatch, document synchronization, provider wait, and extension-host request/reply.
The existing generic first-provider startup marker is not Python-specific and
must not be mistaken for basedpyright readiness.

For bounded inspection, use expressions such as:

```js
trace.snapshot().events.filter(e => e.language === 'python' || String(e.extensionId).includes('basedpyright'))
trace.snapshot().events.filter(e => e.phase.startsWith('completion.')).slice(-40)
wb.extensionActivitySnapshot().activities.filter(e => e.extensionId === 'detachhead.basedpyright')
```

Debug provider notifications enable a separate browser ring (128 events), available
through the existing browser console as `window.__te2CompletionTrace.snapshot()`.
It records receipt, actual Monaco provider registration, and completion send/reply.
Its `clear()` method clears stored events. A non-debug provider notification
disables and clears it. Frontend request IDs are carried into WBA completion traces;
use the client identity at `completion.dispatch` to distinguish client-local IDs.

Wall timestamps correlate only when clocks are aligned; monotonic durations are
local to their process. Provider registration is not a completed suggestion query.
WBA evaluation cannot inspect basedpyright's separate language-server heap or the
remote extension-host JavaScript directly. Their activation/output logs complement
this boundary trace.

## Reproduction

Build WBA and Code TE2 frontend; no asset version bump or Android publication is
implicit. With user-approved runtime reload, ensure a fresh WBA process starts
under `--runtime-debug`, then update/reload frontend assets normally. Use WBA
status to verify support before reproducing. Capture the trace promptly because
its storage is bounded. Shared runtime restarts remain a user-controlled action.
