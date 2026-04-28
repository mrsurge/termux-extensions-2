import { provideWorkbenchCompletionItemsFromVscodeSuggest } from './vscode_completion_vendor/suggest.js';
import {
  provideWorkbenchDocumentRangeSemanticTokensFromVscodeMainThread,
  provideWorkbenchDocumentSemanticTokensFromVscodeMainThread,
} from './vscode_document_intelligence_vendor/semanticTokens.js';

interface LanguageContext {
  uri: string;
  path: string;
  languageId: string;
  version: number;
}

interface SemanticTokensLegendLike {
  tokenTypes: string[];
  tokenModifiers: string[];
}

interface LanguageBridgeState {
  registeredHover: Set<string>;
  registeredSymbols: Set<string>;
  registeredFolding: Set<string>;
  registeredSemanticTokens: Set<string>;
  completionProvidersByLanguage: Record<string, Record<string, CompletionProviderRegistrationLike>>;
  completionProviderDisposablesByLanguage: Record<string, MonacoDisposableLike | null>;
  completionProviderSignatureByLanguage: Record<string, string>;
  semanticTokensLegendCache: Record<string, SemanticTokensLegendLike>;
  semanticTokensRangeFlag: Record<string, boolean>;
}

interface CompletionProviderRegistrationLike {
  handle: string;
  triggerCharacters: string[];
  supportsResolve: boolean;
}

interface GuardedCallResult {
  ok?: boolean;
  stale?: boolean;
  notReady?: boolean;
  canceled?: boolean;
  error?: string;
  result?: unknown;
}

interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
  getLanguageId?(): string;
  getValue?(): string;
  getVersionId?(): number;
}

interface MonacoPositionLike {
  lineNumber?: number;
  column?: number;
}

interface MonacoRangeLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

interface MonacoCancellationTokenLike {
  isCancellationRequested?: boolean;
}

interface MonacoCompletionContextLike {
  triggerKind?: number;
  triggerCharacter?: string;
}

interface MonacoDisposableLike {
  dispose(): void;
}

interface MonacoLanguagesLike {
  SymbolKind?: { Function?: number };
  FoldingRangeKind?: {
    fromValue?: (value: string) => unknown;
    Comment?: unknown;
    Imports?: unknown;
    Region?: unknown;
  };
  CompletionTriggerKind?: {
    TriggerCharacter?: number;
    TriggerForIncompleteCompletions?: number;
  };
  CompletionItemKind?: {
    Property?: number;
  };
  registerHoverProvider?: (selector: unknown, provider: {
    provideHover(model: MonacoModelLike, pos: MonacoPositionLike, token: MonacoCancellationTokenLike): unknown;
  }) => unknown;
  registerDocumentSymbolProvider?: (selector: unknown, provider: {
    provideDocumentSymbols(model: MonacoModelLike, token: MonacoCancellationTokenLike): unknown;
  }) => unknown;
  registerFoldingRangeProvider?: (selector: unknown, provider: {
    provideFoldingRanges(model: MonacoModelLike, context: unknown, token: MonacoCancellationTokenLike): unknown;
  }) => unknown;
  registerCompletionItemProvider?: (selector: unknown, provider: {
    __te2WorkbenchProvider?: true;
    triggerCharacters?: string[];
    provideCompletionItems(model: MonacoModelLike, pos: MonacoPositionLike, context: MonacoCompletionContextLike, token: MonacoCancellationTokenLike): unknown;
  }) => MonacoDisposableLike | unknown;
  registerDocumentRangeSemanticTokensProvider?: (selector: unknown, provider: {
    getLegend(): SemanticTokensLegendLike;
    provideDocumentRangeSemanticTokens(model: MonacoModelLike, range: MonacoRangeLike, token: MonacoCancellationTokenLike): unknown;
  }) => unknown;
  registerDocumentSemanticTokensProvider?: (selector: unknown, provider: {
    getLegend(): SemanticTokensLegendLike;
    provideDocumentSemanticTokens(model: MonacoModelLike, lastResultId: string | null | undefined, token: MonacoCancellationTokenLike): unknown;
    releaseDocumentSemanticTokens(resultId: string): void;
  }) => unknown;
}

interface MonacoLike {
  Range: new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => unknown;
  editor?: {
    getEditors?: () => unknown[];
  };
  languages: MonacoLanguagesLike;
}

