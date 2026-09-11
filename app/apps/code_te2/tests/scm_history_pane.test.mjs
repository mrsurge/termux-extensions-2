import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { buildTree } from '../src/explorer/history/vscode_scm/tree/build.mjs';

const root = path.resolve(import.meta.dirname, '../src/explorer/history/vscode_scm');
const win = new Window();
const names = ['window', 'document', 'navigator', 'customElements', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'MutationObserver', 'ResizeObserver', 'MouseEvent', 'KeyboardEvent', 'UIEvent'];
const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let upstream, pane, graph, hostModule;
let treeCss;
async function load(entry) {
  const built = await build({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: 'esm', target: 'es2022', loader: { '.css': 'empty' } });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=' + entry).toString('base64')}`);
}
before(async () => {
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
  const result = await buildTree();
  const js = result.outputFiles.find(file => file.path.endsWith('.js'));
  treeCss = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  upstream = await import(`data:text/javascript;base64,${Buffer.from(js.text + '\n//# sourceURL=upstream-scm-tree.mjs').toString('base64')}`);
  pane = await load('adapted/browser/scmHistoryViewPane.ts');
  graph = await load('adapted/browser/scmHistory.ts');
  hostModule = await load('history-tree-host.ts');
});
after(async () => {
  await win.happyDOM.abort();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function commitRows() {
  return graph.toISCMHistoryItemViewModelArray([
    { id: 'merge', parentIds: ['left', 'right'], subject: 'Merge', message: 'Merge', author: 'Alice' },
    { id: 'left', parentIds: ['base'], subject: 'Left', message: 'Left' },
    { id: 'right', parentIds: ['base'], subject: 'Right', message: 'Right' },
    { id: 'base', parentIds: [], subject: 'Root', message: 'Root' },
  ]).map(historyItemViewModel => ({ type: 'historyItemViewModel', historyItemViewModel, counts: { state: 'pending' } }));
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function boundedError(error) {
  if (error instanceof Error) error.stack = error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, 'scm-module');
  return error;
}

test('commit and load-more templates retain graph, grouped refs and recycled state', () => {
  const row = commitRows()[0];
  const model = row.historyItemViewModel;
  model.kind = 'HEAD';
  model.historyItem.references = [
    { id: 'main', name: '<main>', color: 'scmGraph.historyItemRefColor', icon: { id: 'git-branch' } },
    { id: 'a', name: 'tag-a', icon: { id: 'tag' } },
    { id: 'b', name: 'tag-b', icon: { id: 'tag' } },
  ];
  const original = structuredClone(model.historyItem.references);
  const renderer = new pane.HistoryItemRenderer();
  const container = win.document.createElement('div');
  const template = renderer.renderTemplate(container);
  renderer.renderElement({ element: row }, 0, template);
  assert.equal(template.graphContainer.classList.contains('current'), true);
  assert.equal(template.labelContainer.children.length, 2);
  assert.equal(template.labelContainer.querySelector('.description').textContent, '<main>');
  assert.equal(template.labelContainer.querySelector('main'), null);
  assert.equal(template.labelContainer.children[1].querySelector('.count').textContent, '2');
  assert.deepEqual(model.historyItem.references, original);
  renderer.renderElement({ element: commitRows()[1] }, 0, template);
  assert.equal(template.graphContainer.classList.contains('current'), false);
  assert.equal(template.labelContainer.children.length, 0);
  assert.equal(template.graphContainer.querySelectorAll('svg').length, 1);
  renderer.disposeTemplate(template);
  assert.equal(container.children.length, 0);

  const more = new pane.HistoryItemLoadMoreRenderer();
  const moreTemplate = more.renderTemplate(container);
  for (const state of ['loading', 'error', 'idle']) {
    more.renderElement({ element: { type: 'historyItemLoadMore', state, graphColumns: model.outputSwimlanes } }, 0, moreTemplate);
    assert.equal(moreTemplate.graphPlaceholder.querySelectorAll('svg').length, 1);
    assert.equal(moreTemplate.graphPlaceholder.querySelectorAll('path').length, 2);
    assert.equal(moreTemplate.element.getAttribute('aria-busy'), String(state === 'loading'));
  }
  assert.equal(moreTemplate.historyItemPlaceholderLabel.textContent, 'Load More...');
  more.disposeTemplate(moreTemplate);
});

test('lazy source pins first parent, represents root absence and fences late reads', async () => {
  const rows = commitRows();
  const calls = [];
  const source = new pane.SCMHistoryTreeDataSource(async (pair, signal) => {
    calls.push({ pair, signal });
    return [{ path: 'new.txt', previousPath: 'old.txt', counts: { state: 'binary' } }];
  });
  const input = { type: 'historyRoot', id: 'snapshot', rows };
  assert.deepEqual(await source.getChildren(input), rows);
  assert.equal(calls.length, 0, 'root enumeration never reads file children');
  const [file] = await source.getChildren(rows[0]);
  assert.deepEqual(calls[0].pair, { commitId: 'merge', parentId: 'left' });
  assert.equal(file.graphColumns, rows[0].historyItemViewModel.outputSwimlanes);
  assert.equal(file.previousPath, 'old.txt');
  assert.equal(file.counts.state, 'binary');
  await source.getChildren(rows[3]);
  assert.deepEqual(calls[1].pair, { commitId: 'base', parentId: null });
  source.dispose();
  assert.equal(calls[0].signal.aborted, true);

  let resolve;
  const late = new pane.SCMHistoryTreeDataSource(() => new Promise(done => { resolve = done; }));
  const pending = late.getChildren(rows[0]);
  late.dispose();
  resolve([{ path: 'late', counts: { state: 'ready', additions: 1, deletions: 0 } }]);
  assert.deepEqual(await pending, []);
});

test('real tree host preserves expanded children on root refresh and routes file intent once', async () => {
  const rows = commitRows();
  const container = win.document.createElement('div'); win.document.body.append(container);
  const calls = [], opens = [], errors = [];
  let moreCalls = 0, finishMore;
  const more = { type: 'historyItemLoadMore', state: 'idle', graphColumns: [] };
  const host = new hostModule.HistoryTreeHost(container, upstream.CompressibleAsyncDataTree,
    { type: 'historyRoot', id: 'snapshot', rows: [...rows, more] }, async pair => {
      calls.push(pair);
      return [{ path: 'example.py', counts: { state: 'ready', additions: 2, deletions: 1 } }];
    }, {
      openFile: async row => { opens.push(row); },
      loadMore: () => { moreCalls++; return new Promise(resolve => { finishMore = resolve; }); },
      onError: error => errors.push(error),
    });
  try {
    host.layout(500, 800);
    await host.ready;
    assert.equal(calls.length, 0);
    await host.tree.expand(rows[0]);
    assert.equal(calls.length, 1);
    assert.equal(host.tree.isCollapsed(rows[0]), false);
    const fileElement = container.querySelector('.history-file-name');
    assert.equal(fileElement.textContent, 'example.py');
    fileElement.dispatchEvent(new win.MouseEvent('click', { bubbles: true, button: 0 }));
    await tick();
    assert.equal(opens.length, 1);
    assert.equal(opens[0].historyItemViewModel.historyItem.id, 'merge');
    assert.equal(opens[0].path, 'example.py');
    const tap = Object.assign(new win.MouseEvent('-monaco-gesturetap', { bubbles: true, button: 0 }), { initialTarget: fileElement, tapCount: 1 });
    fileElement.dispatchEvent(tap);
    await tick();
    assert.equal(opens.length, 2, 'one upstream touch tap generates exactly one further open');
    const replacement = rows.map(row => ({ ...row, counts: { state: 'ready', additions: 2, deletions: 1 } }));
    await host.updateRows([...replacement, more]);
    assert.equal(calls.length, 1, 'stats/root refresh does not reload expanded file children');
    assert.equal(host.tree.isCollapsed(replacement[0]), false);
    assert.equal(container.querySelectorAll('.history-file-name').length, 1);

    host.tree.setFocus([more]);
    const list = container.querySelector('.monaco-list');
    list.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    list.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await tick();
    assert.equal(moreCalls, 1, 'load-more intent is single flight');
    finishMore();
    host.dispose();
    await tick();
    assert.deepEqual(errors, []);
    assert.equal(container.children.length, 0);
  } catch (error) { throw boundedError(error); }
  finally { host.dispose(); container.remove(); }
});

test('disposing a real host aborts an in-flight child read and rejects stale rendering', async () => {
  const rows = commitRows();
  const container = win.document.createElement('div'); win.document.body.append(container);
  let resolve, signal;
  const host = new hostModule.HistoryTreeHost(container, upstream.CompressibleAsyncDataTree,
    { type: 'historyRoot', id: 'old', rows }, (_pair, currentSignal) => {
      signal = currentSignal; return new Promise(done => { resolve = done; });
    }, { openFile: async () => assert.fail('No stale opens'), loadMore: async () => {}, onError: () => assert.fail('No stale errors') });
  try {
    host.layout(300, 600); await host.ready;
    const pending = host.tree.expand(rows[0]).catch(error => error);
    await tick();
    assert.ok(signal);
    host.dispose();
    assert.equal(signal.aborted, true);
    resolve([{ path: 'late', counts: { state: 'pending' } }]);
    await pending; await tick();
    assert.equal(container.children.length, 0);
  } catch (error) { throw boundedError(error); }
  finally { host.dispose(); container.remove(); }
});

test('a failed file read shows retry instead of an empty commit or global exception', async () => {
  const rows = commitRows();
  const container = win.document.createElement('div'); win.document.body.append(container);
  const errors = [];
  let calls = 0;
  const host = new hostModule.HistoryTreeHost(container, upstream.CompressibleAsyncDataTree,
    { type: 'historyRoot', id: 'retry', rows }, () => {
      calls++;
      if (calls === 1) throw new Error('Read failed');
      return Promise.resolve([{ path: 'recovered.txt', counts: { state: 'ready', additions: 1, deletions: 0 } }]);
    }, { openFile: async () => {}, loadMore: async () => {}, onError: error => errors.push(error) });
  try {
    host.layout(300, 600); await host.ready;
    await host.tree.expand(rows[0]);
    const retry = container.querySelector('.history-load-label');
    assert.equal(retry.textContent, 'Could not load files. Retry');
    assert.equal(errors.length, 1);
    retry.dispatchEvent(new win.MouseEvent('click', { button: 0, bubbles: true }));
    await tick();
    assert.equal(calls, 2);
    assert.equal(container.querySelector('.history-load-label'), null);
    assert.equal(container.querySelector('.history-file-name').textContent, 'recovered.txt');
  } catch (error) { throw boundedError(error); }
  finally { host.dispose(); container.remove(); }
});

test('base-tree and history styles are bounded to the history host', async () => {
  const styleBuild = await build({ entryPoints: [path.join(root, 'history-tree-host.ts')], bundle: true, write: false, format: 'esm', outdir: 'unused-history-test' });
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(treeCss + '\n' + styleBuild.outputFiles.find(file => file.path.endsWith('.css')).text);
  let selectors = 0;
  function visit(rules) {
    for (const rule of rules) {
      if (rule.type === win.CSSRule.STYLE_RULE) {
        assert.match(rule.selectorText, /\.te2-scm-history/, rule.selectorText);
        selectors++;
      }
      if ('cssRules' in rule) visit(rule.cssRules);
    }
  }
  visit(sheet.cssRules);
  assert.ok(selectors > 30, 'checks the generated dependency CSS, not an empty stylesheet');
});
