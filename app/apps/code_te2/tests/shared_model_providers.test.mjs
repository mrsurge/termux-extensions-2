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

test('color providers share by producer signature and route both callbacks with model fences', async () => {
  const records = [], calls = [];
  const namespace = { registerColorProvider(selector, provider) {
    const entry = { selector, provider, disposed: 0 }; records.push(entry);
    return { dispose() { entry.disposed++; } };
  } };
  const a = context('file:///a.py'), b = context('file:///b.py', true);
  let finish;
  const source = name => ({ __te2ProviderKey: 'colors:7',
    provideDocumentColors(...args) { calls.push([name, 'colors', args]); return name; },
    provideColorPresentations(...args) { calls.push([name, 'presentations', args]); return new Promise(resolve => { finish = resolve; }); },
  });
  const ad = sharedModelProviders(namespace, a).registerColorProvider('python', source('a'));
  const bd = sharedModelProviders(namespace, b).registerColorProvider('python', source('b'));
  assert.equal(records.length, 1);
  const provider = records[0].provider, target = model(b.state.uri), info = {}, token = {};
  assert.equal(provider.provideDocumentColors(target, token), 'b');
  assert.deepEqual(calls[0], ['b', 'colors', [target, token]]);
  const pending = provider.provideColorPresentations(target, info, token);
  assert.deepEqual(calls[1], ['b', 'presentations', [target, info, token]]);
  b.state.version++; finish(['obsolete']); assert.equal(await pending, undefined);
  ad.dispose(); assert.equal(records[0].disposed, 0);
  bd.dispose(); assert.equal(records[0].disposed, 1);
});

function semanticFixture(range = false) {
  const records = [], calls = [], eventListeners = { a: new Set(), b: new Set() };
  const register = (selector, provider) => {
    const entry = { selector, provider, disposed: 0 }; records.push(entry);
    return { dispose() { entry.disposed++; } };
  };
  const namespace = range ? { registerDocumentRangeSemanticTokensProvider: register }
    : { registerDocumentSemanticTokensProvider: register };
  const a = context('file:///a.py', true), b = context('file:///a.py');
  const legends = { a: { tokenTypes: ['class'], tokenModifiers: [] }, b: { tokenTypes: ['class'], tokenModifiers: [] } };
  const source = name => ({
    getLegend: () => legends[name],
    onDidChange(listener) { eventListeners[name].add(listener); return { dispose() { eventListeners[name].delete(listener); } }; },
    provideDocumentSemanticTokens(...args) { calls.push([name, 'full', args]); return { resultId: '7', data: new Uint32Array([0, 0, 1, 0, 0]) }; },
    provideDocumentRangeSemanticTokens(...args) { calls.push([name, 'range', args]); return { resultId: '7', data: new Uint32Array([0, 0, 1, 0, 0]) }; },
    releaseDocumentSemanticTokens(id) { calls.push([name, 'release', id]); },
  });
  const registerOwner = (ctx, provider) => {
    const facade = sharedModelProviders(namespace, ctx);
    return range ? facade.registerDocumentRangeSemanticTokensProvider('python', provider)
      : facade.registerDocumentSemanticTokensProvider('python', provider);
  };
  const ap = source('a'), bp = source('b');
  return { a, b, ap, bp, legends, records, calls, eventListeners, registerOwner };
}

test('full semantic tokens retain producer IDs and restart deltas when focus selects another runtime', async () => {
  const f = semanticFixture(), ad = f.registerOwner(f.a, f.ap), bd = f.registerOwner(f.b, f.bp);
  assert.equal(f.records.length, 1);
  const provider = f.records[0].provider, target = model(f.a.state.uri), token = {};
  const first = await provider.provideDocumentSemanticTokens(target, null, token);
  assert.notEqual(first.resultId, '7');
  const again = await provider.provideDocumentSemanticTokens(target, first.resultId, token);
  assert.equal(f.calls[1][2][1], '7');
  f.a.state.focused = false; f.b.state.focused = true;
  const second = await provider.provideDocumentSemanticTokens(target, first.resultId, token);
  assert.equal(f.calls[2][0], 'b'); assert.equal(f.calls[2][2][1], undefined);
  assert.notEqual(first.resultId, second.resultId);
  provider.releaseDocumentSemanticTokens(first.resultId); provider.releaseDocumentSemanticTokens(first.resultId);
  assert.deepEqual(f.calls[3], ['a', 'release', '7']);
  ad.dispose(); // also releases the second retained result from a
  assert.deepEqual(f.calls[4], ['a', 'release', '7']);
  provider.releaseDocumentSemanticTokens(again.resultId); assert.equal(f.calls.length, 5);
  provider.releaseDocumentSemanticTokens(second.resultId);
  assert.deepEqual(f.calls[5], ['b', 'release', '7']);
  bd.dispose(); assert.equal(f.records[0].disposed, 1);
});