interface MonacoCompletionRegistryLike extends Record<string, unknown> {
  _entries?: unknown[];
  _lastCandidate?: unknown;
}

const prunedNativeCompletionLanguages = new Set<string>();

interface CreateEditorLanguageBridgeProvidersDeps {
  getMonaco(): MonacoLike | null;
  getLanguageWorkersEnabled(): boolean;
  getCurrentPath(): string | null;
  getHasModel(): boolean;
  getCurrentLanguageContext(): LanguageContext | null;
  callWorkbenchProviderGuarded(
    kind: 'hover' | 'symbols' | 'folding_ranges',
    method: string,
    params: Record<string, unknown>,
    ctx: LanguageContext | null,
    opts?: { timeoutMs?: number; cancelToken?: MonacoCancellationTokenLike | null },
  ): Promise<GuardedCallResult>;
  editorWorkbenchCall(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  absPathFromVscodeUri(raw: string): string | null;
  monacoRangeFromProtoRange(range: unknown): unknown;
  toMonacoHoverContents(raw: unknown): unknown[];
  flushMirrorDebounce(): void;
  ensureWorkbenchLanguageCatalogInstalled(): Promise<void>;
  getWorkbenchLanguageIds(): Iterable<string>;
  languageBridge: LanguageBridgeState;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function documentSymbolProviderSelector(deps: CreateEditorLanguageBridgeProvidersDeps, langId: string): unknown {
  if (deps.getLanguageWorkersEnabled()) return langId;
  return { language: langId, scheme: 'file', exclusive: true };
}

function foldingRangeProviderSelector(deps: CreateEditorLanguageBridgeProvidersDeps, langId: string): unknown {
  if (deps.getLanguageWorkersEnabled()) return langId;
  return { language: langId, scheme: 'file', exclusive: true };
}

function normalizeDocumentSymbols(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  raw: unknown,
): unknown[] {
  const input = asArray(raw);
  const monacoRef = deps.getMonaco();
  if (!input || !monacoRef || !monacoRef.languages) return [];

  const defaultKind = monacoRef.languages.SymbolKind && typeof monacoRef.languages.SymbolKind.Function === 'number'
    ? monacoRef.languages.SymbolKind.Function
    : 11;

  const mapOne = (item: unknown): unknown => {
    const symbol = asRecord(item);
    const location = asRecord(symbol && symbol.location);
    const protoRange = symbol && symbol.range !== undefined
      ? symbol.range
      : (location ? location.range : null);
    const range = deps.monacoRangeFromProtoRange(protoRange);
    const selectionRange = deps.monacoRangeFromProtoRange(symbol && symbol.selectionRange !== undefined ? symbol.selectionRange : protoRange);
    const children = asArray(symbol && symbol.children)
      ? (symbol!.children as unknown[]).map(mapOne)
      : [];

    let detail = symbol && symbol.detail != null ? String(symbol.detail) : '';
    if (!detail && symbol && symbol.containerName != null) detail = String(symbol.containerName);

    return {
      name: String((symbol && symbol.name) || ''),
      detail,
      kind: Number(symbol && symbol.kind != null ? symbol.kind : defaultKind),
      tags: asArray(symbol && symbol.tags) || [],
      range: range || new monacoRef.Range(1, 1, 1, 1),
      selectionRange: selectionRange || range || new monacoRef.Range(1, 1, 1, 1),
      children,
    };
  };

  return input.map(mapOne);
}

function monacoFoldingRangeKindFromProto(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  kind: unknown,
): unknown {
  const monacoRef = deps.getMonaco();
  const foldingKinds = monacoRef && monacoRef.languages ? monacoRef.languages.FoldingRangeKind : null;
  if (!kind || !foldingKinds) return undefined;

  let value = '';
  if (typeof kind === 'string') value = kind;
  else {
    const kindRecord = asRecord(kind);
    if (kindRecord && typeof kindRecord.value === 'string') value = kindRecord.value;
  }
  if (!value) return undefined;
  if (typeof foldingKinds.fromValue === 'function') return foldingKinds.fromValue(value);
  if (value === 'comment' && foldingKinds.Comment) return foldingKinds.Comment;
  if (value === 'imports' && foldingKinds.Imports) return foldingKinds.Imports;
  if (value === 'region' && foldingKinds.Region) return foldingKinds.Region;
  return undefined;
}

function normalizeFoldingRanges(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  raw: unknown,
): Array<Record<string, unknown>> | null {
  const input = asArray(raw);
  if (!input) return null;

  const out: Array<Record<string, unknown>> = [];
  for (const item of input) {
    const range = asRecord(item);
    const start = Number(range && range.start);
    const end = Number(range && range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end <= start) continue;
    const normalized: Record<string, unknown> = { start, end };
    const kind = monacoFoldingRangeKindFromProto(deps, range && range.kind);
    if (kind) normalized.kind = kind;
    out.push(normalized);
  }
  return out;
}

function extractGuardedPayload(result: GuardedCallResult): Record<string, unknown> | null {
  const direct = asRecord(result.result);
  return direct;
}

function extractWorkbenchPayload(result: unknown): Record<string, unknown> | null {
  const record = asRecord(result);
  if (!record) return null;
  const inner = asRecord(record.result);
  return inner || record;
}

function completionProviderKey(langId: string, handle: string): string {
  return langId + '::' + handle;
}

function completionProviderHandleNumber(handle: string): number | null {
  const value = Number(handle);
  return Number.isFinite(value) ? value : null;
}

function completionPropertyKind(deps: CreateEditorLanguageBridgeProvidersDeps): number {
  const monacoRef = deps.getMonaco();
  return monacoRef && monacoRef.languages && monacoRef.languages.CompletionItemKind
    && typeof monacoRef.languages.CompletionItemKind.Property === 'number'
    ? monacoRef.languages.CompletionItemKind.Property
    : 9;
}

function iterablePairs(value: unknown): Iterable<[unknown, unknown]> | null {
  const candidate = value as { [Symbol.iterator]?: unknown } | null | undefined;
  return candidate && typeof candidate[Symbol.iterator] === 'function'
    ? candidate as Iterable<[unknown, unknown]>
    : null;
}

function completionRegistryFromActiveEditor(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): MonacoCompletionRegistryLike | null {
  const monacoRef = deps.getMonaco();
  const editors = monacoRef && monacoRef.editor && typeof monacoRef.editor.getEditors === 'function'
    ? monacoRef.editor.getEditors()
    : [];
  for (const editor of editors) {
    const editorRecord = asRecord(editor);
    let service = asRecord(editorRecord && editorRecord._instantiationService);
    while (service) {
      const parent = asRecord(service._parent);
      if (!parent) break;
      service = parent;
    }

    const services = asRecord(service && service._services);
    const serviceEntries = iterablePairs(services && services._entries);
    if (!serviceEntries) continue;
    for (const [key, value] of serviceEntries) {
      if (String(key) !== 'ILanguageFeaturesService') continue;
      const languageFeatures = asRecord(value);
      const completionProvider = asRecord(languageFeatures && languageFeatures.completionProvider) as MonacoCompletionRegistryLike | null;
      if (completionProvider && Array.isArray(completionProvider._entries)) return completionProvider;
    }
  }
  return null;
}

function selectorMatchesLanguage(selector: unknown, langId: string): boolean {
  if (Array.isArray(selector)) {
    return selector.some((item) => selectorMatchesLanguage(item, langId));
  }
  if (typeof selector === 'string') return selector === langId;
  const selectorRecord = asRecord(selector);
  return !!selectorRecord && selectorRecord.language === langId;
}

function pruneNativeWorkerCompletionProviders(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  langId: string,
): number {
  if (deps.getLanguageWorkersEnabled()) return 0;
  const registry = completionRegistryFromActiveEditor(deps);
  if (!registry || !Array.isArray(registry._entries)) return 0;
  const entries = registry._entries;

  let removed = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = asRecord(entries[i]);
    const provider = asRecord(entry && entry.provider);
    if (
      entry
      && provider
      && Object.prototype.hasOwnProperty.call(provider, '_worker')
      && selectorMatchesLanguage(entry.selector, langId)
    ) {
      entries.splice(i, 1);
      removed += 1;
    }
  }

  if (removed > 0) {
    registry._lastCandidate = undefined;
    if (!prunedNativeCompletionLanguages.has(langId)) {
      prunedNativeCompletionLanguages.add(langId);
      console.log('[completions] pruned native Monaco worker completion provider for lang=' + langId + ' count=' + removed);
    }
  }
  return removed;
}

export function createEditorLanguageBridgeProviders(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): {
  cacheCompletionProviderRegistration(langId: string, registration: CompletionProviderRegistrationLike): void;
  registerSemanticTokensWithLegend(langId: string, legend: SemanticTokensLegendLike, isRange?: boolean): void;
  installWorkbenchLanguageBridgeProviders(): void;
  hydrateProviderSnapshot(snapshot: unknown): { completions: number; semanticTokens: number };
} {
  function selectorLanguagesFromSnapshot(selectorRaw: unknown): string[] {
    const selectorList = asArray(selectorRaw) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rawSelector of selectorList) {
      const selector = asRecord(rawSelector);
      const langId = selector && typeof selector.language === 'string' ? selector.language : '';
      if (!langId || seen.has(langId)) continue;
      seen.add(langId);
      out.push(langId);
    }
    return out;
  }

