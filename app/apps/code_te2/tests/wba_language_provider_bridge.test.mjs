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
  const languages = {
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
    ensureWorkbenchLanguageCatalogInstalled: async () => {},
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
  };
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
