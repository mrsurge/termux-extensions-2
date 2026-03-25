export function renderSearchOverlayBody(resultsContainer, state, deps) {
  const { searchMode, searchLoading, searchError, searchResults } = state;

  // Diagnostics tab owns its own DOM lifecycle (persistent panel for
  // diff-aware updates). Do NOT wipe the container — the renderer manages
  // its children directly. Other mode leftovers are cleaned by the renderer.
  if (searchMode === 'diagnostics') {
    if (deps.renderDiagnosticsResults) {
      deps.renderDiagnosticsResults(resultsContainer);
    }
    return;
  }

  // All other modes: clear and rebuild (this also clears any leftover
  // diagnostics container when switching away from that tab).
  resultsContainer.innerHTML = '';

  if (searchLoading) {
    const loading = document.createElement('div');
    loading.className = 'fe-search-loading';
    loading.textContent =
      searchMode === 'changes'
        ? 'Loading changes…'
        : searchMode === 'review'
          ? 'Loading drafts…'
          : 'Searching…';
    resultsContainer.appendChild(loading);
    return;
  }

  if (searchError) {
    const error = document.createElement('div');
    error.className = 'fe-search-error';
    error.textContent = searchError;
    resultsContainer.appendChild(error);
    return;
  }

  if (!searchResults) {
    const hint = document.createElement('div');
    hint.className = 'fe-search-hint';
    if (searchMode === 'name') {
      hint.textContent = 'Type at least 2 characters to search by name.';
    } else if (searchMode === 'content') {
      hint.textContent = 'Type at least 2 characters to search within files.';
    } else if (searchMode === 'changes') {
      hint.textContent = 'View all changes in the working tree.';
    } else if (searchMode === 'review') {
      hint.textContent = 'Review unsaved draft edits across files.';
    }
    resultsContainer.appendChild(hint);
    return;
  }

  if (searchMode === 'name') {
    deps.renderNameResults(resultsContainer, searchResults);
  } else if (searchMode === 'content') {
    deps.renderContentResults(resultsContainer, searchResults);
  } else if (searchMode === 'changes') {
    deps.renderChangesResults(resultsContainer, searchResults);
  } else if (searchMode === 'review') {
    deps.renderReviewResults(resultsContainer, searchResults);
  }
}
