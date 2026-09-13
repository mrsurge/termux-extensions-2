import type { ExplorerSearchOverlayState } from "./types.ts";
import { installScrollExpansion } from './scroll-expansion.ts';
import { totalChangeStatistics } from './change-statistics.ts';

interface ExplorerSearchOverlayBodyRendererDeps {
  loadChangesPage?(offset: number): void;
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
  installScrollExpansion(resultsContainer);
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

  if (searchMode === 'changes') {
    let body = resultsContainer.querySelector<HTMLElement>(':scope > .fe-changes-progressive-body');
    if (!body) {
      resultsContainer.replaceChildren();
      body = document.createElement('div');
      body.className = 'fe-changes-progressive-body';
      resultsContainer.append(body);
    }
    resultsContainer.querySelector(':scope > .fe-changes-progress')?.remove();
    resultsContainer.querySelector(':scope > .fe-changes-more')?.remove();
    const progress = document.createElement('div');
    progress.className = 'fe-changes-progress fe-search-status';
    const data = searchResults && typeof searchResults === 'object' ? searchResults as Record<string, unknown> : {};
    const all: unknown[] = Array.isArray(data.changes) ? data.changes : [];
    data.recentChanges ??= { paths: [] };
    const shown = typeof data.shown === 'number' ? data.shown : 40;
    const key = (item: unknown): unknown => item && typeof item === 'object' ? (item as Record<string, unknown>).rel : undefined;
    const present = new Set(all.map(key));
    const revealed = new Set((Array.isArray(data.revealedPaths) ? data.revealedPaths : []).filter(path => present.has(path)));
    for (const item of all) {
      if (revealed.size >= shown) break;
      revealed.add(key(item));
    }
    data.revealedPaths = [...revealed];
    const visible = all.filter(item => revealed.has(key(item)));
    const count = visible.length;
    const label = document.createElement('span');
    label.textContent = searchError || (data.complete ? (count ? `Showing ${count} of ${data.total || all.length} changed files` : 'No changed files') : searchStatus?.message || 'Enumerating changed files');
    const heading = document.createElement('div');
    heading.className = 'fe-changes-progress-heading';
    heading.append(label);
    progress.append(heading);
    const totals = totalChangeStatistics(all);
    const summary = document.createElement('span');
    summary.className = 'fe-changes-total';
    const partial = !data.complete || data.truncated || data.refreshRequired || searchError || totals.unknown > 0;
    summary.title = 'Tracked changes against the selected commit; untracked additions are separate. Totals include retained files not yet shown.';
    if (partial) summary.append('Partial ');
    for (const [kind, value, sign] of [['added', totals.added, '+'], ['deleted', totals.deleted, '-']] as const) {
      const pill = document.createElement('span');
      pill.className = `fe-search-change-count is-${kind}`;
      pill.textContent = `${sign}${value}`;
      summary.append(pill);
    }
    if (totals.untrackedFiles) summary.append(` · Untracked +${totals.untrackedAdded}`);
    if (totals.unknown) summary.append(` · ${totals.unknown} unavailable`);
    if (data.refreshRequired) progress.append(' · Refresh required to reconcile remaining changes.');
    if (count < all.length) {
      const next = document.createElement('button');
      next.type = 'button'; next.textContent = 'Show more files'; next.className = 'fe-btn fe-btn-sm';
      next.dataset.scrollMore = 'changes';
      next.onclick = () => {
        if (!next.isConnected) return;
        data.shown = shown + 40;
        renderSearchOverlayBody(resultsContainer, state, deps);
      };
      body.after(next);
      next.classList.add('fe-changes-more');
    }
    if (searchError || data.refreshRequired || data.complete) {
      const first = document.createElement('button');
      first.type = 'button'; first.textContent = 'Refresh results'; first.className = 'fe-btn fe-btn-sm';
      first.onclick = () => deps.loadChangesPage?.(0);
      progress.append(first);
    }
    if (data.truncated) progress.append(' · Enumeration limit reached; result is truncated.');
    heading.append(summary);
    resultsContainer.prepend(progress);
    if (searchResults) deps.renderChangesResults(body, { ...data, changes: visible });
    else body.replaceChildren();
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
      searchMode === "review"
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
    } else if (searchMode === "review") {
      hint.textContent = "Review unsaved draft edits across files.";
    }
    resultsContainer.appendChild(hint);
    return;
  }

  if (searchMode === "content") {
    deps.renderContentResults(resultsContainer, searchResults);
  } else if (searchMode === "review") {
    deps.renderReviewResults(resultsContainer, searchResults);
  }
}
