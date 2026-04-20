import type { JsonObject } from '../../rpc/transport.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';
import type { ExplorerRpcMethod } from '../rpc/contract.ts';
import { createExplorerChangesResultsRenderer } from './changes-results-renderer.ts';
import { createExplorerReviewResultsRenderer } from './review-results-renderer.ts';
import { createExplorerSearchController } from './controller.ts';
import { renderSearchOverlayBody } from './overlay-body-renderer.ts';
import { renderContentResults, renderNameResults } from './results-renderer.ts';
import type {
  ExplorerSearchMode,
  ExplorerSearchOverlayState,
} from './types.ts';
import {
  formatDiffBaseLabel,
  type ExplorerDiffBaseInfo,
} from './utils.ts';

type ExplorerSearchTimer = ReturnType<typeof setTimeout> | null;

interface ExplorerSearchOverlayControllerDeps {
  toast(message: string): void;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  getProjectPath(): string;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
  expandToPath(rel: string): Promise<unknown> | void;
  applySetiIconToSpan(
    span: HTMLElement,
    fileName: string,
    kind?: string,
  ): void;
  basename(path: string): string;
  ensureDraftDiffs(): Promise<void>;
  ensureInlineDiffs(): Promise<void>;
  renderDiagnosticsResults(container: HTMLElement): void;
  getGitDiffBase(): ExplorerDiffBaseInfo;
  setGitDiffBase(next: ExplorerDiffBaseInfo): void;
  onGitDiffBaseChanged(): void;
  toggleDiffBaseMenu(
    button: HTMLButtonElement,
    dropdown: HTMLElement,
  ): Promise<void> | void;
}

interface ExplorerSearchResultsPayload {
  mode?: ExplorerSearchMode;
  base?: ExplorerDiffBaseInfo | null;
}

interface ExplorerReviewEntriesPayload {
  entries?: unknown[];
}

interface SearchModeOption {
  id: ExplorerSearchMode;
  label: string;
}

