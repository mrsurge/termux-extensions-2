import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['monaco_editor/shared_model_providers.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { sharedModelProviders } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const families = [
  ['registerHoverProvider', 'provideHover'],
  ['registerDocumentSymbolProvider', 'provideDocumentSymbols'],
  ['registerFoldingRangeProvider', 'provideFoldingRanges'],
  ['registerDocumentHighlightProvider', 'provideDocumentHighlights'],
  ['registerDefinitionProvider', 'provideDefinition'],
  ['registerReferenceProvider', 'provideReferences'],
  ['registerImplementationProvider', 'provideImplementation'],
];

function context(uri, focused = false) {
  const state = { uri, version: 1, focused, active: true };
  return { state,
    context: () => state.active ? { uri: state.uri, path: state.uri, languageId: 'python', version: state.version } : null,
    focused: () => state.focused,
  };
}
const model = uri => ({ uri: { toString: () => uri }, getVersionId: () => 1 });

for (const [register, method] of families) {
  test(`${method} shares one SDK registration and routes by model/focus, not registration order`, () => {
    const records = [];
    const namespace = { [register](selector, provider) {
      const record = { selector, provider, disposals: 0 }; records.push(record);
      return { dispose() { record.disposals++; } };
    } };
    const a = context('file:///a.py'), b = context('file:///b.py');
    const first = sharedModelProviders(namespace, a), second = sharedModelProviders(namespace, b);
    const calls = [];
    const source = name => ({ [method](...args) { calls.push({ name, args, receiver: this }); return name; } });
    const ap = source('primary'), bp = source('secondary');
    const selector = method === 'provideDocumentSymbols' || method === 'provideFoldingRanges'
      ? { language: 'python', scheme: 'file', exclusive: true } : 'python';
    const ad = first[register](selector, ap), bd = second[register](selector, bp);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].selector, selector);
    const callback = records[0].provider[method];
    const token = { isCancellationRequested: false };
    const target = model('file:///b.py'), position = { lineNumber: 4, column: 3 };
    const args = method === 'provideDocumentSymbols' ? [target, token]
      : method === 'provideFoldingRanges' ? [target, { limit: 500 }, token]
      : method === 'provideReferences' ? [target, position, { includeDeclaration: true }, token]
      : [target, position, token];
    assert.equal(callback(...args), 'secondary');
    assert.deepEqual(calls[0].args, args); assert.equal(calls[0].receiver, bp);
    assert.equal(callback(model('file:///a.py')), 'primary');
    assert.equal(callback(model('file:///unowned.py')), undefined);
    b.state.uri = a.state.uri; b.state.focused = true;
    assert.equal(callback(model(a.state.uri)), 'secondary');
    b.state.focused = false; a.state.focused = true;
    assert.equal(callback(model(a.state.uri)), 'primary');
    a.state.active = false;
    assert.equal(callback(model(a.state.uri)), 'secondary');
    b.state.version = 2;
    assert.equal(callback(model(a.state.uri)), undefined);
    b.state.version = 1;
    assert.equal(callback({ ...model(a.state.uri), isDisposed: () => true }), undefined);
    ad.dispose(); ad.dispose();
    assert.equal(records[0].disposals, 0);
    assert.equal(callback(model(a.state.uri)), 'secondary');
    bd.dispose(); bd.dispose();
    assert.equal(records[0].disposals, 1);
    assert.equal(callback(model(a.state.uri)), undefined);
    const reopened = first[register](selector, ap);
    assert.equal(records.length, 2); reopened.dispose();
    assert.equal(records[1].disposals, 1);
  });
}

