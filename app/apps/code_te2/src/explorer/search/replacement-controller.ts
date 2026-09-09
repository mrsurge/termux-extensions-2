import type { JsonObject } from '../../rpc/transport.ts';
import { EXPLORER_RPC_METHODS, type ExplorerRpcMethod } from '../rpc/contract.ts';
import { normalizeContentSearchResults } from './result-model.ts';
import type { ExplorerContentSearchFileResult, ExplorerContentSearchResults, ExplorerSearchIdentity } from './types.ts';

interface Deps {
  data(): unknown;
  identity(): ExplorerSearchIdentity;
  ready(): boolean;
  render(): void;
  request(method: ExplorerRpcMethod, payload: JsonObject): Promise<JsonObject>;
  confirm(message: string): Promise<boolean>;
  toast(message: string): void;
  refresh(): void;
}

export function contentFileKey(file: ExplorerContentSearchFileResult): string {
  return file.rel || file.relativePath || file.path || '';
}

export function createContentReplacementController(deps: Deps) {
  let identityKey = '';
  let full: ExplorerContentSearchResults | null = null;
  let showAll = false;
  let selecting = false;
  let expanded = false;
  let replacement = '';
  let busy = false;
  let report = '';
  let ignoreClicksUntil = 0;
  const shownFiles = new Set<string>();
  const dismissed = new Set<string>();
  const selected = new Map<string, Set<number>>();
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const key = () => JSON.stringify(deps.identity());

  function sync(): void {
    const next = key();
    if (identityKey === next) return;
    identityKey = next;
    full = null; showAll = false; selecting = false; report = '';
    shownFiles.clear(); dismissed.clear(); selected.clear();
  }
  function check(captured: string): void {
    if (key() !== captured) throw new Error('Search changed; run replacement again.');
  }
  function view(data: unknown): ExplorerContentSearchResults {
    sync();
    const current = normalizeContentSearchResults(data);
    const files = showAll && full ? full.results || [] : (current.results || []).map(file =>
      shownFiles.has(contentFileKey(file)) ? full?.results?.find(f => contentFileKey(f) === contentFileKey(file)) || file : file);
    const results = files.filter(file => !dismissed.has(contentFileKey(file)));
    return { ...(showAll && full ? full : current), results,
      file_count: results.length, match_count: results.reduce((sum, file) => sum + (file.matches?.length || 0), 0) };
  }
  async function all(captured: string): Promise<ExplorerContentSearchResults> {
    if (!deps.ready()) throw new Error('Wait for the search to finish.');
    check(captured);
    if (full) return full;
    const id = deps.identity();
    if (!id.searchId || id.projectGeneration === null) throw new Error('No retained search.');
    const response = await deps.request(EXPLORER_RPC_METHODS.searchMore, {
      searchId: id.searchId, projectGeneration: id.projectGeneration, cursor: 'global:0',
      limit: { maxMatchesPerFile: 700, maxMatchesTotal: 700 },
    });
    check(captured);
    if (!response.result) throw new Error('Missing retained search results.');
    full = normalizeContentSearchResults(response.result);
    return full;
  }
  async function action(run: (captured: string) => Promise<void>): Promise<void> {
    if (busy) return;
    sync(); busy = true; const captured = identityKey;
    deps.render();
    try { await run(captured); }
    catch (error) { deps.toast(error instanceof Error ? error.message : 'Search action failed'); }
    finally { busy = false; deps.render(); }
  }
  function button(label: string, run: () => void, enabled = true): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'fe-search-action'; node.textContent = label;
    node.disabled = busy || !enabled;
    node.onclick = event => { event.stopPropagation(); run(); };
    return node;
  }
  function indexes(file: ExplorerContentSearchFileResult): number[] {
    return (file.matches || []).map((_, index) => index);
  }
  function choose(path: string, index: number): void {
    if (busy) return;
    selecting = true;
    const set = selected.get(path) || new Set<number>();
    if (set.has(index)) set.delete(index); else set.add(index);
    selected.set(path, set); deps.render();
  }
  async function reveal(path?: string, select = false): Promise<void> {
    await action(async captured => {
      const data = await all(captured);
      if (path) shownFiles.add(path); else showAll = true;
      if (select) {
        selecting = true;
        for (const file of data.results || []) {
          const rel = contentFileKey(file);
          if ((!path || path === rel) && !dismissed.has(rel)) selected.set(rel, new Set(indexes(file)));
        }
      }
    });
  }
  async function chooseFile(path: string): Promise<void> {
    await action(async captured => {
      const data = await all(captured);
      const file = data.results?.find(item => contentFileKey(item) === path);
      if (!file || dismissed.has(path)) return;
      // Group selection covers retained hits, not just the currently rendered rows.
      const hits = indexes(file);
      const fullySelected = hits.length > 0 && hits.every(index => selected.get(path)?.has(index));
      selecting = true;
      shownFiles.add(path);
      if (fullySelected) selected.delete(path);
      else selected.set(path, new Set(hits));
    });
  }
  async function replace(scope: 'all' | 'selected' | 'file' | 'hit', path?: string, index?: number): Promise<void> {
    await action(async captured => {
      const visible = view(deps.data());
      const data = await all(captured);
      const work = (data.results || []).filter(file => !dismissed.has(contentFileKey(file)))
        .map(file => ({ file, rel: contentFileKey(file), hits: indexes(file).filter(i =>
          scope === 'all' || (scope === 'selected' ? selected.get(contentFileKey(file))?.has(i)
            : contentFileKey(file) === path && (scope === 'file' || i === index))) }))
        .filter(item => item.hits.length);
      if (!work.length) throw new Error('No matches selected.');
      if (work.some(item => item.hits.some(i => !item.file.matches?.[i]?.editTarget))) {
        throw new Error('The selection includes display-only hits. Select supported text hits instead.');
      }
      const hidden = work.some(item => item.hits.some(i =>
        !visible.results?.find(file => contentFileKey(file) === item.rel)?.matches?.[i]));
      if (hidden && !await deps.confirm('This replacement includes retained hits that are not shown. Replace them too? Results beyond the 700-hit search limit are never included.')) return;
      const text = replacement;
      const id = { ...deps.identity() };
      let changed = 0;
      const outcomes: string[] = [];
      // Prepare/apply sequentially: never allocate more consent tokens than the
      // backend retains. Each file is atomic; successful files are not rolled back.
      for (const item of work) {
        check(captured);
        const base = { searchId: id.searchId, projectGeneration: id.projectGeneration, relativePath: item.rel };
        try {
          const prepared = await deps.request(EXPLORER_RPC_METHODS.searchReplace, {
            ...base, phase: 'prepare', matchIndexes: item.hits, replacement: text,
          });
          check(captured);
          if (typeof prepared.token !== 'string') throw new Error('Missing replacement confirmation.');
          if (prepared.hasDraft === true && !await deps.confirm(`Discard the entire unsaved draft of ${item.rel} and replace ${item.hits.length} disk match(es)?\n\nOther disk text and the Git index remain unchanged.`)) {
            outcomes.push(`${item.rel}: skipped (draft kept)`); continue;
          }
          check(captured);
          const result = await deps.request(EXPLORER_RPC_METHODS.searchReplace, {
            ...base, phase: 'apply', token: prepared.token, discardDraft: prepared.hasDraft === true,
          });
          check(captured);
          if (result.changed === true) {
            changed++;
            // The old snapshot is now stale, including unselected matches in it.
            dismissed.add(item.rel); selected.delete(item.rel);
          }
          outcomes.push(`${item.rel}: ${result.changed === true ? 'replaced' : 'unchanged'}${result.draftRetained === true ? '; draft retained, review before saving' : ''}`);
        } catch (error) {
          outcomes.push(`${item.rel}: ${error instanceof Error ? error.message : 'failed'}`);
          // Stop on errors, including uncertain transport outcomes. Never retry
          // a write or silently continue a batch after its connection is lost.
          outcomes.push('Remaining files were not attempted.'); break;
        }
      }
      check(captured);
      report = outcomes.join('\n');
      deps.toast(`${changed} file(s) changed. See replacement results. Run a new search for updated matches.`);
    });
  }
  function toolbar(container: HTMLElement): void {
    const row = document.createElement('div'); row.className = 'fe-search-replace-actions';
    row.append(button('Show all', () => { void reveal(); }, deps.ready()),
      button('Select all', () => { void reveal(undefined, true); }, deps.ready()));
    if (expanded) row.append(button('Replace selected', () => { void replace('selected'); }, deps.ready() && [...selected.values()].some(set => set.size)),
      button('Replace all', () => { void replace('all'); }, deps.ready()));
    if (selecting) row.append(button('Clear selection', () => { selected.clear(); selecting = false; deps.render(); }));
    container.append(row);
    if (mobile) { const hint = document.createElement('div'); hint.className = 'fe-search-hint'; hint.textContent = 'Long press a hit to select; then tap hits or file headers to select more.'; container.append(hint); }
    if (report) {
      row.append(button('Refresh results', () => deps.refresh()));
      const output = document.createElement('pre'); output.className = 'fe-search-replace-report'; output.textContent = report; container.append(output);
    }
  }
  function header(node: HTMLElement, file: ExplorerContentSearchFileResult): void {
    const rel = contentFileKey(file);
    const count = selected.get(rel)?.size || 0;
    node.classList.toggle('fe-search-selected', count > 0);
    // Mobile selection is gesture-only: omit controls rather than hiding them
    // with a breakpoint so no checkbox space remains on any mobile layout.
    if (!mobile) {
      const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'fe-search-select'; box.disabled = busy;
      box.setAttribute('aria-label', `Select all matches in ${rel}`);
      box.checked = count > 0;
      box.indeterminate = count > 0 && count < (file.fileMatchCount || file.matches?.length || 0);
      box.style.opacity = selecting ? '1' : '.4';
      box.onclick = event => { event.stopPropagation(); void chooseFile(rel); };
      node.prepend(box);
    }
    node.onclick = () => { if (!busy && Date.now() >= ignoreClicksUntil && selecting) void chooseFile(rel); };
    longPress(node, () => { void reveal(rel, true); });
    if ((file.fileMatchCount || 0) > (file.matches?.length || 0)) node.append(button('Show all in file', () => { void reveal(rel); }, deps.ready()));
    if (expanded) node.append(button('Replace file', () => { void replace('file', rel); }, deps.ready()));
    const dismiss = button('×', () => { dismissed.add(rel); selected.delete(rel); deps.render(); });
    dismiss.title = 'Dismiss file from this search'; dismiss.setAttribute('aria-label', `Dismiss ${rel}`); node.append(dismiss);
  }
  function hit(node: HTMLElement, file: ExplorerContentSearchFileResult, index: number): void {
    const rel = contentFileKey(file);
    node.classList.toggle('fe-search-selected', selected.get(rel)?.has(index) === true);
    if (!mobile) {
      const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'fe-search-select'; box.disabled = busy;
      box.checked = selected.get(rel)?.has(index) === true; box.style.opacity = selecting ? '1' : '.4';
      box.setAttribute('aria-label', `Select match ${index + 1} in ${rel}`);
      box.onclick = event => { event.stopPropagation(); choose(rel, index); }; node.prepend(box);
    }
    if (expanded) node.append(button('Replace', () => { void replace('hit', rel, index); }, deps.ready() && !!file.matches?.[index]?.editTarget));
    const navigate = node.onclick;
    node.onclick = event => {
      if (Date.now() < ignoreClicksUntil || busy) return;
      if (selecting) choose(rel, index); else navigate?.call(node, event);
    };
    longPress(node, () => choose(rel, index));
  }
  function longPress(node: HTMLElement, select: () => void): void {
    if (mobile) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let x = 0, y = 0;
      const cancel = () => { clearTimeout(timer); timer = undefined; };
      node.addEventListener('pointerdown', event => {
        if ((event.target as Element).closest('button,input') || busy) return;
        cancel(); x = event.clientX; y = event.clientY;
        timer = setTimeout(() => {
          if (node.isConnected) {
            ignoreClicksUntil = Date.now() + 800;
            select();
          }
        }, 450);
      });
      node.addEventListener('pointermove', event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 8) cancel(); });
      node.addEventListener('pointerup', cancel); node.addEventListener('pointercancel', cancel); node.addEventListener('pointerleave', cancel);
      node.oncontextmenu = event => event.preventDefault();
    }
  }
  return { view, toolbar, header, hit,
    setReplacement(open: boolean, text: string) { expanded = open; replacement = text; deps.render(); },
  };
}

export type ContentReplacementController = ReturnType<typeof createContentReplacementController>;
