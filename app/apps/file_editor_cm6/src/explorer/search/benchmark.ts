import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from "../rpc/contract.ts";
import type { JsonObject } from "../../rpc/transport.ts";

export type SearchBenchmarkLane = "fullStack" | "pythonBridge" | "rustOnly";
export type SearchBenchmarkMode = "genericSuite" | "oneShot";

export interface SearchBenchmarkCaseOptions {
  caseId?: string;
  query: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  isWholeWords?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  useIgnoreFiles?: boolean;
  resultBatching?: SearchResultBatchingOptions;
}

export interface SearchResultBatchingOptions {
  maxFilesPerBatch?: number;
  maxMatchesPerBatch?: number;
}

export interface SearchBenchmarkRunOptions {
  suiteId?: string;
  outputPath?: string;
  lanes?: SearchBenchmarkLane[];
  cases?: SearchBenchmarkCaseOptions[];
}

export interface SearchBenchmarkOneShotOptions extends SearchBenchmarkRunOptions {
  query?: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  isWholeWords?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  useIgnoreFiles?: boolean;
  resultBatching?: SearchResultBatchingOptions;
}

export interface SearchBenchmarkConsoleResult extends JsonObject {
  suiteId: string;
  status: string;
  outputPath: string;
  frontend: JsonObject;
}

interface SearchBenchmarkDeps {
  requestExplorer(
    method: ExplorerRpcMethod,
    payload: JsonObject,
    timeoutMs?: number,
  ): Promise<JsonObject>;
  getProjectPath(): string | null;
  runActualSearchCase(case_: ActualSearchBenchmarkCase): Promise<void>;
}

interface PendingBenchmark {
  suiteId: string;
  startedAt: number;
  progressFrames: number;
  resultFrames: number;
  doneFrames: number;
  errorFrames: number;
  receivedFiles: number;
  receivedMatches: number;
  doneFilesScanned: number | null;
  doneFiles: number | null;
  doneMatches: number | null;
  doneCancelled: boolean;
  cancellationReason: string | null;
  optionalEventsDropped: number;
  requiredEventBackpressureCount: number;
  requiredEventBackpressureMs: number;
  requiredEventFailures: number;
  notificationProcessingMs: number;
  firstResultReceivedMs: number | null;
  doneReceivedMs: number | null;
  errors: string[];
  cases: JsonObject[];
}

interface PendingActualSearchCase {
  suiteId: string;
  lane: "fullStack";
  caseId: string;
  query: string;
  startedAt: number;
  progressFrames: number;
  resultFrames: number;
  doneFrames: number;
  errorFrames: number;
  receivedFiles: number;
  receivedMatches: number;
  filesScanned: number;
  filesMatched: number;
  matchesFound: number;
  firstResultReceivedMs: number | null;
  doneReceivedMs: number | null;
  controllerProcessingMs: number;
  renderFrames: number;
  status: "ok" | "error" | "cancelled";
  error: string | null;
  correlationId: string;
  searchId: string | null;
  jobId: string | null;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve(result: JsonObject): void;
  reject(error: Error): void;
}

export interface ActualSearchBenchmarkCase {
  suiteId: string;
  caseId: string;
  correlationId: string;
  query: string;
  isRegex: boolean;
  isCaseSensitive: boolean;
  isWholeWords: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  useIgnoreFiles: boolean;
}

interface SearchBenchmarkConsoleApi {
  runGenericSuite(
    options?: SearchBenchmarkRunOptions,
  ): Promise<SearchBenchmarkConsoleResult>;
  runOneShot(
    options?: SearchBenchmarkOneShotOptions,
  ): Promise<SearchBenchmarkConsoleResult>;
}

declare global {
  interface Window {
    __te2SearchBenchmark?: SearchBenchmarkConsoleApi;
  }
}

const pendingBenchmarks = new Map<string, PendingBenchmark>();
const pendingActualSearchCases = new Map<string, PendingActualSearchCase>();
let benchmarkDeps: SearchBenchmarkDeps | null = null;

