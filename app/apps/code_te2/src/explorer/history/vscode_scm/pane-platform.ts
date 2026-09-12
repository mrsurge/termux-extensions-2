import type { ISCMHistoryItemGraphNode, ISCMHistoryItemViewModel } from './adapted/common/history.ts';
import type { HistoryIcon } from './platform.ts';

// Presentation input only. Rust read DTOs will be validated by the app backend;
// these rows never resolve Git references or open a working document themselves.
export interface HistoryFileRow {
  readonly type: 'historyItemChangeViewModel';
  readonly historyItemViewModel: ISCMHistoryItemViewModel;
  readonly graphColumns: ISCMHistoryItemGraphNode[];
  readonly path: string;
  readonly previousPath?: string;
  readonly status?: string;
  readonly counts: HistoryCounts;
}

export type HistoryCounts =
  | { readonly state: 'ready'; readonly additions: number; readonly deletions: number }
  | { readonly state: 'partial'; readonly additions: number; readonly deletions: number; readonly unknownFiles: number }
  | { readonly state: 'pending' | 'binary' | 'unavailable' };

export type HistoryFileIconResolver = (name: string) => Promise<{ svg?: string; color?: string } | null>;

export interface HistoryCommitRow {
  readonly type: 'historyItemViewModel';
  readonly historyItemViewModel: ISCMHistoryItemViewModel;
  readonly counts: HistoryCounts;
}

export interface HistoryLoadMoreRow {
  readonly type: 'historyItemLoadMore';
  readonly graphColumns: ISCMHistoryItemGraphNode[];
  readonly state: 'idle' | 'loading' | 'error';
}

export interface HistoryErrorRow {
  readonly type: 'historyItemError';
  readonly owner: HistoryCommitRow;
  readonly graphColumns: ISCMHistoryItemGraphNode[];
}

export type HistoryRow = HistoryCommitRow | HistoryFileRow | HistoryLoadMoreRow | HistoryErrorRow;

export interface HistoryCommitTemplate {
  readonly element: HTMLElement;
  readonly graphContainer: HTMLElement;
  readonly label: HTMLElement;
  readonly description: HTMLElement;
  readonly labelContainer: HTMLElement;
  readonly statistics: HTMLElement;
}

export interface HistoryLoadMoreTemplate {
  readonly element: HTMLElement;
  readonly graphPlaceholder: HTMLElement;
  readonly historyItemPlaceholderContainer: HTMLElement;
  readonly historyItemPlaceholderLabel: HTMLElement;
}

export interface HistoryFileSummary {
  readonly path: string;
  readonly previousPath?: string;
  readonly status?: string;
  readonly counts: HistoryCounts;
}

// The backend pins the commit pair and bounds each result. This callback is a
// presentation boundary, not a VS Code history-provider service impersonation.
export interface HistoryChildrenReader {
  (comparison: { readonly commitId: string; readonly parentId: string | null }, signal: AbortSignal): Promise<readonly HistoryFileSummary[]>;
}

export interface HistoryTreeInput {
  readonly type: 'historyRoot';
  readonly id: string;
  readonly rows: readonly (HistoryCommitRow | HistoryLoadMoreRow)[];
}

export function groupBy<T>(values: readonly T[], key: (value: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = Object.create(null);
  for (const value of values) (groups[key(value)] ??= []).push(value);
  return groups;
}

export function historyIconId(icon: HistoryIcon | undefined): string {
  return icon && typeof icon === 'object' && 'id' in icon && /^[a-z0-9-]+$/.test(icon.id) ? icon.id : '';
}

export interface HistoryFileTemplate {
  readonly rowElement: HTMLElement;
  readonly element: HTMLElement;
  readonly graphPlaceholder: HTMLElement;
  readonly label: HTMLElement;
  readonly statistics: HTMLElement;
}

export function appendElement(parent: HTMLElement, className: string): HTMLElement {
  const element = parent.ownerDocument.createElement('div');
  element.className = className;
  parent.appendChild(element);
  return element;
}

export function renderFileSummary(template: HistoryFileTemplate, row: HistoryFileRow, resolveIcon?: HistoryFileIconResolver): void {
  // Use text nodes, never HTML: Git path strings are untrusted display content.
  const icon = template.label.ownerDocument.createElement('span');
  icon.className = 'history-file-icon codicon codicon-file';
  icon.setAttribute('aria-hidden', 'true');
  const name = template.label.ownerDocument.createElement('span');
  name.className = 'history-file-path';
  name.textContent = row.path;
  template.label.replaceChildren(icon, name);
  // The production host supplies the same vendored filename resolver as tabs.
  // A recycled row detaches this icon, fencing any late asynchronous resolution.
  if (resolveIcon) void resolveIcon(row.path.split('/').at(-1) || row.path).then(resolved => {
    if (icon.parentElement !== template.label || !resolved?.svg) return;
    icon.className = 'history-file-icon';
    icon.innerHTML = resolved.svg; // Trusted vendored SVG, never a Git path string.
    icon.style.color = resolved.color || '';
  }).catch(() => {}); // Generic Codicon remains when the icon catalog is unavailable.
  if (row.status === 'added') {
    const added = template.label.ownerDocument.createElement('span');
    added.className = 'history-file-added';
    added.textContent = 'A';
    added.title = 'Added in this commit';
    template.label.append(added);
  }
  template.label.title = row.previousPath ? `${row.previousPath} -> ${row.path}` : row.path;
  renderCounts(template.statistics, row.counts);
}

export function renderCounts(target: HTMLElement, counts: HistoryCounts): void {
  target.dataset.state = counts.state;
  // Separate numeric cells share a host-owned width, so recycled rows and
  // progressively arriving statistics never shift the additions/deletions columns.
  target.replaceChildren();
  target.title = counts.state === 'partial'
    ? `Partial total: ${counts.unknownFiles} file(s) uncounted or counting interrupted. Known text changes only.` : '';
  if (counts.state === 'ready' || counts.state === 'partial') {
    const suffix = counts.state === 'partial' ? '*' : '';
    const plus = appendElement(target, 'history-additions');
    plus.textContent = `+${counts.additions}${suffix}`;
    target.append(' ');
    const minus = appendElement(target, 'history-deletions');
    minus.textContent = `-${counts.deletions}${suffix}`;
  } else {
    const label = appendElement(target, 'history-count-state');
    label.textContent = { pending: 'Loading', binary: 'Binary', unavailable: 'Unavailable' }[counts.state];
  }
}
