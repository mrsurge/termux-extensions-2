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

function createDeps(languageBridge, registrations, invalidations) {
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