const SEARCH_MODE_OPTIONS: readonly SearchModeOption[] = [
  { id: 'name', label: 'By name' },
  { id: 'content', label: 'By contents' },
  { id: 'changes', label: 'By changes' },
  { id: 'review', label: 'Review edits' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExplorerSearchMode(value: unknown): value is ExplorerSearchMode {
  return (
    value === 'name' ||
    value === 'content' ||
    value === 'changes' ||
    value === 'review' ||
    value === 'diagnostics'
  );
}

function normalizeDiffBase(value: unknown): ExplorerDiffBaseInfo {
  if (!isRecord(value)) {
    return { ref: 'HEAD', mode: 'none', commit: null };
  }
  const commit = isRecord(value.commit) ? value.commit : null;
  return {
    ref: typeof value.ref === 'string' ? value.ref : 'HEAD',
    mode: typeof value.mode === 'string' ? value.mode : 'none',
    commit: commit
      ? {
          hash: typeof commit.hash === 'string' ? commit.hash : undefined,
          short: typeof commit.short === 'string' ? commit.short : undefined,
          subject:
            typeof commit.subject === 'string' ? commit.subject : undefined,
        }
      : null,
  };
}

function getSearchResultsPayload(
  value: unknown,
): ExplorerSearchResultsPayload | null {
  if (!isRecord(value)) return null;
  return value as ExplorerSearchResultsPayload;
}

function getReviewEntriesPayload(
  value: unknown,
): ExplorerReviewEntriesPayload | null {
  if (!isRecord(value)) return null;
  return value as ExplorerReviewEntriesPayload;
}

export function createExplorerSearchOverlayController(
  deps: ExplorerSearchOverlayControllerDeps,
) {
  let searchOverlayVisible = false;
  let searchMode: ExplorerSearchMode = 'name';
  let searchQuery = '';
  let searchResults: unknown = null;
  let searchLoading = false;
  let searchError: string | null = null;
  let searchDebounceTimer: ExplorerSearchTimer = null;
  let lastKnownProjectPath = '';
  let reviewEntries: unknown[] = [];

  let searchController: ReturnType<typeof createExplorerSearchController>;

  const changesResultsRenderer = createExplorerChangesResultsRenderer({
    getGitDiffBase: () => deps.getGitDiffBase(),
    ensureInlineDiffs: () => deps.ensureInlineDiffs(),
    openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
      deps.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
  });

  const reviewResultsRenderer = createExplorerReviewResultsRenderer({
    fetchReviewResults: (force) => searchController.fetchReviewResults(force),
    hasExplorerRpc: () => deps.hasExplorerRpc(),
    notifyExplorer: (method, payload) => {
      deps.notifyExplorer(method as ExplorerRpcMethod, payload);
    },
    toast: (message) => deps.toast(message),
    openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
      deps.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
    ensureDraftDiffs: () => deps.ensureDraftDiffs(),
    ensureInlineDiffs: () => deps.ensureInlineDiffs(),
  });

  function renderSearchOverlay(): void {
    const overlay = document.getElementById('fe-search-overlay');
    if (!(overlay instanceof HTMLElement)) {
      return;
    }

    overlay.style.display = searchOverlayVisible ? 'flex' : 'none';
    if (!searchOverlayVisible) {
      return;
    }

    ensureSearchOverlayStructure(overlay);

    const modeButtons = overlay.querySelectorAll<HTMLButtonElement>(
      '.fe-search-mode button',
    );
    for (const button of modeButtons) {
      button.classList.toggle('active', button.dataset.mode === searchMode);
    }

    const input = overlay.querySelector<HTMLInputElement>('#fe-search-input');
    if (input) {
      input.placeholder =
        searchMode === 'name' ? 'Search files/folders...' : 'Search in files...';
      input.value = searchQuery;
      input.style.display =
        searchMode === 'name' || searchMode === 'content' ? 'block' : 'none';
    }

    const clearBtn =
      overlay.querySelector<HTMLButtonElement>('.fe-search-clear');
    if (clearBtn) {
      clearBtn.style.display =
        searchQuery && (searchMode === 'name' || searchMode === 'content')
          ? 'block'
          : 'none';
    }

    const filterContainer = overlay.querySelector<HTMLElement>(
      '.fe-changes-filter-container',
    );
    if (filterContainer) {
      filterContainer.style.display = searchMode === 'changes' ? 'flex' : 'none';
    }

    const changesToolbar = overlay.querySelector<HTMLElement>(
      '.fe-search-changes-toolbar',
    );
    if (changesToolbar) {
      changesToolbar.style.display = searchMode === 'changes' ? 'flex' : 'none';
    }

    const headButton =
      overlay.querySelector<HTMLButtonElement>('#fe-search-base-btn');
    if (headButton) {
      headButton.textContent = `${formatDiffBaseLabel(deps.getGitDiffBase(), false)} ▾`;
      headButton.disabled = deps.getGitDiffBase().mode === 'none';
    }

    const resultsContainer = overlay.querySelector<HTMLElement>(
      '.fe-search-results',
    );
    if (!resultsContainer) {
      return;
    }

    const state: ExplorerSearchOverlayState = {
      searchMode,
      searchLoading,
      searchError,
      searchResults,
    };
    renderSearchOverlayBody(resultsContainer, state, {
      renderNameResults: (container, data) =>
        renderNameResults(container, data, {
          toast: (message) => deps.toast(message),
          openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
            deps.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
          closeSearchOverlay,
          expandToPath: (rel) => deps.expandToPath(rel),
          applySetiIconToSpan: (span, fileName, kind) =>
            deps.applySetiIconToSpan(span, fileName, kind),
          basename: (path) => deps.basename(path),
        }),
      renderContentResults: (container, data) =>
        renderContentResults(container, data, {
          toast: (message) => deps.toast(message),
          openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
            deps.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
        }),
      renderChangesResults: (container, data) =>
        changesResultsRenderer.renderChangesResults(container, data),
      renderReviewResults: (container, data) =>
        reviewResultsRenderer.renderReviewResults(container, data),
      renderDiagnosticsResults: (container) =>
        deps.renderDiagnosticsResults(container),
    });
  }

  function ensureSearchOverlayStructure(overlay: HTMLElement): void {
    if (overlay.dataset.ready === 'true') {
      return;
    }

    const header = document.createElement('div');
    header.className = 'fe-search-header';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'fe-search-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      closeSearchOverlay();
    });
    header.appendChild(closeBtn);

    const modeContainer = document.createElement('div');
    modeContainer.className = 'fe-search-mode';
    for (const modeOption of SEARCH_MODE_OPTIONS) {
      const button = document.createElement('button');
      button.textContent = modeOption.label;
      button.dataset.mode = modeOption.id;
      button.addEventListener('click', () => {
        searchController.setSearchMode(modeOption.id);
      });
      modeContainer.appendChild(button);
    }
    header.appendChild(modeContainer);

    const inputContainer = document.createElement('div');
    inputContainer.className = 'fe-search-input-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fe-search-input';
    input.addEventListener('input', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        searchController.scheduleSearch(target.value);
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeSearchOverlay();
      }
    });
    inputContainer.appendChild(input);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.className = 'fe-search-clear';
    clearBtn.addEventListener('click', () => {
      searchController.clearSearchResults();
      renderSearchOverlay();
    });
    inputContainer.appendChild(clearBtn);

    const changesToolbar = document.createElement('div');
    changesToolbar.className = 'fe-search-changes-toolbar';

    const headLabel = document.createElement('span');
    headLabel.className = 'fe-search-changes-label';
    headLabel.textContent = 'Diff vs';
    changesToolbar.appendChild(headLabel);

    const headBtn = document.createElement('button');
    headBtn.type = 'button';
    headBtn.id = 'fe-search-base-btn';
    headBtn.className = 'fe-search-head-btn';
    headBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const dropdown = overlay.querySelector<HTMLElement>('#fe-search-base-dd');
      if (!dropdown) {
        return;
      }
      void deps.toggleDiffBaseMenu(headBtn, dropdown);
    });
    changesToolbar.appendChild(headBtn);

    const headDropdown = document.createElement('div');
    headDropdown.id = 'fe-search-base-dd';
    headDropdown.className = 'fe-dropdown';
    changesToolbar.appendChild(headDropdown);

    const filterContainer = document.createElement('div');
    filterContainer.className = 'fe-changes-filter-container';

    const filterLabel = document.createElement('label');
    filterLabel.className = 'fe-changes-filter-label';
    const filterCheck = document.createElement('input');
    filterCheck.type = 'checkbox';
    filterCheck.id = 'fe-changes-filter-active';
    filterLabel.appendChild(filterCheck);
    filterLabel.appendChild(document.createTextNode(' Filter'));

    const filenameLabel = document.createElement('label');
    filenameLabel.className = 'fe-changes-filter-label';
    const filenameCheck = document.createElement('input');
    filenameCheck.type = 'checkbox';
    filenameCheck.id = 'fe-changes-filter-filename';
    filenameCheck.disabled = true;
    filenameLabel.appendChild(filenameCheck);
    filenameLabel.appendChild(document.createTextNode(' Filename only'));

    const hunksLabel = document.createElement('label');
    hunksLabel.className = 'fe-changes-filter-label';
    const hunksCheck = document.createElement('input');
    hunksCheck.type = 'checkbox';
    hunksCheck.id = 'fe-changes-filter-hunks';
    hunksCheck.disabled = true;
    hunksLabel.appendChild(hunksCheck);
    hunksLabel.appendChild(document.createTextNode(' Hunks only'));

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.id = 'fe-changes-filter-input';
    filterInput.className = 'fe-changes-filter-input';
    filterInput.placeholder = 'Filter changes...';
    filterInput.style.display = 'none';

    filterCheck.addEventListener('change', () => {
      const active = filterCheck.checked;
      filenameCheck.disabled = !active;
      hunksCheck.disabled = !active;
      filterInput.style.display = active ? 'inline-block' : 'none';
      if (active) {
        filterInput.focus();
      }
      changesResultsRenderer.applyChangesFilter();
    });

    filenameCheck.addEventListener('change', () => {
      if (filenameCheck.checked) {
        hunksCheck.checked = false;
      }
      changesResultsRenderer.applyChangesFilter();
    });

    hunksCheck.addEventListener('change', () => {
      if (hunksCheck.checked) {
        filenameCheck.checked = false;
      }
      changesResultsRenderer.applyChangesFilter();
    });

    filterInput.addEventListener('input', () => {
      changesResultsRenderer.applyChangesFilter();
    });

    filterContainer.appendChild(filterLabel);
    filterContainer.appendChild(filenameLabel);
    filterContainer.appendChild(hunksLabel);
    filterContainer.appendChild(filterInput);
    changesToolbar.appendChild(filterContainer);

    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'fe-search-results';

    overlay.appendChild(header);
    overlay.appendChild(inputContainer);
    overlay.appendChild(changesToolbar);
    overlay.appendChild(resultsContainer);
    overlay.dataset.ready = 'true';
  }

  searchController = createExplorerSearchController({
    toast: (message) => deps.toast(message),
    renderSearchOverlay,
    focusSearchInput: () => {
      const input = document.getElementById('fe-search-input');
      if (input instanceof HTMLInputElement) {
        input.focus();
      }
    },
    hasBus: () => deps.hasExplorerRpc(),
    sendBus: (method, payload) => deps.notifyExplorer(method, payload),
    getProjectPath: () => deps.getProjectPath(),
    getSearchOverlayVisible: () => searchOverlayVisible,
    setSearchOverlayVisible: (next) => {
      searchOverlayVisible = !!next;
    },
    getSearchMode: () => searchMode,
    setSearchModeValue: (next) => {
      searchMode = next;
    },
    getSearchQuery: () => searchQuery,
    setSearchQuery: (next) => {
      searchQuery = next;
    },
    getSearchResults: () => searchResults,
    setSearchResults: (next) => {
      searchResults = next;
    },
    getSearchLoading: () => searchLoading,
    setSearchLoading: (next) => {
      searchLoading = !!next;
    },
    getSearchError: () => searchError,
    setSearchError: (next) => {
      searchError = next;
    },
    getSearchDebounceTimer: () => searchDebounceTimer,
    setSearchDebounceTimer: (next) => {
      searchDebounceTimer = next;
    },
    setLastKnownProjectPath: (next) => {
      lastKnownProjectPath = next || '';
    },
  });

  function closeSearchOverlay(): void {
    searchController.closeSearchOverlay();
  }

  function handleSearchResultsUpdated(payload: unknown): void {
    const typedPayload = getSearchResultsPayload(payload);
    const payloadMode = typedPayload?.mode;

    if (payloadMode === 'changes' && typedPayload.base) {
      deps.setGitDiffBase(normalizeDiffBase(typedPayload.base));
      deps.onGitDiffBaseChanged();
    }

    if (payloadMode && isExplorerSearchMode(payloadMode) && payloadMode !== searchMode) {
      return;
    }

    searchResults = payload || null;
    searchLoading = false;
    searchError = null;
    if (searchOverlayVisible) {
      renderSearchOverlay();
    }
  }

  function handleReviewEntriesUpdated(payload: unknown): void {
    const typedPayload = getReviewEntriesPayload(payload);
    reviewEntries = Array.isArray(typedPayload?.entries) ? typedPayload.entries : [];
    if (searchMode !== 'review') {
      return;
    }
    searchResults = { mode: 'review', results: reviewEntries };
    searchLoading = false;
    searchError = null;
    if (searchOverlayVisible) {
      renderSearchOverlay();
    }
  }

  function handleSearchError(message: string): boolean {
    if (!searchOverlayVisible || !searchLoading) {
      return false;
    }
    searchLoading = false;
    searchError = message;
    renderSearchOverlay();
    return true;
  }

  return {
    openSearchOverlay: () => searchController.openSearchOverlay(),
    fetchChangesResults: (force = false) => searchController.fetchChangesResults(force),
    renderSearchOverlay,
    handleSearchResultsUpdated,
    handleReviewEntriesUpdated,
    handleSearchError,
    isVisible: () => searchOverlayVisible,
    getSearchMode: () => searchMode,
    getLastKnownProjectPath: () => lastKnownProjectPath,
  };
}