for (const range of [false, true]) {
  test(`${range ? 'range' : 'full'} semantic events aggregate owners and detach only the disposed source`, async () => {
    const f = semanticFixture(range), ad = f.registerOwner(f.a, f.ap), bd = f.registerOwner(f.b, f.bp);
    const provider = f.records[0].provider;
    let changes = 0;
    const subscription = provider.onDidChange(() => { changes++; });
    for (const listeners of Object.values(f.eventListeners)) for (const listener of listeners) listener();
    assert.equal(changes, 2);
    ad.dispose(); assert.equal(changes, 3); // surviving provider must be re-queried
    assert.equal(f.eventListeners.a.size, 0); assert.equal(f.eventListeners.b.size, 1);
    assert.equal(f.records[0].disposed, 0);
    const target = model(f.b.state.uri), bounds = {}, token = {};
    const result = range ? await provider.provideDocumentRangeSemanticTokens(target, bounds, token)
      : await provider.provideDocumentSemanticTokens(target, null, token);
    assert.ok(result.data instanceof Uint32Array); assert.equal(f.calls[0][0], 'b');
    if (range) assert.deepEqual(f.calls[0][2], [target, bounds, token]);
    subscription.dispose(); bd.dispose();
    assert.equal(f.eventListeners.b.size, 0); assert.equal(f.records[0].disposed, 1);
  });

  test(`${range ? 'range' : 'full'} semantic incompatible legends never share a registration or decode token indices`, async () => {
    const f = semanticFixture(range), ad = f.registerOwner(f.a, f.ap);
    f.legends.b = { tokenTypes: ['function'], tokenModifiers: [] };
    const bd = f.registerOwner(f.b, f.bp);
    assert.equal(f.records.length, 2);
    assert.deepEqual(f.records[0].provider.getLegend().tokenTypes, ['class']);
    assert.deepEqual(f.records[1].provider.getLegend().tokenTypes, ['function']);
    f.legends.a.tokenTypes.push('variable'); // stale provider must be re-registered first
    const provider = f.records[0].provider, target = model(f.a.state.uri);
    const result = range ? await provider.provideDocumentRangeSemanticTokens(target, {}, {})
      : await provider.provideDocumentSemanticTokens(target, null, {});
    assert.equal(result, undefined); assert.equal(f.calls.length, 0);
    assert.deepEqual(provider.getLegend().tokenTypes, ['class']);
    ad.dispose(); bd.dispose();
  });
}

test('obsolete pending full semantic replies release original IDs and never enter Monaco', async () => {
  const f = semanticFixture();
  let finish;
  f.ap.provideDocumentSemanticTokens = () => new Promise(resolve => { finish = resolve; });
  const lease = f.registerOwner(f.a, f.ap), provider = f.records[0].provider;
  const pending = provider.provideDocumentSemanticTokens(model(f.a.state.uri), null, {});
  lease.dispose(); finish({ resultId: 'late', data: new Uint32Array() });
  assert.equal(await pending, undefined);
  assert.deepEqual(f.calls, [['a', 'release', 'late']]);
});

