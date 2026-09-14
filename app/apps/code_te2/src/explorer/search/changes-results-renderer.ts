import {
  firstDiffLine,
  formatDiffBaseLabel,
  formatHunkHeader,
  type ExplorerDiffBaseInfo,
  type ExplorerDiffChangeLike,
  type ExplorerDiffHunkLike,
} from './utils.ts';
import { renderHighlightedDiffText, highlightFilterMatches } from './render-styling.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';
import type { HunkRestoreIdentity } from '../tree/restore-action.ts';
import { gitActionButton } from '../git/action-button.ts';
import { changeStatistics } from './change-statistics.ts';

interface ExplorerChangeLine {
  type?: string;
  text?: string;
}

interface ExplorerChangeHunk extends ExplorerDiffHunkLike {
  lines?: ExplorerChangeLine[];
  restore?: HunkRestoreIdentity;
}

interface ExplorerChangeEntry extends ExplorerDiffChangeLike {
  status?: string;
  statusCode?: string;
  summary?: { added?: number; deleted?: number; contentSuppressed?: boolean; displayText?: string };
  error?: string;
  rel?: string;
  statusText?: string;
  hunks?: ExplorerChangeHunk[];
}

interface ExplorerChangesPayload {
  recentChanges?: { paths: string[] };
  complete?: boolean;
  git?: boolean;
  changes?: ExplorerChangeEntry[];
  base?: ExplorerDiffBaseInfo;
}

interface ExplorerChangesResultsRendererDeps {
  remoteAction?(action: 'push' | 'pull' | 'fetch'): Promise<void>;
  hasStagedChanges?(): boolean;
  stageFile?(rel: string): Promise<void>;
  commitStagedChanges?(): Promise<void>;
  getFileIcon?(name: string): Promise<{ svg?: string; color?: string } | null>;
  restoreFile(rel: string): Promise<void>;
  restoreHunk(rel: string, identity: HunkRestoreIdentity): Promise<void>;
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

function isAddLineType(type: string | undefined): boolean {
  return type === 'add' || type === 'add-draft';
}

function isDeleteLineType(type: string | undefined): boolean {
  return type === 'del' || type === 'del-draft';
}

function getComparableLineText(
  lines: ReadonlyArray<ExplorerChangeLine>,
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

export function createExplorerChangesResultsRenderer(
  deps: ExplorerChangesResultsRendererDeps,
) {
  let lastChangesData: ExplorerChangesPayload | null = null;
  let lastChangesContainer: HTMLElement | null = null;
  const renderedGroups = new WeakMap<ExplorerChangeEntry, HTMLElement>();

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
    const filterQuery = readCheckboxValue('fe-changes-filter-active')
      ? readInputValue('fe-changes-filter-input').toLowerCase() : '';
    container.querySelectorAll(':scope > .fe-search-empty, :scope > .fe-search-changes-note, :scope > .fe-search-changes-actions').forEach(node => node.remove());
    if (data.git === false) {
      container.innerHTML =
        '<div class="fe-search-empty">Open a Git project to view changes.</div>';
      return;
    }

    const entries = Array.isArray(data.changes) ? data.changes : [];
    const baseInfo = data.base || deps.getGitDiffBase();
    const headView = (): boolean => (baseInfo.ref || 'HEAD') === 'HEAD' &&
      (deps.getGitDiffBase().ref || 'HEAD') === 'HEAD';
    const labelRestore = (group: HTMLElement): void => {
      for (const button of group.querySelectorAll<HTMLButtonElement>('.fe-search-change-restore')) {
        button.textContent = headView() ? '×' : 'Restore';
        button.classList.toggle('is-historical', !headView());
      }
    };
    // These are ordinary Explorer intents. Backend HEAD guards remain authoritative.
    {
      const actions = document.createElement('div');
      actions.className = 'fe-search-changes-actions';
      // Expand only this bounded result page; do not fetch other pages or alter search state.
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'fe-btn fe-btn-sm fe-search-changes-expand';
      expand.textContent = 'Expand all';
      expand.disabled = entries.length === 0;
      expand.onclick = () => {
        container.querySelectorAll<HTMLButtonElement>(
          '.fe-search-change-toggle[aria-expanded="false"], .fe-search-hunk-toggle[aria-expanded="false"], .fe-search-hunk-blind[aria-expanded="false"]',
        ).forEach(button => button.click());
      };
      actions.appendChild(expand);
      if (deps.commitStagedChanges) {
      const commit = document.createElement('button');
      commit.className = 'fe-search-changes-commit';
      commit.type = 'button';
      commit.textContent = deps.hasStagedChanges?.() === false ? 'Stage and commit all' : 'Commit selected';
      commit.disabled = !headView();
      commit.title = 'Commit all staged changes in this project, not just the displayed files';
      commit.onclick = async () => {
        if (!headView() || commit.disabled) return;
        commit.disabled = true;
        try { await deps.commitStagedChanges?.(); }
        finally { commit.disabled = !headView(); }
      };
      actions.appendChild(commit);
      }
      if (deps.remoteAction) for (const action of ['push', 'pull', 'fetch'] as const) {
        const button = gitActionButton(document, action, `${action[0].toUpperCase()}${action.slice(1)} remote`);
        button.disabled = action !== 'fetch' && !headView();
        button.onclick = async () => {
          if (button.disabled) return;
          button.disabled = true;
          try { await deps.remoteAction?.(action); }
          finally { button.disabled = action !== 'fetch' && !headView(); }
        };
        actions.append(button);
      }
      container.prepend(actions);
    }
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
      container.prepend(note);
    }

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-search-empty';
      empty.textContent = wasOriginallyEmpty
        ? data.complete === false ? 'Waiting for diffs…' : 'No changes against the selected commit.'
        : 'No matching changes found.';
      container.appendChild(empty);
      container.querySelector(':scope > .fe-search-changes')?.remove();
      return;
    }