  function getCompletionRegistrations(langId: string): CompletionProviderRegistrationLike[] {
    const languageCache = deps.languageBridge.completionProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function getCompletionRegistrationSignature(entry: CompletionProviderRegistrationLike): string {
    const triggerCharacters = Array.isArray(entry.triggerCharacters) ? entry.triggerCharacters.map(String).sort().join(',') : '';
    return String(entry.handle) + '::' + triggerCharacters + '::' + (entry.supportsResolve ? '1' : '0');
  }

  function ensureCompletionProviderRegistered(langId: string, entry: CompletionProviderRegistrationLike): void {
    const monacoRef = deps.getMonaco();
    if (!monacoRef || !monacoRef.languages || !monacoRef.languages.registerCompletionItemProvider) return;
    if (deps.getLanguageWorkersEnabled()) return;
    const handleKey = entry.handle != null ? String(entry.handle).trim() : '';
    const providerHandle = completionProviderHandleNumber(handleKey);
    if (!handleKey || providerHandle === null) return;

    const providerKey = completionProviderKey(langId, handleKey);
    const nextSignature = getCompletionRegistrationSignature(entry);
    if (
      nextSignature
      && deps.languageBridge.completionProviderSignatureByLanguage[providerKey] === nextSignature
      && deps.languageBridge.completionProviderDisposablesByLanguage[providerKey]
    ) {
      return;
    }

    const existingDisposable = deps.languageBridge.completionProviderDisposablesByLanguage[providerKey];
    if (existingDisposable && typeof existingDisposable.dispose === 'function') {
      try { existingDisposable.dispose(); } catch (_) {}
    }

    const triggerCharacters = Array.isArray(entry.triggerCharacters) ? entry.triggerCharacters.map(String).filter(Boolean) : [];
    const registrationDisposable = monacoRef.languages.registerCompletionItemProvider(langId, {
      __te2WorkbenchProvider: true,
      triggerCharacters,
      provideCompletionItems(model, pos, context, token) {
        try {
          deps.flushMirrorDebounce();
          void token;
          return provideWorkbenchCompletionItemsFromVscodeSuggest({
            providerHandle,
            languageId: langId,
            model,
            position: pos,
            context,
            monacoTriggerKinds: monacoRef.languages.CompletionTriggerKind || null,
            propertyKind: completionPropertyKind(deps),
            adapterTimeoutMs: 8000,
            callTimeoutMs: 10000,
            getCurrentPath: deps.getCurrentPath,
            absPathFromVscodeUri: deps.absPathFromVscodeUri,
            callWorkbenchCompletions(params, opts) {
              return deps.editorWorkbenchCall('completions', params, opts);
            },
          });
        } catch (_) {
          return { suggestions: [] };
        }
      },
    });
    deps.languageBridge.completionProviderDisposablesByLanguage[providerKey] = (
      registrationDisposable && typeof (registrationDisposable as MonacoDisposableLike).dispose === 'function'
        ? registrationDisposable as MonacoDisposableLike
        : null
    );
    deps.languageBridge.completionProviderSignatureByLanguage[providerKey] = nextSignature;
    pruneNativeWorkerCompletionProviders(deps, langId);
    console.log('[completions] registered provider bridge for lang=' + langId + ' handle=' + handleKey + ' triggers=' + triggerCharacters.join(','));
  }

  function ensureCompletionProvidersRegistered(langId: string): void {
    for (const entry of getCompletionRegistrations(langId)) {
      ensureCompletionProviderRegistered(langId, entry);
    }
    pruneNativeWorkerCompletionProviders(deps, langId);
  }

  function cacheCompletionProviderRegistration(langId: string, registration: CompletionProviderRegistrationLike): void {
    if (!langId) return;
    const handleKey = registration.handle != null ? String(registration.handle).trim() : '';
    if (!handleKey) return;
    if (!deps.languageBridge.completionProvidersByLanguage[langId]) {
      deps.languageBridge.completionProvidersByLanguage[langId] = Object.create(null);
    }
    deps.languageBridge.completionProvidersByLanguage[langId][handleKey] = {
      handle: handleKey,
      triggerCharacters: Array.isArray(registration.triggerCharacters) ? registration.triggerCharacters.map(String).filter(Boolean) : [],
      supportsResolve: !!registration.supportsResolve,
    };
    ensureCompletionProvidersRegistered(langId);
  }

  function hydrateProviderSnapshot(snapshot: unknown): { completions: number; semanticTokens: number } {
    const snapshotRecord = asRecord(snapshot);
    let completionCount = 0;
    let semanticTokensCount = 0;
    const completionEntries = asArray(snapshotRecord ? snapshotRecord.completions : null) || [];
    const semanticTokenEntries = asArray(snapshotRecord ? snapshotRecord.semanticTokens : null) || [];

    for (const rawEntry of completionEntries) {
      const entry = asRecord(rawEntry);
      const handle = entry && entry.handle != null ? String(entry.handle).trim() : '';
      if (!handle) continue;
      const triggerCharacters = (asArray(entry ? entry.triggerCharacters : null) || []).map(String).filter(Boolean);
      const supportsResolve = !!(entry && entry.supportsResolve);
      for (const langId of selectorLanguagesFromSnapshot(entry && entry.selector)) {
        cacheCompletionProviderRegistration(langId, {
          handle,
          triggerCharacters,
          supportsResolve,
        });
        completionCount += 1;
      }
    }

    for (const rawEntry of semanticTokenEntries) {
      const entry = asRecord(rawEntry);
      const legend = asRecord(entry && entry.legend);
      if (!legend) continue;
      const tokenTypes = (asArray(legend.tokenTypes) || []).map(String).filter(Boolean);
      const tokenModifiers = (asArray(legend.tokenModifiers) || []).map(String).filter(Boolean);
      if (!tokenTypes.length && !tokenModifiers.length) continue;
      for (const langId of selectorLanguagesFromSnapshot(entry && entry.selector)) {
        registerSemanticTokensWithLegend(
          langId,
          { tokenTypes, tokenModifiers },
          !!(entry && entry.range),
        );
        semanticTokensCount += 1;
      }
    }

    return { completions: completionCount, semanticTokens: semanticTokensCount };
  }

  function registerSemanticTokensWithLegend(
    langId: string,
    legend: SemanticTokensLegendLike,
    isRange?: boolean,
  ): void {
    const monacoRef = deps.getMonaco();
    if (!monacoRef || !monacoRef.languages) return;
    if (deps.languageBridge.registeredSemanticTokens.has(langId)) return;
    deps.languageBridge.registeredSemanticTokens.add(langId);

    if (isRange && monacoRef.languages.registerDocumentRangeSemanticTokensProvider) {
      monacoRef.languages.registerDocumentRangeSemanticTokensProvider(langId, {
        getLegend() {
          return legend;
        },
        provideDocumentRangeSemanticTokens(model, range) {
          try {
            return provideWorkbenchDocumentRangeSemanticTokensFromVscodeMainThread({
              model,
              languageId: langId,
              range,
              adapterTimeoutMs: 10000,
              callTimeoutMs: 12000,
              getCurrentPath: deps.getCurrentPath,
              absPathFromVscodeUri: deps.absPathFromVscodeUri,
              callWorkbenchSemanticTokensRange(params, opts) {
                return deps.editorWorkbenchCall('semantic_tokens_range', params, opts);
              },
            }).catch(() => null);
          } catch (_) {
            return null;
          }
        },
      });
      return;
    }

    console.log('[semanticTokens] registering FULL provider for ' + langId + ' types=' + legend.tokenTypes.length + ' mods=' + legend.tokenModifiers.length);
    if (!monacoRef.languages.registerDocumentSemanticTokensProvider) return;
    monacoRef.languages.registerDocumentSemanticTokensProvider(langId, {
      getLegend() {
        return legend;
      },
      provideDocumentSemanticTokens(model, lastResultId) {
        try {
          const languageId = String(model && model.getLanguageId ? model.getLanguageId() : langId);
          console.log('[semanticTokens] FULL REQUEST ' + languageId + ' prevResultId=' + (lastResultId || '0'));
          return provideWorkbenchDocumentSemanticTokensFromVscodeMainThread({
            model,
            languageId: langId,
            lastResultId,
            adapterTimeoutMs: 10000,
            callTimeoutMs: 12000,
            getCurrentPath: deps.getCurrentPath,
            absPathFromVscodeUri: deps.absPathFromVscodeUri,
            callWorkbenchSemanticTokens(params, opts) {
              return deps.editorWorkbenchCall('semantic_tokens', params, opts);
            },
          }).catch((error) => {
            console.warn('[semanticTokens] request failed', error);
            return null;
          });
        } catch (_) {
          return null;
        }
      },
      releaseDocumentSemanticTokens() {},
    });
  }

  function registerSemanticTokensForLanguage(langId: string): void {
    if (deps.languageBridge.registeredSemanticTokens.has(langId)) return;
    deps.editorWorkbenchCall('semantic_tokens_legend', { languageId: langId }, { timeoutMs: 8000 })
      .then((result) => {
        const payload = extractWorkbenchPayload(result);
        const legendRecord = payload && asRecord(payload.legend);
        const tokenTypes = legendRecord && asArray(legendRecord.tokenTypes);
        const tokenModifiers = legendRecord && asArray(legendRecord.tokenModifiers);
        if (!legendRecord || !tokenTypes || !tokenModifiers) {
          console.warn('[semanticTokens] no legend for ' + langId, result);
          return;
        }
        const legend: SemanticTokensLegendLike = {
          tokenTypes: tokenTypes.map(String),
          tokenModifiers: tokenModifiers.map(String),
        };
        deps.languageBridge.semanticTokensLegendCache[langId] = legend;
        registerSemanticTokensWithLegend(langId, legend);
      })
      .catch((error) => {
        console.warn('[semanticTokens] legend fetch failed for ' + langId, error);
      });
  }

  function installWorkbenchLanguageBridgeProviders(): void {
    try {
      const monacoRef = deps.getMonaco();
      if (!monacoRef || !monacoRef.languages) return;

      const doRegister = (targets: Set<string>) => {
        try {
          targets.forEach((langId) => {
            if (!langId) return;

            if (!deps.languageBridge.registeredHover.has(langId) && monacoRef.languages.registerHoverProvider) {
              console.log('[hover:bridge] registering hover provider for lang=' + langId);
              monacoRef.languages.registerHoverProvider(langId, {
                provideHover(model, pos, token) {
                  try {
                    const ctx = deps.getCurrentLanguageContext();
                    if (!ctx || !model || !model.uri || String(model.uri.toString()) !== String(ctx.uri)) {
                      console.warn('[hover:bridge] BAIL provideHover: ctx=' + (ctx ? 'ok' : 'NULL') + ' m.uri=' + (model && model.uri ? String(model.uri.toString()).slice(-60) : 'NULL') + ' ctx.uri=' + (ctx ? String(ctx.uri).slice(-60) : 'N/A'));
                      return null;
                    }
                    return deps.callWorkbenchProviderGuarded(
                      'hover',
                      'vscode.hover',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                        column: Number(pos && pos.column ? pos.column : 1),
                        timeoutMs: 4500,
                      },
                      ctx,
                      { timeoutMs: 5000, cancelToken: token },
                    ).then((out) => {
                      const payload = out.ok ? extractGuardedPayload(out) : null;
                      if (!payload) return null;
                      const hoverPayload = asRecord(payload.result) || asRecord(payload.hover) || payload;
                      if (!hoverPayload) return null;
                      const range = deps.monacoRangeFromProtoRange(hoverPayload.range);
                      const contents = deps.toMonacoHoverContents(hoverPayload.contents);
                      if (!contents.length) return null;
                      return { range: range || undefined, contents };
                    });
                  } catch (_) {
                    return null;
                  }
                },
              });
              deps.languageBridge.registeredHover.add(langId);
            }

            if (!deps.languageBridge.registeredSymbols.has(langId) && monacoRef.languages.registerDocumentSymbolProvider) {
              monacoRef.languages.registerDocumentSymbolProvider(documentSymbolProviderSelector(deps, langId), {
                provideDocumentSymbols(model, token) {
                  try {
                    const ctx = deps.getCurrentLanguageContext();
                    if (!ctx || !model || !model.uri || String(model.uri.toString()) !== String(ctx.uri)) return [];
                    return deps.callWorkbenchProviderGuarded(
                      'symbols',
                      'vscode.documentSymbols',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        timeoutMs: 6000,
                      },
                      ctx,
                      { timeoutMs: 6500, cancelToken: token },
                    ).then((out) => {
                      if (!out || !out.ok) return [];
                      const payload = extractGuardedPayload(out);
                      const items = payload && asArray(payload.result ? payload.result : payload);
                      return normalizeDocumentSymbols(deps, items || []);
                    });
                  } catch (_) {
                    return [];
                  }
                },
              });
              deps.languageBridge.registeredSymbols.add(langId);
            }

            if (!deps.languageBridge.registeredFolding.has(langId) && monacoRef.languages.registerFoldingRangeProvider) {
              monacoRef.languages.registerFoldingRangeProvider(foldingRangeProviderSelector(deps, langId), {
                provideFoldingRanges(model, context, token) {
                  try {
                    const ctx = deps.getCurrentLanguageContext();
                    if (!ctx || !model || !model.uri || String(model.uri.toString()) !== String(ctx.uri)) return null;
                    return deps.callWorkbenchProviderGuarded(
                      'folding_ranges',
                      'vscode.foldingRanges',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        context: context && typeof context === 'object' ? context : {},
                        timeoutMs: 6000,
                      },
                      ctx,
                      { timeoutMs: 6500, cancelToken: token },
                    ).then((out) => {
                      if (!out || !out.ok) return null;
                      const payload = extractGuardedPayload(out);
                      const raw = payload ? (payload.result !== undefined ? payload.result : payload) : null;
                      return normalizeFoldingRanges(deps, raw);
                    });
                  } catch (_) {
                    return null;
                  }
                },
              });
              deps.languageBridge.registeredFolding.add(langId);
            }
            ensureCompletionProvidersRegistered(langId);
          });
        } catch (_) {}
      };

