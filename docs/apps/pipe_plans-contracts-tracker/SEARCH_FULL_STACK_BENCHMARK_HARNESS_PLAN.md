# Search Full-Stack Benchmark Harness Plan

## Purpose

Create an explicit benchmark harness for Code TE2 search that measures the real stack without leaking benchmark counters, timers, or pressure probes into the normal search hot path.

Normal Explorer search must stay production-clean. Benchmark collection must only run when an explicit diagnostic method is triggered.

## Non-Negotiables

- Benchmark metrics must stay off the normal search hot path.
- Normal `explorer.search.run`, `search.files.start`, and `search.content.start` must not emit benchmark frames or carry benchmark-only fields.
- Runtime search may still report behavior-relevant facts needed for correctness, such as cancellation reason, truncation reason, required-event enqueue failure, and typed errors.
- Benchmark execution must be explicit, typed, opt-in, and easy to disable by absence of a caller.
- Full benchmark results should be written to a file, not dumped into console logs.
- Console output should be a small sanity summary only: suite id, status, output path, and maybe frontend totals.
- The harness must support both a generic suite and a custom one-shot query/filter run.

## Compatibility With Current Work

This plan is compatible with the current dirty `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services` benchmark/test changes.

Those changes are useful as the Rust-only test baseline because they already prove:

- the progressive content search path is active,
- the search provider is using the multi-threaded Rust path,
- benchmark/rate output can remain ignored-test-only,
- the generic benchmark cases are useful for comparing filter complexity.

Do not restart from the last commit unless the test-only benchmark matrix is intentionally abandoned. The live harness should be additive and should not reuse ignored Cargo test code as production logic.

## Trigger Model

### Frontend Trigger

A frontend benchmark helper can be called from TE2 console eval, for example:

```js
window.__te2SearchBenchmark?.runGenericSuite?.({ outputPath: undefined });
window.__te2SearchBenchmark?.runOneShot?.({
  query: "import",
  includePatterns: ["*.py"],
});
```

The frontend helper sends a typed request over the normal Explorer/frontend-owned lane to the Python Explorer backend. It waits for benchmark completion and writes only a short console sanity message.

### Backend Or Stdin Trigger

The same suite should also be triggerable without frontend rendering by a typed stdin/pipe RPC method, because framework-shells / ferrous-framework can drive worker stdin directly.

This gives two entry paths:

- frontend-triggered full-stack benchmark,
- backend/pipe-triggered Python+Rust or Rust-only benchmark.

## Benchmark Modes

### Generic Suite

Runs a fixed matrix for comparable baseline tracking.

Initial content-search cases:

| Case                       | Query               | Include | Exclude | Purpose                       |
| -------------------------- | ------------------- | ------- | ------- | ----------------------------- |
| `raw-import`               | `import`            | none    | none    | baseline whole-tree query     |
| `include-py`               | `import`            | `*.py`  | none    | include-filter cost           |
| `exclude-ts`               | `import`            | none    | `*.ts`  | exclude-filter cost           |
| `include-under-exclude-ts` | `import`            | `*_*`   | `*.ts`  | include+exclude combined cost |
| `te2-search-canary`        | `te2_search_canary` | none    | none    | targeted full-stack hit probe |

### Custom One-Shot

Runs one caller-supplied benchmark case.

Supported request fields should include:

- `query`
- `isRegex`
- `isCaseSensitive`
- `isWholeWords`
- `includePatterns`
- `excludePatterns`
- `useIgnoreFiles`
- optional explicit caps only when the caller wants to test capped behavior
- optional `outputPath`
- optional `lanes`
- optional pressure/cancellation profile

## Benchmark Lanes

Each benchmark case can run through one or more lanes.

### Lane 1: Full Stack

Path:

```text
frontend benchmark trigger -> normal explorer.search.run -> ExplorerSearchSessions
-> Rust search pipe job -> normal search.job.* socket notifications
-> normal frontend search controller/render path
```

Purpose:

Measure the actual user-visible stack, including Python routing/cache/projection, socket notification delivery, frontend DTO handling, and render cost.
The benchmark-only code arms timers and aggregation around that path; it must not replace the normal search pipeline with a sideband pipe listener.

Frontend result fields:

- `renderedFiles`
- `renderedMatches`
- `firstResultReceivedMs`
- `renderMs`
- `totalRunMs`
- `doneReceivedMs`
- all Python/Rust benchmark summary fields returned for that run

### Lane 2: Python Bridge

Path:

```text
Rust search -> pipe -> Python Explorer backend
```

Purpose:

Measure pipe delivery, Python receive/projection/cache, and Python benchmark dispatch without socket or frontend rendering.

