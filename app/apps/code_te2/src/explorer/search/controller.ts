import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from "../rpc/contract.ts";
import type { JsonObject } from "../../rpc/transport.ts";
import type {
  ExplorerContentSearchFileResult,
  ExplorerContentSearchOptions,
  ExplorerSearchIdentity,
  ExplorerSearchMode,
  ExplorerSearchMoreInFileResult,
  ExplorerSearchMoreResult,
  ExplorerSearchStatus,
  SearchJobDonePayload,
  SearchJobErrorPayload,
  SearchJobProgressPayload,
  SearchJobResultPayload,
} from "./types.ts";
import {
  CONTENT_SEARCH_MORE_IN_FILE_LIMIT,
  CONTENT_SEARCH_MORE_LIMIT,
  CONTENT_SEARCH_PRESENTATION_WINDOW,
} from "./types.ts";
import {
  mergeContentSearchFile,
  mergeContentSearchResults,
  normalizeContentSearchResults,
} from "./result-model.ts";
import { getErrorMessage } from "../utils/errors.ts";

type ExplorerSearchTimer = ReturnType<typeof setTimeout> | null;

interface ExplorerSearchControllerDeps {
  toast(message: string): void;
  renderSearchOverlay(): void;
  focusSearchInput(): void;
  hasBus(): boolean;
  sendBus(method: ExplorerRpcMethod, payload: JsonObject): void;
  requestBus(
    method: ExplorerRpcMethod,
    payload: JsonObject,
    timeoutMs?: number,
  ): Promise<JsonObject>;
  getProjectPath(): string;
  getSearchOverlayVisible(): boolean;
  setSearchOverlayVisible(next: boolean): void;
  getSearchMode(): ExplorerSearchMode;
  setSearchModeValue(next: ExplorerSearchMode): void;
  getSearchQuery(): string;
  setSearchQuery(next: string): void;
  getSearchResults(): unknown;
  setSearchResults(next: unknown): void;
  getSearchLoading(): boolean;
  setSearchLoading(next: boolean): void;
  getSearchError(): string | null;
  setSearchError(next: string | null): void;
  getSearchDebounceTimer(): ExplorerSearchTimer;
  setSearchDebounceTimer(next: ExplorerSearchTimer): void;
  setLastKnownProjectPath(next: string): void;
  getContentSearchOptions(): ExplorerContentSearchOptions;
  getSearchIdentity(): ExplorerSearchIdentity;
  setSearchIdentity(next: ExplorerSearchIdentity): void;
  setSearchStatus(next: ExplorerSearchStatus | null): void;
  setGlobalMoreLoading(next: boolean): void;
  setFileMoreLoading(rel: string, next: boolean): void;
}

const EMPTY_SEARCH_IDENTITY: ExplorerSearchIdentity = {
  correlationId: null,
  searchId: null,
  jobId: null,
  root: null,
  projectGeneration: null,
};

const SEARCH_INPUT_DEBOUNCE_MS = 500;

let searchSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nextCorrelationId(): string {
  searchSequence += 1;
  return `explorer-search:${Date.now()}:${searchSequence}`;
}

function hasCancelableIdentity(identity: ExplorerSearchIdentity): boolean {
  return Boolean(identity.searchId || identity.jobId);
}

function activeFileKey(file: ExplorerContentSearchFileResult): string {
  return file.rel || file.relativePath || file.path || "";
}

