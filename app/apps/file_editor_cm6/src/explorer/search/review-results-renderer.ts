import { EXPLORER_RPC_METHODS } from '../rpc/contract.ts';
import {
  firstDiffLine,
  formatHunkHeader,
  type ExplorerDiffChangeLike,
  type ExplorerDiffHunkLike,
} from './utils.ts';
import { renderHighlightedDiffText } from './render-styling.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';

interface ExplorerReviewLine {
  type?: string;
  text?: string;
}

interface ExplorerReviewHunk extends ExplorerDiffHunkLike {
  lines?: ExplorerReviewLine[];
}

interface ExplorerReviewEntry extends ExplorerDiffChangeLike {
  rel?: string;
  has_draft?: boolean;
  hunks?: ExplorerReviewHunk[];
}

interface ExplorerReviewPayload {
  results?: ExplorerReviewEntry[];
}

interface ExplorerReviewResultsRendererDeps {
  fetchReviewResults(force?: boolean): Promise<unknown>;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: string, payload: Record<string, unknown>): void;
  toast(message: string): void;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
  ensureDraftDiffs(): Promise<void>;
  ensureInlineDiffs(): Promise<void>;
}

function normalizeReviewPayload(data: unknown): ExplorerReviewPayload {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as ExplorerReviewPayload;
  }
  return {};
}

function isAddLineType(type: string | undefined): boolean {
  return type === 'add-draft';
}

function isDeleteLineType(type: string | undefined): boolean {
  return type === 'del-draft';
}

function getComparableLineText(
  lines: ReadonlyArray<ExplorerReviewLine>,
  index: number,
  currentType: string | undefined,
): string | null {
  if (isAddLineType(currentType)) {
    const previous = lines[index - 1];
    return isDeleteLineType(previous?.type) ? previous?.text || '' : null;
  }
  if (isDeleteLineType(currentType)) {
    const next = lines[index + 1];
    return isAddLineType(next?.type) ? next?.text || '' : null;
  }
  return null;
}

