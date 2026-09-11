import { HistoryItemRenderer, HistoryItemChangeRenderer, HistoryItemLoadMoreRenderer, HistoryItemErrorRenderer, ListDelegate, SCMHistoryTreeDataSource } from './adapted/browser/scmHistoryViewPane.ts';
import type { HistoryChildrenReader, HistoryFileRow, HistoryRow, HistoryTreeInput } from './pane-platform.ts';
import type { HistoryTree, HistoryTreeConstructor, TreeDisposable } from './tree-contract.ts';
import { applyGraphColors } from './platform.ts';
import './adapted/browser/media/scm.css';
import './history-tree-host.css';

export interface HistoryTreeActions {
  openFile(row: HistoryFileRow): Promise<void>;
  loadMore(): Promise<void>;
  onError(error: unknown): void;
}

function rowId(row: HistoryRow): string {
  if (row.type === 'historyItemLoadMore') return 'load-more';
  if (row.type === 'historyItemError') return `error:${rowId(row.owner)}`;
  const item = row.historyItemViewModel.historyItem;
  return JSON.stringify(row.type === 'historyItemViewModel'
    ? [row.type, item.id, item.parentIds]
    : [row.type, item.id, item.parentIds, row.previousPath ?? null, row.path]);
}

/** One immutable history generation; the caller replaces this host on ref/project changes. */
export class HistoryTreeHost implements TreeDisposable {
  readonly ready: Promise<void>;
  readonly tree: HistoryTree;
  private readonly source: SCMHistoryTreeDataSource;
  private readonly subscriptions: TreeDisposable[] = [];
  private readonly input: { type: 'historyRoot'; id: string; rows: HistoryTreeInput['rows'] };
  private readonly element: HTMLElement;
  private disposed = false;
  private loadingMore = false;
  private readonly retrying = new Set<string>();
  private updateRevision = 0;

  constructor(container: HTMLElement, Tree: HistoryTreeConstructor, input: HistoryTreeInput, readChildren: HistoryChildrenReader, private readonly actions: HistoryTreeActions) {
    this.input = { ...input };
    this.element = container.ownerDocument.createElement('div');
    this.element.className = 'te2-scm-history scm-history-view';
    applyGraphColors(this.element);
    container.appendChild(this.element);
    this.source = new SCMHistoryTreeDataSource(readChildren, error => {
      if (!this.disposed) this.actions.onError(error);
    });
    try {
      this.tree = new Tree('TE2 history', this.element, new ListDelegate(),
        { isIncompressible: () => true },
        [new HistoryItemRenderer(), new HistoryItemChangeRenderer(), new HistoryItemLoadMoreRenderer(), new HistoryItemErrorRenderer()], this.source, {
          compressionEnabled: false, expandOnlyOnTwistieClick: false,
          identityProvider: { getId: rowId },
          accessibilityProvider: {
            getWidgetAriaLabel: () => 'Source Control History',
            getAriaLabel: row => row.type === 'historyItemViewModel'
              ? `${row.historyItemViewModel.historyItem.subject}, ${row.historyItemViewModel.historyItem.author ?? ''}`
              : row.type === 'historyItemChangeViewModel' ? row.path
                : row.type === 'historyItemError' ? 'Could not load files. Retry' : 'Load more history',
          },
        });
    } catch (error) {
      this.source.dispose(); this.element.remove(); throw error;
    }
    // Upstream onPointer combines mouse and touch. Do not install a second tap
    // handler, which would dispatch a file open twice on mobile.
    this.subscriptions.push(this.tree.onPointer(event => {
      if ('button' in event.browserEvent && event.browserEvent.button !== 0) return;
      if (event.element) this.activate(event.element);
    }));
    this.subscriptions.push(this.tree.onKeyDown(event => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
      const row = this.tree.getFocus()[0];
      if (row && row.type !== 'historyItemViewModel') {
        event.preventDefault(); this.activate(row);
      }
    }));
    this.ready = this.tree.setInput(this.input).catch(error => {
      if (!this.disposed) { this.dispose(); throw error; }
    });
  }

  private activate(row: HistoryRow): void {
    if (this.disposed || row.type === 'historyItemViewModel') return;
    if (row.type === 'historyItemError') {
      const key = rowId(row.owner);
      if (this.retrying.has(key)) return;
      this.retrying.add(key);
      void Promise.resolve().then(() => {
        if (!this.disposed) return this.tree.updateChildren(row.owner, false, true);
      }).catch(error => { if (!this.disposed) this.actions.onError(error); })
        .finally(() => { this.retrying.delete(key); });
    } else if (row.type === 'historyItemChangeViewModel') {
      void Promise.resolve().then(() => {
        if (!this.disposed) return this.actions.openFile(row);
      }).catch(error => { if (!this.disposed) this.actions.onError(error); });
    } else if (!this.loadingMore && row.state !== 'loading') {
      this.loadingMore = true;
      void Promise.resolve().then(() => {
        if (!this.disposed) return this.actions.loadMore();
      }).catch(error => { if (!this.disposed) this.actions.onError(error); })
        .finally(() => { this.loadingMore = false; });
    }
  }

  async updateRows(rows: HistoryTreeInput['rows']): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.updateRevision;
    this.input.rows = rows;
    await this.ready;
    if (this.disposed || revision !== this.updateRevision) return;
    // Root-only refresh retains expanded file children; no new Git read per row.
    try { await this.tree.updateChildren(this.input, false, true); }
    catch (error) { if (!this.disposed) throw error; }
  }

  layout(height: number, width: number): void {
    if (!this.disposed) this.tree.layout(height, width);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Cancel native refresh waiters before disposing their render-event source.
    this.tree.cancelAllRefreshPromises(true);
    this.source.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.tree.dispose();
    this.element.remove();
  }
}
