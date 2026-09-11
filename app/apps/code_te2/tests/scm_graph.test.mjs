import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
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