test('distinct selectors and Monaco namespaces never share a registration accidentally', () => {
  const calls = [];
  const namespace = { registerDocumentSymbolProvider(selector) { calls.push(selector); return { dispose() {} }; } };
  const owner = context('file:///a.py'), a = sharedModelProviders(namespace, owner), b = sharedModelProviders(namespace, owner);
  const provider = { provideDocumentSymbols() { return []; } };
  const leases = [a.registerDocumentSymbolProvider('python', provider),
    a.registerDocumentSymbolProvider({ language: 'python', scheme: 'file', exclusive: true }, provider),
    b.registerDocumentSymbolProvider({ exclusive: true, scheme: 'file', language: 'python' }, provider),
    sharedModelProviders({ ...namespace }, owner).registerDocumentSymbolProvider('python', provider)];
  assert.equal(calls.length, 3);
  assert.throws(() => a.registerDocumentSymbolProvider({ language: 'python', pattern: '**/*' }, provider), /Unsupported/);
  for (const lease of leases) lease.dispose();
});

test('retained-result provider registrations pass through unchanged', () => {
  const functions = { registerCompletionItemProvider() {}, registerInlayHintsProvider() {},
    registerInlineCompletionsProvider() {}, registerColorProvider() {}, registerDocumentSemanticTokensProvider() {} };
  const facade = sharedModelProviders(functions, context('file:///a.py'));
  for (const [key, value] of Object.entries(functions)) assert.equal(facade[key], value);
});

test('failed registration is not cached and does not poison another owner', () => {
  let attempts = 0;
  const namespace = { registerHoverProvider() { if (++attempts === 1) throw Error('registration failed'); return { dispose() {} }; } };
  const owner = sharedModelProviders(namespace, context('file:///a.py'));
  const provider = { provideHover() { return null; } };
  assert.throws(() => owner.registerHoverProvider('python', provider), /registration failed/);
  owner.registerHoverProvider('python', provider).dispose();
  assert.equal(attempts, 2);
});

test('pending results stay with their producer across focus changes but cannot outlive its lease', async () => {
  let sdk, finish;
  const namespace = { registerDefinitionProvider(_selector, provider) { sdk = provider; return { dispose() {} }; } };
  const a = context('file:///a.py', true), b = context('file:///a.py');
  const primary = sharedModelProviders(namespace, a), secondary = sharedModelProviders(namespace, b);
  const first = primary.registerDefinitionProvider('python', { provideDefinition: () => new Promise(resolve => { finish = resolve; }) });
  const second = secondary.registerDefinitionProvider('python', { provideDefinition: () => 'secondary' });
  const pending = sdk.provideDefinition(model(a.state.uri), {}, {});
  a.state.focused = false; b.state.focused = true;
  finish('primary result'); assert.equal(await pending, 'primary result');
  assert.equal(sdk.provideDefinition(model(a.state.uri), {}, {}), 'secondary');
  a.state.focused = true; b.state.focused = false;
  const disposed = sdk.provideDefinition(model(a.state.uri), {}, {});
  first.dispose(); finish('must not appear'); assert.equal(await disposed, undefined);
  assert.equal(sdk.provideDefinition(model(a.state.uri), {}, {}), 'secondary');
  second.dispose();
});

test('pending replies are fenced by document version/context; current failures remain visible', async () => {
  let sdk, finish, fail;
  const namespace = { registerHoverProvider(_selector, provider) { sdk = provider; return { dispose() {} }; } };
  const owner = context('file:///a.py');
  const facade = sharedModelProviders(namespace, owner);
  const lease = facade.registerHoverProvider('python', { provideHover: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) });
  const stale = sdk.provideHover(model(owner.state.uri), {}, {});
  owner.state.version = 2; finish('stale'); assert.equal(await stale, undefined);
  owner.state.version = 1;
  const current = sdk.provideHover(model(owner.state.uri), {}, {});
  fail(Error('real provider failure')); await assert.rejects(current, /real provider failure/);
  const lateFailure = sdk.provideHover(model(owner.state.uri), {}, {});
  owner.state.uri = 'file:///b.py'; fail(Error('obsolete request')); assert.equal(await lateFailure, undefined);
  lease.dispose();
});
