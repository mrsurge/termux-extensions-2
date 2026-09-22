import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

async function importModule(entry) {
  const result = await build({
    entryPoints: [path.join(appRoot, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url =
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}` +
    `#${moduleSequence++}`;
  return import(url);
}

function languageBridgeState() {
  return {
    registeredHover: new Set(),
    registeredSymbols: new Set(),
    registeredFolding: new Set(),
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

function createDeps(languageBridge, registrations, invalidations, overrides = {}) {
  function register(kind, languageId, provider) {
    registrations.push([kind, languageId]);
    const subscription = provider.onDidChange(() => {
      invalidations.push(languageId);
    });
    return {
      dispose() {
        subscription.dispose();
      },
    };
  }

  return {
    languageBridge,
    getDisableSemanticTokens: () => false,
    getMonaco: () => ({
      languages: {
        registerDocumentSemanticTokensProvider(languageId, provider) {
          return register("full", languageId, provider);
        },
        registerDocumentRangeSemanticTokensProvider(languageId, provider) {
          return register("range", languageId, provider);
        },
      },
    }),
    ...overrides,
  };
}

async function settleInvalidations() {
  await Promise.resolve();
  await Promise.resolve();
}

test("semantic token registration deduplicates selectors and prefers full maps", async () => {
  const { createEditorLanguageBridgeProviders } = await importModule(
    "monaco_editor/editor_language_bridge_providers.ts",
  );
  const languageBridge = languageBridgeState();
  const registrations = [];
  const invalidations = [];
  const providers = createEditorLanguageBridgeProviders(
    createDeps(languageBridge, registrations, invalidations),
  );
  const legend = {
    tokenTypes: ["function", "variable"],
    tokenModifiers: ["declaration"],
  };

  providers.registerSemanticTokensWithLegend("rust", legend, false, {
    providerKey: "41:full",
  });
  providers.registerSemanticTokensWithLegend("rust", legend, false, {
    providerKey: "41:full",
  });
  providers.registerSemanticTokensWithLegend("rust", legend, true, {
    providerKey: "42:range",
  });
  await settleInvalidations();

  assert.deepEqual(registrations, [["full", "rust"]]);
  assert.deepEqual(invalidations, []);
  assert.equal(languageBridge.semanticTokensProviderModeByLanguage.rust, "full");

  providers.registerSemanticTokensWithLegend("rust", legend, false, {
    providerKey: "43:full",
  });
  providers.registerSemanticTokensWithLegend("rust", legend, false, {
    providerKey: "43:full",
  });
  await settleInvalidations();
  assert.deepEqual(invalidations, ["rust"]);

  providers.registerSemanticTokensWithLegend(
    "rust",
    {
      tokenTypes: ["function", "variable", "type"],
      tokenModifiers: ["declaration"],
    },
    false,
    { providerKey: "43:full", replay: true },
  );
  await settleInvalidations();
  assert.deepEqual(invalidations, ["rust"]);
});

test("range-only languages retain one stable range provider", async () => {
  const { createEditorLanguageBridgeProviders } = await importModule(
    "monaco_editor/editor_language_bridge_providers.ts",
  );
  const languageBridge = languageBridgeState();
  const registrations = [];
  const invalidations = [];
  const providers = createEditorLanguageBridgeProviders(
    createDeps(languageBridge, registrations, invalidations),
  );
  const legend = {
    tokenTypes: ["class"],
    tokenModifiers: [],
  };

  providers.registerSemanticTokensWithLegend("typescript", legend, true, {
    providerKey: "71:range",
    replay: true,
  });
  providers.registerSemanticTokensWithLegend("typescript", legend, true, {
    providerKey: "71:range",
    replay: true,
  });
  await settleInvalidations();

  assert.deepEqual(registrations, [["range", "typescript"]]);
  assert.deepEqual(invalidations, []);
  assert.equal(
    languageBridge.semanticTokensProviderModeByLanguage.typescript,
    "range",
  );
});

test("full semantic requests outlive slow provider startup and honor Monaco cancellation", async () => {
  const { createEditorLanguageBridgeProviders } = await importModule(
    "monaco_editor/editor_language_bridge_providers.ts",
  );
  const languageBridge = languageBridgeState();
  const registrations = [];
  const invalidations = [];
  const registeredProviders = new Map();
  const calls = [];
  const deps = createDeps(languageBridge, registrations, invalidations, {
    getCurrentPath: () => "/workspace/a.py",
    absPathFromVscodeUri: () => "/workspace/a.py",
    editorWorkbenchCall: async (method, params, options) => {
      calls.push({ method, params, options });
      return {
        ok: true,
        result: {
          type: "full",
          id: 7,
          data: [0, 0, 3, 0, 0],
        },
      };
    },
    getMonaco: () => ({
      languages: {
        registerDocumentSemanticTokensProvider(languageId, provider) {
          registeredProviders.set(languageId, provider);
          return { dispose() {} };
        },
      },
    }),
  });
  const providers = createEditorLanguageBridgeProviders(deps);
  providers.registerSemanticTokensWithLegend(
    "python",
    { tokenTypes: ["class"], tokenModifiers: [] },
    false,
  );
  const provider = registeredProviders.get("python");
  const model = {
    uri: { toString: () => "file:///workspace/a.py" },
    getLanguageId: () => "python",
    getValue: () => "class A: pass",
    getVersionId: () => 1,
  };

  assert.equal(
    await provider.provideDocumentSemanticTokens(
      model,
      null,
      { isCancellationRequested: true },
    ),
    null,
  );
  assert.equal(calls.length, 0);

  const result = await provider.provideDocumentSemanticTokens(
    model,
    null,
    { isCancellationRequested: false },
  );
  assert.deepEqual(Array.from(result.data), [0, 0, 3, 0, 0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "semantic_tokens");
  assert.equal(calls[0].params.timeoutMs, 30000);
  assert.equal(calls[0].options.timeoutMs, 36000);
});

test("semantic results completed after Monaco cancellation are discarded", async () => {
  const { createEditorLanguageBridgeProviders } = await importModule(
    "monaco_editor/editor_language_bridge_providers.ts",
  );
  const languageBridge = languageBridgeState();
  const registeredProviders = new Map();
  let releaseResponse;
  const response = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const providers = createEditorLanguageBridgeProviders(
    createDeps(languageBridge, [], [], {
      getCurrentPath: () => "/workspace/a.py",
      absPathFromVscodeUri: () => "/workspace/a.py",
      editorWorkbenchCall: () => response,
      getMonaco: () => ({
        languages: {
          registerDocumentSemanticTokensProvider(languageId, provider) {
            registeredProviders.set(languageId, provider);
            return { dispose() {} };
          },
        },
      }),
    }),
  );
  providers.registerSemanticTokensWithLegend(
    "python",
    { tokenTypes: ["class"], tokenModifiers: [] },
    false,
  );
  const token = { isCancellationRequested: false };
  const pending = registeredProviders.get("python").provideDocumentSemanticTokens(
    {
      uri: { toString: () => "file:///workspace/a.py" },
      getLanguageId: () => "python",
      getValue: () => "class A: pass",
      getVersionId: () => 1,
    },
    null,
    token,
  );
  token.isCancellationRequested = true;
  releaseResponse({
    ok: true,
    result: { type: "full", id: 8, data: [0, 0, 3, 0, 0] },
  });
  assert.equal(await pending, null);
});