test('completion lists resolve and release with their producer across focus changes', async () => {
  const registrations = [], calls = [];
  const namespace = { registerCompletionItemProvider(selector, provider) {
    const record = { selector, provider, disposed: 0 }; registrations.push(record);
    return { dispose() { record.disposed++; } };
  } };
  const a = context('file:///a.py', true), b = context('file:///a.py');
  const source = name => ({ __te2ProviderKey: 'handle:23:selector', triggerCharacters: ['.'],
    provideCompletionItems() { return { suggestions: [{ label: name }], incomplete: true,
      dispose() { calls.push(`release:${name}`); } }; },
    resolveCompletionItem(item) { calls.push(`resolve:${name}`); return item; },
  });
  const ad = sharedModelProviders(namespace, a).registerCompletionItemProvider([{ pattern: '**/*.py' }], source('a'));
  const bd = sharedModelProviders(namespace, b).registerCompletionItemProvider([{ pattern: '**/*.py' }], source('b'));
  assert.equal(registrations.length, 1);
  const provider = registrations[0].provider;
  const list = await provider.provideCompletionItems(model(a.state.uri), {}, {}, {});
  a.state.focused = false; b.state.focused = true;
  provider.resolveCompletionItem(list.suggestions[0], {});
  assert.deepEqual(calls, ['resolve:a']);
  ad.dispose();
  provider.resolveCompletionItem(list.suggestions[0], {});
  list.dispose(); list.dispose();
  assert.deepEqual(calls, ['resolve:a', 'release:a']);
  const other = sharedModelProviders(namespace, b).registerCompletionItemProvider('python', { ...source('other'), __te2ProviderKey: 'handle:24' });
  assert.equal(registrations.length, 2);
  bd.dispose(); other.dispose();
  assert.ok(registrations.every(r => r.disposed === 1));
});

test('obsolete pending completion lists release exactly once', async () => {
  let finish, provider, releases = 0;
  const namespace = { registerCompletionItemProvider(_selector, value) { provider = value; return { dispose() {} }; } };
  const ctx = context('file:///a.py');
  const lease = sharedModelProviders(namespace, ctx).registerCompletionItemProvider('python', {
    __te2ProviderKey: '23', provideCompletionItems: () => new Promise(resolve => { finish = resolve; }),
  });
  const pending = provider.provideCompletionItems(model(ctx.state.uri), {}, {}, {});
  lease.dispose();
  finish({ suggestions: [{}], dispose() { releases++; } });
  assert.equal(await pending, undefined);
  assert.equal(releases, 1);
});

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

test('unkeyed external color providers retain the original registration path', () => {
  let received;
  const namespace = { registerColorProvider(...args) { received = args; return 'original'; } };
  const facade = sharedModelProviders(namespace, context('file:///a.py'));
  const provider = { provideDocumentColors() {}, provideColorPresentations() {} };
  assert.equal(facade.registerColorProvider('python', provider), 'original');
  assert.deepEqual(received, ['python', provider]);
});

test('inlay hints resolve and release through their producer after focus changes', async () => {
  const records = [], calls = [];
  const namespace = { registerInlayHintsProvider(selector, provider) {
    const entry = { selector, provider, disposed: 0 }; records.push(entry);
    return { dispose() { entry.disposed++; } };
  } };
  const a = context('file:///a.py', true), b = context('file:///a.py');
  const source = name => ({ __te2ProviderKey: 'hint:7', displayName: 'Hints',
    provideInlayHints(...args) { calls.push([name, 'provide', args]); return { hints: [{ label: name }], dispose() { calls.push([name, 'release']); } }; },
    resolveInlayHint(hint, token) { calls.push([name, 'resolve', token]); return hint; },
  });
  const ad = sharedModelProviders(namespace, a).registerInlayHintsProvider('python', source('a'));
  const bd = sharedModelProviders(namespace, b).registerInlayHintsProvider('python', source('b'));
  assert.equal(records.length, 1); assert.equal(records[0].provider.displayName, 'Hints');
  const provider = records[0].provider, target = model(a.state.uri), range = {}, token = {};
  const list = await provider.provideInlayHints(target, range, token);
  assert.deepEqual(calls[0], ['a', 'provide', [target, range, token]]);
  a.state.focused = false; b.state.focused = true;
  provider.resolveInlayHint(list.hints[0], token);
  assert.deepEqual(calls[1], ['a', 'resolve', token]);
  ad.dispose(); provider.resolveInlayHint(list.hints[0], token);
  list.dispose(); list.dispose();
  assert.deepEqual(calls.slice(2), [['a', 'release']]);
  const next = await provider.provideInlayHints(target, range, token);
  assert.equal(next.hints[0].label, 'b'); next.dispose();
  bd.dispose(); assert.equal(records[0].disposed, 1);
});

