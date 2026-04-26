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
    triggerCharacters?: string[];
    provideCompletionItems(model: MonacoModelLike, pos: MonacoPositionLike, token: MonacoCancellationTokenLike, context: MonacoCompletionContextLike): unknown;
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
  languages: MonacoLanguagesLike;
}

interface CreateEditorLanguageBridgeProvidersDeps {
  getMonaco(): MonacoLike | null;
  getLanguageWorkersEnabled(): boolean;
  getCurrentPath(): string | null;
  getHasModel(): boolean;
  getCurrentLanguageContext(): LanguageContext | null;
  callWorkbenchProviderGuarded(
    kind: 'hover' | 'symbols' | 'folding_ranges' | 'completions',
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
  monacoRangeFromCompletionRange(range: unknown, pos: MonacoPositionLike): unknown;
  mapCompletionItemKind(kind: unknown): number;
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

export function createEditorLanguageBridgeProviders(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): {
  cacheCompletionProviderRegistration(langId: string, registration: CompletionProviderRegistrationLike): void;
  registerSemanticTokensWithLegend(langId: string, legend: SemanticTokensLegendLike, isRange?: boolean): void;
  installWorkbenchLanguageBridgeProviders(): void;
} {
  function getCompletionRegistrations(langId: string): CompletionProviderRegistrationLike[] {
    const languageCache = deps.languageBridge.completionProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function getCompletionTriggerCharacters(langId: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of getCompletionRegistrations(langId)) {
      const triggerChars = Array.isArray(entry.triggerCharacters) ? entry.triggerCharacters : [];
      for (const triggerChar of triggerChars) {
        const ch = String(triggerChar || '');
        if (!ch || seen.has(ch)) continue;
        seen.add(ch);
        out.push(ch);
      }
    }
    return out;
  }

  function getCompletionRegistrationSignature(langId: string): string {
    return getCompletionRegistrations(langId)
      .map((entry) => {
        const triggerCharacters = Array.isArray(entry.triggerCharacters) ? entry.triggerCharacters.map(String).sort().join(',') : '';
        return String(entry.handle) + '::' + triggerCharacters + '::' + (entry.supportsResolve ? '1' : '0');
      })
      .sort()
      .join('|');
  }

  function ensureCompletionProviderRegistered(langId: string): void {
    const monacoRef = deps.getMonaco();
    if (!monacoRef || !monacoRef.languages || !monacoRef.languages.registerCompletionItemProvider) return;
    if (!getCompletionRegistrations(langId).length) return;

    const nextSignature = getCompletionRegistrationSignature(langId);
    if (
      nextSignature
      && deps.languageBridge.completionProviderSignatureByLanguage[langId] === nextSignature
      && deps.languageBridge.completionProviderDisposablesByLanguage[langId]
    ) {
      return;
    }

    const existingDisposable = deps.languageBridge.completionProviderDisposablesByLanguage[langId];
    if (existingDisposable && typeof existingDisposable.dispose === 'function') {
      try { existingDisposable.dispose(); } catch (_) {}
    }

    const triggerCharacters = getCompletionTriggerCharacters(langId);
    const registrationDisposable = monacoRef.languages.registerCompletionItemProvider(langId, {
      triggerCharacters,
      provideCompletionItems(model, pos, token, context) {
        try {
          deps.flushMirrorDebounce();
          const ctx = deps.getCurrentLanguageContext();
          if (!ctx || !model || !model.uri || String(model.uri.toString()) !== String(ctx.uri)) {
            return { suggestions: [] };
          }
          let triggerKind = 0;
          let triggerCharacter: string | undefined;
          const triggerKinds = monacoRef.languages.CompletionTriggerKind;
          if (context && triggerKinds && context.triggerKind === triggerKinds.TriggerCharacter) {
            triggerKind = 1;
            triggerCharacter = context.triggerCharacter || undefined;
          } else if (context && triggerKinds && context.triggerKind === triggerKinds.TriggerForIncompleteCompletions) {
            triggerKind = 2;
          }
          return deps.callWorkbenchProviderGuarded(
            'completions',
            'vscode.completions',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                        column: Number(pos && pos.column ? pos.column : 1),
                        triggerKind,
                        triggerCharacter,
                        timeoutMs: 8000,
                      },
                      ctx,
            { timeoutMs: 10000, cancelToken: token },
          ).then((out) => {
            if (!out || !out.ok) return { suggestions: [] };
            const payload = extractGuardedPayload(out);
            const root = payload && (asRecord(payload.result) || payload);
            const rawItems = root ? (asArray(root.items) || asArray(root.suggestions) || []) : [];
            const suggestions: Array<Record<string, unknown>> = [];
            for (const rawItem of rawItems) {
              const item = asRecord(rawItem);
              if (!item) continue;
              const suggestion: Record<string, unknown> = {
                label: item.label || '',
                kind: deps.mapCompletionItemKind(item.kind),
                detail: item.detail || undefined,
                documentation: item.documentation || undefined,
                sortText: item.sortText || undefined,
                filterText: item.filterText || undefined,
                preselect: item.preselect || undefined,
                insertText: item.insertText || (typeof item.label === 'string' ? item.label : ''),
                insertTextRules: item.insertTextRules || undefined,
                range: deps.monacoRangeFromCompletionRange(item.range, pos),
                commitCharacters: item.commitCharacters || undefined,
                additionalTextEdits: item.additionalTextEdits || undefined,
                tags: item.tags || undefined,
              };
              const command = asRecord(item.command);
              if (command) {
                suggestion.command = {
                  id: command.id || '',
                  title: command.title || command.id || '',
                  arguments: command.arguments || undefined,
                };
              }
              suggestions.push(suggestion);
            }
            return {
              suggestions,
              incomplete: !!(root && root.isIncomplete),
            };
          });
        } catch (_) {
          return { suggestions: [] };
        }
      },
    });
    deps.languageBridge.completionProviderDisposablesByLanguage[langId] = (
      registrationDisposable && typeof (registrationDisposable as MonacoDisposableLike).dispose === 'function'
        ? registrationDisposable as MonacoDisposableLike
        : null
    );
    deps.languageBridge.completionProviderSignatureByLanguage[langId] = nextSignature;
    console.log('[completions] registered provider bridge for lang=' + langId + ' triggers=' + triggerCharacters.join(','));
  }

  function cacheCompletionProviderRegistration(langId: string, registration: CompletionProviderRegistrationLike): void {
    if (!langId) return;
    const handleKey = String(registration.handle || '').trim();
    if (!handleKey) return;
    if (!deps.languageBridge.completionProvidersByLanguage[langId]) {
      deps.languageBridge.completionProvidersByLanguage[langId] = Object.create(null);
    }
    deps.languageBridge.completionProvidersByLanguage[langId][handleKey] = {
      handle: handleKey,
      triggerCharacters: Array.isArray(registration.triggerCharacters) ? registration.triggerCharacters.map(String).filter(Boolean) : [],
      supportsResolve: !!registration.supportsResolve,
    };
    ensureCompletionProviderRegistered(langId);
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
            if (!model || !model.uri || !range) return null;
            const uri = String(model.uri.toString());
            const path = deps.getCurrentPath() ? String(deps.getCurrentPath()) : deps.absPathFromVscodeUri(uri);
            const languageId = String(model.getLanguageId ? model.getLanguageId() : langId);
            return deps.editorWorkbenchCall(
              'semantic_tokens_range',
              {
                uri,
                path,
                languageId,
                range: {
                  startLineNumber: range.startLineNumber,
                  startColumn: range.startColumn,
                  endLineNumber: range.endLineNumber,
                  endColumn: range.endColumn,
                },
                timeoutMs: 10000,
              },
              { timeoutMs: 12000 },
            ).then((out) => {
              const payload = extractWorkbenchPayload(out);
              const data = payload && asArray(payload.data);
              if (!payload || !data || !data.length) return null;
              return {
                resultId: typeof payload.resultId === 'string' ? payload.resultId : '',
                data: new Uint32Array(data as number[]),
              };
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
          if (!model || !model.uri) return null;
          const uri = String(model.uri.toString());
          const path = deps.getCurrentPath() ? String(deps.getCurrentPath()) : deps.absPathFromVscodeUri(uri);
          const languageId = String(model.getLanguageId ? model.getLanguageId() : langId);
          console.log('[semanticTokens] FULL REQUEST ' + languageId + ' path=' + path + ' prevResultId=' + (lastResultId || '0'));
          return deps.editorWorkbenchCall(
            'semantic_tokens',
            {
              uri,
              path,
              languageId,
              previousResultId: lastResultId || '0',
              timeoutMs: 10000,
            },
            { timeoutMs: 12000 },
          ).then((out) => {
            const payload = extractWorkbenchPayload(out);
            if (!payload) return null;
            const edits = asArray(payload.edits);
            if (payload.type === 'delta' && edits) {
              return {
                resultId: typeof payload.resultId === 'string' ? payload.resultId : '',
                edits: edits.map((edit) => {
                  const e = asRecord(edit);
                  const editData = asArray(e && e.data);
                  return {
                    start: Number(e && e.start ? e.start : 0),
                    deleteCount: Number(e && e.deleteCount ? e.deleteCount : 0),
                    data: editData ? new Uint32Array(editData as number[]) : undefined,
                  };
                }),
              };
            }
            const data = asArray(payload.data);
            if (!data || !data.length) return null;
            return {
              resultId: typeof payload.resultId === 'string' ? payload.resultId : '',
              data: new Uint32Array(data as number[]),
            };
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
            ensureCompletionProviderRegistered(langId);
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
            ensureCompletionProviderRegistered(langId);
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
              ensureCompletionProviderRegistered(langId);
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
  };
}
