import {
  type ExplorerContentSearchFileResult,
  type ExplorerContentSearchMatch,
  type ExplorerContentSearchResults,
  type ExplorerNameSearchItem,
  type ExplorerNameSearchResults,
} from './types.ts';
import { getErrorMessage } from '../utils/errors.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';

interface ExplorerSearchResultsRendererDeps {
  toast(message: string): void;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
  closeSearchOverlay?(): void;
  expandToPath?(rel: string): Promise<unknown> | void;
  applySetiIconToSpan?(span: HTMLElement, fileName: string, kind?: string): void;
  basename?(path: string): string;
}

function normalizeNameResults(data: unknown): ExplorerNameSearchResults {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as ExplorerNameSearchResults;
  }
  return {};
}

function normalizeContentResults(data: unknown): ExplorerContentSearchResults {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as ExplorerContentSearchResults;
  }
  return {};
}

export function renderNameResults(
  container: HTMLElement,
  data: unknown,
  deps: ExplorerSearchResultsRendererDeps,
): void {
  const payload = normalizeNameResults(data);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  results.forEach((item: ExplorerNameSearchItem) => {
    const rel = item.rel || '';
    const row = document.createElement('div');
    row.className = 'fe-search-item';
    row.onclick = async () => {
      if (item.type === 'file') {
        if (!rel) {
          deps.toast('File opener not available');
          return;
        }
        try {
          await deps.openFileAndMaybeJump(rel);
        } catch (error) {
          deps.toast(
            `Failed to open file: ${getErrorMessage(error, 'unknown error')}`,
          );
        }
        return;
      }

      if (item.type === 'dir' && rel) {
        deps.closeSearchOverlay?.();
        await deps.expandToPath?.(rel);
      }
    };

    const icon = document.createElement('span');
    icon.className = 'fe-search-icon';
    if (item.type === 'dir') {
      icon.textContent = '📁';
    } else {
      icon.textContent = '📄';
      deps.applySetiIconToSpan?.(
        icon,
        deps.basename?.(rel) || rel,
        'file',
      );
    }
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'fe-search-name';
    name.textContent = rel;
    row.appendChild(name);

    list.appendChild(row);
  });

  container.appendChild(list);
  if (payload.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    const shownCount =
      typeof payload.count === 'number' ? payload.count : results.length;
    notice.textContent = `Showing first ${shownCount} results`;
    container.appendChild(notice);
  }
}

export function renderContentResults(
  container: HTMLElement,
  data: unknown,
  deps: ExplorerSearchResultsRendererDeps,
): void {
  const payload = normalizeContentResults(data);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  results.forEach((fileResult: ExplorerContentSearchFileResult) => {
    const rel = fileResult.rel || '';
    const fileGroup = document.createElement('div');
    fileGroup.className = 'fe-search-file-group';

    const matches = Array.isArray(fileResult.matches) ? fileResult.matches : [];
    const fileHeader = document.createElement('div');
    fileHeader.className = 'fe-search-file-header';
    fileHeader.textContent = `${rel} (${matches.length})`;
    fileGroup.appendChild(fileHeader);

    matches.forEach((match: ExplorerContentSearchMatch) => {
      const matchRow = document.createElement('div');
      matchRow.className = 'fe-search-match';
      matchRow.onclick = async () => {
      if (!rel) {
          deps.toast('File opener not available');
          return;
        }
        try {
          await deps.openFileAndMaybeJump(rel, typeof match.line === 'number' ? match.line : 1, {
            focus: false,
            scrollY: 'center',
          });
        } catch (error) {
          deps.toast(
            `Failed to open file: ${getErrorMessage(error, 'unknown error')}`,
          );
        }
      };

      const lineNum = document.createElement('span');
      lineNum.className = 'fe-search-line-num';
      lineNum.textContent = String(
        typeof match.line === 'number' ? match.line : 1,
      );
      matchRow.appendChild(lineNum);

      const snippet = document.createElement('span');
      snippet.className = 'fe-search-snippet';
      snippet.textContent = match.snippet || '';
      matchRow.appendChild(snippet);

      fileGroup.appendChild(matchRow);
    });

    list.appendChild(fileGroup);
  });

  container.appendChild(list);
  if (payload.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    const fileCount =
      typeof payload.file_count === 'number' ? payload.file_count : results.length;
    const matchCount =
      typeof payload.match_count === 'number'
        ? payload.match_count
        : results.reduce((count, result) => {
            const matches = Array.isArray(result.matches) ? result.matches : [];
            return count + matches.length;
          }, 0);
    notice.textContent = `Showing ${fileCount} files, ${matchCount} matches`;
    container.appendChild(notice);
  }
}