test('inline lists retain show/free producer, metadata and exactly-once cleanup', async () => {
  const records = [], calls = [];
  const namespace = { registerInlineCompletionsProvider(selector, provider) {
    const entry = { selector, provider, disposed: 0 }; records.push(entry);
    return { dispose() { entry.disposed++; } };
  } };
  const a = context('file:///a.py', true), b = context('file:///a.py');
  const originals = new Map();
  const source = name => ({ __te2ProviderKey: 'inline:8', groupId: 'group', yieldsToGroupIds: ['other'],
    excludesGroupIds: ['excluded'], displayName: 'Inline', debounceDelayMs: 42,
    provideInlineCompletions(...args) { calls.push([name, 'provide', args]);
      const result = { pid: 8, items: [{ insertText: name }] }; originals.set(name, result); return result; },
    handleItemDidShow(...args) { calls.push([name, 'show', args]); },
    disposeInlineCompletions(...args) { calls.push([name, 'free', args]); },
  });
  const ad = sharedModelProviders(namespace, a).registerInlineCompletionsProvider('python', source('a'));
  const bd = sharedModelProviders(namespace, b).registerInlineCompletionsProvider('python', source('b'));
  assert.equal(records.length, 1);
  const provider = records[0].provider;
  assert.equal(provider.groupId, 'group'); assert.deepEqual(provider.yieldsToGroupIds, ['other']);
  assert.deepEqual(provider.excludesGroupIds, ['excluded']); assert.equal(provider.debounceDelayMs, 42);
  assert.equal(provider.displayName, 'Inline');
  const target = model(a.state.uri), position = {}, requestContext = {}, token = {};
  const list = await provider.provideInlineCompletions(target, position, requestContext, token);
  assert.deepEqual(calls[0], ['a', 'provide', [target, position, requestContext, token]]);
  a.state.focused = false; b.state.focused = true;
  const item = list.items[0], delta = {};
  provider.handleItemDidShow(list, item, 'text', delta);
  assert.deepEqual(calls[1], ['a', 'show', [originals.get('a'), item, 'text', delta]]);
  ad.dispose(); provider.handleItemDidShow(list, item, 'text', delta);
  const reason = { kind: 'accepted' };
  provider.disposeInlineCompletions(list, reason); provider.disposeInlineCompletions(list, reason); list.dispose();
  assert.deepEqual(calls.slice(2), [['a', 'free', [originals.get('a'), reason]]]);
  const next = await provider.provideInlineCompletions(target, position, requestContext, token);
  assert.equal(next.items[0].insertText, 'b'); provider.disposeInlineCompletions(next, reason);
  bd.dispose(); assert.equal(records[0].disposed, 1);
});

for (const kind of ['inlay', 'inline']) {
  for (const stale of ['dispose', 'version']) {
    test(`${kind} obsolete pending ${stale} result frees the original resource once`, async () => {
      let installed, finish, releases = 0;
      const pending = new Promise(resolve => { finish = resolve; });
      const register = (_selector, provider) => { installed = provider; return { dispose() {} }; };
      const namespace = kind === 'inlay' ? { registerInlayHintsProvider: register } : { registerInlineCompletionsProvider: register };
      const ctx = context('file:///a.py');
      const facade = sharedModelProviders(namespace, ctx);
      const lease = kind === 'inlay'
        ? facade.registerInlayHintsProvider('python', { __te2ProviderKey: '7', provideInlayHints: () => pending })
        : facade.registerInlineCompletionsProvider('python', { __te2ProviderKey: '7', provideInlineCompletions: () => pending,
          disposeInlineCompletions() { releases++; } });
      const result = kind === 'inlay' ? installed.provideInlayHints(model(ctx.state.uri), {}, {})
        : installed.provideInlineCompletions(model(ctx.state.uri), {}, {}, {});
      if (stale === 'dispose') lease.dispose(); else ctx.state.version++;
      finish(kind === 'inlay' ? { hints: [{}], dispose() { releases++; } } : { pid: 7, items: [{}] });
      assert.equal(await result, undefined); assert.equal(releases, 1);
      lease.dispose(); assert.equal(releases, 1);
    });
  }
}

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
