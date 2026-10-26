import { isUnknownArray } from '../../rpc/value-types.ts';
import { EXPLORER_RPC_METHODS } from '../rpc/contract.ts';
import {
  firstDiffLine,
  formatHunkHeader,
  type ExplorerDiffChangeLike,
  type ExplorerDiffHunkLike,
} from './utils.ts';
import { renderHighlightedDiffText } from './render-styling.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';
import { renderPathLabel } from './results-renderer.ts';

interface ExplorerReviewLine {
  type?: string;
  text?: string;
}

interface ExplorerReviewHunk extends ExplorerDiffHunkLike {
  lines?: ExplorerReviewLine[];
}

interface ExplorerReviewEntry extends ExplorerDiffChangeLike {
  error?: string;
  identity?: string;
  rel?: string;
  has_draft?: boolean;
  diskExists?: boolean;
  hunks?: ExplorerReviewHunk[];
}

interface ExplorerReviewPayload {
  results?: ExplorerReviewEntry[];
}

interface ExplorerReviewResultsRendererDeps {
  fetchReviewResults(force?: boolean): Promise<unknown>;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: string, payload: Record<string, unknown>): void;
  revertHunk(rel: string, identity: string, index: number): Promise<unknown>;
  revertHunks(rel: string, identity: string, indexes: number[]): Promise<unknown>;
  saveHunks(rel: string, identity: string, indexes: number[]): Promise<unknown>;
  saveFiles(files: string[]): Promise<unknown>;
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
  if (data && typeof data === 'object' && !isUnknownArray(data)) {
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
  const selection = new Map<string, { identity: string; indexes: Set<number>; whole: boolean }>();
  let syncSelection = (): void => {};
  let mutationPending = false;
  let retainedGroups = new Map<string, { identity: string; node: HTMLElement }>();

  function pruneSelection(entries: ExplorerReviewEntry[]): void {
    for (const [rel, selected] of selection) {
      if (!entries.some(entry => entry.rel === rel && entry.identity === selected.identity)) selection.delete(rel);
    }
  }

  function fullySelected(entry: ExplorerReviewEntry): boolean {
    const selected = selection.get(entry.rel || '');
    return Boolean(selected && (entry.hunks?.length ? selected.indexes.size === entry.hunks.length : selected.whole));
  }

  function selectFile(entry: ExplorerReviewEntry, checked: boolean): void {
    const rel = entry.rel || '';
    if (checked) selection.set(rel, { identity: entry.identity || '', indexes: new Set((entry.hunks || []).map((_, i) => i)), whole: true });
    else selection.delete(rel);
    syncSelection();
  }

  async function enableDiffViews(): Promise<void> {
    await deps.ensureDraftDiffs();
  }

  function renderReviewResults(container: HTMLElement, data: unknown): void {
    const target = container;
    container = document.createElement('div');
    const payload = normalizeReviewPayload(data);
    const entries = isUnknownArray(payload.results) ? payload.results : [];
    const previousGroups = retainedGroups;
    retainedGroups = new Map();
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
    const updateSelectAllLabel = (): void => {
      const allSelected =
        entries.length > 0 &&
        entries.every(fullySelected);
      selectAllBtn.textContent = allSelected ? 'Clear Selection' : 'Select All';
    };
    updateSelectAllLabel();
    selectAllBtn.onclick = () => {
      const allSelected =
        entries.length > 0 &&
        entries.every(fullySelected);
      entries.forEach(entry => selectFile(entry, !allSelected));
    };
    toolbar.appendChild(selectAllBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Selected';
    saveBtn.title = 'Save selected draft hunks; keep unselected edits unsaved';
    saveBtn.className = 'fe-btn fe-btn-sm fe-btn-primary';
    saveBtn.onclick = async () => {
      if (mutationPending) return;
      const selected = entries.filter(entry => selection.has(entry.rel || '')).map(entry => ({
        entry, indexes: [...(selection.get(entry.rel || '')?.indexes || [])], whole: fullySelected(entry),
      }));
      if (!selected.length) {
        deps.toast('No files selected');
        return;
      }
      if (!deps.hasExplorerRpc()) {
        deps.toast('Review bus unavailable');
        return;
      }
      mutationPending = true;
      syncSelection();
      try {
        for (const { entry, indexes, whole } of selected) {
          const rel = entry.rel || '';
          if (entry.diskExists === false || !entry.hunks?.length) {
            if (!whole) throw Error('New files require whole-file Save');
            const result = await deps.saveFiles([rel]);
            if (!result || typeof result !== 'object' || !('saved_count' in result) || result.saved_count !== 1) {
              throw Error('Whole-file save did not complete; inspect the draft before retrying');
            }
          } else {
            if (!entry.identity) throw Error('Draft identity unavailable; refresh before saving');
            const result = await deps.saveHunks(rel, entry.identity, indexes);
            if (!result || typeof result !== 'object' || !('diskSaved' in result) || result.diskSaved !== true) {
              throw Error('Save outcome is unknown; inspect disk before retrying');
            }
            if (!('draftReconciled' in result) || result.draftReconciled !== true) {
              throw Error('message' in result && typeof result.message === 'string' ? result.message : 'Disk saved, but draft reconciliation failed. Do not retry the write.');
            }
            if ('directorySynced' in result && result.directorySynced === false) deps.toast('Saved, but directory sync was not confirmed. Do not retry the write.');
          }
          selection.delete(rel);
        }
      } catch (error) {
        deps.toast(error instanceof Error ? error.message : 'Save failed; inspect disk before retrying');
      } finally {
        mutationPending = false;
        syncSelection();
      }
    };
    toolbar.appendChild(saveBtn);

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Revert Selected';
    discardBtn.className = 'fe-btn fe-btn-sm fe-btn-danger';
    discardBtn.onclick = async () => {
      if (mutationPending) return;
      const selected = entries.filter(entry => selection.has(entry.rel || ''));
      if (!selected.length) {
        deps.toast('No hunks selected');
        return;
      }
      mutationPending = true;
      syncSelection();
      try {
        if (!(await window.teUI.dialog.confirm(`Revert selected draft edits in ${selected.length} file(s)? Unselected edits and disk files will be kept.`))) return;
        for (const entry of selected) {
          const rel = entry.rel || '';
          const picked = selection.get(rel);
          if (!picked || !entry.identity) throw Error('Draft changed; refresh before reverting');
          if (entry.hunks?.length) {
            await deps.revertHunks(rel, entry.identity, [...picked.indexes]);
          } else {
            throw Error('Hunk preview unavailable; use the file Discard action');
          }
          selection.delete(rel);
        }
      } catch (error) {
        deps.toast(error instanceof Error ? error.message : 'Reversion failed; refresh before trying again');
      } finally {
        mutationPending = false;
        syncSelection();
      }
    };
    toolbar.appendChild(discardBtn);

    syncSelection = () => {
      for (const entry of entries) {
        const rel = entry.rel || '';
        const selected = selection.get(rel);
        for (const checkbox of target.querySelectorAll<HTMLInputElement>('.fe-review-checkbox')) {
          if (checkbox.dataset.rel !== rel) continue;
          const index = checkbox.dataset.hunkIndex;
          checkbox.checked = index === undefined ? fullySelected(entry) : Boolean(selected?.indexes.has(Number(index)));
          checkbox.indeterminate = index === undefined && Boolean(selected) && !fullySelected(entry);
          checkbox.disabled = mutationPending || !entry.has_draft;
        }
      }
      saveBtn.disabled = mutationPending || !selection.size || entries.some(entry => selection.has(entry.rel || '') && entry.diskExists === false && !fullySelected(entry));
      discardBtn.disabled = mutationPending || !selection.size || entries.some(entry => selection.has(entry.rel || '') && !entry.hunks?.length);
      selectAllBtn.disabled = mutationPending;
      updateSelectAllLabel();
    };

    container.appendChild(toolbar);

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-search-empty';
      empty.textContent = 'No pending draft edits.';
      container.appendChild(empty);
      target.replaceChildren(...Array.from(container.childNodes));
      syncSelection();
      return;
    }

    const list = document.createElement('div');
    list.className = 'fe-review-list';

    entries.forEach((entry) => {
      const rel = entry.rel || '';
      const previous = previousGroups.get(rel);
      if (previous && entry.identity && previous.identity === entry.identity) {
        const check = previous.node.querySelector<HTMLInputElement>('.fe-review-checkbox');
        if (check) check.checked = fullySelected(entry);
        retainedGroups.set(rel, previous);
        list.appendChild(previous.node);
        return;
      }
      const group = document.createElement('div');
      group.dataset.rel = rel;
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

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'fe-review-checkbox';
      check.value = rel;
      check.dataset.rel = rel;
      if (!entry.has_draft) {
        check.disabled = true;
      }
      check.checked = fullySelected(entry);
      check.setAttribute('aria-label', `Select all draft hunks in ${rel}`);
      check.onchange = (event) => {
        const checkbox = event.target;
        if (!(checkbox instanceof HTMLInputElement)) return;
        selectFile(entry, checkbox.checked);
      };
      check.onclick = event => event.stopPropagation();
      header.appendChild(check);

      const fileBody = document.createElement('div');
      fileBody.className = 'fe-search-change-body';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'fe-search-change-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', `Toggle draft hunks in ${rel}`);
      group.classList.add('is-expanded');
      toggle.onclick = event => {
        event.stopPropagation();
        fileBody.hidden = !fileBody.hidden;
        toggle.setAttribute('aria-expanded', String(!fileBody.hidden));
        group.classList.toggle('is-expanded', !fileBody.hidden);
      };
      const icon = document.createElement('span');
      icon.className = 'fe-search-change-icon codicon codicon-file';
      icon.setAttribute('aria-hidden', 'true');
      toggle.appendChild(icon);

      const title = document.createElement('span');
      title.className = 'fe-search-change-path';
      renderPathLabel(title, rel);
      toggle.appendChild(title);
      header.appendChild(toggle);
      const discardFile = document.createElement('button');
      discardFile.type = 'button';
      discardFile.className = 'fe-search-change-restore fe-review-revert';
      discardFile.textContent = 'Discard';
      discardFile.title = `Discard the entire draft for ${rel}; leave disk unchanged`;
      discardFile.onclick = async event => {
        event.stopPropagation();
        if (mutationPending || discardFile.disabled) return;
        mutationPending = true;
        discardFile.disabled = true;
        syncSelection();
        try {
          if (!(await window.teUI.dialog.confirm(`Discard the entire draft for ${rel}? Disk will be kept.`))) return;
          if (!deps.hasExplorerRpc()) throw Error('Review bus unavailable');
          deps.notifyExplorer(EXPLORER_RPC_METHODS.reviewDiscard, { files: [rel] });
        } catch (error) {
          deps.toast(error instanceof Error ? error.message : 'Discard failed');
        } finally {
          mutationPending = false;
          discardFile.disabled = false;
          syncSelection();
        }
      };
      header.appendChild(discardFile);
      header.onclick = event => { event.stopPropagation(); if (event.target === header) toggle.click(); };

      group.appendChild(header);
      if (entry.error) {
        const warning = document.createElement('div');
        warning.className = 'fe-search-warning';
        warning.textContent = entry.error;
        fileBody.appendChild(warning);
      }

      const hunks = isUnknownArray(entry.hunks) ? entry.hunks : [];
      if (hunks.length) {
        const hunksContainer = document.createElement('div');
        hunksContainer.className = 'fe-search-change-hunks';

        hunks.forEach((hunk, hunkIndex) => {
          const hunkBlock = document.createElement('div');
          hunkBlock.className = 'fe-search-hunk';

          const hunkHeaderRow = document.createElement('div');
          hunkHeaderRow.className = 'fe-search-hunk-header-row';
          const hunkCheck = document.createElement('input');
          hunkCheck.type = 'checkbox';
          hunkCheck.className = 'fe-review-checkbox';
          hunkCheck.dataset.rel = rel;
          hunkCheck.dataset.hunkIndex = String(hunkIndex);
          hunkCheck.setAttribute('aria-label', `Select draft hunk ${hunkIndex + 1} in ${rel}`);
          hunkCheck.onclick = event => event.stopPropagation();
          hunkCheck.onchange = () => {
            const selected = selection.get(rel) || { identity: entry.identity || '', indexes: new Set<number>(), whole: false };
            if (hunkCheck.checked) selected.indexes.add(hunkIndex);
            else selected.indexes.delete(hunkIndex);
            if (selected.indexes.size) selection.set(rel, selected);
            else selection.delete(rel);
            syncSelection();
          };
          hunkHeaderRow.appendChild(hunkCheck);
          const hunkHeader = document.createElement('button');
          hunkHeader.type = 'button';
          hunkHeader.className = 'fe-search-hunk-header fe-search-hunk-toggle';
          hunkHeader.textContent = formatHunkHeader(hunk);
          hunkHeader.setAttribute('aria-expanded', 'true');
          hunkHeader.onclick = event => {
            event.stopPropagation();
            diffRows.hidden = !diffRows.hidden;
            hunkHeader.setAttribute('aria-expanded', String(!diffRows.hidden));
          };
          hunkHeaderRow.appendChild(hunkHeader);
          const revert = document.createElement('button');
          revert.className = 'fe-search-change-restore fe-review-revert';
          revert.textContent = 'Revert hunk';
          revert.title = 'Discard only this hunk from the draft; leave disk unchanged';
          revert.onclick = async event => {
            event.stopPropagation();
            if (revert.disabled || mutationPending || !entry.identity) return;
            mutationPending = true;
            syncSelection();
            revert.disabled = true;
            try {
              if (!(await window.teUI.dialog.confirm(`Revert this hunk in ${rel}? Other draft edits and the disk file will be kept.`))) {
                revert.disabled = false;
                return;
              }
              await deps.revertHunk(rel, entry.identity, hunkIndex);
            } catch (error) {
              deps.toast(error instanceof Error ? error.message : 'Hunk reversion failed; refresh before trying again');
              revert.disabled = false;
            } finally {
              mutationPending = false;
              syncSelection();
            }
          };
          hunkHeaderRow.appendChild(revert);
          hunkHeader.dataset.line = String(
            Number(hunk.newStart || hunk.oldStart || 1),
          );
          hunkBlock.appendChild(hunkHeaderRow);

          const diffRows = document.createElement('div');
          diffRows.className = 'fe-search-diff-rows';

          let oldLine = typeof hunk.oldStart === 'number' ? hunk.oldStart : 0;
          let newLine = typeof hunk.newStart === 'number' ? hunk.newStart : 0;

          const lines = isUnknownArray(hunk.lines) ? hunk.lines : [];
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

        fileBody.appendChild(hunksContainer);
      }

      group.appendChild(fileBody);

      list.appendChild(group);
      if (entry.identity) retainedGroups.set(rel, { identity: entry.identity, node: group });
    });

    container.appendChild(list);
    target.replaceChildren(...Array.from(container.childNodes));
    syncSelection();
  }

  return { renderReviewResults };
}