      const immediate = new Set<string>();
      try {
        const ctx = deps.getCurrentLanguageContext();
        if (ctx && ctx.languageId) immediate.add(String(ctx.languageId));
      } catch (_) {}
      console.log('[hover:bridge] installWorkbenchLanguageBridgeProviders immediate=' + Array.from(immediate).join(',') + ' model=' + (deps.getHasModel() ? 'yes' : 'no') + ' registeredHover=' + Array.from(deps.languageBridge.registeredHover).join(','));
      if (immediate.size) {
        doRegister(immediate);
        immediate.forEach((langId) => {
          try {
            ensureCompletionProvidersRegistered(langId);
          } catch (_) {}
          try {
            registerSemanticTokensForLanguage(langId);
          } catch (_) {}
        });
      }

      deps.ensureWorkbenchLanguageCatalogInstalled().then(() => {
        try {
          const all = new Set<string>();
          for (const id of deps.getWorkbenchLanguageIds()) {
            if (id) all.add(id);
          }
          try {
            const ctx = deps.getCurrentLanguageContext();
            if (ctx && ctx.languageId) all.add(String(ctx.languageId));
          } catch (_) {}
          doRegister(all);
          all.forEach((langId) => {
            try {
              ensureCompletionProvidersRegistered(langId);
            } catch (_) {}
          });
        } catch (_) {}
      }).catch(() => {});
    } catch (_) {}
  }

  return {
    cacheCompletionProviderRegistration,
    registerSemanticTokensWithLegend,
    installWorkbenchLanguageBridgeProviders,
    hydrateProviderSnapshot,
  };
}
