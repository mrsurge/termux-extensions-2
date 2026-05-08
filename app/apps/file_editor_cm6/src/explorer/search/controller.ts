import { EXPLORER_RPC_METHODS, type ExplorerRpcMethod } from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';
import type {
  ExplorerContentSearchOptions,
  ExplorerSearchMode,
} from './types.ts';
import { getErrorMessage } from '../utils/errors.ts';

type ExplorerSearchTimer = ReturnType<typeof setTimeout> | null;

interface ExplorerSearchControllerDeps {
  toast(message: string): void;
  renderSearchOverlay(): void;
  focusSearchInput(): void;
  hasBus(): boolean;
  sendBus(method: ExplorerRpcMethod, payload: JsonObject): void;
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
}

export function createExplorerSearchController(
  deps: ExplorerSearchControllerDeps,
) {
  function clearSearchResults(preserveQuery = false): void {
    if (!preserveQuery) {
      deps.setSearchQuery('');
    }
    deps.setSearchResults(null);
    deps.setSearchError(null);
    deps.setSearchLoading(false);
    const timer = deps.getSearchDebounceTimer();
    if (timer) {
      clearTimeout(timer);
      deps.setSearchDebounceTimer(null);
    }
  }

  function buildSearchPayload(query: string): JsonObject {
    const mode = deps.getSearchMode();
    if (mode !== 'content') {
      return {
        mode,
        query,
      };
    }
    const options = deps.getContentSearchOptions();
    return {
      mode,
      query,
      isRegex: options.isRegex,
      isCaseSensitive: options.isCaseSensitive,
      isWholeWords: options.isWholeWords,
      includePattern: options.includePattern,
      excludePattern: options.excludePattern,
      useIgnoreFiles: options.useIgnoreFiles,
    };
  }

  async function performSearch(query: string): Promise<void> {
    const mode = deps.getSearchMode();
    if (mode === 'changes' || mode === 'review') return;
    if (!deps.getProjectPath()) {
      deps.setSearchError('No project open');
      deps.setSearchLoading(false);
      deps.renderSearchOverlay();
      return;
    }

    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError('Search bus unavailable');
      deps.renderSearchOverlay();
      return;
    }

    try {
      deps.sendBus(EXPLORER_RPC_METHODS.searchRun, buildSearchPayload(query));
    } catch (error) {
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, 'Search request failed'));
      deps.renderSearchOverlay();
    }
  }

  function scheduleSearch(query: string): void {
    const mode = deps.getSearchMode();
    if (mode === 'changes' || mode === 'review') return;
    deps.setSearchQuery(query);

    const timer = deps.getSearchDebounceTimer();
    if (timer) {
      clearTimeout(timer);
    }

    if (query.length < 2) {
      deps.setSearchResults(null);
      deps.renderSearchOverlay();
      return;
    }

    deps.setSearchLoading(true);
    deps.renderSearchOverlay();
    deps.setSearchDebounceTimer(
      setTimeout(() => {
        void performSearch(query);
      }, 300),
    );
  }

  function refreshCurrentSearch(): void {
    if (deps.getSearchMode() !== 'content') {
      return;
    }
    scheduleSearch(deps.getSearchQuery());
  }

  async function fetchChangesResults(force = false): Promise<void> {
    if (deps.getSearchMode() !== 'changes') return;
    if (deps.getSearchLoading() && !force) return;

    if (!deps.getProjectPath()) {
      deps.setSearchError('No project open');
      deps.setSearchLoading(false);
      deps.renderSearchOverlay();
      return;
    }

    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.setSearchLoading(true);
    deps.setSearchError(null);
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError('Search bus unavailable');
      deps.renderSearchOverlay();
      return;
    }

    try {
      deps.sendBus(EXPLORER_RPC_METHODS.searchRun, { mode: 'changes' });
    } catch (error) {
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, 'Changes lookup failed'));
      deps.renderSearchOverlay();
    }
  }

  async function fetchReviewResults(force = false): Promise<void> {
    if (deps.getSearchMode() !== 'review') return;
    if (deps.getSearchLoading() && !force) return;

    deps.setSearchLoading(true);
    deps.setSearchError(null);
    deps.renderSearchOverlay();

    if (!deps.hasBus()) {
      deps.setSearchLoading(false);
      deps.setSearchError('Review bus unavailable');
      deps.renderSearchOverlay();
      return;
    }

    try {
      deps.sendBus(EXPLORER_RPC_METHODS.reviewList, { lightweight: false });
    } catch (error) {
      deps.setSearchLoading(false);
      deps.setSearchError(getErrorMessage(error, 'Failed to load review list'));
      deps.renderSearchOverlay();
    }
  }

  function setSearchMode(mode: ExplorerSearchMode): void {
    if (mode === deps.getSearchMode()) return;
    clearSearchResults(true);
    deps.setSearchModeValue(mode);

    if (mode === 'changes') {
      deps.setSearchLoading(true);
      deps.renderSearchOverlay();
      void fetchChangesResults(true);
      return;
    }

    if (mode === 'review') {
      deps.setSearchLoading(true);
      deps.renderSearchOverlay();
      void fetchReviewResults(true);
      return;
    }

    if (mode === 'diagnostics') {
      deps.setSearchLoading(false);
      deps.setSearchError(null);
      deps.renderSearchOverlay();
      return;
    }

    deps.setSearchLoading(false);
    deps.setSearchError(null);
    deps.renderSearchOverlay();
    if (deps.getSearchQuery().length >= 2) {
      void performSearch(deps.getSearchQuery());
    } else {
      setTimeout(() => deps.focusSearchInput(), 0);
    }
  }

  function openSearchOverlay(): void {
    if (!deps.getProjectPath()) {
      deps.toast('No project open');
      return;
    }
    deps.setSearchOverlayVisible(true);
    deps.setLastKnownProjectPath(deps.getProjectPath());
    deps.renderSearchOverlay();
    setTimeout(() => {
      const mode = deps.getSearchMode();
      if (mode === 'changes') {
        void fetchChangesResults(true);
      } else if (mode === 'review') {
        void fetchReviewResults(true);
      } else {
        deps.focusSearchInput();
      }
    }, 0);
  }

  function closeSearchOverlay(): void {
    deps.setSearchOverlayVisible(false);
    clearSearchResults();
    deps.renderSearchOverlay();
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
  };
}