Python result fields:

- `pipeRequestMs`
- `firstPipeResultMs`
- `projectionMs`
- `cacheInsertMs`
- `emittedEvents`
- `receivedFiles`
- `receivedMatches`
- `totalRunMs`
- Rust summary fields returned for that run

### Lane 3: Rust Only

Path:

```text
Rust framework service provider only
```

Purpose:

Measure the live Rust framework process search provider using the same provider primitives as real pipe search, without Python, socket, or frontend costs.

Rust result fields:

- `searchThreads`
- `durationMs`
- `filesScanned`
- `filesMatched`
- `matchesFound`
- `resultBatches`
- `cancelled`
- `cancellationReason`
- `truncatedReason`
- `droppedOptionalEvents`
- `requiredEventFailures`

## Next Search Runtime Optimization Direction

Large-repo live testing and full-stack benchmark output show Rust search throughput is no longer the first bottleneck. The next work should reduce Python-layer allocation, cache size, and DTO copying before attempting semantic cache-derived searches.

### Phase 1: Compact Python Search Cache

Target:

- Keep the external frontend and pipe DTO contracts unchanged.
- Keep `JsonObject` / dictionary handling at RPC boundaries only.
- Replace the in-memory content result cache with compact typed structures.
- Store per-match data without repeated dictionary keys.
- Store match ranges internally as compact tuples and project them back to frontend range objects only on emit.
- Preserve `lineText`, `snippet`, `matchText`, and ranges so future cache-derived narrowing can still be implemented safely.

Expected impact:

- lower Python heap usage for large search results,
- lower GC pressure,
- faster result-frame ingestion,
- faster `more` / `moreInFile` materialization,
- less Rust-to-Python backpressure from Python cache insertion work.

### Phase 2: Typed Search Boundary And Minimal Emits

Target:

- Convert pipe search DTO payloads into strict Python search-layer structures after the `msgspec` envelope has decoded.
- Avoid recursively validating or copying unrelated envelope data on every hit frame.
- Construct minimal outgoing `search.job.*` / Explorer result payloads instead of copying full pipe params/results and mutating them.
- Keep benchmark counters off the normal hot path; only behavior-relevant fields such as cancellation, truncation, and required-event failure remain normal runtime facts.

Implementation status:

- Done in the Python Explorer session layer.
- Routed pipe notifications are parsed into compact search event context objects.
- Hit result parsing reads the decoded pipe dictionaries without normalizing each file/match/range into fresh dictionaries first.
- Outgoing `explorer.search.started`, `search.job.progress`, `search.job.result`, `search.job.done`, and `search.job.error` payloads are built from session state plus the parsed event context instead of copying full inbound pipe params.

Expected impact:

- fewer Python object allocations per result frame,
- lower socket payload construction overhead,
- clearer ownership between pipe envelope shape, Python cache shape, and frontend DTO shape.

### Deferred: Cache-Derived Narrowing

Cache-derived narrowing remains a later optimization. It should only run from a complete, non-stale cache when the new request is provably a subset of the cached request, such as added exclusions or stricter include filters. Query extension, regex changes, case changes, or whole-word changes need explicit matching/range recomputation rules before they can avoid a new Rust search.

## Cancellation And Pressure Tests

The generic suite should eventually include failure/pressure cases from each stack boundary.

### Frontend Cancellation

Cancel after the frontend receives or renders a configured number of result frames.

Expected result:

- frontend reports the cancel trigger,
- Python forwards cancellation,
- Rust stops the search,
- final result records the cancellation reason and where it originated.

### Python Cancellation

Cancel after Python receives/projects a configured number of pipe result frames.

Expected result:

- Python reports the cancel trigger,
- Rust stops the search,
- frontend receives benchmark done/error if running full stack.

### Rust Cancellation

Cancel inside the Rust job during walker/search execution.

Expected result:

- Rust reports cancellation reason,
- Python receives a typed done/error frame,
- frontend sees a complete benchmark result if running full stack.

### Pressure Tests

Pressure tests should be explicit profiles, not ambient instrumentation.

Initial profiles:

- `socketPressure`: stress Python-to-frontend benchmark notification delivery.
- `pipePressure`: stress Rust-to-Python benchmark result delivery.
- `rustQueuePressure`: stress Rust result queue behavior.

Pressure metrics are benchmark-only result fields and must not be emitted by normal search.

## Output File

The benchmark runner writes a structured JSON result file.

Default path policy:

- use caller `outputPath` if supplied,
- otherwise use `$TEMPDIR` when set,
- otherwise use a clearly named workspace-local scratch path.

