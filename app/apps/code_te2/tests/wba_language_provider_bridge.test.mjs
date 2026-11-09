import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function loadProvidersModule() {
  if (process.versions.bun) return import('../monaco_editor/editor_language_bridge_providers.ts');
  const result = await build({
    entryPoints: [
      path.join(appRoot, "monaco_editor/editor_language_bridge_providers.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}#${Date.now()}`;
  return import(url);
}

async function loadBridgeUtils() {
  if (process.versions.bun) return import('../monaco_editor/editor_bridge_utils.ts');
  const result = await build({
    entryPoints: [
      path.join(appRoot, "monaco_editor/editor_bridge_utils.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}#${Date.now()}`;
  return import(url);
}

function languageBridgeState() {
  return {
    registeredHover: new Set(),
    registeredSymbols: new Set(),
    registeredFolding: new Set(),
    registeredDocumentHighlights: new Set(),
    registeredDefinitions: new Set(),
    registeredReferences: new Set(),
    registeredImplementations: new Set(),
    registeredSemanticTokens: new Set(),
    semanticTokensProviderKeysByLanguage: {},
    semanticTokensProviderModeByLanguage: {},
    semanticTokensRegistrationSignatureByLanguage: {},
    semanticTokensProviderDisposablesByLanguage: {},
    semanticTokensChangeEmittersByLanguage: {},
    semanticTokensLanguagesByEventHandle: {},
    completionProvidersByLanguage: {},
    completionProviderDisposablesByLanguage: {},
    completionProviderSignatureByLanguage: {},
    documentColorProvidersByLanguage: {},
    documentColorProviderDisposablesByLanguage: {},
    documentColorProviderSignatureByLanguage: {},
    inlayHintsProvidersByLanguage: {},
    inlayHintsProviderDisposablesByKey: {},
    inlayHintsProviderSignatureByKey: {},
    inlineCompletionProvidersByLanguage: {},
    inlineCompletionProviderDisposablesByKey: {},
    inlineCompletionProviderSignatureByKey: {},
    semanticTokensLegendCache: {},
    semanticTokensRangeFlag: {},
  };
}

// Exercise installed callbacks and lifecycle, not just the DTO converter.
test('completion providers retain individual selectors, triggers, incomplete flags and lifecycle', async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  const harness = createHarness(createEditorLanguageBridgeProviders, false, {
    workbenchCall(method, params) {
      if (method === 'completions') return { ok: true, result: { sessionId: 'session', providers: [{
        handle: params.providerHandle,
        dto: { x: params.providerHandle, c: params.providerHandle === 23, b: [{ a: `item${params.providerHandle}`, x: [params.providerHandle, 0] }] },
      }] } };
      if (method === 'completions_resolve') return { ok: true, result: { a: 'resolved', x: params.id } };
      return { ok: true };
    },
  });
  const a = { handle: '23', selector: [{ language: 'python', scheme: 'vscode-remote' }, { language: 'yaml' }], triggerCharacters: ['.'], supportsResolve: true };
  const b = { handle: '24', selector: [{ scheme: 'vscode-remote', pattern: '**/*.py' }], triggerCharacters: [':'], supportsResolve: false };
  harness.providers.cacheCompletionProviderRegistration('python', a);
  harness.providers.cacheCompletionProviderRegistration('yaml', a);
  harness.providers.cacheCompletionProviderRegistration('*', b);
  const active = harness.registrations.completions.filter(r => !r.disposed);
  assert.equal(active.length, 2);
  assert.deepEqual(active[0].selector, [{ language: 'python', scheme: 'file' }, { language: 'yaml', scheme: undefined }]);
  assert.deepEqual(active[1].selector, [{ scheme: 'file', pattern: '**/*.py' }]);
  assert.deepEqual(active.map(r => r.provider.triggerCharacters), [['.'], [':']]);
  assert.equal(typeof active[0].provider.resolveCompletionItem, 'function');
  assert.equal(active[1].provider.resolveCompletionItem, undefined);
  const model = { uri: { toString: () => 'file:///workspace/main.py' }, getLanguageId: () => 'python' };
  Object.assign(harness.context, { uri: 'file:///workspace/main.py', path: '/workspace/main.py', languageId: 'python' });
  const lists = await Promise.all(active.map(r => r.provider.provideCompletionItems(model, { lineNumber: 1, column: 1 }, {}, {})));
  assert.deepEqual(lists.map(l => l.incomplete), [true, false]);
  assert.deepEqual(harness.calls.filter(c => c.method === 'completions').map(c => c.params.providerHandle), [23, 24]);
  assert.equal((await active[0].provider.resolveCompletionItem(lists[0].suggestions[0], {})).label, 'resolved');
  for (const list of lists) list.dispose();
  await Promise.resolve();
  assert.deepEqual(harness.calls.filter(c => c.method === 'completions_release').map(c => c.params.cacheId), [23, 24]);
});

function createHarness(
  createEditorLanguageBridgeProviders,
  workersEnabled,
  options = {},
) {
  const registrations = {};
  const calls = [];
  const tokenizationCalls = [];
  const languageBridge = languageBridgeState();
  const languages = options.sharedLanguages || {
    registerCompletionItemProvider(selector, provider) {
      const registration = { selector, provider, disposed: false };
      (registrations.completions ??= []).push(registration);
      return { dispose() { registration.disposed = true; } };
    },
    registerHoverProvider(language, provider) {
      registrations.hover = { language, provider };
      return { dispose() {} };
    },
    registerDocumentHighlightProvider(language, provider) {
      registrations.documentHighlights = { language, provider };
      return { dispose() {} };
    },
    registerDefinitionProvider(language, provider) {
      registrations.definitions = { language, provider };
      return { dispose() {} };
    },
    registerReferenceProvider(language, provider) {
      registrations.references = { language, provider };
      return { dispose() {} };
    },
    registerImplementationProvider(language, provider) {
      registrations.implementations = { language, provider };
      return { dispose() {} };
    },
  };
  const context = {
    uri: "file:///workspace/main.any",
    path: "/workspace/main.any",
    languageId: "example-language",
    version: 1,
  };
  Object.assign(languages, options.languages);
  const providers = createEditorLanguageBridgeProviders({
    getMonaco: () => ({
      Range: class Range {
        constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
          Object.assign(this, {
            startLineNumber,
            startColumn,
            endLineNumber,
            endColumn,
          });
        }
      },
      Uri: {
        parse: (value) => ({ value, toString: () => value }),
        file: (value) => ({ value, toString: () => `file://${value}` }),
      },
      languages,
    }),
    getLanguageWorkersEnabled: () => workersEnabled,
    getDisableSemanticTokens: () => false,
    getCurrentPath: () => context.path,
    absPathFromVscodeUri: () => context.path,
    getHasModel: () => true,
    getCurrentLanguageContext: () => context,
    isEditorFocused: () => options.focused?.() ?? false,
    editorWorkbenchCall: async (method, params) => {
      calls.push({ method, params });
      if (options.workbenchCall) return options.workbenchCall(method, params);
      if (method === "document_highlights") {
        return {
          ok: true,
          result: [
            {
              range: {
                startLineNumber: 1,
                startColumn: 2,
                endLineNumber: 1,
                endColumn: 5,
              },
              kind: 2,
            },
          ],
        };
      }
      return {
        ok: true,
        result: [
          {
            uri: "file:///workspace/target.any",
            range: {
              startLineNumber: 3,
              startColumn: 4,
              endLineNumber: 3,
              endColumn: 8,
            },
          },
        ],
      };
    },
    callWorkbenchProviderGuarded: async (kind, method, params) => {
      calls.push({ kind, method, params });
      return {
        ok: true,
        result: {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 4,
          },
          contents: [
            {
              value: "\n```typescript\nconst value: number\n```\n",
            },
          ],
        },
      };
    },
    projectMonacoHoverContents: options.projectMonacoHoverContents,
    ensureTextmateTokenization: async (languageId, filePath) => {
      tokenizationCalls.push({ languageId, filePath });
      if (options.tokenizationGate) await options.tokenizationGate;
      return true;
    },
    ensureWorkbenchLanguageCatalogInstalled: async () => { await options.catalogGate; },
    getWorkbenchLanguageIds: () => [context.languageId],
    monacoRangeFromProtoRange: (range) => range,
    flushMirrorDebounce() {},
    languageBridge,
  });
  return {
    providers,
    registrations,
    calls,
    context,
    tokenizationCalls,
    languageBridge,
  };
}

test('provider owner releases every registration family once and cannot revive after teardown', async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  const records = [];
  const languages = Object.fromEntries([
    'Hover', 'DocumentSymbol', 'FoldingRange', 'DocumentHighlight', 'Definition',
    'Reference', 'Implementation', 'CompletionItem', 'Color', 'InlayHints',
    'InlineCompletions', 'DocumentSemanticTokens', 'DocumentRangeSemanticTokens',
  ].map(kind => [`register${kind}Provider`, (_selector, provider) => {
    const record = { kind, provider, disposals: 0 }; records.push(record);
    return { dispose() { record.disposals++; } };
  }]));
  const h = createHarness(createEditorLanguageBridgeProviders, false, { languages });
  h.providers.installWorkbenchLanguageBridgeProviders();
  for (const kind of ['documentHighlights', 'definitions', 'references', 'implementations']) {
    h.providers.cacheLanguageProviderRegistration(kind, 'example-language');
  }
  h.providers.cacheCompletionProviderRegistration('example-language', { handle: '1', triggerCharacters: [] });
  h.providers.cacheDocumentColorProviderRegistration('example-language', { handle: '2' });
  h.providers.cacheInlayHintsProviderRegistration('example-language', { handle: '3' });
  h.providers.cacheInlineCompletionProviderRegistration('example-language', { handle: '4' });
  h.providers.registerSemanticTokensWithLegend('example-language', { tokenTypes: ['variable'], tokenModifiers: [] });
  h.providers.registerSemanticTokensWithLegend('other-language', { tokenTypes: ['variable'], tokenModifiers: [] }, true);
  const semantic = records.find(r => r.kind === 'DocumentSemanticTokens');
  let invalidations = 0;
  semantic.provider.onDidChange(() => invalidations++);
  h.providers.fireSemanticTokensChanged('example-language');
  const count = records.length;
  assert.deepEqual(new Set(records.map(r => r.kind)), new Set([
    'Hover', 'DocumentSymbol', 'FoldingRange', 'DocumentHighlight', 'Definition',
    'Reference', 'Implementation', 'CompletionItem', 'Color', 'InlayHints',
    'InlineCompletions', 'DocumentSemanticTokens', 'DocumentRangeSemanticTokens',
  ]));
  h.providers.dispose(); h.providers.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invalidations, 0);
  assert.ok(records.every(r => r.disposals === 1));
  h.providers.installWorkbenchLanguageBridgeProviders();
  h.providers.cacheCompletionProviderRegistration('example-language', { handle: 'new', triggerCharacters: [] });
  h.providers.cacheLanguageProviderRegistration('references', 'other-language');
  h.providers.registerSemanticTokensWithLegend('new', { tokenTypes: ['variable'], tokenModifiers: [] });
  h.providers.fireSemanticTokensChanged();
  assert.equal(records.length, count);
  assert.equal(h.languageBridge.registeredHover.size, 0);
  assert.deepEqual(h.languageBridge.completionProvidersByLanguage, {});
});

test('catalog and legend replies cannot register providers after owner disposal', async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  let finishCatalog, finishLegend;
  const catalogGate = new Promise(resolve => { finishCatalog = resolve; });
  const legendGate = new Promise(resolve => { finishLegend = resolve; });
  let semanticRegistrations = 0;
  const h = createHarness(createEditorLanguageBridgeProviders, false, {
    catalogGate,
    workbenchCall: () => legendGate,
    languages: { registerDocumentSemanticTokensProvider() { semanticRegistrations++; return { dispose() {} }; } },
  });
  h.providers.installWorkbenchLanguageBridgeProviders();
  h.providers.dispose();
  finishCatalog(); finishLegend({ ok: true, result: { legend: { tokenTypes: ['variable'], tokenModifiers: [] } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(semanticRegistrations, 0);
  assert.equal(h.languageBridge.registeredHover.size, 0);
  assert.equal(h.languageBridge.registeredSemanticTokens.size, 0);
});

test('two real WBA bridge owners share static registrations and route RPCs to the focused matching runtime', async t => {
  t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {});
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  const records = [];
  const sharedLanguages = Object.fromEntries([
    'Hover', 'DocumentSymbol', 'FoldingRange', 'DocumentHighlight', 'Definition', 'Reference', 'Implementation',
  ].map(kind => [`register${kind}Provider`, (selector, provider) => {
    const record = { kind, selector, provider, disposals: 0 }; records.push(record);
    return { dispose() { record.disposals++; } };
  }]));
  let focused = 'primary';
  const a = createHarness(createEditorLanguageBridgeProviders, false, { sharedLanguages, focused: () => focused === 'primary' });
  const b = createHarness(createEditorLanguageBridgeProviders, false, { sharedLanguages, focused: () => focused === 'secondary' });
  a.context.uri = 'file:///workspace/a.py'; a.context.path = '/workspace/a.py';
  b.context.uri = 'file:///workspace/b.py'; b.context.path = '/workspace/b.py';
  for (const owner of [a, b]) {
    owner.providers.installWorkbenchLanguageBridgeProviders();
    for (const kind of ['documentHighlights', 'definitions', 'references', 'implementations']) {
      owner.providers.cacheLanguageProviderRegistration(kind, owner.context.languageId);
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(records.length, 7);
  const provider = records.find(record => record.kind === 'Definition').provider;
  const request = uri => provider.provideDefinition({ uri: { toString: () => uri }, getVersionId: () => 1 }, { lineNumber: 7, column: 3 }, {});
  const result = await request(b.context.uri);
  assert.equal(result.length, 1);
  assert.equal(a.calls.filter(call => call.method === 'definition').length, 0);
  assert.equal(b.calls.filter(call => call.method === 'definition').length, 1);
  assert.equal(b.calls.find(call => call.method === 'definition').params.path, '/workspace/b.py');
  b.context.uri = a.context.uri; b.context.path = a.context.path; focused = 'secondary';
  await request(a.context.uri);
  assert.equal(b.calls.filter(call => call.method === 'definition').length, 2);
  a.providers.dispose(); assert.ok(records.every(record => record.disposals === 0));
  await request(a.context.uri);
  assert.equal(b.calls.filter(call => call.method === 'definition').length, 3);
  b.providers.dispose(); assert.ok(records.every(record => record.disposals === 1));
  assert.equal(provider.provideDefinition({ uri: { toString: () => a.context.uri } }, {}, {}), undefined);
});

test('in-flight completion results are cancelled and released after owner disposal', async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = createHarness(createEditorLanguageBridgeProviders, false, {
    workbenchCall(method) { return method === 'completions' ? pending : { ok: true }; },
  });
  h.providers.cacheCompletionProviderRegistration('example-language', { handle: '23', triggerCharacters: [] });
  const provider = h.registrations.completions[0].provider;
  const model = { uri: { toString: () => h.context.uri }, getLanguageId: () => h.context.languageId };
  const result = provider.provideCompletionItems(model, { lineNumber: 1, column: 1 }, {}, {});
  h.providers.dispose();
  finish({ ok: true, result: { sessionId: 'late-session', providers: [{ handle: 23, dto: { x: 23, b: [{ a: 'late', x: [23, 0] }] } }] } });
  assert.equal(await result, undefined);
  await Promise.resolve();
  assert.equal(h.calls.filter(c => c.method === 'completions_release').length, 1);
  const before = h.calls.length;
  assert.equal(await provider.provideCompletionItems(model, { lineNumber: 1, column: 1 }, {}, {}), undefined);
  assert.equal(h.calls.length, before);
});

for (const kind of ['inlayHints', 'inlineCompletions']) {
  test(`two WBA owners share ${kind} registration without rerouting release`, async () => {
    const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
    let provider, registrations = 0, disposals = 0, focused = 'a';
    const register = (_selector, value) => { provider = value; registrations++; return { dispose() { disposals++; } }; };
    const sharedLanguages = kind === 'inlayHints' ? { registerInlayHintsProvider: register } : { registerInlineCompletionsProvider: register };
    const requestMethod = kind === 'inlayHints' ? 'inlay_hints' : 'inline_completions';
    const releaseMethod = kind === 'inlayHints' ? 'inlay_hints_release' : 'inline_completions_free';
    const create = name => createHarness(createEditorLanguageBridgeProviders, false, {
      sharedLanguages, focused: () => focused === name,
      workbenchCall(method) { return method === requestMethod
        ? { ok: true, result: kind === 'inlayHints' ? { hints: [], cacheId: 19 } : { pid: 19, items: [] } }
        : { ok: true }; },
    });
    const a = create('a'), b = create('b');
    for (const h of [a, b]) {
      if (kind === 'inlayHints') h.providers.cacheInlayHintsProviderRegistration('example-language', { handle: '7' });
      else h.providers.cacheInlineCompletionProviderRegistration('example-language', { handle: '7' });
    }
    assert.equal(registrations, 1);
    const model = { uri: { toString: () => a.context.uri }, getVersionId: () => 1, getLanguageId: () => a.context.languageId };
    const list = kind === 'inlayHints'
      ? await provider.provideInlayHints(model, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, {})
      : await provider.provideInlineCompletions(model, { lineNumber: 1, column: 1 }, {}, {});
    assert.equal(a.calls.filter(c => c.method === requestMethod).length, 1);
    assert.equal(b.calls.length, 0);
    focused = 'b'; a.providers.dispose(); assert.equal(disposals, 0);
    if (kind === 'inlayHints') list.dispose(); else provider.disposeInlineCompletions(list, { kind: 'other' });
    await Promise.resolve();
    assert.equal(a.calls.filter(c => c.method === releaseMethod).length, 1);
    assert.equal(b.calls.length, 0);
    b.providers.dispose(); assert.equal(disposals, 1);
  });

  test(`late ${kind} results release retained extension-host resources`, async () => {
    const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
    let finish, provider;
    const pending = new Promise(resolve => { finish = resolve; });
    const requestMethod = kind === 'inlayHints' ? 'inlay_hints' : 'inline_completions';
    const releaseMethod = kind === 'inlayHints' ? 'inlay_hints_release' : 'inline_completions_free';
    const register = (_selector, value) => { provider = value; return { dispose() {} }; };
    const h = createHarness(createEditorLanguageBridgeProviders, false, {
      workbenchCall(method) { return method === requestMethod ? pending : { ok: true }; },
      languages: kind === 'inlayHints' ? { registerInlayHintsProvider: register } : { registerInlineCompletionsProvider: register },
    });
    const model = { uri: { toString: () => h.context.uri }, getLanguageId: () => h.context.languageId };
    let result;
    if (kind === 'inlayHints') {
      h.providers.cacheInlayHintsProviderRegistration('example-language', { handle: '7' });
      result = provider.provideInlayHints(model, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 });
    } else {
      h.providers.cacheInlineCompletionProviderRegistration('example-language', { handle: '7' });
      result = provider.provideInlineCompletions(model, { lineNumber: 1, column: 1 }, {});
    }
    assert.equal(h.calls.filter(c => c.method === requestMethod).length, 1);
    h.providers.dispose();
    finish({ ok: true, result: kind === 'inlayHints' ? { hints: [], cacheId: 19 } : { pid: 19, items: [] } });
    assert.equal(await result, undefined);
    await Promise.resolve();
    const releases = h.calls.filter(c => c.method === releaseMethod);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].params.providerHandle, '7');
  });
}

test("WBA position providers register identically for any advertised language", async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  const harness = createHarness(createEditorLanguageBridgeProviders, false);
  for (const kind of [
    "documentHighlights",
    "definitions",
    "references",
    "implementations",
  ]) {
    harness.providers.cacheLanguageProviderRegistration(
      kind,
      "example-language",
    );
  }

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(harness.registrations).map(([kind, entry]) => [
        kind,
        entry.language,
      ]),
    ),
    {
      documentHighlights: "example-language",
      definitions: "example-language",
      references: "example-language",
      implementations: "example-language",
    },
  );

  const model = { uri: { toString: () => harness.context.uri } };
  const highlights = await harness.registrations.documentHighlights.provider
    .provideDocumentHighlights(model, { lineNumber: 1, column: 3 }, {});
  assert.equal(highlights[0].kind, 2);
  assert.equal(harness.calls[0].method, "document_highlights");

  const definitions = await harness.registrations.definitions.provider
    .provideDefinition(model, { lineNumber: 1, column: 3 }, {});
  assert.equal(definitions[0].uri.toString(), "file:///workspace/target.any");
  assert.equal(harness.calls[1].method, "definition");
});

