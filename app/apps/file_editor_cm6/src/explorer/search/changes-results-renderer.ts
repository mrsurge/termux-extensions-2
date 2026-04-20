import {
  firstDiffLine,
  formatDiffBaseLabel,
  formatHunkHeader,
  type ExplorerDiffBaseInfo,
  type ExplorerDiffChangeLike,
  type ExplorerDiffHunkLike,
} from './utils.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';

interface ExplorerChangeLine {
  type?: string;
  text?: string;
}

interface ExplorerChangeHunk extends ExplorerDiffHunkLike {
  lines?: ExplorerChangeLine[];
}

interface ExplorerChangeEntry extends ExplorerDiffChangeLike {
  rel?: string;
  statusText?: string;
  hunks?: ExplorerChangeHunk[];
}

interface ExplorerChangesPayload {
  git?: boolean;
  changes?: ExplorerChangeEntry[];
  base?: ExplorerDiffBaseInfo;
}

interface ExplorerChangesResultsRendererDeps {
  getGitDiffBase(): ExplorerDiffBaseInfo;
  ensureInlineDiffs(): Promise<void>;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
}

function normalizeChangesPayload(data: unknown): ExplorerChangesPayload {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as ExplorerChangesPayload;
  }
  return {};
}

function readCheckboxValue(id: string): boolean {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el.checked : false;
}

function readInputValue(id: string): string {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el.value : '';
}

export function createExplorerChangesResultsRenderer(
  deps: ExplorerChangesResultsRendererDeps,
) {
  let lastChangesData: ExplorerChangesPayload | null = null;
  let lastChangesContainer: HTMLElement | null = null;

  function renderChangesResults(container: HTMLElement, data: unknown): void {
    lastChangesContainer = container;
    lastChangesData = normalizeChangesPayload(data);
    applyChangesFilter();
  }

  function applyChangesFilter(): void {
    if (!lastChangesContainer || !lastChangesData) return;

    const filterActive = readCheckboxValue('fe-changes-filter-active');
    const filenameOnly = readCheckboxValue('fe-changes-filter-filename');
    const hunksOnly = readCheckboxValue('fe-changes-filter-hunks');
    const query = readInputValue('fe-changes-filter-input').toLowerCase();

    let entries = Array.isArray(lastChangesData.changes)
      ? lastChangesData.changes
      : [];

    if (filterActive && query) {
      entries = entries
        .map((change) => {
          const filenameMatch = (change.rel || '').toLowerCase().includes(query);
          const nextChange: ExplorerChangeEntry = { ...change };

          if (hunksOnly) {
            const matchingHunks = (Array.isArray(change.hunks) ? change.hunks : []).filter(
              (hunk) =>
                (Array.isArray(hunk.lines) ? hunk.lines : []).some((line) =>
                  (line.text || '').toLowerCase().includes(query),
                ),
            );

            if (matchingHunks.length > 0) {
              nextChange.hunks = matchingHunks;
              return nextChange;
            }
            if (filenameMatch) {
              nextChange.hunks = [];
              return nextChange;
            }
            return null;
          }

          if (filenameMatch) return nextChange;

          if (!filenameOnly) {
            const hunks = Array.isArray(change.hunks) ? change.hunks : [];
            for (const hunk of hunks) {
              const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
              for (const line of lines) {
                if ((line.text || '').toLowerCase().includes(query)) {
                  return nextChange;
                }
              }
            }
          }

          return null;
        })
        .filter((entry): entry is ExplorerChangeEntry => entry !== null);
    }

    const originalEntries = Array.isArray(lastChangesData.changes)
      ? lastChangesData.changes
      : [];
    renderChangesList(
      lastChangesContainer,
      { ...lastChangesData, changes: entries },
      originalEntries.length === 0,
    );
  }

  function renderChangesList(
    container: HTMLElement,
    data: ExplorerChangesPayload,
    wasOriginallyEmpty: boolean,
  ): void {
    container.innerHTML = '';
    if (data.git === false) {
      container.innerHTML =
        '<div class="fe-search-empty">Open a Git project to view changes.</div>';
      return;
    }

    const entries = Array.isArray(data.changes) ? data.changes : [];
    const baseInfo = data.base || deps.getGitDiffBase();
    if (baseInfo && baseInfo.mode !== 'none') {
      const note = document.createElement('div');
      note.className = 'fe-search-changes-note';
      note.style.margin = '4px 0 8px';
      const ref =
        (baseInfo.commit && baseInfo.commit.short) ||
        baseInfo.ref ||
        deps.getGitDiffBase().ref ||
        'HEAD';
      note.textContent = `Comparing against ${ref}`;
      container.appendChild(note);
    }

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-search-empty';
      empty.textContent = wasOriginallyEmpty
        ? 'Working tree is clean.'
        : 'No matching changes found.';
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'fe-search-changes';

    entries.forEach((change) => {
      const rel = change.rel || '';
      const group = document.createElement('div');
      group.className = 'fe-search-file-group fe-search-change-group';
      group.dataset.line = String(firstDiffLine(change) || 1);
      group.onclick = async (event) => {
        await deps.ensureInlineDiffs();
        const target = event.target;
        const currentTarget = event.currentTarget;
        const lineEl =
          target instanceof HTMLElement ? target.closest<HTMLElement>('[data-line]') : null;
        const lineFromTarget = lineEl ? Number(lineEl.dataset.line || 0) : 0;
        const fallbackLine =
          currentTarget instanceof HTMLElement
            ? Number(currentTarget.dataset.line || 0) || firstDiffLine(change)
            : firstDiffLine(change);
        const line = lineFromTarget || fallbackLine;
        await deps.openFileAndMaybeJump(rel, line || firstDiffLine(change), {
          focus: false,
        });
      };

      const header = document.createElement('div');
      header.className = 'fe-search-file-header fe-search-change-header';

      const title = document.createElement('span');
      title.className = 'fe-search-change-path';
      title.textContent = rel;
      header.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'fe-search-change-meta';
      const statusText = document.createElement('span');
      statusText.className = 'fe-search-change-status-text';
      statusText.textContent = change.statusText || '';
      meta.appendChild(statusText);
      header.appendChild(meta);
      group.appendChild(header);

      const hunks = Array.isArray(change.hunks) ? change.hunks : [];
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

          (Array.isArray(hunk.lines) ? hunk.lines : []).forEach((line) => {
            const row = document.createElement('div');
            row.className = 'fe-search-diff-row';
            const rowLine =
              line.type === 'add' || line.type === 'add-draft'
                ? newLine
                : line.type === 'del' || line.type === 'del-draft'
                  ? oldLine
                  : newLine || oldLine || 1;
            row.dataset.line = String(rowLine || 1);

            const lineNum = document.createElement('span');
            lineNum.className = 'fe-search-diff-line-num';

            const sign = document.createElement('span');
            sign.className = 'fe-search-diff-sign';

            const text = document.createElement('pre');
            text.className = 'fe-search-diff-text';
            text.textContent = line.text || '';

            if (line.type === 'add' || line.type === 'add-draft') {
              row.classList.add(line.type === 'add-draft' ? 'is-add-draft' : 'is-add');
              lineNum.textContent = String(newLine);
              sign.textContent = '+';
              newLine += 1;
            } else if (line.type === 'del' || line.type === 'del-draft') {
              row.classList.add(line.type === 'del-draft' ? 'is-del-draft' : 'is-del');
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

  return {
    renderChangesResults,
    applyChangesFilter,
  };
}