export function installExplorerSearchBenchmarkApi(
  deps: SearchBenchmarkDeps,
): void {
  benchmarkDeps = deps;
  window.__te2SearchBenchmark = {
    runGenericSuite: (options = {}) => runBenchmark("genericSuite", options),
    runOneShot: (options = {}) =>
      runBenchmark("oneShot", normalizeOneShot(options)),
  };
}

export function handleSearchBenchmarkNotification(
  method: string,
  payload: JsonObject,
): void {
  const suiteId = stringValue(payload.suiteId);
  if (!suiteId) return;
  const pending = pendingBenchmarks.get(suiteId);
  if (!pending) return;
  const processingStartedAt = performance.now();
  try {
    if (method === "explorer.search.benchmark.progress") {
      pending.progressFrames += 1;
      return;
    }
    if (method === "explorer.search.benchmark.result") {
      pending.resultFrames += 1;
      if (pending.firstResultReceivedMs === null) {
        pending.firstResultReceivedMs = elapsedMs(pending.startedAt);
      }
      const result = objectValue(payload.result);
      pending.receivedFiles +=
        numberValue(payload.fileCount) ?? countResultFiles(result);
      pending.receivedMatches +=
        numberValue(payload.matchCount) ?? countResultMatches(result);
      return;
    }
    if (method === "explorer.search.benchmark.done") {
      pending.doneFrames += 1;
      pending.doneReceivedMs = elapsedMs(pending.startedAt);
      pending.doneFilesScanned = numberValue(payload.filesScanned);
      pending.doneFiles =
        numberValue(payload.filesMatched) ?? numberValue(payload.fileCount);
      pending.doneMatches =
        numberValue(payload.matchesFound) ?? numberValue(payload.matchCount);
      pending.doneCancelled = payload.cancelled === true;
      pending.cancellationReason = stringValue(payload.cancellationReason);
      pending.optionalEventsDropped =
        numberValue(payload.optionalEventsDropped) ?? 0;
      pending.requiredEventBackpressureCount =
        numberValue(payload.requiredEventBackpressureCount) ?? 0;
      pending.requiredEventBackpressureMs =
        numberValue(payload.requiredEventBackpressureMs) ?? 0;
      pending.requiredEventFailures =
        numberValue(payload.requiredEventFailures) ?? 0;
      return;
    }
    if (method === "explorer.search.benchmark.error") {
      pending.errorFrames += 1;
      const message =
        stringValue(payload.error) || stringValue(payload.message);
      if (message) pending.errors.push(message);
    }
  } finally {
    pending.notificationProcessingMs += performance.now() - processingStartedAt;
  }
}

export function hasActiveActualSearchBenchmark(): boolean {
  return pendingActualSearchCases.size > 0;
}

export function observeActualSearchNotification(
  method:
    | "search.job.progress"
    | "search.job.result"
    | "search.job.done"
    | "search.job.error",
  payload: JsonObject,
  controllerProcessingMs: number,
): void {
  const pending = pendingActualCaseForPayload(payload);
  if (!pending) return;
  pending.controllerProcessingMs += controllerProcessingMs;
  pending.renderFrames += 1;
  pending.searchId = stringValue(payload.searchId) || pending.searchId;
  pending.jobId =
    stringValue(payload.jobId) || stringValue(payload.opId) || pending.jobId;

  if (method === "search.job.progress") {
    pending.progressFrames += 1;
    pending.filesScanned =
      numberValue(payload.filesScanned) ?? pending.filesScanned;
    pending.filesMatched =
      numberValue(payload.filesMatched) ?? pending.filesMatched;
    pending.matchesFound =
      numberValue(payload.matchesFound) ?? pending.matchesFound;
    return;
  }

  if (method === "search.job.result") {
    pending.resultFrames += 1;
    if (pending.firstResultReceivedMs === null) {
      pending.firstResultReceivedMs = elapsedMs(pending.startedAt);
    }
    const result = objectValue(payload.result);
    pending.receivedFiles += countVisibleResultFiles(result);
    pending.receivedMatches += countVisibleResultMatches(result);
    return;
  }

  if (method === "search.job.done") {
    pending.doneFrames += 1;
    pending.doneReceivedMs = elapsedMs(pending.startedAt);
    pending.filesMatched =
      numberValue(payload.fileCount) ??
      numberValue(payload.filesMatched) ??
      pending.filesMatched;
    pending.matchesFound =
      numberValue(payload.matchCount) ??
      numberValue(payload.matchesFound) ??
      pending.matchesFound;
    pending.status = payload.cancelled === true ? "cancelled" : "ok";
    finishActualSearchCase(pending);
    return;
  }

  pending.errorFrames += 1;
  pending.status = "error";
  pending.error =
    stringValue(payload.message) ||
    stringValue(payload.code) ||
    "Search failed";
  finishActualSearchCase(pending);
}

