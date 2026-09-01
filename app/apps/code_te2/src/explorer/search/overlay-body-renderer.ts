import type { ExplorerSearchOverlayState } from "./types.ts";

interface ExplorerSearchOverlayBodyRendererDeps {
  renderContentResults(container: HTMLElement, data: unknown): void;
  renderChangesResults(container: HTMLElement, data: unknown): void;
  renderReviewResults(container: HTMLElement, data: unknown): void;
  renderDiagnosticsResults?(container: HTMLElement): void;
}

export function renderSearchOverlayBody(
  resultsContainer: HTMLElement,
  state: ExplorerSearchOverlayState,
  deps: ExplorerSearchOverlayBodyRendererDeps,
): void {
  const {
    searchMode,
    searchLoading,
    searchError,
    searchResults,
    searchStatus,
  } = state;

  if (searchMode === "diagnostics") {
    deps.renderDiagnosticsResults?.(resultsContainer);
    return;
  }

  resultsContainer.innerHTML = "";

  if (searchStatus && searchMode === "content") {
    const status = document.createElement("div");
    status.className = `fe-search-status fe-search-status-${searchStatus.status}`;
    const message =
      searchStatus.message ||
      (searchStatus.status === "running" ? "Searching" : "Search");
    const parts = [message];
    if (typeof searchStatus.filesScanned === "number") {
      parts.push(`${searchStatus.filesScanned} files scanned`);
    }
    if (typeof searchStatus.filesMatched === "number") {
      parts.push(`${searchStatus.filesMatched} files`);
    }
    if (typeof searchStatus.matchesFound === "number") {
      parts.push(`${searchStatus.matchesFound} matches`);
    }
    status.textContent = parts.join(" · ");
    resultsContainer.appendChild(status);
  }

  if (searchLoading && !searchResults) {
    const loading = document.createElement("div");
    loading.className = "fe-search-loading";
    loading.textContent =
      searchMode === "changes"
        ? "Loading changes…"
        : searchMode === "review"
          ? "Loading drafts…"
          : "Searching…";
    resultsContainer.appendChild(loading);
    return;
  }

  if (searchError && !searchResults) {
    const error = document.createElement("div");
    error.className = "fe-search-error";
    error.textContent = searchError;
    resultsContainer.appendChild(error);
    return;
  }

  if (searchError) {
    const error = document.createElement("div");
    error.className = "fe-search-error fe-search-error-inline";
    error.textContent = searchError;
    resultsContainer.appendChild(error);
  }

  if (!searchResults) {
    const hint = document.createElement("div");
    hint.className = "fe-search-hint";
    if (searchMode === "content") {
      hint.textContent = "Type at least 2 characters to search within files.";
    } else if (searchMode === "changes") {
      hint.textContent = "View all changes in the working tree.";
    } else if (searchMode === "review") {
      hint.textContent = "Review unsaved draft edits across files.";
    }
    resultsContainer.appendChild(hint);
    return;
  }

  if (searchMode === "content") {
    deps.renderContentResults(resultsContainer, searchResults);
  } else if (searchMode === "changes") {
    deps.renderChangesResults(resultsContainer, searchResults);
  } else if (searchMode === "review") {
    deps.renderReviewResults(resultsContainer, searchResults);
  }
}