export function createExplorerReviewResultsRenderer(
  deps: ExplorerReviewResultsRendererDeps,
) {
  const selectedReviewFiles = new Set<string>();

  function pruneSelection(entries: ExplorerReviewEntry[]): void {
    const valid = new Set(
      entries
        .map((entry) => entry.rel || '')
        .filter((rel): rel is string => Boolean(rel)),
    );
    for (const rel of selectedReviewFiles) {
      if (!valid.has(rel)) {
        selectedReviewFiles.delete(rel);
      }
    }
  }

  async function enableDiffViews(): Promise<void> {
    await deps.ensureDraftDiffs();
    await deps.ensureInlineDiffs();
  }

  function renderReviewResults(container: HTMLElement, data: unknown): void {
    container.innerHTML = '';
    const payload = normalizeReviewPayload(data);
    const entries = Array.isArray(payload.results) ? payload.results : [];
    pruneSelection(entries);

    const toolbar = document.createElement('div');
    toolbar.className = 'fe-review-toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.className = 'fe-btn fe-btn-sm';
    refreshBtn.onclick = () => {
      void deps.fetchReviewResults(true);
    };
    toolbar.appendChild(refreshBtn);

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'fe-btn fe-btn-sm';
    selectAllBtn.style.marginLeft = '8px';
    const updateSelectAllLabel = (): void => {
      const allSelected =
        entries.length > 0 &&
        entries.every((entry) => entry.rel && selectedReviewFiles.has(entry.rel));
      selectAllBtn.textContent = allSelected ? 'Clear Selection' : 'Select All';
    };
    updateSelectAllLabel();
    selectAllBtn.onclick = () => {
      const allSelected =
        entries.length > 0 &&
        entries.every((entry) => entry.rel && selectedReviewFiles.has(entry.rel));
      if (allSelected) {
        entries.forEach((entry) => {
          if (entry.rel) {
            selectedReviewFiles.delete(entry.rel);
          }
        });
      } else {
        entries.forEach((entry) => {
          if (entry.rel) {
            selectedReviewFiles.add(entry.rel);
          }
        });
      }
      container.querySelectorAll<HTMLInputElement>('.fe-review-checkbox').forEach((checkbox) => {
        const rel = checkbox.dataset.rel || '';
        checkbox.checked = selectedReviewFiles.has(rel);
      });
      updateSelectAllLabel();
    };
    toolbar.appendChild(selectAllBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Selected';
    saveBtn.className = 'fe-btn fe-btn-sm fe-btn-primary';
    saveBtn.style.marginLeft = '8px';
    saveBtn.onclick = () => {
      const selected = Array.from(selectedReviewFiles);
      if (!selected.length) {
        deps.toast('No files selected');
        return;
      }
      if (!deps.hasExplorerRpc()) {
        deps.toast('Review bus unavailable');
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.reviewSave, { files: selected });
    };
    toolbar.appendChild(saveBtn);

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Discard Selected';
    discardBtn.className = 'fe-btn fe-btn-sm fe-btn-danger';
    discardBtn.style.marginLeft = '8px';
    discardBtn.onclick = async () => {
      const selected = Array.from(selectedReviewFiles);
      if (!selected.length) {
        deps.toast('No files selected');
        return;
      }
      if (!(await window.teUI.dialog.confirm(`Discard drafts for ${selected.length} file(s)?`))) {
        return;
      }
      if (!deps.hasExplorerRpc()) {
        deps.toast('Review bus unavailable');
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.reviewDiscard, { files: selected });
    };
    toolbar.appendChild(discardBtn);

    container.appendChild(toolbar);

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-search-empty';
      empty.textContent = 'No pending draft edits.';
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'fe-review-list';

    entries.forEach((entry) => {
      const rel = entry.rel || '';
      const group = document.createElement('div');
      group.className =
        'fe-search-file-group fe-search-change-group fe-review-group';
      group.dataset.line = String(firstDiffLine(entry) || 1);
      group.onclick = async (event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest('.fe-review-checkbox')
        ) {
          return;
        }
        const lineEl =
          target instanceof HTMLElement ? target.closest<HTMLElement>('[data-line]') : null;
        const fallbackLine =
          event.currentTarget instanceof HTMLElement
            ? Number(event.currentTarget.dataset.line || 0)
            : 0;
        const line = lineEl ? Number(lineEl.dataset.line || 0) : fallbackLine;
        await enableDiffViews();
        await deps.openFileAndMaybeJump(rel, line || firstDiffLine(entry), {
          focus: false,
        });
      };

      const header = document.createElement('div');
      header.className = 'fe-search-file-header fe-search-change-header';
      header.style.cursor = 'default';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'fe-review-checkbox';
      check.value = rel;
      check.dataset.rel = rel;
      if (!entry.has_draft) {
        check.disabled = true;
      }
      check.checked = selectedReviewFiles.has(rel);
      check.onchange = (event) => {
        const checkbox = event.target;
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.checked) {
          selectedReviewFiles.add(rel);
        } else {
          selectedReviewFiles.delete(rel);
        }
      };
      check.style.marginRight = '8px';
      header.appendChild(check);

      const title = document.createElement('span');
      title.className = 'fe-search-change-path';
      title.textContent = rel;
      title.style.cursor = 'pointer';
      title.onclick = async () => {
        await enableDiffViews();
        await deps.openFileAndMaybeJump(rel, firstDiffLine(entry), {
          focus: false,
        });
      };
      header.appendChild(title);

      group.appendChild(header);

      const hunks = Array.isArray(entry.hunks) ? entry.hunks : [];
      if (hunks.length) {
        const hunksContainer = document.createElement('div');
        hunksContainer.className = 'fe-search-change-hunks';

        hunks.forEach((hunk) => {
          const hunkBlock = document.createElement('div');
          hunkBlock.className = 'fe-search-hunk';

          const hunkHeader = document.createElement('div');
          hunkHeader.className = 'fe-search-hunk-header';
          hunkHeader.textContent = formatHunkHeader(hunk);
          hunkHeader.dataset.line = String(
            Number(hunk.newStart || hunk.oldStart || 1),
          );
          hunkBlock.appendChild(hunkHeader);

          const diffRows = document.createElement('div');
          diffRows.className = 'fe-search-diff-rows';

          let oldLine = typeof hunk.oldStart === 'number' ? hunk.oldStart : 0;
          let newLine = typeof hunk.newStart === 'number' ? hunk.newStart : 0;

          const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
          lines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = 'fe-search-diff-row';
            const rowLine =
              line.type === 'add-draft'
                ? newLine
                : line.type === 'del-draft'
                  ? oldLine
                  : newLine || oldLine || 1;
            row.dataset.line = String(rowLine || 1);

            const lineNum = document.createElement('span');
            lineNum.className = 'fe-search-diff-line-num';

            const sign = document.createElement('span');
            sign.className = 'fe-search-diff-sign';

            const text = document.createElement('pre');
            text.className = 'fe-search-diff-text';
            renderHighlightedDiffText(text, line.text || '', rel, {
              compareAgainst: getComparableLineText(lines, index, line.type),
              mode: isAddLineType(line.type)
                ? 'added'
                : isDeleteLineType(line.type)
                  ? 'removed'
                  : null,
            });

            if (line.type === 'add-draft') {
              row.classList.add('is-add-draft');
              lineNum.textContent = String(newLine);
              sign.textContent = '+';
              newLine += 1;
            } else if (line.type === 'del-draft') {
              row.classList.add('is-del-draft');
              lineNum.textContent = String(oldLine);
              sign.textContent = '-';
              oldLine += 1;
            } else {
              row.classList.add('is-context');
              lineNum.textContent = String(newLine || oldLine);
              sign.textContent = '';
              newLine += 1;
              oldLine += 1;
            }

            row.appendChild(lineNum);
            row.appendChild(sign);
            row.appendChild(text);
            diffRows.appendChild(row);
          });

          hunkBlock.appendChild(diffRows);
          hunksContainer.appendChild(hunkBlock);
        });

        group.appendChild(hunksContainer);
      }

      list.appendChild(group);
    });

    container.appendChild(list);
  }

  return { renderReviewResults };
}