test("Monaco Web Worker mode does not register WBA language providers", async () => {
  const { createEditorLanguageBridgeProviders } = await loadProvidersModule();
  const harness = createHarness(createEditorLanguageBridgeProviders, true);
  harness.providers.cacheLanguageProviderRegistration(
    "documentHighlights",
    "example-language",
  );
  harness.providers.cacheLanguageProviderRegistration(
    "definitions",
    "example-language",
  );
  assert.deepEqual(harness.registrations, {});
});

test("hover waits for every fenced language tokenizer before returning", async () => {
  const [{ createEditorLanguageBridgeProviders }, { projectMonacoHoverContents }] =
    await Promise.all([loadProvidersModule(), loadBridgeUtils()]);
  let releaseTokenization;
  const tokenizationGate = new Promise((resolve) => {
    releaseTokenization = resolve;
  });
  const harness = createHarness(createEditorLanguageBridgeProviders, false, {
    projectMonacoHoverContents,
    tokenizationGate,
  });
  harness.providers.installWorkbenchLanguageBridgeProviders();
  await new Promise((resolve) => setImmediate(resolve));

  const model = { uri: { toString: () => harness.context.uri } };
  let settled = false;
  const hoverPromise = harness.registrations.hover.provider
    .provideHover(model, { lineNumber: 1, column: 2 }, {})
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.deepEqual(harness.tokenizationCalls, [
    {
      languageId: "typescript",
      filePath: harness.context.path,
    },
  ]);

  releaseTokenization(true);
  const hover = await hoverPromise;
  assert.equal(settled, true);
  assert.equal(hover.contents[0].value.includes("```typescript"), true);
});
