export function createExplorerSearchController(deps) {
  function clearSearchResults(preserveQuery = false) {
    if (!preserveQuery) deps.setSearchQuery('');
    deps.setSearchResults(null);
    deps.setSearchError(null);
    deps.setSearchLoading(false);
    const timer = deps.getSearchDebounceTimer();
    if (timer) {
      clearTimeout(timer);
      deps.setSearchDebounceTimer(null);
    }
  }

  async function performSearch(query) {
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
      deps.sendBus('search:run', { mode: deps.getSearchMode(), query });
    } catch (err) {
      deps.setSearchLoading(false);
      deps.setSearchError(err?.message || 'Search request failed');
      deps.renderSearchOverlay();
    }
  }

  function scheduleSearch(query) {
    const mode = deps.getSearchMode();
    if (mode === 'changes' || mode === 'review') return;
    deps.setSearchQuery(query);

    const timer = deps.getSearchDebounceTimer();
    if (timer) clearTimeout(timer);

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

  async function fetchChangesResults(force = false) {
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
      deps.sendBus('search:run', { mode: 'changes' });
    } catch (err) {
      deps.setSearchLoading(false);
      deps.setSearchError(err?.message || 'Changes lookup failed');
      deps.renderSearchOverlay();
    }
  }

  async function fetchReviewResults(force = false) {
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
      deps.sendBus('review:list', { lightweight: false });
    } catch (err) {
      deps.setSearchLoading(false);
      deps.setSearchError(err?.message || 'Failed to load review list');
      deps.renderSearchOverlay();
    }
  }

  function setSearchMode(mode) {
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
      // Diagnostics tab renders from cached detail data — no fetch needed.
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

  function openSearchOverlay() {
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

  function closeSearchOverlay() {
    deps.setSearchOverlayVisible(false);
    clearSearchResults();
    deps.renderSearchOverlay();
  }

  return {
    clearSearchResults,
    scheduleSearch,
    performSearch,
    fetchChangesResults,
    fetchReviewResults,
    setSearchMode,
    openSearchOverlay,
    closeSearchOverlay,
  };
}
