import { CompressibleAsyncDataTree } from 'te2-scm-tree';
import { getIcon as getSetiIcon } from '/static/vendor/seti-icons/seti-icons.js';
import { HistoryTreeHost } from './vscode_scm/history-tree-host.ts';
import { toISCMHistoryItemViewModelArray } from './vscode_scm/adapted/browser/scmHistory.ts';
import type { ISCMHistoryItem } from './vscode_scm/adapted/common/history.ts';
import type { HistoryCounts, HistoryFileSummary, HistoryCommitRow, HistoryLoadMoreRow } from './vscode_scm/pane-platform.ts';
import { EXPLORER_RPC_METHODS as RPC, type ExplorerRpcMethod } from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid History response');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('Invalid History text');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Invalid History count');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error('Invalid History list');
  return value as unknown[];
}
function counts(value: unknown): HistoryCounts {
  const item = record(value);
  return item.state === 'ready' ? { state: 'ready', additions: number(item.additions), deletions: number(item.deletions) }
    : { state: item.state === 'binary' ? 'binary' : 'unavailable' };
}

/** One visible History tab owns one connection-local, immutable graph generation. */
export class ExplorerHistoryController {
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private tree: HistoryTreeHost | null = null;
  private resize: ResizeObserver | null = null;
  private generation = -1;
  private epoch = 0;
  private commits: ISCMHistoryItem[] = [];
  private statistics = new Map<string, HistoryCounts>();
  private indices = new Map<string, number>();
  private head: string | undefined;
  private refs = new Map<string, { id: string; name: string }[]>();
  private complete = false;
  private pending: JsonObject[] = [];
  private expired = false;

  constructor(private readonly request: (method: ExplorerRpcMethod, payload: JsonObject) => Promise<JsonObject>) {}

  mount(container: HTMLElement): void {
    if (this.root) return;
    container.replaceChildren();
    this.root = container.ownerDocument.createElement('section');
    this.root.style.cssText = 'height:100%;min-height:180px;display:flex;flex-direction:column';
    const refresh = container.ownerDocument.createElement('button');
    refresh.className = 'fe-history-refresh';
    refresh.textContent = 'Refresh History'; refresh.type = 'button';
    refresh.onclick = () => { void this.open(); };
    this.status = container.ownerDocument.createElement('div');
    this.status.setAttribute('role', 'status');
    this.body = container.ownerDocument.createElement('div');
    this.body.style.cssText = 'flex:1;min-height:0;overflow:hidden';
    this.root.append(refresh, this.status, this.body); container.append(this.root);
    this.resize = new ResizeObserver(() => this.layout()); this.resize.observe(this.body);
    void this.open();
  }

  private message(error: unknown): void {
    if (this.status) this.status.textContent = error instanceof Error ? error.message : String(error);
  }
  private layout(): void {
    if (this.body) this.tree?.layout(this.body.clientHeight, this.body.clientWidth);
  }
  private reset(): void {
    this.expired = false;
    this.tree?.dispose(); this.tree = null;
    this.commits = []; this.statistics.clear(); this.indices.clear(); this.refs.clear(); this.head = undefined; this.complete = false;
  }
  private async open(): Promise<void> {
    const epoch = ++this.epoch;
    this.reset(); this.generation = -1; this.pending = [];
    this.message('Loading History...');
    try {
      const reply = await this.request(RPC.historyOpen, {});
      const generation = number(reply.generation);
      if (epoch !== this.epoch || !this.root) {
        void this.request(RPC.historyClose, { generation }).catch(() => {});
        return;
      }
      this.generation = generation;
      const pending = this.pending; this.pending = [];
      for (const item of pending) this.notify(item);
    } catch (error) { if (epoch === this.epoch) this.message(error); }
  }

