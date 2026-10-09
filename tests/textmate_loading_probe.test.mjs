import test from 'node:test';
import assert from 'node:assert/strict';
import { probeLoading } from '../scripts/probe_textmate_loading.mjs';
import { createTextmateGrammarBodyLoader } from '../app/apps/code_te2/monaco_editor/editor_textmate_grammar_loader.ts';
import { createRequire } from 'node:module';
const textmate = createRequire(import.meta.url)('../app/apps/code_te2/vendor/vscode-textmate/release/main.js');

function grammar(scopeName, includes = [], injectTo = []) {
  return { scopeName, injectTo, id: `test/${scopeName}.json`, file: `${scopeName}.json`,
    raw: JSON.stringify({ scopeName, patterns: includes.map((include) => ({ include })) }) };
}

test('real dependency discovery batches siblings, caches bodies and fences revisions', async () => {
  const result = await probeLoading([
    grammar('source.root', ['source.left', 'source.right']),
    grammar('source.left', ['source.leaf']), grammar('source.right'), grammar('source.leaf'),
    grammar('injection.root', [], ['source.root']),
  ], 'source.root', { latencyMs: 5 });
  const [cold, warm, reset] = result.runs;
  assert.equal(cold.bodyCallbacks, 5);
  assert.equal(cold.requests, 3);
  assert.deepEqual(cold.batches.map((batch) => batch.ids.length), [1, 3, 1]);
  assert.equal(warm.requests, 0);
  assert.equal(warm.rawBytes, 0);
  assert.equal(reset.requests, cold.requests);
  assert.equal(reset.rawBytes, cold.rawBytes);
});

test('network parameters reject invalid simulation values', async () => {
  await assert.rejects(probeLoading([grammar('source.root')], 'source.root', { latencyMs: -1 }));
});

test('closure seeds one revision-scoped request, shares waiters and avoids body RPCs', async () => {
  const calls = [];
  const loader = createTextmateGrammarBodyLoader(async (method, params) => {
    calls.push({ method, params });
    await new Promise(resolve => setTimeout(resolve, 5));
    return { rootScope: params.scope, revision: params.revision, ids: ['root', 'leaf'],
      bodies: Object.fromEntries(['root', 'leaf'].filter(id => !params.knownIds.includes(id))
        .map(id => [id, { ok: true, revision: params.revision, raw: `body-${id}` }])) };
  });
  await Promise.all([loader.prepare('source.root', 'v1'), loader.prepare('source.root', 'v1')]);
  assert.equal(await loader.load('leaf', 'v1'), 'body-leaf');
  await loader.prepare('source.root', 'v1');
  assert.equal(calls.length, 1);
  await loader.prepare('source.other', 'v1');
  assert.deepEqual(calls[1].params.knownIds, ['root', 'leaf']);
  await loader.prepare('source.root', 'v2');
  assert.deepEqual(calls[2].params.knownIds, []);
  assert.ok(calls.every(call => call.method === 'editor.textmate.closure.get'));
});

test('closure rejects stale replies and retries failed requests without partial cache seeding', async () => {
  let finish;
  const loader = createTextmateGrammarBodyLoader(async (_method, params) => {
    if (params.revision === 'v1') return new Promise(resolve => { finish = resolve; });
    return { rootScope: params.scope, revision: params.revision, ids: ['root'],
      bodies: { root: { ok: true, revision: params.revision, raw: 'new' } } };
  });
  const stale = loader.prepare('source.root', 'v1');
  const rejected = assert.rejects(stale, /superseded/);
  await loader.prepare('source.root', 'v2');
  finish({ rootScope: 'source.root', revision: 'v1', ids: ['root'],
    bodies: { root: { ok: true, revision: 'v1', raw: 'old' } } });
  await rejected;
  assert.equal(await loader.load('root', 'v2'), 'new');
});

test('real TextMate construction consumes a seeded closure without dependency round trips', async () => {
  const definitions = [grammar('source.root', ['source.left']), grammar('source.left', ['source.leaf']), grammar('source.leaf')];
  const byScope = new Map(definitions.map(item => [item.scopeName, item]));
  const calls = [];
  const loader = createTextmateGrammarBodyLoader(async (method, params) => {
    calls.push(method);
    assert.equal(method, 'editor.textmate.closure.get');
    return { rootScope: params.scope, revision: params.revision, ids: definitions.map(item => item.id),
      bodies: Object.fromEntries(definitions.map(item => [item.id, { ok: true, revision: params.revision, raw: item.raw }])) };
  });
  await loader.prepare('source.root', 'v1');
  const registry = new textmate.Registry({ onigLib: Promise.resolve({}),
    loadGrammar: async scope => {
      const definition = byScope.get(scope);
      return definition ? textmate.parseRawGrammar(await loader.load(definition.id, 'v1'), definition.file) : null;
    } });
  try { await registry.loadGrammar('source.root'); } finally { registry.dispose(); }
  assert.deepEqual(calls, ['editor.textmate.closure.get']);
});

test('malformed closure is not cached, and reset releases waiters before the transport reply', async () => {
  let attempts = 0;
  const loader = createTextmateGrammarBodyLoader(async (_method, params) => {
    attempts++;
    return { rootScope: params.scope, revision: params.revision, ids: ['root', 'leaf'],
      bodies: { root: { ok: true, revision: params.revision, raw: 'root' },
        ...(attempts > 1 ? { leaf: { ok: true, revision: params.revision, raw: 'leaf' } } : {}) } };
  });
  await assert.rejects(loader.prepare('source.root', 'v1'), /Missing/);
  await loader.prepare('source.root', 'v1');
  assert.equal(attempts, 2);
  const blocked = createTextmateGrammarBodyLoader(async () => new Promise(() => {}));
  const pending = blocked.prepare('source.root', 'v1');
  const rejected = assert.rejects(pending, /superseded/);
  blocked.reset();
  await rejected;
});
