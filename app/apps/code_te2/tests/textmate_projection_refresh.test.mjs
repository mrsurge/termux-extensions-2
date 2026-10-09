import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const result = await build({ entryPoints: [import.meta.dirname + '/../monaco_editor/editor_textmate_runtime.ts'],
  bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createEditorTextmateRuntime } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('catalog refresh keeps same-revision projection and invalidates only actual changes', async (t) => {
  t.mock.method(console, 'warn', () => {}); // Expected failed-RPC branch; do not dump data-URL bundles.
  let revision = 'v1', resets = 0, calls = 0, fail = false;
  const runtime = createEditorTextmateRuntime({
    getWindow: () => ({ monaco: { editor: { getModels: () => [{ resetTokenization: () => resets++ }] } } }),
    normalizeLanguage: value => String(value || ''),
    editorRpcCall: async () => {
      calls++;
      if (fail) throw Error('disconnected');
      return { revision, grammars: [], languages: [] };
    },
  });
  assert.equal(await runtime.refreshTextmateProjection(), true);
  assert.equal(resets, 1);
  assert.equal(await runtime.refreshTextmateProjection(), false);
  assert.equal(resets, 1);
  assert.equal(await runtime.refreshTextmateProjection('v1'), false);
  assert.equal(calls, 2);
  fail = true;
  await assert.rejects(runtime.refreshTextmateProjection(), /disconnected/);
  assert.equal(resets, 1);
  fail = false;
  revision = 'v2';
  assert.equal(await runtime.refreshTextmateProjection(), true);
  assert.equal(resets, 2);
});

test('installed provider and grammar bodies survive unchanged contributions', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  let revision = 'v1', installs = 0, disposals = 0;
  const calls = [];
  const grammar = { id: 'probe/root.json', scopeName: 'source.probe', language: 'probe' };
  const raw = '{"scopeName":"source.probe","patterns":[]}';
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const runtime = createEditorTextmateRuntime({
    getWindow: () => ({ monaco: { languages: {
      getLanguages: () => [{ id: 'probe' }], getEncodedLanguageId: () => 1,
      setTokensProvider: () => { installs++; return { dispose: () => disposals++ }; },
    } } }),
    fetchFn: async (url) => url.endsWith('markdown-cache.json')
      ? Response.json({schema:1,bodies:{[grammar.id]:{raw,sha256}}})
      : new Response(await fs.readFile(import.meta.dirname + '/../monaco_editor/textmate/onig.wasm')),
    buildUiUrl: value => value,
    normalizeLanguage: value => String(value || ''),
    editorRpcCall: async (method, params) => {
      calls.push(method);
      if (method === 'editor.textmate.catalog.get') return { revision, grammars: [grammar], languages: [] };
      assert.equal(method, 'editor.textmate.closure.get');
      return { revision, rootScope: params.scope, complete:true, ids: [grammar.id],
        fingerprints:{[grammar.id]:sha256}, bodies: {} };
    },
  });
  await runtime.prepareTextmateForDocument('file.probe', 'probe');
  assert.equal(installs, 1);
  assert.deepEqual(calls, ['editor.textmate.catalog.get', 'editor.textmate.closure.get']);
  assert.equal(await runtime.refreshTextmateProjection(), false);
  await runtime.prepareTextmateForDocument('other.probe', 'probe');
  assert.equal(installs, 1);
  assert.equal(disposals, 0);
  assert.equal(calls.filter(method => method === 'editor.textmate.closure.get').length, 1);
  revision = 'v2';
  assert.equal(await runtime.refreshTextmateProjection(), true);
  assert.equal(disposals, 1);
  await runtime.prepareTextmateForDocument('file.probe', 'probe');
  assert.equal(installs, 2);
  assert.equal(calls.filter(method => method === 'editor.textmate.closure.get').length, 2);
});
