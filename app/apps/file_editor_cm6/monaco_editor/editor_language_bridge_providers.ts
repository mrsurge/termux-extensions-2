import { provideWorkbenchCompletionItemsFromVscodeSuggest } from "./vscode_completion_vendor/suggest.js";
import {
  provideWorkbenchInlayHintsFromVscodeMainThread,
  resolveWorkbenchInlayHintFromVscodeMainThread,
} from "./vscode_document_intelligence_vendor/inlayHints.ts";
import {
  freeWorkbenchInlineCompletionsFromVscodeMainThread,
  notifyWorkbenchInlineCompletionDidShowFromVscodeMainThread,
  provideWorkbenchInlineCompletionsFromVscodeMainThread,
} from "./vscode_document_intelligence_vendor/inlineCompletions.ts";
import {
  provideWorkbenchDocumentRangeSemanticTokensFromVscodeMainThread,
  provideWorkbenchDocumentSemanticTokensFromVscodeMainThread,
} from "./vscode_document_intelligence_vendor/semanticTokens.js";

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
  semanticTokensChangeEmittersByLanguage: Record<
    string,
    SemanticTokensChangeEmitterLike
  >;
  semanticTokensLanguagesByEventHandle: Record<string, string[]>;
  completionProvidersByLanguage: Record<
    string,
    Record<string, CompletionProviderRegistrationLike>
  >;
  completionProviderDisposablesByLanguage: Record<
    string,
    MonacoDisposableLike | null
  >;
  completionProviderSignatureByLanguage: Record<string, string>;
  documentColorProvidersByLanguage: Record<
    string,
    Record<string, DocumentColorProviderRegistrationLike>
  >;
  documentColorProviderDisposablesByLanguage: Record<
    string,
    MonacoDisposableLike | null
  >;
  documentColorProviderSignatureByLanguage: Record<string, string>;
  inlayHintsProvidersByLanguage: Record<
    string,
    Record<string, InlayHintsProviderRegistrationLike>
  >;
  inlayHintsProviderDisposablesByKey: Record<
    string,
    MonacoDisposableLike | null
  >;
  inlayHintsProviderSignatureByKey: Record<string, string>;
  inlineCompletionProvidersByLanguage: Record<
    string,
    Record<string, InlineCompletionProviderRegistrationLike>
  >;
  inlineCompletionProviderDisposablesByKey: Record<
    string,
    MonacoDisposableLike | null
  >;
  inlineCompletionProviderSignatureByKey: Record<string, string>;
  semanticTokensLegendCache: Record<string, SemanticTokensLegendLike>;
  semanticTokensRangeFlag: Record<string, boolean>;
}

interface CompletionProviderRegistrationLike {
  handle: string;
  triggerCharacters: string[];
  supportsResolve: boolean;
}

interface DocumentColorProviderRegistrationLike {
  handle: string;
}

interface InlayHintsProviderRegistrationLike {
  handle: string;
  supportsResolve: boolean;
  displayName?: string | null;
  eventHandle?: number | null;
}

