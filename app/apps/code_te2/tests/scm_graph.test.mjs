import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const root = path.resolve(import.meta.dirname, '../src/explorer/history/vscode_scm');
async function load(file) {
  const result = await build({ entryPoints: [path.join(root, file)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
// Execute the original upstream cases and assertions through node:test.
await load('adapted/test/browser/scmHistory.test.ts');
const graph = await load('adapted/browser/scmHistory.ts');
const { HistoryItemChangeRenderer } = await load('adapted/browser/scmHistoryViewPane.ts');
test('file-row graph geometry remains the literal upstream implementation', () => {
  const extract = file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const start = source.indexOf('\tprivate _renderGraphPlaceholder(');
    return source.slice(start, source.indexOf('\n\tdisposeTemplate(', start))
      .replace('HistoryItemChangeTemplate', 'HistoryFileTemplate');
  };
  assert.equal(extract('adapted/browser/scmHistoryViewPane.ts'), extract('upstream/browser/scmHistoryViewPane.ts'));
});
test('upstream file row preserves lanes on reuse and displays unknown counts honestly', () => {
  const win = new Window(); globalThis.document = win.document;
  const rowElement = win.document.createElement('div');
  const container = win.document.createElement('div'); rowElement.append(container);
  const renderer = new HistoryItemChangeRenderer();
  const template = renderer.renderTemplate(container);
  const models = graph.toISCMHistoryItemViewModelArray([
    { id: 'merge', parentIds: ['left', 'right'], subject: '', message: '' },
  ]);
  const linear = graph.toISCMHistoryItemViewModelArray([
    { id: 'linear', parentIds: ['base'], subject: '', message: '' },
  ])[0];
  const input = { type: 'historyItemChangeViewModel', historyItemViewModel: models[0], graphColumns: models[0].outputSwimlanes,
    path: '<img src=x onerror=alert(1)>', previousPath: 'old.txt', counts: { state: 'ready', additions: 12, deletions: 3 } };
  renderer.renderElement({ element: input }, 0, template);
  assert.equal(template.statistics.textContent, '+12 -3');
  assert.equal(template.label.textContent, input.path);
  assert.equal(template.element.querySelector('img'), null);
  assert.equal(template.graphPlaceholder.querySelectorAll('path').length, 2);
  for (const state of ['pending', 'binary', 'unavailable']) {
    renderer.renderElement({ element: { ...input, counts: { state }, previousPath: undefined, historyItemViewModel: linear, graphColumns: linear.outputSwimlanes } }, 0, template);
    assert.equal(template.statistics.dataset.state, state);
    assert.doesNotMatch(template.statistics.textContent, /[+-]0/);
    assert.equal(template.graphPlaceholder.querySelectorAll('svg').length, 1);
    assert.equal(template.graphPlaceholder.querySelectorAll('path').length, 1);
    assert.equal(template.label.title, input.path);
  }
  renderer.disposeTemplate(template);
  assert.equal(rowElement.style.marginLeft, '');
  assert.equal(container.children.length, 0);
  win.happyDOM.abort();
});
test('vendored hashes and patches reproduce adapted source exactly', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync(process.execPath, [path.join(root, 'materialize.mjs')], { encoding: 'utf8' }), /reproduction verified/);
});
const items = [
  { id: 'merge', parentIds: ['left', 'right'], subject: '', message: '' },
  { id: 'left', parentIds: ['base'], subject: '', message: '' },
  { id: 'right', parentIds: ['base'], subject: '', message: '' },
  { id: 'base', parentIds: [], subject: '', message: '' },
];
test('expanded file rows preserve graph lanes and SVG geometry', () => {
  const win = new Window(); globalThis.document = win.document;
  const models = graph.toISCMHistoryItemViewModelArray(items);
  const before = JSON.stringify(models);
  for (const model of models) {
    const node = graph.renderSCMHistoryItemGraph(model);
    assert.equal(node.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(node.style.height, '22px');
    assert.ok(node.querySelector('circle'));
    for (let file = 0; file < 3; file++) {
      const placeholder = graph.renderSCMHistoryGraphPlaceholder(model.outputSwimlanes, graph.getHistoryItemIndex(model));
      assert.equal(placeholder.querySelectorAll('path').length, model.outputSwimlanes.length);
      for (const line of placeholder.querySelectorAll('path')) assert.match(line.getAttribute('d'), /^M \d+ 0 V 22$/);
    }
  }
  assert.equal(JSON.stringify(models), before, 'expansion never mutates topology');
  win.happyDOM.abort();
});
test('append-only pages keep existing lane identities', () => {
  const complete = graph.toISCMHistoryItemViewModelArray(items);
  for (let end = 1; end <= items.length; end++) {
    const page = graph.toISCMHistoryItemViewModelArray(items.slice(0, end));
    assert.deepEqual(page, complete.slice(0, end));
  }
});