    const list = container.querySelector<HTMLElement>(':scope > .fe-search-changes') || document.createElement('div');
    list.className = 'fe-search-changes';
    const keep = new Set<HTMLElement>();
    const place = (group: HTMLElement, index: number): void => {
      group.querySelector('.fe-search-change-header')?.classList.toggle('is-recent',
        data.recentChanges?.paths.includes(group.dataset.rel || '') === true);
      keep.add(group);
      if (list.children[index] !== group) list.insertBefore(group, list.children[index] || null);
    };

    entries.forEach((change, index) => {
      const cached = renderedGroups.get(change);
      if (cached) {
        labelRestore(cached);
        const stage = cached.querySelector<HTMLButtonElement>('.fe-search-change-stage');
        if (stage) stage.disabled = !headView();
        place(cached, index); return;
      }
      const rel = change.rel || '';
      const previous = [...list.children].find(child => (child as HTMLElement).dataset.rel === rel);
      const expansion = previous ? [...previous.querySelectorAll<HTMLButtonElement>('[aria-expanded]')]
        .map(button => button.getAttribute('aria-expanded') === 'true') : [];
      const group = document.createElement('div');
      group.dataset.rel = rel;
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
      // A local click replaces the live batch highlight, without selecting hunks
      // or changing shared Git state. Capture also covers header action buttons.
      header.addEventListener('click', () => {
        if (!lastChangesData?.recentChanges) return;
        lastChangesData.recentChanges.paths = [rel];
        list.querySelectorAll<HTMLElement>('.fe-search-change-group').forEach(row => {
          row.querySelector('.fe-search-change-header')?.classList.toggle('is-recent', row.dataset.rel === rel);
        });
      }, true);

      // File expansion is presentation-only; diff rows retain navigation and Restore owns its action.
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'fe-search-change-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `Expand changes in ${rel}`);
      const fileBody = document.createElement('div');
      fileBody.className = 'fe-search-change-body';
      fileBody.hidden = true;
      toggle.onclick = (event) => {
        event.stopPropagation();
        fileBody.hidden = !fileBody.hidden;
        toggle.setAttribute('aria-expanded', String(!fileBody.hidden));
        toggle.setAttribute('aria-label', `${fileBody.hidden ? 'Expand' : 'Collapse'} changes in ${rel}`);
      };
      const icon = document.createElement('span');
      icon.className = 'fe-search-change-icon codicon codicon-file';
      icon.setAttribute('aria-hidden', 'true');
      toggle.appendChild(icon);
      // Resolve trusted vendored icons by basename, without inserting path text as markup.
      void deps.getFileIcon?.(rel.split('/').pop() || rel).then((resolved) => {
        if (!resolved?.svg) return;
        icon.classList.remove('codicon', 'codicon-file');
        icon.innerHTML = resolved.svg;
        if (resolved.color) icon.style.color = resolved.color;
      }).catch(() => { /* Keep the generic icon when a vendored icon is unavailable. */ });

      const title = document.createElement('span');
      title.className = 'fe-search-change-path';
      title.title = rel;
      const pathText = document.createElement('bdi');
      pathText.dir = 'ltr';
      pathText.textContent = rel;
      highlightFilterMatches(pathText, filterQuery);
      title.appendChild(pathText);
      toggle.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'fe-search-change-meta';
      const statusText = document.createElement('span');
      statusText.className = 'fe-search-change-status-text';
      const untracked = change.status === '?' || change.statusCode?.trim() === '??' || change.statusText === 'Untracked';
      const modified = change.status === 'M' || change.statusText === 'Modified';
      statusText.textContent = untracked ? 'A' : modified ? 'M' : change.statusText || '';
      statusText.title = change.statusText || '';
      statusText.classList.toggle('is-added', untracked);
      meta.appendChild(statusText);
      const hunks = Array.isArray(change.hunks) ? change.hunks : [];
      const stats = changeStatistics(change);
      const { added, deleted } = stats || { added: 0, deleted: 0 };
      for (const [kind, count, sign] of [['added', added, '+'], ['deleted', deleted, '-']] as const) {
        const pill = document.createElement('span');
        pill.className = `fe-search-change-count is-${kind}`;
        pill.textContent = stats ? `${sign}${count}` : `${sign}?`;
        pill.title = stats ? `${count} ${kind} lines` : 'Line count unavailable for this preview';
        meta.appendChild(pill);
      }
      toggle.appendChild(meta);
      header.appendChild(toggle);
      if (deps.stageFile) {
        const stage = document.createElement('button');
        stage.type = 'button';
        stage.className = 'fe-search-change-stage';
        stage.textContent = '+';
        stage.title = `Stage disk changes in ${rel}`;
        stage.setAttribute('aria-label', stage.title);
        stage.disabled = !headView();
        stage.onclick = async (event) => {
          event.stopPropagation();
          if (!headView() || stage.disabled) return;
          stage.disabled = true;
          try { await deps.stageFile?.(rel); }
          finally { stage.disabled = !headView(); }
        };
        header.appendChild(stage);
      }
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'fe-search-change-restore';
      restore.textContent = '×';
      restore.title = `Restore ${rel} from selected commit...`;
      restore.setAttribute('aria-label', `Restore ${rel} from selected commit`);
      restore.onclick = async (event) => {
        event.stopPropagation();
        if (restore.disabled) return;
        restore.disabled = true;
        try { await deps.restoreFile(rel); }
        finally { restore.disabled = false; }
      };
      header.appendChild(restore);
      group.appendChild(header);

      // Bodyless previews navigate from the header; they have nothing to expand.
      if (!hunks.length) {
        toggle.removeAttribute('aria-expanded');
        toggle.setAttribute('aria-label', `Open ${rel}`);
        toggle.title = `Open ${rel}`;
        toggle.onclick = async event => {
          event.stopPropagation();
          await deps.openFileAndMaybeJump(rel, 1, { focus: false });
        };
      }

      if (hunks.length) {
        const hunksContainer = document.createElement('div');
        hunksContainer.className = 'fe-search-change-hunks';

        hunks.forEach((hunk) => {
          const hunkBlock = document.createElement('div');
          hunkBlock.className = 'fe-search-hunk';

          // Sibling buttons share a row without nesting Restore inside the collapse target.
          const hunkHeaderRow = document.createElement('div');
          hunkHeaderRow.className = 'fe-search-hunk-header-row';
          hunkBlock.appendChild(hunkHeaderRow);

          const hunkHeader = document.createElement('button');
          hunkHeader.type = 'button';
          hunkHeader.className = 'fe-search-hunk-header fe-search-hunk-toggle';
          hunkHeader.textContent = formatHunkHeader(hunk);
          hunkHeader.dataset.line = String(
            Number(hunk.newStart || hunk.oldStart || 1),
          );
          hunkHeaderRow.appendChild(hunkHeader);
          const identity = hunk.restore;
          if (identity && typeof identity.commit === 'string' && typeof identity.sourceSha256 === 'string' && Number.isInteger(identity.hunkIndex)) {
            const restoreHunk = document.createElement('button');
            restoreHunk.type = 'button';
            restoreHunk.className = 'fe-search-change-restore';
            restoreHunk.textContent = '×';
            restoreHunk.title = 'Restore this hunk from selected commit...';
            restoreHunk.setAttribute('aria-label', restoreHunk.title);
            restoreHunk.onclick = async (event) => {
              event.stopPropagation();
              if (restoreHunk.disabled) return;
              restoreHunk.disabled = true;
              try { await deps.restoreHunk(rel, identity); }
              finally { restoreHunk.disabled = false; }
            };
            hunkHeaderRow.appendChild(restoreHunk);
          }

          const diffRows = document.createElement('div');
          diffRows.className = 'fe-search-diff-rows';
          hunkHeader.setAttribute('aria-expanded', 'true');
          const body = document.createElement('div');
          body.className = 'fe-search-hunk-body';
          hunkHeader.onclick = (event) => {
            event.stopPropagation();
            body.hidden = !body.hidden;
            hunkHeader.setAttribute('aria-expanded', String(!body.hidden));
          };

          let oldLine = typeof hunk.oldStart === 'number' ? hunk.oldStart : 0;
          let newLine = typeof hunk.newStart === 'number' ? hunk.newStart : 0;

          const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
          lines.forEach((line, index) => {
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
            renderHighlightedDiffText(text, line.text || '', rel, {
              compareAgainst: getComparableLineText(lines, index, line.type),
              mode: isAddLineType(line.type)
                ? 'added'
                : isDeleteLineType(line.type)
                  ? 'removed'
                  : null,
            });
            highlightFilterMatches(text, filterQuery);

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

          body.appendChild(diffRows);
          if (lines.length > 50) {
            diffRows.classList.add('is-blinded');
            const blind = document.createElement('button');
            blind.type = 'button';
            blind.className = 'fe-search-hunk-blind';
            const updateBlind = (): void => {
              const clipped = diffRows.classList.contains('is-blinded');
              blind.textContent = clipped ? `Show remaining ${lines.length - 50} lines` : 'Show first 50 lines';
              blind.setAttribute('aria-expanded', String(!clipped));
              blind.classList.toggle('is-blinded', clipped);
            };
            blind.onclick = (event) => {
              event.stopPropagation();
              diffRows.classList.toggle('is-blinded');
              updateBlind();
            };
            updateBlind();
            body.appendChild(blind);
          }
          hunkBlock.appendChild(body);
          hunksContainer.appendChild(hunkBlock);
        });

        fileBody.appendChild(hunksContainer);
      }

      if (change.error) {
        const notice = document.createElement('div');
        notice.className = 'fe-search-error'; notice.textContent = change.error;
        fileBody.append(notice);
      }
      group.appendChild(fileBody);
      // A new file snapshot replaces only its own DOM. Preserve presentation,
      // never reuse old diff actions or their guarded edit identities.
      group.querySelectorAll<HTMLButtonElement>('[aria-expanded]').forEach((button, index) => {
        if (expansion[index] && button.getAttribute('aria-expanded') === 'false') button.click();
      });
      labelRestore(group);
      renderedGroups.set(change, group);
      place(group, index);
    });

    for (const child of [...list.children]) if (!keep.has(child as HTMLElement)) child.remove();
    if (list.parentElement !== container) container.appendChild(list);
  }

  return {
    renderChangesResults,
    applyChangesFilter,
  };
}
