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
  readonly counts: HistoryCounts;
}

export type HistoryCounts =
  | { readonly state: 'ready'; readonly additions: number; readonly deletions: number }
  | { readonly state: 'pending' | 'binary' | 'unavailable' };

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

export function renderFileSummary(template: HistoryFileTemplate, row: HistoryFileRow): void {
  // Use text nodes, never HTML: Git path strings are untrusted display content.
  template.label.textContent = row.path;
  template.label.title = row.previousPath ? `${row.previousPath} -> ${row.path}` : row.path;
  renderCounts(template.statistics, row.counts);
}

export function renderCounts(target: HTMLElement, counts: HistoryCounts): void {
  target.dataset.state = counts.state;
  target.textContent = counts.state === 'ready'
    ? `+${counts.additions} -${counts.deletions}`
    : { pending: 'Loading', binary: 'Binary', unavailable: 'Unavailable' }[counts.state];
}