interface InlineCompletionProviderRegistrationLike {
  handle: string;
  supportsHandleEvents: boolean;
  extensionId?: string | null;
  extensionVersion?: string | null;
  groupId?: string | null;
  yieldsToGroupIds: string[];
  excludesGroupIds: string[];
  displayName?: string | null;
  debounceDelayMs?: number | null;
  eventHandle?: number | null;
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

interface MonacoColorLike {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

interface MonacoColorInformationLike {
  color?: MonacoColorLike;
  range?: MonacoRangeLike;
}

interface MonacoInlineCompletionContextLike extends Record<string, unknown> {
  triggerKind?: number;
}

interface MonacoDisposableLike {
  dispose(): void;
}

interface SemanticTokensChangeEmitterLike {
  event(listener: () => void): MonacoDisposableLike;
  fire(): void;
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
  registerHoverProvider?: (
    selector: unknown,
    provider: {
      provideHover(
        model: MonacoModelLike,
        pos: MonacoPositionLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => unknown;
  registerDocumentSymbolProvider?: (
    selector: unknown,
    provider: {
      provideDocumentSymbols(
        model: MonacoModelLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => unknown;
  registerFoldingRangeProvider?: (
    selector: unknown,
    provider: {
      provideFoldingRanges(
        model: MonacoModelLike,
        context: unknown,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => unknown;
  registerCompletionItemProvider?: (
    selector: unknown,
    provider: {
      __te2WorkbenchProvider?: true;
      triggerCharacters?: string[];
      provideCompletionItems(
        model: MonacoModelLike,
        pos: MonacoPositionLike,
        context: MonacoCompletionContextLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => MonacoDisposableLike | unknown;
  registerInlayHintsProvider?: (
    selector: unknown,
    provider: {
      displayName?: string;
      provideInlayHints(
        model: MonacoModelLike,
        range: MonacoRangeLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
      resolveInlayHint?(
        hint: Record<string, unknown>,
        token: MonacoCancellationTokenLike,
      ): unknown;
      onDidChangeInlayHints?: unknown;
    },
  ) => MonacoDisposableLike | unknown;
  registerColorProvider?: (
    selector: unknown,
    provider: {
      __te2WorkbenchColorProvider?: true;
      provideDocumentColors(
        model: MonacoModelLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
      provideColorPresentations(
        model: MonacoModelLike,
        colorInfo: MonacoColorInformationLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => MonacoDisposableLike | unknown;
  registerInlineCompletionsProvider?: (
    selector: unknown,
    provider: {
      provideInlineCompletions(
        model: MonacoModelLike,
        position: MonacoPositionLike,
        context: MonacoInlineCompletionContextLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
      handleItemDidShow?(
        completions: Record<string, unknown>,
        item: Record<string, unknown>,
        updatedInsertText: string,
        editDeltaInfo: unknown,
      ): unknown;
      disposeInlineCompletions(
        completions: Record<string, unknown>,
        reason: Record<string, unknown>,
      ): void;
      groupId?: string;
      yieldsToGroupIds?: string[];
      excludesGroupIds?: string[];
      displayName?: string;
      debounceDelayMs?: number;
      toString?(): string;
    },
  ) => MonacoDisposableLike | unknown;
  registerDocumentRangeSemanticTokensProvider?: (
    selector: unknown,
    provider: {
      onDidChange?: (listener: () => void) => MonacoDisposableLike;
      getLegend(): SemanticTokensLegendLike;
      provideDocumentRangeSemanticTokens(
        model: MonacoModelLike,
        range: MonacoRangeLike,
        token: MonacoCancellationTokenLike,
      ): unknown;
    },
  ) => unknown;
  registerDocumentSemanticTokensProvider?: (
    selector: unknown,
    provider: {
      onDidChange?: (listener: () => void) => MonacoDisposableLike;
      getLegend(): SemanticTokensLegendLike;
      provideDocumentSemanticTokens(
        model: MonacoModelLike,
        lastResultId: string | null | undefined,
        token: MonacoCancellationTokenLike,
      ): unknown;
      releaseDocumentSemanticTokens(resultId: string): void;
    },
  ) => unknown;
}

interface MonacoLike {
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => unknown;
  editor?: {
    getEditors?: () => unknown[];
  };
  languages: MonacoLanguagesLike;
}

interface MonacoLanguageFeatureRegistryLike extends Record<string, unknown> {
  _entries?: unknown[];
  _lastCandidate?: unknown;
}

const prunedNativeCompletionLanguages = new Set<string>();
const prunedNativeColorLanguages = new Set<string>();

interface CreateEditorLanguageBridgeProvidersDeps {
  getMonaco(): MonacoLike | null;
  getLanguageWorkersEnabled(): boolean;
  getDisableSemanticTokens(): boolean;
  getCurrentPath(): string | null;
  getHasModel(): boolean;
  getCurrentLanguageContext(): LanguageContext | null;
  callWorkbenchProviderGuarded(
    kind: "hover" | "symbols" | "folding_ranges",
    method: string,
    params: Record<string, unknown>,
    ctx: LanguageContext | null,
    opts?: {
      timeoutMs?: number;
      cancelToken?: MonacoCancellationTokenLike | null;
    },
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
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function documentSymbolProviderSelector(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  langId: string,
): unknown {
  if (deps.getLanguageWorkersEnabled()) return langId;
  return { language: langId, scheme: "file", exclusive: true };
}

function foldingRangeProviderSelector(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  langId: string,
): unknown {
  if (deps.getLanguageWorkersEnabled()) return langId;
  return { language: langId, scheme: "file", exclusive: true };
}

function normalizeDocumentSymbols(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  raw: unknown,
): unknown[] {
  const input = asArray(raw);
  const monacoRef = deps.getMonaco();
  if (!input || !monacoRef || !monacoRef.languages) return [];

  const defaultKind =
    monacoRef.languages.SymbolKind &&
    typeof monacoRef.languages.SymbolKind.Function === "number"
      ? monacoRef.languages.SymbolKind.Function
      : 11;

  const mapOne = (item: unknown): unknown => {
    const symbol = asRecord(item);
    const location = asRecord(symbol && symbol.location);
    const protoRange =
      symbol && symbol.range !== undefined
        ? symbol.range
        : location
          ? location.range
          : null;
    const range = deps.monacoRangeFromProtoRange(protoRange);
    const selectionRange = deps.monacoRangeFromProtoRange(
      symbol && symbol.selectionRange !== undefined
        ? symbol.selectionRange
        : protoRange,
    );
    const children = asArray(symbol && symbol.children)
      ? (symbol!.children as unknown[]).map(mapOne)
      : [];

    let detail = symbol && symbol.detail != null ? String(symbol.detail) : "";
    if (!detail && symbol && symbol.containerName != null)
      detail = String(symbol.containerName);

    return {
      name: String((symbol && symbol.name) || ""),
      detail,
      kind: Number(symbol && symbol.kind != null ? symbol.kind : defaultKind),
      tags: asArray(symbol && symbol.tags) || [],
      range: range || new monacoRef.Range(1, 1, 1, 1),
      selectionRange:
        selectionRange || range || new monacoRef.Range(1, 1, 1, 1),
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
  const foldingKinds =
    monacoRef && monacoRef.languages
      ? monacoRef.languages.FoldingRangeKind
      : null;
  if (!kind || !foldingKinds) return undefined;

  let value = "";
  if (typeof kind === "string") value = kind;
  else {
    const kindRecord = asRecord(kind);
    if (kindRecord && typeof kindRecord.value === "string")
      value = kindRecord.value;
  }
  if (!value) return undefined;
  if (typeof foldingKinds.fromValue === "function")
    return foldingKinds.fromValue(value);
  if (value === "comment" && foldingKinds.Comment) return foldingKinds.Comment;
  if (value === "imports" && foldingKinds.Imports) return foldingKinds.Imports;
  if (value === "region" && foldingKinds.Region) return foldingKinds.Region;
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
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 1 ||
      end <= start
    )
      continue;
    const normalized: Record<string, unknown> = { start, end };
    const kind = monacoFoldingRangeKindFromProto(deps, range && range.kind);
    if (kind) normalized.kind = kind;
    out.push(normalized);
  }
  return out;
}

function extractGuardedPayload(
  result: GuardedCallResult,
): Record<string, unknown> | null {
  const direct = asRecord(result.result);
  return direct;
}

function extractWorkbenchPayload(
  result: unknown,
): Record<string, unknown> | null {
  const record = asRecord(result);
  if (!record) return null;
  const inner = asRecord(record.result);
  return inner || record;
}

function completionPropertyKind(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): number {
  const monacoRef = deps.getMonaco();
  return monacoRef &&
    monacoRef.languages &&
    monacoRef.languages.CompletionItemKind &&
    typeof monacoRef.languages.CompletionItemKind.Property === "number"
    ? monacoRef.languages.CompletionItemKind.Property
    : 9;
}

function iterablePairs(value: unknown): Iterable<[unknown, unknown]> | null {
  const candidate = value as { [Symbol.iterator]?: unknown } | null | undefined;
  return candidate && typeof candidate[Symbol.iterator] === "function"
    ? (candidate as Iterable<[unknown, unknown]>)
    : null;
}

function completionRegistryFromActiveEditor(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): MonacoLanguageFeatureRegistryLike | null {
  const monacoRef = deps.getMonaco();
  const editors =
    monacoRef &&
    monacoRef.editor &&
    typeof monacoRef.editor.getEditors === "function"
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
      if (String(key) !== "ILanguageFeaturesService") continue;
      const languageFeatures = asRecord(value);
      const completionProvider = asRecord(
        languageFeatures && languageFeatures.completionProvider,
      ) as MonacoLanguageFeatureRegistryLike | null;
      if (completionProvider && Array.isArray(completionProvider._entries))
        return completionProvider;
    }
  }
  return null;
}

function colorRegistryFromActiveEditor(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): MonacoLanguageFeatureRegistryLike | null {
  const monacoRef = deps.getMonaco();
  const editors =
    monacoRef &&
    monacoRef.editor &&
    typeof monacoRef.editor.getEditors === "function"
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
      if (String(key) !== "ILanguageFeaturesService") continue;
      const languageFeatures = asRecord(value);
      const colorProvider = asRecord(
        languageFeatures && languageFeatures.colorProvider,
      ) as MonacoLanguageFeatureRegistryLike | null;
      if (colorProvider && Array.isArray(colorProvider._entries))
        return colorProvider;
    }
  }
  return null;
}

function selectorMatchesLanguage(selector: unknown, langId: string): boolean {
  if (Array.isArray(selector)) {
    return selector.some((item) => selectorMatchesLanguage(item, langId));
  }
  if (typeof selector === "string") return selector === langId;
  const selectorRecord = asRecord(selector);
  return !!selectorRecord && selectorRecord.language === langId;
}

function documentColorProviderSelector(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  langId: string,
): unknown {
  if (deps.getLanguageWorkersEnabled()) return langId;
  return { language: langId, scheme: "file", exclusive: true };
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
      entry &&
      provider &&
      Object.prototype.hasOwnProperty.call(provider, "_worker") &&
      selectorMatchesLanguage(entry.selector, langId)
    ) {
      entries.splice(i, 1);
      removed += 1;
    }
  }

  if (removed > 0) {
    registry._lastCandidate = undefined;
    if (!prunedNativeCompletionLanguages.has(langId)) {
      prunedNativeCompletionLanguages.add(langId);
      console.log(
        "[completions] pruned native Monaco worker completion provider for lang=" +
          langId +
          " count=" +
          removed,
      );
    }
  }
  return removed;
}

function pruneNativeWorkerColorProviders(
  deps: CreateEditorLanguageBridgeProvidersDeps,
  langId: string,
): number {
  if (deps.getLanguageWorkersEnabled()) return 0;
  const registry = colorRegistryFromActiveEditor(deps);
  if (!registry || !Array.isArray(registry._entries)) return 0;
  const entries = registry._entries;

  let removed = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = asRecord(entries[i]);
    const provider = asRecord(entry && entry.provider);
    if (
      entry &&
      provider &&
      Object.prototype.hasOwnProperty.call(provider, "_worker") &&
      selectorMatchesLanguage(entry.selector, langId)
    ) {
      entries.splice(i, 1);
      removed += 1;
    }
  }

  if (removed > 0) {
    registry._lastCandidate = undefined;
    if (!prunedNativeColorLanguages.has(langId)) {
      prunedNativeColorLanguages.add(langId);
      console.log(
        "[documentColors] pruned native Monaco worker color provider for lang=" +
          langId +
          " count=" +
          removed,
      );
    }
  }
  return removed;
}

export function createEditorLanguageBridgeProviders(
  deps: CreateEditorLanguageBridgeProvidersDeps,
): {
  cacheCompletionProviderRegistration(
    langId: string,
    registration: CompletionProviderRegistrationLike,
  ): void;
  cacheDocumentColorProviderRegistration(
    langId: string,
    registration: DocumentColorProviderRegistrationLike,
  ): void;
  cacheInlayHintsProviderRegistration(
    langId: string,
    registration: InlayHintsProviderRegistrationLike,
  ): void;
  cacheInlineCompletionProviderRegistration(
    langId: string,
    registration: InlineCompletionProviderRegistrationLike,
  ): void;
  registerSemanticTokensWithLegend(
    langId: string,
    legend: SemanticTokensLegendLike,
    isRange?: boolean,
  ): void;
  fireSemanticTokensChanged(langId?: string | null): void;
  resetDynamicProviderCaches(reason?: string): void;
  installWorkbenchLanguageBridgeProviders(): void;
  hydrateProviderSnapshot(snapshot: unknown): {
    completions: number;
    documentColors: number;
    inlayHints: number;
    inlineCompletions: number;
    semanticTokens: number;
  };
} {
  let semanticTokensDisableLogged = false;

  function logSemanticTokensDisabledOnce(): void {
    if (semanticTokensDisableLogged) return;
    semanticTokensDisableLogged = true;
    try {
      console.log("[semanticTokens] disabled by __debugDisableSemanticTokens");
    } catch (_) {}
  }

  function createSemanticTokensChangeEmitter(): SemanticTokensChangeEmitterLike {
    const listeners = new Set<() => void>();
    return {
      event(listener: () => void): MonacoDisposableLike {
        listeners.add(listener);
        return {
          dispose(): void {
            listeners.delete(listener);
          },
        };
      },
      fire(): void {
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch (_) {}
        }
      },
    };
  }

  function semanticTokensChangeEmitterForLanguage(
    langId: string,
  ): SemanticTokensChangeEmitterLike {
    const key = String(langId || "");
    let emitter =
      deps.languageBridge.semanticTokensChangeEmittersByLanguage[key];
    if (!emitter) {
      emitter = createSemanticTokensChangeEmitter();
      deps.languageBridge.semanticTokensChangeEmittersByLanguage[key] = emitter;
    }
    return emitter;
  }

  function fireSemanticTokensChanged(langId?: string | null): void {
    if (langId) {
      const emitter =
        deps.languageBridge.semanticTokensChangeEmittersByLanguage[
          String(langId)
        ];
      if (emitter) {
        try {
          console.log(
            "[semanticTokens] invalidating provider for " + String(langId),
          );
        } catch (_) {}
        emitter.fire();
      }
      return;
    }
    for (const key of Object.keys(
      deps.languageBridge.semanticTokensChangeEmittersByLanguage,
    )) {
      const emitter =
        deps.languageBridge.semanticTokensChangeEmittersByLanguage[key];
      if (!emitter) continue;
      try {
        console.log("[semanticTokens] invalidating provider for " + key);
      } catch (_) {}
      emitter.fire();
    }
  }

  function selectorLanguagesFromSnapshot(selectorRaw: unknown): string[] {
    const selectorList = asArray(selectorRaw) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rawSelector of selectorList) {
      const selector = asRecord(rawSelector);
      const langId =
        selector && typeof selector.language === "string"
          ? selector.language
          : "";
      if (!langId || seen.has(langId)) continue;
      seen.add(langId);
      out.push(langId);
    }
    return out;
  }

  function disposeProviderRecord(
    record: Record<string, MonacoDisposableLike | null>,
  ): void {
    for (const disposable of Object.values(record)) {
      if (disposable && typeof disposable.dispose === "function") {
        try {
          disposable.dispose();
        } catch (_) {}
      }
    }
  }

  function getCompletionRegistrations(
    langId: string,
  ): CompletionProviderRegistrationLike[] {
    const languageCache =
      deps.languageBridge.completionProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function getCompletionRegistrationSignature(
    entry: CompletionProviderRegistrationLike,
  ): string {
    const triggerCharacters = Array.isArray(entry.triggerCharacters)
      ? entry.triggerCharacters.map(String).sort().join(",")
      : "";
    return (
      String(entry.handle) +
      "::" +
      triggerCharacters +
      "::" +
      (entry.supportsResolve ? "1" : "0")
    );
  }

  function getCompletionProviderSignature(
    entries: CompletionProviderRegistrationLike[],
  ): string {
    return entries.map(getCompletionRegistrationSignature).sort().join("|");
  }

  function getCompletionProviderTriggerCharacters(
    entries: CompletionProviderRegistrationLike[],
  ): string[] {
    const seen = new Set<string>();
    const triggers: string[] = [];
    for (const entry of entries) {
      const triggerCharacters = Array.isArray(entry.triggerCharacters)
        ? entry.triggerCharacters
        : [];
      for (const trigger of triggerCharacters) {
        const normalized = String(trigger);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        triggers.push(normalized);
      }
    }
    return triggers;
  }

  function getCompletionProviderHandles(
    entries: CompletionProviderRegistrationLike[],
  ): string[] {
    return entries
      .map((entry) => String(entry.handle || "").trim())
      .filter(Boolean)
      .sort((left, right) => Number(left) - Number(right));
  }

  function ensureCompletionProviderRegistered(langId: string): void {
    const monacoRef = deps.getMonaco();
    if (
      !monacoRef ||
      !monacoRef.languages ||
      !monacoRef.languages.registerCompletionItemProvider
    )
      return;
    if (deps.getLanguageWorkersEnabled()) return;
    const entries = getCompletionRegistrations(langId);
    if (!entries.length) return;
    const handles = getCompletionProviderHandles(entries);
    if (!handles.length) return;
    const nextSignature = getCompletionProviderSignature(entries);
    if (
      nextSignature &&
      deps.languageBridge.completionProviderSignatureByLanguage[langId] ===
        nextSignature &&
      deps.languageBridge.completionProviderDisposablesByLanguage[langId]
    ) {
      return;
    }

    const existingDisposable =
      deps.languageBridge.completionProviderDisposablesByLanguage[langId];
    if (
      existingDisposable &&
      typeof existingDisposable.dispose === "function"
    ) {
      try {
        existingDisposable.dispose();
      } catch (_) {}
    }

    const triggerCharacters = getCompletionProviderTriggerCharacters(entries);
    const registrationDisposable =
      monacoRef.languages.registerCompletionItemProvider(langId, {
        __te2WorkbenchProvider: true,
        triggerCharacters,
        provideCompletionItems(model, pos, context, token) {
          try {
            deps.flushMirrorDebounce();
            void token;
            return provideWorkbenchCompletionItemsFromVscodeSuggest({
              languageId: langId,
              model,
              position: pos,
              context,
              monacoTriggerKinds:
                monacoRef.languages.CompletionTriggerKind || null,
              propertyKind: completionPropertyKind(deps),
              adapterTimeoutMs: 8000,
              callTimeoutMs: 10000,
              getCurrentPath: deps.getCurrentPath,
              absPathFromVscodeUri: deps.absPathFromVscodeUri,
              callWorkbenchCompletions(params, opts) {
                return deps.editorWorkbenchCall("completions", params, opts);
              },
            });
          } catch (_) {
            return { suggestions: [] };
          }
        },
      });
    deps.languageBridge.completionProviderDisposablesByLanguage[langId] =
      registrationDisposable &&
      typeof (registrationDisposable as MonacoDisposableLike).dispose ===
        "function"
        ? (registrationDisposable as MonacoDisposableLike)
        : null;
    deps.languageBridge.completionProviderSignatureByLanguage[langId] =
      nextSignature;
    pruneNativeWorkerCompletionProviders(deps, langId);
    console.log(
      "[completions] registered aggregated provider bridge for lang=" +
        langId +
        " handles=" +
        handles.join(",") +
        " triggers=" +
        triggerCharacters.join(","),
    );
  }

  function ensureCompletionProvidersRegistered(langId: string): void {
    ensureCompletionProviderRegistered(langId);
    pruneNativeWorkerCompletionProviders(deps, langId);
  }

  function cacheCompletionProviderRegistration(
    langId: string,
    registration: CompletionProviderRegistrationLike,
  ): void {
    if (!langId) return;
    const handleKey =
      registration.handle != null ? String(registration.handle).trim() : "";
    if (!handleKey) return;
    if (!deps.languageBridge.completionProvidersByLanguage[langId]) {
      deps.languageBridge.completionProvidersByLanguage[langId] =
        Object.create(null);
    }
    deps.languageBridge.completionProvidersByLanguage[langId][handleKey] = {
      handle: handleKey,
      triggerCharacters: Array.isArray(registration.triggerCharacters)
        ? registration.triggerCharacters.map(String).filter(Boolean)
        : [],
      supportsResolve: !!registration.supportsResolve,
    };
    ensureCompletionProvidersRegistered(langId);
  }

  function getDocumentColorRegistrations(
    langId: string,
  ): DocumentColorProviderRegistrationLike[] {
    const languageCache =
      deps.languageBridge.documentColorProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function getDocumentColorProviderHandles(
    entries: DocumentColorProviderRegistrationLike[],
  ): string[] {
    return entries
      .map((entry) => String(entry.handle || "").trim())
      .filter(Boolean)
      .sort((left, right) => Number(left) - Number(right));
  }

  function getDocumentColorProviderSignature(
    entries: DocumentColorProviderRegistrationLike[],
  ): string {
    return getDocumentColorProviderHandles(entries).join("|");
  }

  function numberFrom(value: unknown, fallback = 0): number {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function normalizeMonacoColor(raw: unknown): Record<string, number> | null {
    if (Array.isArray(raw) && raw.length >= 4) {
      return {
        red: numberFrom(raw[0]),
        green: numberFrom(raw[1]),
        blue: numberFrom(raw[2]),
        alpha: numberFrom(raw[3], 1),
      };
    }
    const record = asRecord(raw);
    if (!record) return null;
    return {
      red: numberFrom(record.red),
      green: numberFrom(record.green),
      blue: numberFrom(record.blue),
      alpha: numberFrom(record.alpha, 1),
    };
  }

  function normalizeMonacoColorInfo(raw: unknown): Record<string, unknown> | null {
    const record = asRecord(raw);
    const monacoRef = deps.getMonaco();
    if (!record || !monacoRef) return null;
    const color = normalizeMonacoColor(record.color);
    const range =
      deps.monacoRangeFromProtoRange(record.range) ||
      new monacoRef.Range(1, 1, 1, 1);
    if (!color || !range) return null;
    return { color, range };
  }

  function colorInfoToRaw(
    colorInfo: MonacoColorInformationLike,
  ): Record<string, unknown> {
    const color = asRecord(colorInfo.color);
    const range = asRecord(colorInfo.range);
    return {
      color: [
        numberFrom(color && color.red),
        numberFrom(color && color.green),
        numberFrom(color && color.blue),
        numberFrom(color && color.alpha, 1),
      ],
      range: {
        startLineNumber: numberFrom(range && range.startLineNumber, 1),
        startColumn: numberFrom(range && range.startColumn, 1),
        endLineNumber: numberFrom(range && range.endLineNumber, 1),
        endColumn: numberFrom(range && range.endColumn, 1),
      },
    };
  }

  function normalizeMonacoTextEdit(raw: unknown): Record<string, unknown> | null {
    const record = asRecord(raw);
    if (!record) return null;
    const range = deps.monacoRangeFromProtoRange(record.range);
    const text =
      record.text == null
        ? record.newText == null
          ? null
          : String(record.newText)
        : String(record.text);
    if (!range || text == null) return null;
    return { ...record, range, text };
  }

  function normalizeMonacoColorPresentation(
    raw: unknown,
  ): Record<string, unknown> | null {
    const record = asRecord(raw);
    if (!record || typeof record.label !== "string" || !record.label) {
      return null;
    }
    const out: Record<string, unknown> = { label: record.label };
    const textEdit = normalizeMonacoTextEdit(record.textEdit);
    if (textEdit) out.textEdit = textEdit;
    if (Array.isArray(record.additionalTextEdits)) {
      const edits = record.additionalTextEdits
        .map(normalizeMonacoTextEdit)
        .filter((item): item is Record<string, unknown> => !!item);
      if (edits.length) out.additionalTextEdits = edits;
    }
    return out;
  }

  function ensureDocumentColorProviderRegistered(langId: string): void {
    const monacoRef = deps.getMonaco();
    if (
      !monacoRef ||
      !monacoRef.languages ||
      !monacoRef.languages.registerColorProvider
    )
      return;
    if (deps.getLanguageWorkersEnabled()) return;
    const entries = getDocumentColorRegistrations(langId);
    if (!entries.length) return;
    const handles = getDocumentColorProviderHandles(entries);
    if (!handles.length) return;
    const nextSignature = getDocumentColorProviderSignature(entries);
    if (
      nextSignature &&
      deps.languageBridge.documentColorProviderSignatureByLanguage[langId] ===
        nextSignature &&
      deps.languageBridge.documentColorProviderDisposablesByLanguage[langId]
    ) {
      return;
    }

    const existingDisposable =
      deps.languageBridge.documentColorProviderDisposablesByLanguage[langId];
    if (
      existingDisposable &&
      typeof existingDisposable.dispose === "function"
    ) {
      try {
        existingDisposable.dispose();
      } catch (_) {}
    }

    const registrationDisposable = monacoRef.languages.registerColorProvider(
      documentColorProviderSelector(deps, langId),
      {
        __te2WorkbenchColorProvider: true,
        provideDocumentColors(model, token) {
          try {
            if (token && token.isCancellationRequested) return [];
            const ctx = deps.getCurrentLanguageContext();
            if (
              !ctx ||
              !model ||
              !model.uri ||
              String(model.uri.toString()) !== String(ctx.uri)
            ) {
              return [];
            }
            deps.flushMirrorDebounce();
            return deps
              .editorWorkbenchCall(
                "document_colors",
                {
                  uri: ctx.uri,
                  path: ctx.path,
                  languageId: ctx.languageId,
                  text:
                    model && typeof model.getValue === "function"
                      ? model.getValue()
                      : undefined,
                  modelVersionId:
                    model && typeof model.getVersionId === "function"
                      ? model.getVersionId()
                      : undefined,
                  timeoutMs: 8000,
                },
                { timeoutMs: 10000 },
              )
              .then((result) => {
                const payload = extractWorkbenchPayload(result);
                const rawColors =
                  asArray(payload && payload.colors) ||
                  asArray(asRecord(payload && payload.result)?.colors) ||
                  [];
                return rawColors
                  .map(normalizeMonacoColorInfo)
                  .filter((item): item is Record<string, unknown> => !!item);
              })
              .catch(() => []);
          } catch (_) {
            return [];
          }
        },
        provideColorPresentations(model, colorInfo, token) {
          try {
            if (token && token.isCancellationRequested) return [];
            const ctx = deps.getCurrentLanguageContext();
            if (
              !ctx ||
              !model ||
              !model.uri ||
              String(model.uri.toString()) !== String(ctx.uri)
            ) {
              return [];
            }
            return deps
              .editorWorkbenchCall(
                "color_presentations",
                {
                  uri: ctx.uri,
                  path: ctx.path,
                  languageId: ctx.languageId,
                  colorInfo: colorInfoToRaw(colorInfo || {}),
                  timeoutMs: 8000,
                },
                { timeoutMs: 10000 },
              )
              .then((result) => {
                const payload = extractWorkbenchPayload(result);
                const rawPresentations =
                  asArray(payload && payload.presentations) ||
                  asArray(asRecord(payload && payload.result)?.presentations) ||
                  [];
                return rawPresentations
                  .map(normalizeMonacoColorPresentation)
                  .filter((item): item is Record<string, unknown> => !!item);
              })
              .catch(() => []);
          } catch (_) {
            return [];
          }
        },
      },
    );
    deps.languageBridge.documentColorProviderDisposablesByLanguage[langId] =
      registrationDisposable &&
      typeof (registrationDisposable as MonacoDisposableLike).dispose ===
        "function"
        ? (registrationDisposable as MonacoDisposableLike)
        : null;
    deps.languageBridge.documentColorProviderSignatureByLanguage[langId] =
      nextSignature;
    pruneNativeWorkerColorProviders(deps, langId);
    console.log(
      "[documentColors] registered aggregated provider bridge for lang=" +
        langId +
        " handles=" +
        handles.join(","),
    );
  }

  function ensureDocumentColorProvidersRegistered(langId: string): void {
    ensureDocumentColorProviderRegistered(langId);
    pruneNativeWorkerColorProviders(deps, langId);
  }

  function cacheDocumentColorProviderRegistration(
    langId: string,
    registration: DocumentColorProviderRegistrationLike,
  ): void {
    if (!langId) return;
    const handleKey =
      registration.handle != null ? String(registration.handle).trim() : "";
    if (!handleKey) return;
    if (!deps.languageBridge.documentColorProvidersByLanguage[langId]) {
      deps.languageBridge.documentColorProvidersByLanguage[langId] =
        Object.create(null);
    }
    deps.languageBridge.documentColorProvidersByLanguage[langId][handleKey] = {
      handle: handleKey,
    };
    ensureDocumentColorProvidersRegistered(langId);
  }

  function getInlayHintsRegistrations(
    langId: string,
  ): InlayHintsProviderRegistrationLike[] {
    const languageCache =
      deps.languageBridge.inlayHintsProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function inlayHintsRegistrationKey(langId: string, handle: string): string {
    return langId + "::" + handle;
  }

  function getInlayHintsRegistrationSignature(
    entry: InlayHintsProviderRegistrationLike,
  ): string {
    return [
      String(entry.handle || "").trim(),
      entry.supportsResolve ? "1" : "0",
      String(entry.displayName || ""),
      entry.eventHandle == null ? "" : String(entry.eventHandle),
    ].join("::");
  }

  function ensureInlayHintsProviderRegistered(
    langId: string,
    handleKey: string,
  ): void {
    const monacoRef = deps.getMonaco();
    if (
      !monacoRef ||
      !monacoRef.languages ||
      !monacoRef.languages.registerInlayHintsProvider
    )
      return;
    const languageCache =
      deps.languageBridge.inlayHintsProvidersByLanguage[langId];
    const registration = languageCache ? languageCache[handleKey] : null;
    if (!registration) return;

    const registrationKey = inlayHintsRegistrationKey(langId, handleKey);
    const nextSignature = getInlayHintsRegistrationSignature(registration);
    if (
      nextSignature &&
      deps.languageBridge.inlayHintsProviderSignatureByKey[registrationKey] ===
        nextSignature &&
      deps.languageBridge.inlayHintsProviderDisposablesByKey[registrationKey]
    ) {
      return;
    }

    const existingDisposable =
      deps.languageBridge.inlayHintsProviderDisposablesByKey[registrationKey];
    if (
      existingDisposable &&
      typeof existingDisposable.dispose === "function"
    ) {
      try {
        existingDisposable.dispose();
      } catch (_) {}
    }

    const registrationDisposable =
      monacoRef.languages.registerInlayHintsProvider(langId, {
        displayName: registration.displayName || undefined,
        provideInlayHints(model, range) {
          try {
            deps.flushMirrorDebounce();
            return provideWorkbenchInlayHintsFromVscodeMainThread({
              model,
              range,
              languageId: langId,
              providerHandle: handleKey,
              adapterTimeoutMs: 10000,
              callTimeoutMs: 12000,
              getCurrentPath: deps.getCurrentPath,
              absPathFromVscodeUri: deps.absPathFromVscodeUri,
              callWorkbenchInlayHints(params, opts) {
                return deps.editorWorkbenchCall("inlay_hints", params, opts);
              },
              callWorkbenchInlayHintsRelease(params, opts) {
                return deps.editorWorkbenchCall(
                  "inlay_hints_release",
                  params,
                  opts,
                );
              },
            }).catch(() => undefined);
          } catch (_) {
            return undefined;
          }
        },
        resolveInlayHint(hint) {
          if (!registration.supportsResolve) return hint;
          try {
            return resolveWorkbenchInlayHintFromVscodeMainThread({
              providerHandle: handleKey,
              hint,
              callWorkbenchInlayHintsResolve(params, opts) {
                return deps.editorWorkbenchCall(
                  "inlay_hints_resolve",
                  params,
                  opts,
                );
              },
            }).catch(() => hint);
          } catch (_) {
            return hint;
          }
        },
      });
    deps.languageBridge.inlayHintsProviderDisposablesByKey[registrationKey] =
      registrationDisposable &&
      typeof (registrationDisposable as MonacoDisposableLike).dispose ===
        "function"
        ? (registrationDisposable as MonacoDisposableLike)
        : null;
    deps.languageBridge.inlayHintsProviderSignatureByKey[registrationKey] =
      nextSignature;
  }

  function ensureInlayHintsProvidersRegistered(langId: string): void {
    const registrations = getInlayHintsRegistrations(langId);
    for (const registration of registrations) {
      const handleKey = String(registration.handle || "").trim();
      if (!handleKey) continue;
      ensureInlayHintsProviderRegistered(langId, handleKey);
    }
  }

  function cacheInlayHintsProviderRegistration(
    langId: string,
    registration: InlayHintsProviderRegistrationLike,
  ): void {
    if (!langId) return;
    const handleKey =
      registration.handle != null ? String(registration.handle).trim() : "";
    if (!handleKey) return;
    if (!deps.languageBridge.inlayHintsProvidersByLanguage[langId]) {
      deps.languageBridge.inlayHintsProvidersByLanguage[langId] =
        Object.create(null);
    }
    deps.languageBridge.inlayHintsProvidersByLanguage[langId][handleKey] = {
      handle: handleKey,
      supportsResolve: !!registration.supportsResolve,
      displayName: registration.displayName || null,
      eventHandle:
        registration.eventHandle == null
          ? null
          : Number(registration.eventHandle),
    };
    ensureInlayHintsProvidersRegistered(langId);
  }

  function getInlineCompletionRegistrations(
    langId: string,
  ): InlineCompletionProviderRegistrationLike[] {
    const languageCache =
      deps.languageBridge.inlineCompletionProvidersByLanguage[langId];
    if (!languageCache) return [];
    return Object.values(languageCache);
  }

  function inlineCompletionRegistrationKey(
    langId: string,
    handle: string,
  ): string {
    return langId + "::" + handle;
  }

  function getInlineCompletionRegistrationSignature(
    entry: InlineCompletionProviderRegistrationLike,
  ): string {
    return [
      String(entry.handle || "").trim(),
      entry.supportsHandleEvents ? "1" : "0",
      String(entry.extensionId || ""),
      String(entry.extensionVersion || ""),
      String(entry.groupId || ""),
      entry.yieldsToGroupIds.join(","),
      entry.excludesGroupIds.join(","),
      String(entry.displayName || ""),
      entry.debounceDelayMs == null ? "" : String(entry.debounceDelayMs),
      entry.eventHandle == null ? "" : String(entry.eventHandle),
    ].join("::");
  }

  function ensureInlineCompletionProviderRegistered(
    langId: string,
    handleKey: string,
  ): void {
    const monacoRef = deps.getMonaco();
    if (
      !monacoRef ||
      !monacoRef.languages ||
      !monacoRef.languages.registerInlineCompletionsProvider
    )
      return;
    const languageCache =
      deps.languageBridge.inlineCompletionProvidersByLanguage[langId];
    const registration = languageCache ? languageCache[handleKey] : null;
    if (!registration) return;

    const registrationKey = inlineCompletionRegistrationKey(langId, handleKey);
    const nextSignature =
      getInlineCompletionRegistrationSignature(registration);
    if (
      nextSignature &&
      deps.languageBridge.inlineCompletionProviderSignatureByKey[
        registrationKey
      ] === nextSignature &&
      deps.languageBridge.inlineCompletionProviderDisposablesByKey[
        registrationKey
      ]
    ) {
      return;
    }

    const existingDisposable =
      deps.languageBridge.inlineCompletionProviderDisposablesByKey[
        registrationKey
      ];
    if (
      existingDisposable &&
      typeof existingDisposable.dispose === "function"
    ) {
      try {
        existingDisposable.dispose();
      } catch (_) {}
    }

    const registrationDisposable =
      monacoRef.languages.registerInlineCompletionsProvider(langId, {
        provideInlineCompletions(model, position, context) {
          try {
            deps.flushMirrorDebounce();
            return provideWorkbenchInlineCompletionsFromVscodeMainThread({
              model,
              position,
              languageId: langId,
              providerHandle: handleKey,
              context,
              adapterTimeoutMs: 10000,
              callTimeoutMs: 12000,
              getCurrentPath: deps.getCurrentPath,
              absPathFromVscodeUri: deps.absPathFromVscodeUri,
              callWorkbenchInlineCompletions(params, opts) {
                return deps.editorWorkbenchCall(
                  "inline_completions",
                  params,
                  opts,
                );
              },
            }).catch(() => undefined);
          } catch (_) {
            return undefined;
          }
        },
        handleItemDidShow(completions, item, updatedInsertText) {
          if (!registration.supportsHandleEvents) return;
          try {
            const pid = Number(asRecord(completions)?.pid);
            const idx = Number(asRecord(item)?.idx);
            if (!Number.isFinite(pid) || !Number.isFinite(idx)) return;
            void notifyWorkbenchInlineCompletionDidShowFromVscodeMainThread({
              providerHandle: handleKey,
              pid,
              idx,
              updatedInsertText: String(updatedInsertText || ""),
              callWorkbenchInlineCompletionsDidShow(params, opts) {
                return deps.editorWorkbenchCall(
                  "inline_completions_did_show",
                  params,
                  opts,
                );
              },
            });
          } catch (_) {}
        },
        disposeInlineCompletions(completions, reason) {
          try {
            const pid = Number(asRecord(completions)?.pid);
            if (!Number.isFinite(pid)) return;
            void freeWorkbenchInlineCompletionsFromVscodeMainThread({
              providerHandle: handleKey,
              pid,
              reason: asRecord(reason) || { kind: "other" },
              callWorkbenchInlineCompletionsFree(params, opts) {
                return deps.editorWorkbenchCall(
                  "inline_completions_free",
                  params,
                  opts,
                );
              },
            });
          } catch (_) {}
        },
        groupId: registration.groupId || registration.extensionId || undefined,
        yieldsToGroupIds: Array.isArray(registration.yieldsToGroupIds)
          ? registration.yieldsToGroupIds
          : [],
        excludesGroupIds: Array.isArray(registration.excludesGroupIds)
          ? registration.excludesGroupIds
          : [],
        displayName: registration.displayName || undefined,
        debounceDelayMs:
          registration.debounceDelayMs == null
            ? undefined
            : Number(registration.debounceDelayMs),
        toString() {
          return (
            "InlineCompletionsProvider(" +
            (registration.extensionId || handleKey) +
            ")"
          );
        },
      });
    deps.languageBridge.inlineCompletionProviderDisposablesByKey[
      registrationKey
    ] =
      registrationDisposable &&
      typeof (registrationDisposable as MonacoDisposableLike).dispose ===
        "function"
        ? (registrationDisposable as MonacoDisposableLike)
        : null;
    deps.languageBridge.inlineCompletionProviderSignatureByKey[
      registrationKey
    ] = nextSignature;
  }

  function ensureInlineCompletionProvidersRegistered(langId: string): void {
    const registrations = getInlineCompletionRegistrations(langId);
    for (const registration of registrations) {
      const handleKey = String(registration.handle || "").trim();
      if (!handleKey) continue;
      ensureInlineCompletionProviderRegistered(langId, handleKey);
    }
  }

  function cacheInlineCompletionProviderRegistration(
    langId: string,
    registration: InlineCompletionProviderRegistrationLike,
  ): void {
    if (!langId) return;
    const handleKey =
      registration.handle != null ? String(registration.handle).trim() : "";
    if (!handleKey) return;
    if (!deps.languageBridge.inlineCompletionProvidersByLanguage[langId]) {
      deps.languageBridge.inlineCompletionProvidersByLanguage[langId] =
        Object.create(null);
    }
    deps.languageBridge.inlineCompletionProvidersByLanguage[langId][handleKey] =
      {
        handle: handleKey,
        supportsHandleEvents: !!registration.supportsHandleEvents,
        extensionId: registration.extensionId || null,
        extensionVersion: registration.extensionVersion || null,
        groupId: registration.groupId || null,
        yieldsToGroupIds: Array.isArray(registration.yieldsToGroupIds)
          ? registration.yieldsToGroupIds.map(String).filter(Boolean)
          : [],
        excludesGroupIds: Array.isArray(registration.excludesGroupIds)
          ? registration.excludesGroupIds.map(String).filter(Boolean)
          : [],
        displayName: registration.displayName || null,
        debounceDelayMs:
          registration.debounceDelayMs == null
            ? null
            : Number(registration.debounceDelayMs),
        eventHandle:
          registration.eventHandle == null
            ? null
            : Number(registration.eventHandle),
      };
    ensureInlineCompletionProvidersRegistered(langId);
  }

  function hydrateProviderSnapshot(snapshot: unknown): {
    completions: number;
    documentColors: number;
    inlayHints: number;
    inlineCompletions: number;
    semanticTokens: number;
  } {
    const snapshotRecord = asRecord(snapshot);
    const disableSemanticTokens = deps.getDisableSemanticTokens();
    let completionCount = 0;
    let documentColorCount = 0;
    let inlayHintsCount = 0;
    let inlineCompletionCount = 0;
    let semanticTokensCount = 0;
    const completionEntries =
      asArray(snapshotRecord ? snapshotRecord.completions : null) || [];
    const documentColorEntries =
      asArray(snapshotRecord ? snapshotRecord.documentColors : null) || [];
    const inlayHintsEntries =
      asArray(snapshotRecord ? snapshotRecord.inlayHints : null) || [];
    const inlineCompletionEntries =
      asArray(snapshotRecord ? snapshotRecord.inlineCompletions : null) || [];
    const semanticTokenEntries =
      asArray(snapshotRecord ? snapshotRecord.semanticTokens : null) || [];

    for (const rawEntry of completionEntries) {
      const entry = asRecord(rawEntry);
      const handle =
        entry && entry.handle != null ? String(entry.handle).trim() : "";
      if (!handle) continue;
      const triggerCharacters = (
        asArray(entry ? entry.triggerCharacters : null) || []
      )
        .map(String)
        .filter(Boolean);
      const supportsResolve = !!(entry && entry.supportsResolve);
      for (const langId of selectorLanguagesFromSnapshot(
        entry && entry.selector,
      )) {
        cacheCompletionProviderRegistration(langId, {
          handle,
          triggerCharacters,
          supportsResolve,
        });
        completionCount += 1;
      }
    }

    for (const rawEntry of inlayHintsEntries) {
      const entry = asRecord(rawEntry);
      const handle =
        entry && entry.handle != null ? String(entry.handle).trim() : "";
      if (!handle) continue;
      for (const langId of selectorLanguagesFromSnapshot(
        entry && entry.selector,
      )) {
        cacheInlayHintsProviderRegistration(langId, {
          handle,
          supportsResolve: entry?.supportsResolve === true,
          displayName:
            typeof entry?.displayName === "string" ? entry.displayName : null,
          eventHandle:
            typeof entry?.eventHandle === "number" &&
            Number.isFinite(entry.eventHandle)
              ? entry.eventHandle
              : null,
        });
        inlayHintsCount += 1;
      }
    }

    for (const rawEntry of documentColorEntries) {
      const entry = asRecord(rawEntry);
      const handle =
        entry && entry.handle != null ? String(entry.handle).trim() : "";
      if (!handle) continue;
      for (const langId of selectorLanguagesFromSnapshot(
        entry && entry.selector,
      )) {
        cacheDocumentColorProviderRegistration(langId, { handle });
        documentColorCount += 1;
      }
    }

    for (const rawEntry of inlineCompletionEntries) {
      const entry = asRecord(rawEntry);
      const handle =
        entry && entry.handle != null ? String(entry.handle).trim() : "";
      if (!handle) continue;
      for (const langId of selectorLanguagesFromSnapshot(
        entry && entry.selector,
      )) {
        cacheInlineCompletionProviderRegistration(langId, {
          handle,
          supportsHandleEvents: entry?.supportsHandleEvents === true,
          extensionId:
            typeof entry?.extensionId === "string" ? entry.extensionId : null,
          extensionVersion:
            typeof entry?.extensionVersion === "string"
              ? entry.extensionVersion
              : null,
          groupId: typeof entry?.groupId === "string" ? entry.groupId : null,
          yieldsToGroupIds: (
            asArray(entry ? entry.yieldsToGroupIds : null) || []
          )
            .map(String)
            .filter(Boolean),
          excludesGroupIds: (
            asArray(entry ? entry.excludesGroupIds : null) || []
          )
            .map(String)
            .filter(Boolean),
          displayName:
            typeof entry?.displayName === "string" ? entry.displayName : null,
          debounceDelayMs:
            typeof entry?.debounceDelayMs === "number" &&
            Number.isFinite(entry.debounceDelayMs)
              ? entry.debounceDelayMs
              : null,
          eventHandle:
            typeof entry?.eventHandle === "number" &&
            Number.isFinite(entry.eventHandle)
              ? entry.eventHandle
              : null,
        });
        inlineCompletionCount += 1;
      }
    }

    if (!disableSemanticTokens) {
      for (const rawEntry of semanticTokenEntries) {
        const entry = asRecord(rawEntry);
        const legend = asRecord(entry && entry.legend);
        if (!legend) continue;
        const tokenTypes = (asArray(legend.tokenTypes) || [])
          .map(String)
          .filter(Boolean);
        const tokenModifiers = (asArray(legend.tokenModifiers) || [])
          .map(String)
          .filter(Boolean);
        if (!tokenTypes.length && !tokenModifiers.length) continue;
        for (const langId of selectorLanguagesFromSnapshot(
          entry && entry.selector,
        )) {
          registerSemanticTokensWithLegend(
            langId,
            { tokenTypes, tokenModifiers },
            !!(entry && entry.range),
          );
          semanticTokensCount += 1;
        }
      }
    } else if (semanticTokenEntries.length) {
      logSemanticTokensDisabledOnce();
    }

    return {
      completions: completionCount,
      documentColors: documentColorCount,
      inlayHints: inlayHintsCount,
      inlineCompletions: inlineCompletionCount,
      semanticTokens: semanticTokensCount,
    };
  }

  function registerSemanticTokensWithLegend(
    langId: string,
    legend: SemanticTokensLegendLike,
    isRange?: boolean,
  ): void {
    if (deps.getDisableSemanticTokens()) {
      logSemanticTokensDisabledOnce();
      return;
    }
    const monacoRef = deps.getMonaco();
    if (!monacoRef || !monacoRef.languages) return;
    deps.languageBridge.semanticTokensLegendCache[langId] = legend;
    deps.languageBridge.semanticTokensRangeFlag[langId] = !!isRange;
    const changeEmitter = semanticTokensChangeEmitterForLanguage(langId);
    if (deps.languageBridge.registeredSemanticTokens.has(langId)) {
      fireSemanticTokensChanged(langId);
      return;
    }
    deps.languageBridge.registeredSemanticTokens.add(langId);

    if (
      isRange &&
      monacoRef.languages.registerDocumentRangeSemanticTokensProvider
    ) {
      monacoRef.languages.registerDocumentRangeSemanticTokensProvider(langId, {
        onDidChange: changeEmitter.event,
        getLegend() {
          return (
            deps.languageBridge.semanticTokensLegendCache[langId] || legend
          );
        },
        provideDocumentRangeSemanticTokens(model, range) {
          try {
            return provideWorkbenchDocumentRangeSemanticTokensFromVscodeMainThread(
              {
                model,
                languageId: langId,
                range,
                adapterTimeoutMs: 10000,
                callTimeoutMs: 12000,
                getCurrentPath: deps.getCurrentPath,
                absPathFromVscodeUri: deps.absPathFromVscodeUri,
                callWorkbenchSemanticTokensRange(params, opts) {
                  return deps.editorWorkbenchCall(
                    "semantic_tokens_range",
                    params,
                    opts,
                  );
                },
              },
            ).catch(() => null);
          } catch (_) {
            return null;
          }
        },
      });
      return;
    }

    console.log(
      "[semanticTokens] registering FULL provider for " +
        langId +
        " types=" +
        legend.tokenTypes.length +
        " mods=" +
        legend.tokenModifiers.length,
    );
    if (!monacoRef.languages.registerDocumentSemanticTokensProvider) return;
    monacoRef.languages.registerDocumentSemanticTokensProvider(langId, {
      onDidChange: changeEmitter.event,
      getLegend() {
        return deps.languageBridge.semanticTokensLegendCache[langId] || legend;
      },
      provideDocumentSemanticTokens(model, lastResultId) {
        try {
          const languageId = String(
            model && model.getLanguageId ? model.getLanguageId() : langId,
          );
          console.log(
            "[semanticTokens] FULL REQUEST " +
              languageId +
              " prevResultId=" +
              (lastResultId || "0"),
          );
          return provideWorkbenchDocumentSemanticTokensFromVscodeMainThread({
            model,
            languageId: langId,
            lastResultId,
            adapterTimeoutMs: 10000,
            callTimeoutMs: 12000,
            getCurrentPath: deps.getCurrentPath,
            absPathFromVscodeUri: deps.absPathFromVscodeUri,
            callWorkbenchSemanticTokens(params, opts) {
              return deps.editorWorkbenchCall("semantic_tokens", params, opts);
            },
          }).catch((error) => {
            console.warn("[semanticTokens] request failed", error);
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
    if (deps.getDisableSemanticTokens()) {
      logSemanticTokensDisabledOnce();
      return;
    }
    if (deps.languageBridge.registeredSemanticTokens.has(langId)) return;
    deps
      .editorWorkbenchCall(
        "semantic_tokens_legend",
        { languageId: langId },
        { timeoutMs: 8000 },
      )
      .then((result) => {
        const payload = extractWorkbenchPayload(result);
        const legendRecord = payload && asRecord(payload.legend);
        const tokenTypes = legendRecord && asArray(legendRecord.tokenTypes);
        const tokenModifiers =
          legendRecord && asArray(legendRecord.tokenModifiers);
        if (!legendRecord || !tokenTypes || !tokenModifiers) {
          console.warn("[semanticTokens] no legend for " + langId, result);
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
        console.warn(
          "[semanticTokens] legend fetch failed for " + langId,
          error,
        );
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

            if (
              !deps.languageBridge.registeredHover.has(langId) &&
              monacoRef.languages.registerHoverProvider
            ) {
              console.log(
                "[hover:bridge] registering hover provider for lang=" + langId,
              );
              monacoRef.languages.registerHoverProvider(langId, {
                provideHover(model, pos, token) {
                  try {
                    const ctx = deps.getCurrentLanguageContext();
                    if (
                      !ctx ||
                      !model ||
                      !model.uri ||
                      String(model.uri.toString()) !== String(ctx.uri)
                    ) {
                      console.warn(
                        "[hover:bridge] BAIL provideHover: ctx=" +
                          (ctx ? "ok" : "NULL") +
                          " m.uri=" +
                          (model && model.uri
                            ? String(model.uri.toString()).slice(-60)
                            : "NULL") +
                          " ctx.uri=" +
                          (ctx ? String(ctx.uri).slice(-60) : "N/A"),
                      );
                      return null;
                    }
                    return deps
                      .callWorkbenchProviderGuarded(
                        "hover",
                        "vscode.hover",
                        {
                          uri: ctx.uri,
                          path: ctx.path,
                          languageId: ctx.languageId,
                          lineNumber: Number(
                            pos && pos.lineNumber ? pos.lineNumber : 1,
                          ),
                          column: Number(pos && pos.column ? pos.column : 1),
                          timeoutMs: 4500,
                        },
                        ctx,
                        { timeoutMs: 5000, cancelToken: token },
                      )
                      .then((out) => {
                        const payload = out.ok
                          ? extractGuardedPayload(out)
                          : null;
                        if (!payload) return null;
                        const hoverPayload =
                          asRecord(payload.result) ||
                          asRecord(payload.hover) ||
                          payload;
                        if (!hoverPayload) return null;
                        const range = deps.monacoRangeFromProtoRange(
                          hoverPayload.range,
                        );
                        const contents = deps.toMonacoHoverContents(
                          hoverPayload.contents,
                        );
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

            if (
              !deps.languageBridge.registeredSymbols.has(langId) &&
              monacoRef.languages.registerDocumentSymbolProvider
            ) {
              monacoRef.languages.registerDocumentSymbolProvider(
                documentSymbolProviderSelector(deps, langId),
                {
                  provideDocumentSymbols(model, token) {
                    try {
                      const ctx = deps.getCurrentLanguageContext();
                      if (
                        !ctx ||
                        !model ||
                        !model.uri ||
                        String(model.uri.toString()) !== String(ctx.uri)
                      )
                        return [];
                      return deps
                        .callWorkbenchProviderGuarded(
                          "symbols",
                          "vscode.documentSymbols",
                          {
                            uri: ctx.uri,
                            path: ctx.path,
                            languageId: ctx.languageId,
                            timeoutMs: 6000,
                          },
                          ctx,
                          { timeoutMs: 6500, cancelToken: token },
                        )
                        .then((out) => {
                          if (!out || !out.ok) return [];
                          const payload = extractGuardedPayload(out);
                          const items =
                            payload &&
                            asArray(payload.result ? payload.result : payload);
                          return normalizeDocumentSymbols(deps, items || []);
                        });
                    } catch (_) {
                      return [];
                    }
                  },
                },
              );
              deps.languageBridge.registeredSymbols.add(langId);
            }

            if (
              !deps.languageBridge.registeredFolding.has(langId) &&
              monacoRef.languages.registerFoldingRangeProvider
            ) {
              monacoRef.languages.registerFoldingRangeProvider(
                foldingRangeProviderSelector(deps, langId),
                {
                  provideFoldingRanges(model, context, token) {
                    try {
                      const ctx = deps.getCurrentLanguageContext();
                      if (
                        !ctx ||
                        !model ||
                        !model.uri ||
                        String(model.uri.toString()) !== String(ctx.uri)
                      )
                        return null;
                      return deps
                        .callWorkbenchProviderGuarded(
                          "folding_ranges",
                          "vscode.foldingRanges",
                          {
                            uri: ctx.uri,
                            path: ctx.path,
                            languageId: ctx.languageId,
                            context:
                              context && typeof context === "object"
                                ? context
                                : {},
                            timeoutMs: 6000,
                          },
                          ctx,
                          { timeoutMs: 6500, cancelToken: token },
                        )
                        .then((out) => {
                          if (!out || !out.ok) return null;
                          const payload = extractGuardedPayload(out);
                          const raw = payload
                            ? payload.result !== undefined
                              ? payload.result
                              : payload
                            : null;
                          return normalizeFoldingRanges(deps, raw);
                        });
                    } catch (_) {
                      return null;
                    }
                  },
                },
              );
              deps.languageBridge.registeredFolding.add(langId);
            }
            ensureCompletionProvidersRegistered(langId);
            ensureDocumentColorProvidersRegistered(langId);
          });
        } catch (_) {}
      };

      const immediate = new Set<string>();
      try {
        const ctx = deps.getCurrentLanguageContext();
        if (ctx && ctx.languageId) immediate.add(String(ctx.languageId));
      } catch (_) {}
      console.log(
        "[hover:bridge] installWorkbenchLanguageBridgeProviders immediate=" +
          Array.from(immediate).join(",") +
          " model=" +
          (deps.getHasModel() ? "yes" : "no") +
          " registeredHover=" +
          Array.from(deps.languageBridge.registeredHover).join(","),
      );
      if (immediate.size) {
        doRegister(immediate);
        immediate.forEach((langId) => {
          try {
            ensureCompletionProvidersRegistered(langId);
          } catch (_) {}
          try {
            ensureDocumentColorProvidersRegistered(langId);
          } catch (_) {}
          try {
            ensureInlayHintsProvidersRegistered(langId);
          } catch (_) {}
          try {
            registerSemanticTokensForLanguage(langId);
          } catch (_) {}
        });
      }

      deps
        .ensureWorkbenchLanguageCatalogInstalled()
        .then(() => {
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
              try {
                ensureDocumentColorProvidersRegistered(langId);
              } catch (_) {}
              try {
                ensureInlayHintsProvidersRegistered(langId);
              } catch (_) {}
              try {
                ensureInlineCompletionProvidersRegistered(langId);
              } catch (_) {}
            });
          } catch (_) {}
        })
        .catch(() => {});
    } catch (_) {}
  }

  function resetDynamicProviderCaches(reason?: string): void {
    try {
      disposeProviderRecord(
        deps.languageBridge.completionProviderDisposablesByLanguage,
      );
      disposeProviderRecord(
        deps.languageBridge.documentColorProviderDisposablesByLanguage,
      );
      disposeProviderRecord(
        deps.languageBridge.inlayHintsProviderDisposablesByKey,
      );
      disposeProviderRecord(
        deps.languageBridge.inlineCompletionProviderDisposablesByKey,
      );

      deps.languageBridge.completionProvidersByLanguage = {};
      deps.languageBridge.completionProviderDisposablesByLanguage = {};
      deps.languageBridge.completionProviderSignatureByLanguage = {};
      deps.languageBridge.documentColorProvidersByLanguage = {};
      deps.languageBridge.documentColorProviderDisposablesByLanguage = {};
      deps.languageBridge.documentColorProviderSignatureByLanguage = {};
      deps.languageBridge.inlayHintsProvidersByLanguage = {};
      deps.languageBridge.inlayHintsProviderDisposablesByKey = {};
      deps.languageBridge.inlayHintsProviderSignatureByKey = {};
      deps.languageBridge.inlineCompletionProvidersByLanguage = {};
      deps.languageBridge.inlineCompletionProviderDisposablesByKey = {};
      deps.languageBridge.inlineCompletionProviderSignatureByKey = {};
      deps.languageBridge.semanticTokensLanguagesByEventHandle = {};
      deps.languageBridge.semanticTokensLegendCache = {};
      deps.languageBridge.semanticTokensRangeFlag = {};
      deps.languageBridge.registeredSemanticTokens.forEach((langId) =>
        fireSemanticTokensChanged(langId),
      );
      console.log(
        "[providers] reset dynamic WBA provider caches reason=" +
          String(reason || "session_reset"),
      );
    } catch (error) {
      console.warn("[providers] dynamic provider cache reset failed", error);
    }
  }

  return {
    cacheCompletionProviderRegistration,
    cacheDocumentColorProviderRegistration,
    cacheInlayHintsProviderRegistration,
    cacheInlineCompletionProviderRegistration,
    registerSemanticTokensWithLegend,
    fireSemanticTokensChanged,
    resetDynamicProviderCaches,
    installWorkbenchLanguageBridgeProviders,
    hydrateProviderSnapshot,
  };
}