async function runBenchmark(
  mode: SearchBenchmarkMode,
  options: SearchBenchmarkRunOptions,
): Promise<SearchBenchmarkConsoleResult> {
  const deps = benchmarkDeps;
  if (!deps) {
    throw new Error("Explorer search benchmark API is not installed");
  }
  const suiteId = options.suiteId || `search-benchmark-${Date.now()}`;
  const pending: PendingBenchmark = {
    suiteId,
    startedAt: performance.now(),
    progressFrames: 0,
    resultFrames: 0,
    doneFrames: 0,
    errorFrames: 0,
    receivedFiles: 0,
    receivedMatches: 0,
    doneFilesScanned: null,
    doneFiles: null,
    doneMatches: null,
    doneCancelled: false,
    cancellationReason: null,
    optionalEventsDropped: 0,
    requiredEventBackpressureCount: 0,
    requiredEventBackpressureMs: 0,
    requiredEventFailures: 0,
    notificationProcessingMs: 0,
    firstResultReceivedMs: null,
    doneReceivedMs: null,
    errors: [],
    cases: [],
  };
  pendingBenchmarks.set(suiteId, pending);
  try {
    const payload = buildRunPayload(mode, suiteId, options);
    const fullStackCases = payloadHasFullStackLane(payload)
      ? normalizedCasesForRun(mode, options)
      : [];
    const result = await deps.requestExplorer(
      EXPLORER_RPC_METHODS.searchBenchmarkRun,
      payload,
      180000,
    );
    if (fullStackCases.length > 0) {
      for (const case_ of fullStackCases) {
        const caseResult = await runActualFullStackCase(suiteId, case_);
        pending.cases.push(caseResult);
      }
    }
    const outputPath = stringValue(result.outputPath) || "";
    const frontend = buildFrontendMetrics(pending);
    if (outputPath) {
      await deps.requestExplorer(
        EXPLORER_RPC_METHODS.searchBenchmarkFrontendResult,
        {
          dto: "SearchBenchmarkFrontendResult",
          version: 1,
          suiteId,
          outputPath,
          frontend,
        },
        30000,
      );
    }
    const summary: SearchBenchmarkConsoleResult = {
      suiteId,
      status: stringValue(result.status) || "unknown",
      outputPath,
      frontend,
    };
    console.info("[TE2 search benchmark]", summary);
    return summary;
  } finally {
    pendingBenchmarks.delete(suiteId);
  }
}

function buildRunPayload(
  mode: SearchBenchmarkMode,
  suiteId: string,
  options: SearchBenchmarkRunOptions,
): JsonObject {
  const payload: JsonObject = {
    dto: "SearchBenchmarkRunRequest",
    version: 1,
    mode,
    suiteId,
  };
  if (options.outputPath) payload.outputPath = options.outputPath;
  if (Array.isArray(options.lanes) && options.lanes.length > 0) {
    payload.lanes = options.lanes;
  }
  if (Array.isArray(options.cases) && options.cases.length > 0) {
    payload.cases = options.cases.map(normalizeCase);
  }
  return payload;
}

function payloadHasFullStackLane(payload: JsonObject): boolean {
  const lanes = payload.lanes;
  if (!Array.isArray(lanes) || lanes.length === 0) return true;
  return lanes.includes("fullStack");
}

