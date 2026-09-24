import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { encode, decode } from '@msgpack/msgpack';
import { provideCompletions } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/completions.mjs';
import { WorkbenchClient } from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs';
import { dispatchJsonRpcRequest } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs';

async function loadSource(path) {
  const url = new URL(path, import.meta.url);
  if (process.versions.bun) return import(url.href);
  const result = await build({ entryPoints: [url.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { provideWorkbenchCompletionItemsFromVscodeSuggest: provide, resolveWorkbenchCompletionItem: resolveItem } =
  await loadSource('../monaco_editor/vscode_completion_vendor/suggest.ts');

const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 };
const defaults = { insert: range, replace: { ...range, endColumn: 6 } };
const dto = (label = 'print', cacheId = 0) => ({ a: defaults, b: [{ a: label, x: [cacheId, 0] }], c: true, d: 8, x: cacheId });
const reply = providers => ({ ok: true, result: { sessionId: 'session-one', providers } });
function runtime(results) {
  return {
    ensureConnected() {}, defaultAuthority: () => 'localhost', documentScheme: () => 'file',
    languageFeaturesRpcId: 94, languageIdFromPath: () => 'python',
    didChange: async () => ({ ok: true }), findAllProviderHandles: () => [...results.keys()],
    waitFor: async () => true, uriForPath: path => ({ scheme: 'file', path }), log() {}, warn() {},
    sendExtPending: (_rpc, _method, [handle]) => ({ promise: Promise.resolve({ type: 9, result: results.get(handle) }) }),
  };
}
function deps(response, releases = []) {
  return {
    languageId: 'python', propertyKind: 9, providerHandle: 23,
    model: { uri: { toString: () => 'file:///a.py' }, getLanguageId: () => 'python' },
    position: { lineNumber: 1, column: 3 }, context: {},
    getCurrentPath: () => '/a.py', absPathFromVscodeUri: () => '/a.py',
    callWorkbenchCompletions: async () => response,
    releaseCompletionItems: async params => { releases.push(params); return { ok: true }; },
  };
}

test('700 suggestions cross MessagePack once, with no expanded or duplicate DTO aliases', async () => {
  const compact = { ...dto(), b: Array.from({ length: 700 }, (_, i) => ({ a: `suggestion_${i}`, b: 1, x: [0, i] })) };
  const result = await provideCompletions(runtime(new Map([[23, compact]])), { path: '/a.py', languageId: 'python', providerHandle: 23 });
  assert.strictEqual(result.result.providers[0].dto, compact);
  assert.deepEqual(Object.keys(result.result), ['providers']);
  const projected = reply(result.result.providers);
  const bytes = encode(projected);
  const decoded = decode(bytes);
  assert.equal(decoded.result.providers[0].dto.b.length, 700);
  const list = await provide(deps(decoded));
  assert.equal(list.suggestions.length, 700);
  const oldPayload = { ok: true, result: { dto: compact, suggestResults: [compact], items: list.suggestions } };
  assert.ok(bytes.length < encode(oldPayload, { ignoreUndefined: true }).length / 2);
  list.dispose();
});

test('batch projection retains every provider DTO and each provider default range', async () => {
  const first = dto('zulu', 3);
  const second = { ...dto('alpha', 4), a: { ...range, startColumn: 2 }, c: false };
  const result = await provideCompletions(runtime(new Map([[23, first], [24, second]])), { path: '/a.py' });
  const releases = [];
  const list = await provide(deps(reply(result.result.providers), releases));
  assert.deepEqual(list.suggestions.map(item => item.label), ['zulu', 'alpha']); // Monaco, not TE2, sorts.
  assert.deepEqual(list.suggestions.map(item => item.range), [first.a, second.a]);
  assert.equal(list.incomplete, true);
  list.dispose(); list.dispose();
  assert.deepEqual(releases.map(x => [x.providerHandle, x.cacheId]), [[23, 3], [24, 4]]);
});

test('vendored inflation preserves snippets, edits, IDs, commands, labels and commit characters', async () => {
  const compact = dto();
  compact.b = [{ a: { label: 'name', description: 'detail' }, h: '${1:name}', i: 4,
    k: '.;', l: [{ range, text: 'import name' }], n: 12, o: '_vscode_delegate_cmd', p: ['unused'],
    m: [1], x: [0, 0], d: { value: '**docs**' } }];
  const list = await provide(deps(reply([{ handle: 23, dto: compact }])));
  assert.deepEqual(list.suggestions[0], {
    label: compact.b[0].a, kind: 9, tags: [1], detail: undefined, documentation: { value: '**docs**' },
    sortText: undefined, filterText: undefined, preselect: undefined, insertText: '${1:name}',
    range: defaults, insertTextRules: 4, commitCharacters: ['.', ';'], additionalTextEdits: compact.b[0].l,
    command: { $ident: 12, id: '_vscode_delegate_cmd', title: '', arguments: [12] }, _id: [0, 0],
  });
  list.dispose();
});

test('resolve uses the originating session/provider and updates the same Monaco item', async () => {
  const releases = [], calls = [];
  const list = await provide(deps(reply([{ handle: 23, dto: dto() }]), releases));
  const item = list.suggestions[0];
  const result = await resolveItem(item, 9, async params => {
    calls.push(params);
    return { ok: true, result: { a: 'print', x: [0, 0], c: 'resolved', l: [{ range, text: 'import print' }] } };
  });
  assert.strictEqual(result, item);
  assert.deepEqual(calls, [{ providerHandle: 23, sessionId: 'session-one', id: [0, 0] }]);
  assert.equal(item.detail, 'resolved');
  assert.deepEqual(item.range, defaults);
  list.dispose();
  await resolveItem(item, 9, () => assert.fail('Disposed list cannot resolve'));
  assert.equal(releases.length, 1);
});

test('empty and cancelled results release even cache ID zero exactly once', async () => {
  for (const empty of [true, false]) {
    const releases = [];
    const compact = { ...dto(), b: empty ? [] : dto().b };
    const list = await provide({ ...deps(reply([{ handle: 23, dto: compact }]), releases), isCancelled: () => !empty });
    assert.equal(list.suggestions.length, 0);
    list.dispose?.(); list.dispose?.();
    assert.deepEqual(releases, [{ providerHandle: 23, sessionId: 'session-one', cacheId: 0 }]);
  }
});

test('late resolve never modifies a disposed list and legacy expanded payloads are rejected', async () => {
  const list = await provide(deps(reply([{ handle: 23, dto: dto() }])));
  let finish;
  const resolving = resolveItem(list.suggestions[0], 9, () => new Promise(resolve => { finish = resolve; }));
  list.dispose(); finish({ ok: true, result: { a: 'changed' } });
  await resolving;
  assert.equal(list.suggestions[0].label, 'print');
  await assert.rejects(provide(deps({ ok: true, result: { items: [{ label: 'legacy' }] } })), /compact completion payload/);
});

test('null provider stays unpinned and uncached lists cannot resolve after disposal', async () => {
  const compact = dto();
  delete compact.x;
  const response = reply([{ handle: 23, dto: compact }]);
  const list = await provide({ ...deps(response), providerHandle: null,
    callWorkbenchCompletions: async params => {
      assert.equal(Object.hasOwn(params, 'providerHandle'), false);
      return response;
    },
    releaseCompletionItems: () => assert.fail('No cache ID was supplied'),
  });
  list.dispose();
  await resolveItem(list.suggestions[0], 9, () => assert.fail('Disposed owner cannot resolve'));
});

async function client(t) {
  const root = await mkdtemp(join(tmpdir(), 'te2-completion-projection-'));
  const wb = new WorkbenchClient({ extensionStoragePath: root, webviewReconstructionStoragePath: root });
  t.after(async () => { if (wb._metricsTimer) clearInterval(wb._metricsTimer); await rm(root, { recursive: true, force: true }); });
  wb.ext = { protocol: {} };
  return wb;
}

test('client fences release, resolve and prepared requests after an extension-host reset', async t => {
  const wb = await client(t);
  const calls = [];
  wb._sendExt = (...args) => calls.push(args);
  wb._completionRuntime = () => runtime(new Map([[23, dto()]]));
  const prepared = await wb.prepareCompletions({ path: '/a.py', providerHandle: 23 });
  const sessionId = wb._completionSessionId;
  assert.equal(wb.releaseCompletionItems({ sessionId, providerHandle: 23, cacheId: 0 }).ok, true);
  assert.deepEqual(calls[0].slice(1), ['$releaseCompletionItems', [23, 0], false]);
  wb._resetSessionCaches('test');
  assert.equal(wb.releaseCompletionItems({ sessionId, providerHandle: 23, cacheId: 0 }).error, 'stale_completion_session');
  assert.equal((await wb.resolveCompletionItem({ sessionId, providerHandle: 23, id: [0, 0] })).error, 'stale_completion_session');
  assert.equal((await prepared()).error, 'stale_completion_session');
  assert.equal(calls.length, 1);
});

test('resolve and release dispatch never activate a language or acquire the document gate', async () => {
  const calls = [];
  const wb = {
    runClientDocumentOperation: () => assert.fail('cache lifecycle entered document gate'),
    activateLanguage: () => assert.fail('cache lifecycle activated language'),
    resolveCompletionItem: async params => { calls.push(params); return { ok: true, result: null }; },
    releaseCompletionItems: params => { calls.push(params); return { ok: true }; },
  };
  for (const method of ['vscode.completions.resolve', 'vscode.completions.release']) {
    assert.equal((await dispatchJsonRpcRequest({ wb }, { id: 1, method, params: { sessionId: 'old' } })).result.ok, true);
  }
  assert.equal(calls.length, 2);
});