  notify(payload: JsonObject): void {
    if (!this.root) return;
    if (this.generation < 0) {
      if (this.pending.length < 64) this.pending.push(payload);
      return;
    }
    try {
      const generation = number(payload.generation);
      if (generation < this.generation) return;
      if (generation === this.generation && this.expired) return;
      if (generation > this.generation) {
        if (payload.kind !== 'snapshot') return;
        this.reset(); this.generation = generation;
      }
      if (payload.kind === 'snapshot') {
        const snapshot = record(payload.snapshot);
        this.head = typeof snapshot.head_id === 'string' ? snapshot.head_id : undefined;
        for (const raw of array(snapshot.refs)) {
          const ref = record(raw), id = text(ref.commit_id), name = text(ref.name);
          const refs = this.refs.get(id) || [];
          refs.push({ id: name, name }); this.refs.set(id, refs);
        }
      } else if (payload.kind === 'page') {
        const page = record(payload.page);
        if (number(page.offset) !== this.commits.length) throw Error('History page order changed; refresh History');
        for (const raw of array(page.commits)) {
          const row = record(raw);
          if (this.commits.length >= 500) break;
          this.commits.push({ id: text(row.identity), displayId: text(row.identity).slice(0, 8),
            subject: text(row.subject), message: text(row.subject), author: text(row.author),
            parentIds: array(row.parents).map(text), references: this.refs.get(text(row.identity)) });
        }
        this.complete = page.complete === true || this.commits.length >= 500;
        this.message(this.commits.length >= 500 ? 'Showing the first 500 commits' : `${this.commits.length} commits`);
        this.render();
      } else if (payload.kind === 'statistics') {
        const item = record(payload.statistics);
        this.statistics.set(text(item.commit_id), item.state === 'ready'
          ? { state: 'ready', additions: number(item.known_additions), deletions: number(item.known_deletions) }
          : item.state === 'incomplete' || item.state === 'error'
            ? { state: 'partial', additions: number(item.known_additions), deletions: number(item.known_deletions), unknownFiles: number(item.unknown_files) }
          : { state: item.state === 'computing' ? 'pending' : 'unavailable' });
        this.render();
      } else if (payload.kind === 'expired') {
        // Native idle expiry is terminal for these row identities. Keep Refresh
        // explicit instead of replaying a file click against a different snapshot.
        this.reset();
        this.expired = true;
        this.message('History session expired. Refresh History to continue.');
      } else if (payload.kind === 'error' || payload.kind === 'watcherError') this.message(payload.error);
    } catch (error) { this.message(error); }
  }

  private render(): void {
    if (!this.body) return;
    const models = toISCMHistoryItemViewModelArray(this.commits, undefined,
      this.head ? { id: 'HEAD', name: 'HEAD', revision: this.head } : undefined);
    const rows: (HistoryCommitRow | HistoryLoadMoreRow)[] = models.map(historyItemViewModel => ({
      type: 'historyItemViewModel', historyItemViewModel,
      counts: this.statistics.get(historyItemViewModel.historyItem.id) || { state: 'pending' },
    }));
    if (!this.complete) rows.push({ type: 'historyItemLoadMore', graphColumns: models.at(-1)?.outputSwimlanes || [], state: 'idle' });
    if (this.tree) { void this.tree.updateRows(rows).catch(error => this.message(error)); return; }
    const generation = this.generation;
    this.tree = new HistoryTreeHost(this.body, CompressibleAsyncDataTree,
      { type: 'historyRoot', id: String(generation), rows },
      async ({ commitId }, signal) => {
        const files: HistoryFileSummary[] = [];
        let offset = 0;
        do {
          signal.throwIfAborted();
          const reply = await this.request(RPC.historyFiles, { generation, commitId, offset });
          signal.throwIfAborted();
          if (generation !== this.generation) throw Error('History changed');
          const page = record(reply.page);
          for (const raw of array(page.files)) {
            if (files.length >= 500) throw Error('This commit exceeds the 500-file preview limit');
            const row = record(raw);
            const path = text(row.new_path ?? row.old_path);
            const previousPath = typeof row.old_path === 'string' && row.old_path !== path ? row.old_path : undefined;
            const key = JSON.stringify([commitId, previousPath ?? null, path]);
            if (!this.indices.has(key) && this.indices.size >= 2000) throw Error('History file summary limit reached; refresh History to inspect other commits');
            this.indices.set(key, number(row.index));
            files.push({ path, previousPath, status: text(row.status), counts: counts(row.counts) });
          }
          if (page.next_offset === null) break;
          // A malformed continuation must not turn expansion into an RPC loop.
          const nextOffset = number(page.next_offset);
          if (nextOffset <= offset) throw Error('History file page did not advance');
          offset = nextOffset;
          if (files.length >= 500) throw Error('This commit exceeds the 500-file preview limit');
        } while (true);
        return files;
      }, {
        openFile: async row => {
          const commitId = row.historyItemViewModel.historyItem.id;
          const index = this.indices.get(JSON.stringify([commitId, row.previousPath ?? null, row.path]));
          if (index === undefined || generation !== this.generation) throw Error('History selection is stale');
          await this.request(RPC.historyOpenFile, { generation, commitId, index });
        },
        loadMore: async () => { await this.request(RPC.historyMore, { generation }); },
        onError: error => this.message(error),
      }, getSetiIcon);
    void this.tree.ready.then(() => this.layout()).catch(error => this.message(error));
  }

  dispose(): void {
    if (!this.root) return;
    const generation = this.generation;
    ++this.epoch; this.reset(); this.pending = []; this.generation = -1;
    this.resize?.disconnect(); this.resize = null;
    this.root.remove(); this.root = null; this.body = null; this.status = null;
    if (generation >= 0) void this.request(RPC.historyClose, { generation }).catch(() => {});
  }

  reconnect(): void { if (this.root) void this.open(); }
}