export function createExplorerSearchController(
  deps: ExplorerSearchControllerDeps,
) {
  let activeSearchHighlightKey: string | null = null;

  function setSearchIdentityFromPayload(payload: unknown): void {
    if (!isRecord(payload)) return;
    const current = deps.getSearchIdentity();
    deps.setSearchIdentity({
      correlationId:
        stringValue(payload.correlationId) || current.correlationId,
      searchId: stringValue(payload.searchId) || current.searchId,
      jobId:
        stringValue(payload.jobId) ||
        stringValue(payload.opId) ||
        current.jobId,
      root: stringValue(payload.root) || current.root,
      projectGeneration:
        numberValue(payload.projectGeneration) ?? current.projectGeneration,
    });
  }

  function setSearchStatus(next: ExplorerSearchStatus | null): void {
    deps.setSearchStatus(next);
  }

  function clearTimer(): void {
    const timer = deps.getSearchDebounceTimer();
    if (timer) {
      clearTimeout(timer);
      deps.setSearchDebounceTimer(null);
    }
  }

  function buildCancelPayload(
    identity: ExplorerSearchIdentity,
    reason: string,
  ): JsonObject | null {
    if (!hasCancelableIdentity(identity)) {
      return null;
    }
    const payload: JsonObject = {
      dto: "SearchJobCancelRequest",
      version: 1,
      reason,
    };
    if (identity.jobId) payload.jobId = identity.jobId;
    if (identity.searchId) payload.searchId = identity.searchId;
    if (identity.root) payload.root = identity.root;
    if (typeof identity.projectGeneration === "number") {
      payload.projectGeneration = identity.projectGeneration;
    }
    return payload;
  }

  function cancelSearchIdentity(
    identity: ExplorerSearchIdentity,
    reason: string,
  ): void {
    const payload = buildCancelPayload(identity, reason);
    if (!payload || !deps.hasBus()) {
      return;
    }
    void deps
      .requestBus(EXPLORER_RPC_METHODS.searchCancel, payload, 5000)
      .catch(() => {
        // Cancellation is best-effort from the UI close/supersede path; backend
        // errors are surfaced by routed search.job.error when relevant.
      });
  }

  function cancelActiveSearch(reason: string): void {
    changesGeneration++;
    const identity = deps.getSearchIdentity();
    if (!hasCancelableIdentity(identity)) {
      return;
    }
    setSearchStatus({ status: "canceling", message: "Canceling search" });
    cancelSearchIdentity(identity, reason);
  }

  function sendSearchHighlightClear(reason: string): void {
    if (activeSearchHighlightKey === null) {
      return;
    }
    activeSearchHighlightKey = null;
    if (!deps.hasBus()) {
      return;
    }
    try {
      deps.sendBus(EXPLORER_RPC_METHODS.searchHighlightClear, { reason });
    } catch (_) {}
  }

  function syncSearchHighlight(query: string): void {
    if (
      deps.getSearchMode() !== "content" ||
      !deps.getSearchOverlayVisible() ||
      query.length < 2
    ) {
      sendSearchHighlightClear(query.length < 2 ? "queryCleared" : "inactive");
      return;
    }

    const options = deps.getContentSearchOptions();
    const payload: JsonObject = {
      query,
      isRegex: options.isRegex,
      isCaseSensitive: options.isCaseSensitive,
      isWholeWords: options.isWholeWords,
      projectRoot: deps.getProjectPath(),
      source: "explorerSearch",
    };
    const nextKey = JSON.stringify(payload);
    if (activeSearchHighlightKey === nextKey) {
      return;
    }
    activeSearchHighlightKey = nextKey;
    if (!deps.hasBus()) {
      return;
    }
    try {
      deps.sendBus(EXPLORER_RPC_METHODS.searchHighlightSet, payload);
    } catch (_) {}
  }

  function clearSearchState(preserveQuery = false): void {
    if (!preserveQuery) {
      deps.setSearchQuery("");
    }
    deps.setSearchResults(null);
    deps.setSearchError(null);
    deps.setSearchLoading(false);
    deps.setSearchIdentity({ ...EMPTY_SEARCH_IDENTITY });
    deps.setGlobalMoreLoading(false);
    setSearchStatus(null);
    clearTimer();
  }

  function clearSearchResults(preserveQuery = false): void {
    cancelActiveSearch("cleared");
    sendSearchHighlightClear("cleared");
    clearSearchState(preserveQuery);
  }

  function buildSearchPayload(query: string): JsonObject {
    const mode = deps.getSearchMode();
    const root = deps.getProjectPath();
    const correlationId = nextCorrelationId();
    const payload: JsonObject = {
      mode,
      query,
      root,
      correlationId,
    };

    deps.setSearchIdentity({
      correlationId,
      searchId: null,
      jobId: null,
      root,
      projectGeneration: null,
    });

    if (mode !== "content") {
      return payload;
    }

    const options = deps.getContentSearchOptions();
    payload.isRegex = options.isRegex;
    payload.isCaseSensitive = options.isCaseSensitive;
    payload.isWholeWords = options.isWholeWords;
    payload.includePattern = options.includePattern;
    payload.excludePattern = options.excludePattern;
    payload.useIgnoreFiles = options.useIgnoreFiles;
    payload.presentationWindow = { ...CONTENT_SEARCH_PRESENTATION_WINDOW };
    return payload;
  }

  async function performSearch(
    query: string,
    preparedPayload?: JsonObject,
  ): Promise<void> {
    const mode = deps.getSearchMode();
    if (mode === "changes" || mode === "review") return;
    if (!deps.getProjectPath()) {
      deps.setSearchError("No project open");
      deps.setSearchLoading(false);
      deps.renderSearchOverlay();
      return;
    }

    const payload = preparedPayload || buildSearchPayload(query);
    syncSearchHighlight(query);
    setSearchIdentityFromPayload(payload);
    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    deps.setSearchResults(null);
    deps.setGlobalMoreLoading(false);
    setSearchStatus({ status: "running", message: "Searching" });
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError("Search bus unavailable");
      setSearchStatus({
        status: "error",
        message: "Search bus unavailable",
      });
      deps.renderSearchOverlay();
      return;
    }

    try {
      deps.sendBus(EXPLORER_RPC_METHODS.searchRun, payload);
    } catch (error) {
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, "Search request failed"));
      setSearchStatus({
        status: "error",
        message: getErrorMessage(error, "Search request failed"),
      });
      deps.renderSearchOverlay();
    }
  }

  function scheduleSearch(
    query: string,
    preparedPayload?: JsonObject,
  ): void {
    const mode = deps.getSearchMode();
    if (mode === "changes" || mode === "review") return;
    deps.setSearchQuery(query);
    clearTimer();
    syncSearchHighlight(query);

    if (query.length < 2) {
      cancelActiveSearch("queryCleared");
      clearSearchState(true);
      deps.renderSearchOverlay();
      return;
    }

    cancelActiveSearch("replaced");
    const payload = preparedPayload || buildSearchPayload(query);
    if (preparedPayload) {
      deps.setSearchIdentity({
        correlationId: stringValue(payload.correlationId),
        searchId: stringValue(payload.searchId),
        jobId: stringValue(payload.jobId) || stringValue(payload.opId),
        root: stringValue(payload.root) || deps.getProjectPath() || null,
        projectGeneration: numberValue(payload.projectGeneration),
      });
    }
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    setSearchStatus({ status: "running", message: "Waiting to search" });
    deps.renderSearchOverlay();
    deps.setSearchDebounceTimer(
      setTimeout(() => {
        void performSearch(query, payload);
      }, SEARCH_INPUT_DEBOUNCE_MS),
    );
  }

  function refreshCurrentSearch(): void {
    if (deps.getSearchMode() !== "content") {
      return;
    }
    scheduleSearch(deps.getSearchQuery());
  }

  let changesGeneration = 0;
  async function fetchChangesResults(force = false): Promise<void> {
    if (deps.getSearchMode() !== "changes") return;
    if (deps.getSearchLoading() && !force) return;

    if (!deps.getProjectPath()) {
      deps.setSearchError("No project open");
      deps.setSearchLoading(false);
      deps.renderSearchOverlay();
      return;
    }

    cancelActiveSearch("modeChanged");
    const generation = changesGeneration;
    const project = deps.getProjectPath();
    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    setSearchStatus(null);
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError("Search bus unavailable");
      deps.renderSearchOverlay();
      return;
    }

    try {
      const result = await deps.requestBus(EXPLORER_RPC_METHODS.searchRun, { mode: "changes" });
      if (generation !== changesGeneration || project !== deps.getProjectPath() || deps.getSearchMode() !== 'changes') return;
      handleSearchResultsUpdated(result);
    } catch (error) {
      if (generation !== changesGeneration || project !== deps.getProjectPath()) return;
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, "Changes lookup failed"));
      deps.renderSearchOverlay();
    }
  }

  async function fetchReviewResults(force = false): Promise<void> {
    if (deps.getSearchMode() !== "review") return;
    if (deps.getSearchLoading() && !force) return;

    cancelActiveSearch("modeChanged");
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    setSearchStatus(null);
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError("Review bus unavailable");
      deps.renderSearchOverlay();
      return;
    }

    try {
      deps.sendBus(EXPLORER_RPC_METHODS.reviewList, { lightweight: false });
    } catch (error) {
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, "Failed to load review list"));
      deps.renderSearchOverlay();
    }
  }

  function setSearchMode(mode: ExplorerSearchMode): void {
    if (mode === deps.getSearchMode()) return;
    clearSearchResults(true);
    deps.setSearchModeValue(mode);

    if (mode === "changes") {
      deps.setSearchLoading(true);
      deps.renderSearchOverlay();
      void fetchChangesResults(true);
      return;
    }

    if (mode === "review") {
      deps.setSearchLoading(true);
      deps.renderSearchOverlay();
      void fetchReviewResults(true);
      return;
    }

    if (mode === "diagnostics") {
      deps.setSearchLoading(false);
      deps.setSearchError(null);
      setSearchStatus(null);
      deps.renderSearchOverlay();
      return;
    }

    deps.setSearchLoading(false);
    deps.setSearchError(null);
    setSearchStatus(null);
    deps.renderSearchOverlay();
    if (deps.getSearchQuery().length >= 2) {
      syncSearchHighlight(deps.getSearchQuery());
      void performSearch(deps.getSearchQuery());
    } else {
      setTimeout(() => deps.focusSearchInput(), 0);
    }
  }

  function openSearchOverlay(): void {
    if (!deps.getProjectPath()) {
      deps.toast("No project open");
      return;
    }
    deps.setSearchOverlayVisible(true);
    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.renderSearchOverlay();
    syncSearchHighlight(deps.getSearchQuery());
    setTimeout(() => {
      const mode = deps.getSearchMode();
      if (mode === "changes") {
        void fetchChangesResults(true);
      } else if (mode === "review") {
        void fetchReviewResults(true);
      } else {
        deps.focusSearchInput();
      }
    }, 0);
  }

  function closeSearchOverlay(reason = "overlayClosed"): void {
    cancelActiveSearch(reason);
    sendSearchHighlightClear(reason);
    deps.setSearchOverlayVisible(false);
    clearSearchState();
    deps.renderSearchOverlay();
  }

  function isActiveSearchPayload(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    const identity = deps.getSearchIdentity();
    const correlationId = stringValue(payload.correlationId);
    if (identity.correlationId && correlationId) {
      return identity.correlationId === correlationId;
    }
    const searchId = stringValue(payload.searchId);
    if (identity.searchId && searchId) {
      return identity.searchId === searchId;
    }
    const jobId = stringValue(payload.jobId) || stringValue(payload.opId);
    if (identity.jobId && jobId) {
      return identity.jobId === jobId;
    }
    return !identity.correlationId && !identity.searchId && !identity.jobId;
  }

  function handleContentResultsUpdated(payload: unknown): void {
    const normalized = normalizeContentSearchResults(payload);
    setSearchIdentityFromPayload(payload);
    setSearchIdentityFromPayload(normalized);
    deps.setSearchResults(normalized);
    deps.setSearchLoading(false);
    deps.setSearchError(null);
    setSearchStatus({
      status: normalized.complete === false ? "running" : "done",
      message: normalized.complete === false ? "Searching" : "Search complete",
      filesMatched: normalized.totalFileCount ?? normalized.file_count,
      matchesFound: normalized.totalMatchCount ?? normalized.match_count,
    });
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  function handleSearchResultsUpdated(payload: unknown): void {
    const payloadMode =
      isRecord(payload) && typeof payload.mode === "string"
        ? payload.mode
        : undefined;

    if (
      payloadMode &&
      payloadMode !== deps.getSearchMode() &&
      payloadMode !== "content"
    ) {
      return;
    }

    if (deps.getSearchMode() === "content" || payloadMode === "content") {
      handleContentResultsUpdated(payload);
      return;
    }

    deps.setSearchResults(payload || null);
    deps.setSearchLoading(false);
    deps.setSearchError(null);
    setSearchStatus(null);
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  function handleSearchJobProgress(payload: SearchJobProgressPayload): void {
    if (!isActiveSearchPayload(payload)) return;
    setSearchIdentityFromPayload(payload);
    deps.setSearchLoading(!deps.getSearchResults());
    deps.setSearchError(null);
    setSearchStatus({
      status: "running",
      message: payload.message || "Searching",
      filesScanned: payload.filesScanned,
      filesMatched: payload.filesMatched,
      matchesFound: payload.matchesFound,
    });
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  function handleSearchJobResult(payload: SearchJobResultPayload): void {
    if (!isActiveSearchPayload(payload)) return;
    setSearchIdentityFromPayload(payload);
    if (payload.result) {
      setSearchIdentityFromPayload(payload.result);
      deps.setSearchResults(
        mergeContentSearchResults(deps.getSearchResults(), payload.result),
      );
    }
    deps.setSearchLoading(false);
    deps.setSearchError(null);
    setSearchStatus({ status: "running", message: "Searching" });
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  function handleSearchJobDone(payload: SearchJobDonePayload): void {
    if (!isActiveSearchPayload(payload)) return;
    setSearchIdentityFromPayload(payload);
    const limit =
      typeof payload.matchLimit === "number"
        ? payload.matchLimit
        : (payload.matchesFound ?? payload.matchCount);
    const limited =
      payload.truncated === true && payload.truncatedReason === "matchLimit";
    deps.setSearchLoading(false);
    deps.setSearchError(null);
    setSearchStatus({
      status: payload.cancelled === true ? "idle" : "done",
      message:
        payload.cancelled === true
          ? "Search cancelled"
          : limited
            ? `Stopped after ${limit ?? "the configured limit"} matches. Add filters to narrow the search.`
            : "Search complete",
      filesScanned: payload.filesScanned,
      filesMatched: payload.filesMatched ?? payload.fileCount,
      matchesFound: payload.matchesFound ?? payload.matchCount,
    });
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  function handleSearchJobError(payload: SearchJobErrorPayload): void {
    if (!isActiveSearchPayload(payload)) return;
    setSearchIdentityFromPayload(payload);
    const message = payload.message || payload.code || "Search failed";
    deps.setSearchLoading(false);
    deps.setSearchError(message);
    setSearchStatus({ status: "error", message });
    if (deps.getSearchOverlayVisible()) {
      deps.renderSearchOverlay();
    }
  }

  async function loadMoreResults(): Promise<void> {
    const current = normalizeContentSearchResults(deps.getSearchResults());
    const identity = deps.getSearchIdentity();
    const searchId = current.searchId || identity.searchId;
    const cursor = current.nextGlobalCursor;
    if (!searchId || !cursor || !deps.hasBus()) {
      return;
    }

    deps.setGlobalMoreLoading(true);
    setSearchStatus({ status: "loadingMore", message: "Loading more results" });
    deps.renderSearchOverlay();

    const payload: JsonObject = {
      dto: "ExplorerSearchMoreRequest",
      version: 1,
      searchId,
      cursor,
      limit: { ...CONTENT_SEARCH_MORE_LIMIT },
    };
    if (identity.root || current.query) {
      payload.root = identity.root || deps.getProjectPath();
    }
    if (typeof identity.projectGeneration === "number") {
      payload.projectGeneration = identity.projectGeneration;
    }

    try {
      const response = (await deps.requestBus(
        EXPLORER_RPC_METHODS.searchMore,
        payload,
        30000,
      )) as ExplorerSearchMoreResult;
      if (response.result) {
        deps.setSearchResults(
          mergeContentSearchResults(deps.getSearchResults(), response.result),
        );
        setSearchIdentityFromPayload(response);
        setSearchIdentityFromPayload(response.result);
      }
      deps.setSearchError(null);
      setSearchStatus({ status: "done", message: "More results loaded" });
    } catch (error) {
      const message = getErrorMessage(error, "Failed to load more results");
      deps.setSearchError(message);
      setSearchStatus({ status: "error", message });
    } finally {
      deps.setGlobalMoreLoading(false);
      deps.renderSearchOverlay();
    }
  }

  async function loadMoreInFile(
    file: ExplorerContentSearchFileResult,
  ): Promise<void> {
    const rel = activeFileKey(file);
    const current = normalizeContentSearchResults(deps.getSearchResults());
    const identity = deps.getSearchIdentity();
    const searchId = current.searchId || identity.searchId;
    const cursor = file.nextMatchCursor;
    if (!rel || !searchId || !cursor || !deps.hasBus()) {
      return;
    }

    deps.setFileMoreLoading(rel, true);
    setSearchStatus({
      status: "loadingMore",
      message: `Loading more matches in ${rel}`,
    });
    deps.renderSearchOverlay();

    const payload: JsonObject = {
      dto: "ExplorerSearchMoreInFileRequest",
      version: 1,
      searchId,
      relativePath: rel,
      cursor,
      maxMatches: CONTENT_SEARCH_MORE_IN_FILE_LIMIT,
    };
    if (identity.root || deps.getProjectPath()) {
      payload.root = identity.root || deps.getProjectPath();
    }
    if (typeof identity.projectGeneration === "number") {
      payload.projectGeneration = identity.projectGeneration;
    }

    try {
      const response = (await deps.requestBus(
        EXPLORER_RPC_METHODS.searchMoreInFile,
        payload,
        30000,
      )) as ExplorerSearchMoreInFileResult;
      if (response.file) {
        deps.setSearchResults(
          mergeContentSearchFile(deps.getSearchResults(), response.file),
        );
        setSearchIdentityFromPayload(response);
      }
      deps.setSearchError(null);
      setSearchStatus({ status: "done", message: "More matches loaded" });
    } catch (error) {
      const message = getErrorMessage(error, "Failed to load more matches");
      deps.setSearchError(message);
      setSearchStatus({ status: "error", message });
    } finally {
      deps.setFileMoreLoading(rel, false);
      deps.renderSearchOverlay();
    }
  }

  return {
    clearSearchResults,
    scheduleSearch,
    refreshCurrentSearch,
    performSearch,
    fetchChangesResults,
    fetchReviewResults,
    setSearchMode,
    openSearchOverlay,
    closeSearchOverlay,
    cancelActiveSearch,
    handleSearchResultsUpdated,
    handleSearchJobProgress,
    handleSearchJobResult,
    handleSearchJobDone,
    handleSearchJobError,
    loadMoreResults,
    loadMoreInFile,
  };
}