function normalizedCasesForRun(
  mode: SearchBenchmarkMode,
  options: SearchBenchmarkRunOptions,
): JsonObject[] {
  if (Array.isArray(options.cases) && options.cases.length > 0) {
    return options.cases.map(normalizeCase);
  }
  if (mode === "oneShot") {
    return (
      normalizeOneShot(options as SearchBenchmarkOneShotOptions).cases || []
    ).map(normalizeCase);
  }
  return [
    normalizeCase({ caseId: "raw-import", query: "import" }),
    normalizeCase({
      caseId: "include-py",
      query: "import",
      includePatterns: ["*.py"],
    }),
    normalizeCase({
      caseId: "exclude-ts",
      query: "import",
      excludePatterns: ["*.ts"],
    }),
    normalizeCase({
      caseId: "include-under-exclude-ts",
      query: "import",
      includePatterns: ["*_*"],
      excludePatterns: ["*.ts"],
    }),
    normalizeCase({ caseId: "te2-search-canary", query: "te2_search_canary" }),
  ];
}

async function runActualFullStackCase(
  suiteId: string,
  rawCase: JsonObject,
): Promise<JsonObject> {
  const deps = benchmarkDeps;
  if (!deps) throw new Error("Explorer search benchmark API is not installed");
  const caseId = stringValue(rawCase.caseId) || "case";
  const query = stringValue(rawCase.query) || "";
  const correlationId = `search-benchmark:${suiteId}:fullStack:${caseId}:${Date.now()}`;
  return await new Promise<JsonObject>((resolve, reject) => {
    const pending: PendingActualSearchCase = {
      suiteId,
      lane: "fullStack",
      caseId,
      query,
      startedAt: performance.now(),
      progressFrames: 0,
      resultFrames: 0,
      doneFrames: 0,
      errorFrames: 0,
      receivedFiles: 0,
      receivedMatches: 0,
      filesScanned: 0,
      filesMatched: 0,
      matchesFound: 0,
      firstResultReceivedMs: null,
      doneReceivedMs: null,
      controllerProcessingMs: 0,
      renderFrames: 0,
      status: "ok",
      error: null,
      correlationId,
      searchId: null,
      jobId: null,
      timeoutId: setTimeout(() => {
        const active = pendingActualSearchCases.get(correlationId);
        if (!active) return;
        active.status = "error";
        active.error = "fullStack benchmark case timed out";
        finishActualSearchCase(active);
      }, 180000),
      resolve,
      reject,
    };
    pendingActualSearchCases.set(correlationId, pending);
    deps
      .runActualSearchCase({
        suiteId,
        caseId,
        correlationId,
        query,
        isRegex: rawCase.isRegex === true,
        isCaseSensitive: rawCase.isCaseSensitive === true,
        isWholeWords: rawCase.isWholeWords === true,
        includePatterns: stringArray(rawCase.includePatterns),
        excludePatterns: stringArray(rawCase.excludePatterns),
        useIgnoreFiles: rawCase.useIgnoreFiles !== false,
      })
      .catch((error: unknown) => {
        clearTimeout(pending.timeoutId);
        pendingActualSearchCases.delete(correlationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function normalizeOneShot(
  options: SearchBenchmarkOneShotOptions,
): SearchBenchmarkRunOptions {
  if (Array.isArray(options.cases) && options.cases.length > 0) {
    return options;
  }
  return {
    ...options,
    cases: [
      {
        caseId: options.suiteId ? `${options.suiteId}-one-shot` : "one-shot",
        query: options.query || "import",
        isRegex: options.isRegex,
        isCaseSensitive: options.isCaseSensitive,
        isWholeWords: options.isWholeWords,
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns,
        useIgnoreFiles: options.useIgnoreFiles,
        resultBatching: options.resultBatching,
      },
    ],
  };
}

function normalizeCase(value: SearchBenchmarkCaseOptions): JsonObject {
  return {
    caseId: value.caseId || "case",
    query: value.query,
    isRegex: value.isRegex === true,
    isCaseSensitive: value.isCaseSensitive === true,
    isWholeWords: value.isWholeWords === true,
    includePatterns: Array.isArray(value.includePatterns)
      ? value.includePatterns
      : [],
    excludePatterns: Array.isArray(value.excludePatterns)
      ? value.excludePatterns
      : [],
    useIgnoreFiles: value.useIgnoreFiles !== false,
    ...(value.resultBatching
      ? { resultBatching: normalizeResultBatching(value.resultBatching) }
      : {}),
  };
}

function normalizeResultBatching(
  value: SearchResultBatchingOptions,
): JsonObject {
  const result: JsonObject = {};
  const maxFilesPerBatch = value.maxFilesPerBatch;
  if (
    typeof maxFilesPerBatch === "number" &&
    Number.isFinite(maxFilesPerBatch)
  ) {
    result.maxFilesPerBatch = Math.max(1, Math.floor(maxFilesPerBatch));
  }
  const maxMatchesPerBatch = value.maxMatchesPerBatch;
  if (
    typeof maxMatchesPerBatch === "number" &&
    Number.isFinite(maxMatchesPerBatch)
  ) {
    result.maxMatchesPerBatch = Math.max(1, Math.floor(maxMatchesPerBatch));
  }
  return result;
}

function buildFrontendMetrics(pending: PendingBenchmark): JsonObject {
  const totalRunMs = elapsedMs(pending.startedAt);
  const authoritativeFiles = pending.doneFiles ?? pending.receivedFiles;
  const authoritativeMatches = pending.doneMatches ?? pending.receivedMatches;
  return {
    suiteId: pending.suiteId,
    totalRunMs,
    firstResultReceivedMs: pending.firstResultReceivedMs,
    doneReceivedMs: pending.doneReceivedMs,
    progressFrames: pending.progressFrames,
    resultFrames: pending.resultFrames,
    doneFrames: pending.doneFrames,
    errorFrames: pending.errorFrames,
    receivedFiles: pending.receivedFiles,
    receivedMatches: pending.receivedMatches,
    accumulatedFiles: pending.receivedFiles,
    accumulatedMatches: pending.receivedMatches,
    doneFilesScanned: pending.doneFilesScanned,
    doneFiles: pending.doneFiles,
    doneMatches: pending.doneMatches,
    doneCancelled: pending.doneCancelled,
    cancellationReason: pending.cancellationReason,
    optionalEventsDropped: pending.optionalEventsDropped,
    requiredEventBackpressureCount: pending.requiredEventBackpressureCount,
    requiredEventBackpressureMs: pending.requiredEventBackpressureMs,
    requiredEventFailures: pending.requiredEventFailures,
    completion: {
      complete: pending.doneCancelled
        ? false
        : pending.doneFiles === null && pending.doneMatches === null
          ? false
          : pending.doneFiles === pending.receivedFiles &&
            pending.doneMatches === pending.receivedMatches,
      reason: pending.doneCancelled
        ? pending.cancellationReason || "cancelled"
        : undefined,
      missingFiles:
        pending.doneFiles === null
          ? null
          : Math.max(0, pending.doneFiles - pending.receivedFiles),
      missingMatches:
        pending.doneMatches === null
          ? null
          : Math.max(0, pending.doneMatches - pending.receivedMatches),
      extraFiles:
        pending.doneFiles === null
          ? null
          : Math.max(0, pending.receivedFiles - pending.doneFiles),
      extraMatches:
        pending.doneMatches === null
          ? null
          : Math.max(0, pending.receivedMatches - pending.doneMatches),
    },
    rates: calculateRates({
      durationMs: totalRunMs,
      resultFrames: pending.resultFrames,
      matches: authoritativeMatches,
      files: authoritativeFiles,
      filesScanned: pending.doneFilesScanned ?? 0,
    }),
    notificationProcessingMs:
      Math.round(pending.notificationProcessingMs * 100) / 100,
    errors: pending.errors,
    projectPath: benchmarkDeps?.getProjectPath() || "",
    cases: pending.cases,
  };
}

function pendingActualCaseForPayload(
  payload: JsonObject,
): PendingActualSearchCase | null {
  const correlationId = stringValue(payload.correlationId);
  if (correlationId) {
    const pending = pendingActualSearchCases.get(correlationId);
    if (pending) return pending;
  }
  const searchId = stringValue(payload.searchId);
  const jobId = stringValue(payload.jobId) || stringValue(payload.opId);
  for (const pending of pendingActualSearchCases.values()) {
    if (searchId && pending.searchId === searchId) return pending;
    if (jobId && pending.jobId === jobId) return pending;
  }
  return null;
}

function finishActualSearchCase(pending: PendingActualSearchCase): void {
  pendingActualSearchCases.delete(pending.correlationId);
  clearTimeout(pending.timeoutId);
  pending.resolve(actualSearchCaseResult(pending));
}

function actualSearchCaseResult(pending: PendingActualSearchCase): JsonObject {
  const totalRunMs = elapsedMs(pending.startedAt);
  const authoritative = {
    filesScanned: pending.filesScanned,
    filesMatched: pending.filesMatched,
    matchesFound: pending.matchesFound,
    resultBatches: pending.resultFrames,
  };
  return {
    dto: "SearchBenchmarkCaseResult",
    version: 1,
    lane: "fullStack",
    caseId: pending.caseId,
    query: pending.query,
    status: pending.status,
    error: pending.error,
    frontend: {
      totalRunMs,
      firstResultReceivedMs: pending.firstResultReceivedMs,
      doneReceivedMs: pending.doneReceivedMs,
      progressFrames: pending.progressFrames,
      resultFrames: pending.resultFrames,
      doneFrames: pending.doneFrames,
      errorFrames: pending.errorFrames,
      receivedFiles: pending.receivedFiles,
      receivedMatches: pending.receivedMatches,
      controllerProcessingMs:
        Math.round(pending.controllerProcessingMs * 100) / 100,
      renderFrames: pending.renderFrames,
      authoritative,
      completion: {
        complete:
          pending.status === "ok" &&
          pending.filesMatched === pending.receivedFiles &&
          pending.matchesFound === pending.receivedMatches,
        reason:
          pending.status === "ok"
            ? "complete"
            : pending.error || pending.status,
        missingFiles: Math.max(0, pending.filesMatched - pending.receivedFiles),
        missingMatches: Math.max(
          0,
          pending.matchesFound - pending.receivedMatches,
        ),
        extraFiles: Math.max(0, pending.receivedFiles - pending.filesMatched),
        extraMatches: Math.max(
          0,
          pending.receivedMatches - pending.matchesFound,
        ),
      },
      rates: calculateRates({
        durationMs: totalRunMs,
        resultFrames: pending.resultFrames,
        matches: pending.matchesFound,
        files: pending.filesMatched,
        filesScanned: pending.filesScanned,
      }),
    },
  };
}

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function countResultFiles(result: JsonObject): number {
  const files = result.files;
  return Array.isArray(files) ? files.length : 0;
}

function countVisibleResultFiles(result: JsonObject): number {
  const results = result.results;
  if (Array.isArray(results)) return results.length;
  return countResultFiles(result);
}

function countVisibleResultMatches(result: JsonObject): number {
  const matchCount =
    numberValue(result.match_count) ?? numberValue(result.matchCount);
  if (typeof matchCount === "number") return matchCount;
  const results = result.results;
  if (!Array.isArray(results)) return countResultMatches(result);
  return results.reduce((total, file) => {
    const rawFile = objectValue(file);
    const matches = rawFile.matches;
    return total + (Array.isArray(matches) ? matches.length : 0);
  }, 0);
}

function countResultMatches(result: JsonObject): number {
  const matchCount =
    numberValue(result.matchCount) ?? numberValue(result.match_count);
  if (typeof matchCount === "number") return matchCount;
  const files = result.files;
  if (!Array.isArray(files)) return 0;
  return files.reduce((total, file) => {
    const rawFile = objectValue(file);
    const matches = rawFile.matches;
    return total + (Array.isArray(matches) ? matches.length : 0);
  }, 0);
}

function calculateRates(input: {
  durationMs: number;
  resultFrames: number;
  matches: number;
  files: number;
  filesScanned: number;
}): JsonObject {
  const seconds = input.durationMs > 0 ? input.durationMs / 1000 : 0;
  return {
    durationMs: input.durationMs,
    resultsPerSecond: rate(input.resultFrames, seconds),
    matchesPerSecond: rate(input.matches, seconds),
    filesPerSecond: rate(input.files, seconds),
    filesScannedPerSecond: rate(input.filesScanned, seconds),
  };
}

function rate(count: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.round((count / seconds) * 100) / 100;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