Suggested filename:

```text
te2-search-benchmark-<suiteId>.json
```

The frontend console summary should include only:

- `suiteId`
- `status`
- `outputPath`
- lane/case count
- frontend render totals for sanity

## Result DTO Shape Draft

### Request

```ts
type SearchBenchmarkRunRequest = {
  dto: "SearchBenchmarkRunRequest";
  version: 1;
  mode: "genericSuite" | "oneShot";
  suiteId?: string;
  outputPath?: string;
  lanes?: Array<"fullStack" | "pythonBridge" | "rustOnly">;
  cases?: SearchBenchmarkCase[];
  pressureProfile?: SearchBenchmarkPressureProfile;
};
```

### Case

```ts
type SearchBenchmarkCase = {
  caseId: string;
  query: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  isWholeWords?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  useIgnoreFiles?: boolean;
  maxFiles?: number;
  maxMatchesPerFile?: number;
  maxMatchesTotal?: number;
};
```

### Result File

```ts
type SearchBenchmarkSuiteResult = {
  dto: "SearchBenchmarkSuiteResult";
  version: 1;
  suiteId: string;
  mode: "genericSuite" | "oneShot";
  startedAtMs: number;
  finishedAtMs: number;
  status: "ok" | "cancelled" | "error";
  outputPath: string;
  cases: SearchBenchmarkCaseResult[];
};
```

### Case Result

```ts
type SearchBenchmarkCaseResult = {
  caseId: string;
  lane: "fullStack" | "pythonBridge" | "rustOnly";
  query: string;
  includePatterns: string[];
  excludePatterns: string[];
  rust?: SearchBenchmarkRustMetrics;
  python?: SearchBenchmarkPythonMetrics;
  frontend?: SearchBenchmarkFrontendMetrics;
  pressure?: SearchBenchmarkPressureMetrics;
  cancellation?: SearchBenchmarkCancellation;
  status: "ok" | "cancelled" | "error";
  error?: string;
};
```

`frontend.visibleWindow` is the authoritative UI-fill metric for `fullStack`.
It is distinct from full-search throughput:

```ts
type SearchBenchmarkVisibleWindowMetrics = {
  cap: 50;
  expectedMatches: number; // min(cap, terminal matchCount)
  deliveredMatches: number;
  receivedMatches: number;
  matchesAtFill: number;
  filesAtFill: number;
  firstResultReceivedMs: number | null;
  lastResultReceivedMs: number | null;
  filledMs: number | null;
  deliveryMs: number | null;
  complete: boolean;
  rates: {
    matchesPerSecond: number;
    deliveryMatchesPerSecond: number | null;
  };
};
```

For broad searches, `filledMs` is the first real frontend result notification
that reaches the 50-match visible window. For sparse searches, `filledMs` is
the last result frame once terminal `done` proves all expected matches have
arrived. Terminal full-search totals remain under
`frontend.authoritative` / `frontend.scanRates`.

## Implementation Phases

### Phase 1: Contract And Backend Skeleton

- Add benchmark DTO contract docs.
- Add Python Explorer backend method for benchmark run requests.
- Add Rust pipe method names and DTO skeletons.
- Ensure benchmark code path is isolated from normal `explorer.search.run`.

### Phase 2: Rust-Only Live Benchmark

- Add explicit Rust pipe method for benchmark execution.
- Reuse search provider primitives, not ignored Cargo tests.
- Return structured benchmark metrics only through the benchmark method.
- Add generic suite and one-shot support.

### Phase 3: Python Bridge Benchmark

- Add Python benchmark runner that calls Rust benchmark/search methods through pipe.
- Measure Python projection/cache/receive timings in the benchmark runner only.
- Write JSON result file.

### Phase 4: Frontend Full-Stack Benchmark

- Add frontend benchmark helper callable from console eval.
- Render benchmark results through the same result DTO renderer path used by Explorer search when appropriate.
- Measure rendered files/matches, render time, and total done time.
- Print only a short sanity summary to console.

### Phase 5: Cancellation And Pressure Profiles

- Add frontend cancellation profile.
- Add Python cancellation profile.
- Add Rust cancellation profile.
- Add socket/pipe/rust-queue pressure profiles.
- Ensure every profile reports typed origin and reason.

## Planned Files

Likely Python scope:

- `app/apps/file_editor_cm6/explorer/transport/rpc_contract.py`
- `app/apps/file_editor_cm6/explorer/handlers/search.py`
- `app/apps/file_editor_cm6/explorer/search.py`
- `app/apps/file_editor_cm6/explorer/services/search_sessions.py`
- optional new `app/apps/file_editor_cm6/explorer/services/search_benchmark.py`

Likely frontend scope:

- `app/apps/file_editor_cm6/src/explorer/rpc/contract.ts`
- `app/apps/file_editor_cm6/src/explorer/search/controller.ts`
- optional new benchmark helper module under `app/apps/file_editor_cm6/src/explorer/search/`

Likely Rust scope:

- `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/search_ops.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/pipe/search_pipe_ops.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/scheduler.rs`
- optional new `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/search_benchmark.rs`

Planning/docs scope:

- `docs/apps/pipe_plans-contracts-tracker/SEARCH_FULL_STACK_BENCHMARK_HARNESS_PLAN.md`
- `docs/apps/pipe_plans-contracts-tracker/SEARCH_PIPE_DTO_CONTRACT.md` if benchmark DTOs are promoted into the formal contract

## Validation Strategy

- Normal search tests must pass with benchmark tests ignored.
- Ignored Rust benchmark tests remain available for provider-only local checks.
- Full-stack benchmark is validated by triggering it through TE2 console eval and checking the result file.
- Console output is only a summary and must not contain the full matrix.
- Normal Explorer search should produce no benchmark output.
- Benchmark results must separate accumulated result-frame counts from terminal `done` counts. Terminal `done` totals are the authoritative completion totals; mismatches mark the case `partial`/`incomplete` instead of `ok`.
- Result files should include calculated full-search rates such as results, matches, files scanned, and files matched per second at case and lane-summary level.
- Full-stack result files must separately report visible-window fill metrics so frontend speed is calculated from the time to deliver the first visible 50 matches, or all expected matches for sparse searches.
- Progressive search delivery must preserve required result frames under pressure. Optional progress may drop, but result frames backpressure instead of cancelling the job, and terminal `done` reports pressure metrics.

## Tracker

| Step                                        | Status                                | Outcome                                                                                                                                       |
| ------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Record benchmark harness plan               | Done                                  | This document captures the explicit full-stack benchmark direction.                                                                           |
| Keep benchmark metrics off normal hot path  | Done for current Rust scheduler slice | Runtime scheduler benchmark metrics were removed; ignored tests own provider rate output.                                                     |
| Define formal benchmark DTO contract        | Partial                               | DTOs are implemented in code and drafted here; formal contract doc promotion remains open.                                                    |
| Add Rust live benchmark method              | Done                                  | `search.benchmark.run` returns Rust-only benchmark DTOs through the pipe.                                                                     |
| Add Python bridge benchmark runner          | Done                                  | Explorer backend runs `pythonBridge`, writes JSON result files, and appends frontend data.                                                    |
| Add frontend full-stack runner              | Done                                  | `window.__te2SearchBenchmark` runs normal content searches and records real `search.job.*` socket/controller timing.                          |
| Fix benchmark completion accounting         | Done                                  | Done totals are authoritative, accumulated frames stay separate, and mismatches are flagged.                                                  |
| Add benchmark rate summaries                | Done                                  | Case and lane summaries include calculated result/match/file rates per second.                                                                |
| Split frontend visible-window fill metrics  | Done                                  | Full-stack cases report `visibleWindow` and lane `visibleWindowRates` separately from full-search scan throughput.                            |
| Fix progressive search result backpressure  | Done                                  | Required result frames block on full queues; optional progress drops are counted.                                                             |
| Coalesce no-hit progress traffic            | Done                                  | Hit-bearing results stay atomic; progress/count-only updates coalesce at 256 scanned files.                                                   |
| Add no-filter canary benchmark case         | Done                                  | Generic suite includes `te2_search_canary` to probe targeted progressive hit delivery.                                                        |
| Compact Python search cache                 | Done                                  | Phase 1: `search_sessions.py` now stores content hits as slots cache records with tuple ranges.                                               |
| Add typed search boundary conversion        | Done                                  | Phase 2: routed pipe notifications parse into compact search event context objects.                                                           |
| Minimize outgoing search socket payloads    | Done                                  | Phase 2: normal search job emits are built from session state and event context, not copied params.                                           |
| Evaluate cache-derived narrowing            | Deferred                              | Later: only from complete, same-root/generation caches with proven subset semantics.                                                          |
| Add cancellation profiles                   | Pending                               | Frontend, Python, and Rust-origin cancellation tests.                                                                                         |
| Add pressure profiles                       | Pending                               | Socket, pipe, and Rust queue pressure tests.                                                                                                  |
| Validate no normal search benchmark leakage | Done                                  | Benchmark observers are dormant until triggered; when active, `fullStack` intentionally uses normal `explorer.search.run` and `search.job.*`. |
