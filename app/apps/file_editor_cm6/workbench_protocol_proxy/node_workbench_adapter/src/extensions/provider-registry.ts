export const PROVIDER_KINDS = [
  "hover",
  "documentSymbols",
  "foldingRanges",
  "completions",
  "inlayHints",
  "inlineCompletions",
  "semanticTokens",
  "documentColors",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderEntry {
  handle: number;
  selector: unknown[];
  label?: string | null;
  eventHandle?: unknown;
  triggerCharacters?: string[];
  supportsResolve?: boolean;
  supportsHandleEvents?: boolean;
  extensionId?: string | null;
  extensionVersion?: string | null;
  groupId?: string | null;
  yieldsToGroupIds?: string[];
  excludesGroupIds?: string[];
  displayName?: string | null;
  debounceDelayMs?: number | null;
  legend?: unknown;
  range?: boolean;
}

export interface ProviderRegistrationOutcome {
  handled: boolean;
  ready: boolean;
  logs: string[];
  events: Record<string, unknown>[];
}

export interface ProviderResyncOutcome {
  replayed: {
    semanticTokens: number;
    hover: number;
    completions: number;
    inlayHints: number;
    inlineCompletions: number;
    documentSymbols: number;
    foldingRanges: number;
    documentColors: number;
  };
  events: Record<string, unknown>[];
}

function emptyOutcome(handled = false): ProviderRegistrationOutcome {
  return { handled, ready: false, logs: [], events: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function selectorLanguage(selector: unknown): string | null {
  if (!isRecord(selector)) return null;
  const language = selector.language;
  return typeof language === "string" && language ? language : null;
}

function selectorLanguages(selector: unknown[]): string[] {
  const out: string[] = [];
  for (const item of selector) {
    const language = selectorLanguage(item);
    if (language) out.push(language);
  }
  return out;
}

function firstSelectorLanguage(selector: unknown[]): string | null {
  for (const item of selector) {
    const language = selectorLanguage(item);
    if (language) return language;
  }
  return null;
}

function stringifyPreview(
  value: unknown,
  maxLength: number,
): string | undefined {
  try {
    return JSON.stringify(value)?.slice(0, maxLength);
  } catch {
    return undefined;
  }
}

function labelFromValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "string") return value.value;
  return null;
}

function tokenLegendLength(
  legend: unknown,
  key: "tokenTypes" | "tokenModifiers",
): number {
  if (!isRecord(legend)) return 0;
  const value = legend[key];
  return Array.isArray(value) ? value.length : 0;
}

function finiteHandle(value: unknown): number | null {
  const handle = Number(value);
  return Number.isFinite(handle) ? handle : null;
}

function normalizeSelector(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function methodMatches(method: unknown, name: string): method is string {
  return method === name;
}

export class ProviderRegistry {
  private readonly providers: Record<ProviderKind, Map<number, ProviderEntry>> =
    {
      hover: new Map<number, ProviderEntry>(),
      documentSymbols: new Map<number, ProviderEntry>(),
      foldingRanges: new Map<number, ProviderEntry>(),
      completions: new Map<number, ProviderEntry>(),
      inlayHints: new Map<number, ProviderEntry>(),
      inlineCompletions: new Map<number, ProviderEntry>(),
      semanticTokens: new Map<number, ProviderEntry>(),
      documentColors: new Map<number, ProviderEntry>(),
    };

  private readonly textContentProviders = new Map<string, number>();

  clear(): void {
    for (const providerMap of Object.values(this.providers)) {
      providerMap.clear();
    }
    this.textContentProviders.clear();
  }

  registerFromRequest(
    method: unknown,
    args: unknown,
  ): ProviderRegistrationOutcome {
    if (!Array.isArray(args)) return emptyOutcome(false);
    if (methodMatches(method, "$registerTextDocumentContentProvider")) {
      return this.registerTextDocumentContentProvider(args);
    }
    if (methodMatches(method, "$registerDocumentSymbolProvider")) {
      return this.registerDocumentSymbolsProvider(args);
    }
    if (methodMatches(method, "$registerHoverProvider")) {
      return this.registerHoverProvider(args);
    }
    if (methodMatches(method, "$registerFoldingRangeProvider")) {
      return this.registerFoldingRangeProvider(args);
    }
    if (methodMatches(method, "$registerCompletionsProvider")) {
      return this.registerCompletionsProvider(args);
    }
    if (methodMatches(method, "$registerInlayHintsProvider")) {
      return this.registerInlayHintsProvider(args);
    }
    if (methodMatches(method, "$registerInlineCompletionsSupport")) {
      return this.registerInlineCompletionsProvider(args);
    }
    if (methodMatches(method, "$registerDocumentSemanticTokensProvider")) {
      return this.registerDocumentSemanticTokensProvider(args);
    }
    if (methodMatches(method, "$registerDocumentRangeSemanticTokensProvider")) {
      return this.registerDocumentRangeSemanticTokensProvider(args);
    }
    if (methodMatches(method, "$registerDocumentColorProvider")) {
      return this.registerDocumentColorProvider(args);
    }
    return emptyOutcome(false);
  }

  getTextContentProvider(scheme: string): number | null {
    return this.textContentProviders.get(scheme) ?? null;
  }

  hasTextContentProvider(scheme: string): boolean {
    return this.textContentProviders.has(scheme);
  }

  list(kind: ProviderKind): ProviderEntry[] {
    return Array.from(this.providers[kind].values());
  }

  snapshot(): Record<ProviderKind, ProviderEntry[]> {
    return {
      hover: this.list("hover"),
      documentSymbols: this.list("documentSymbols"),
      foldingRanges: this.list("foldingRanges"),
      completions: this.list("completions"),
      inlayHints: this.list("inlayHints"),
      inlineCompletions: this.list("inlineCompletions"),
      semanticTokens: this.list("semanticTokens"),
      documentColors: this.list("documentColors"),
    };
  }

  selectorGroupsSummary(kind: ProviderKind): string {
    return this.list(kind)
      .map((entry) => JSON.stringify(selectorLanguages(entry.selector)))
      .join(", ");
  }

  languageSummary(kind: ProviderKind): string {
    return this.list(kind)
      .flatMap((entry) => selectorLanguages(entry.selector))
      .join(",");
  }

  getProvider(kind: ProviderKind, handle: number): ProviderEntry | undefined {
    return this.providers[kind].get(handle);
  }

  findProviderHandle(kind: ProviderKind, languageId: string): number | null {
    return this.findAllProviderHandles(kind, languageId)[0] ?? null;
  }

  findAllProviderHandles(kind: ProviderKind, languageId: string): number[] {
    if (!languageId) return [];
    const handles: number[] = [];
    for (const entry of this.providers[kind].values()) {
      if (selectorLanguages(entry.selector).includes(languageId)) {
        handles.push(entry.handle);
      }
    }
    return handles;
  }

  findSemanticRangeHandles(languageId: string): number[] {
    if (!languageId) return [];
    const handles: number[] = [];
    for (const entry of this.providers.semanticTokens.values()) {
      if (!entry.range) continue;
      if (selectorLanguages(entry.selector).includes(languageId)) {
        handles.push(entry.handle);
      }
    }
    return handles;
  }

  buildResyncEvents(): ProviderResyncOutcome {
    const replayed = {
      semanticTokens: 0,
      hover: 0,
      completions: 0,
      inlayHints: 0,
      inlineCompletions: 0,
      documentSymbols: 0,
      foldingRanges: 0,
      documentColors: 0,
    };
    const events: Record<string, unknown>[] = [];

    for (const entry of this.providers.completions.values()) {
      for (const language of selectorLanguages(entry.selector)) {
        events.push({
          type: "provider/completions",
          handle: entry.handle,
          language,
          triggerCharacters: Array.isArray(entry.triggerCharacters)
            ? entry.triggerCharacters
            : [],
          supportsResolve: !!entry.supportsResolve,
          resync: true,
        });
        replayed.completions += 1;
      }
    }

    for (const entry of this.providers.inlineCompletions.values()) {
      for (const language of selectorLanguages(entry.selector)) {
        events.push({
          type: "provider/inlineCompletions",
          handle: entry.handle,
          language,
          supportsHandleEvents: !!entry.supportsHandleEvents,
          extensionId: entry.extensionId ?? null,
          extensionVersion: entry.extensionVersion ?? null,
          groupId: entry.groupId ?? null,
          yieldsToGroupIds: Array.isArray(entry.yieldsToGroupIds)
            ? entry.yieldsToGroupIds
            : [],
          excludesGroupIds: Array.isArray(entry.excludesGroupIds)
            ? entry.excludesGroupIds
            : [],
          displayName: entry.displayName ?? null,
          debounceDelayMs: entry.debounceDelayMs ?? null,
          eventHandle: entry.eventHandle ?? null,
          resync: true,
        });
        replayed.inlineCompletions += 1;
      }
    }

    for (const entry of this.providers.inlayHints.values()) {
      for (const language of selectorLanguages(entry.selector)) {
        events.push({
          type: "provider/inlayHints",
          handle: entry.handle,
          language,
          supportsResolve: !!entry.supportsResolve,
          displayName: entry.displayName ?? null,
          eventHandle: entry.eventHandle ?? null,
          resync: true,
        });
        replayed.inlayHints += 1;
      }
    }

    for (const entry of this.providers.semanticTokens.values()) {
      const language = selectorLanguage(entry.selector[0]);
      if (!language || !entry.legend) continue;
      events.push({
        type: "provider/semanticTokens",
        handle: entry.handle,
        language,
        legend: entry.legend,
        eventHandle: entry.eventHandle ?? null,
        range: !!entry.range,
        resync: true,
      });
      replayed.semanticTokens += 1;
    }

    for (const entry of this.providers.documentColors.values()) {
      for (const language of selectorLanguages(entry.selector)) {
        events.push({
          type: "provider/documentColors",
          handle: entry.handle,
          language,
          resync: true,
        });
        replayed.documentColors += 1;
      }
    }

    return { replayed, events };
  }

  private registerTextDocumentContentProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handle = finiteHandle(args[0]);
    const scheme = typeof args[1] === "string" ? args[1] : null;
    if (handle === null || !scheme) return outcome;
    this.textContentProviders.set(scheme, handle);
    outcome.logs.push(
      `[contentProvider] registered scheme=${scheme} handle=${handle}`,
    );
    return outcome;
  }

  private registerDocumentSymbolsProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handle = finiteHandle(args[0]);
    const selector = normalizeSelector(args[1]);
    const label = typeof args[2] === "string" ? args[2] : null;
    if (handle === null || !selector) return outcome;

    this.providers.documentSymbols.set(handle, { handle, selector, label });
    const language = firstSelectorLanguage(selector);
    if (language) {
      outcome.ready = true;
      outcome.events.push({
        type: "provider/documentSymbols",
        handle,
        language,
      });
    }
    return outcome;
  }

  private registerHoverProvider(args: unknown[]): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handleValue = Number(args[0]);
    const selector = args[1];
    outcome.logs.push(
      `[providers] $registerHoverProvider handle=${handleValue} selector=${stringifyPreview(selector, 200)} isArr=${Array.isArray(selector)} isFinite=${Number.isFinite(handleValue)}`,
    );

    const handle = Number.isFinite(handleValue) ? handleValue : null;
    const normalizedSelector = normalizeSelector(selector);
    const label = typeof args[2] === "string" ? args[2] : null;
    if (handle === null || !normalizedSelector) return outcome;

    this.providers.hover.set(handle, {
      handle,
      selector: normalizedSelector,
      label,
    });
    const language = firstSelectorLanguage(normalizedSelector);
    if (language) {
      outcome.ready = true;
      outcome.events.push({ type: "provider/hover", handle, language });
    }
    outcome.logs.push(
      `[providers] hover map size=${this.providers.hover.size} languages=[${this.languageSummary("hover")}]`,
    );
    return outcome;
  }

  private registerFoldingRangeProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handleValue = Number(args[0]);
    const selector = args[1];
    const label = labelFromValue(args[2]);
    const eventHandle =
      typeof args[3] === "number" && Number.isFinite(args[3]) ? args[3] : null;
    outcome.logs.push(
      `[providers] $registerFoldingRangeProvider handle=${handleValue} selector=${stringifyPreview(selector, 200)} eventHandle=${eventHandle ?? "none"} isArr=${Array.isArray(selector)} isFinite=${Number.isFinite(handleValue)}`,
    );

    const handle = Number.isFinite(handleValue) ? handleValue : null;
    const normalizedSelector = normalizeSelector(selector);
    if (handle === null || !normalizedSelector) return outcome;

    this.providers.foldingRanges.set(handle, {
      handle,
      selector: normalizedSelector,
      label,
      eventHandle,
    });
    const language = firstSelectorLanguage(normalizedSelector);
    if (language) {
      outcome.events.push({
        type: "provider/foldingRanges",
        handle,
        language,
        eventHandle,
      });
    }
    outcome.logs.push(
      `[providers] foldingRanges map size=${this.providers.foldingRanges.size} languages=[${this.languageSummary("foldingRanges")}]`,
    );
    return outcome;
  }

  private registerCompletionsProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handle = finiteHandle(args[0]);
    const selector = normalizeSelector(args[1]);
    const triggerCharacters = Array.isArray(args[2])
      ? args[2].map(String).filter(Boolean)
      : [];
    const supportsResolve = !!args[3];
    if (handle === null || !selector) return outcome;

    this.providers.completions.set(handle, {
      handle,
      selector,
      triggerCharacters,
      supportsResolve,
    });
    const language = firstSelectorLanguage(selector);
    if (language) {
      outcome.events.push({
        type: "provider/completions",
        handle,
        language,
        triggerCharacters,
        supportsResolve,
      });
    }
    outcome.logs.push(
      `[providers] completions map size=${this.providers.completions.size} languages=[${this.languageSummary("completions")}]`,
    );
    return outcome;
  }

  private registerInlayHintsProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handle = finiteHandle(args[0]);
    const selector = normalizeSelector(args[1]);
    const supportsResolve = !!args[2];
    const eventHandle = finiteHandle(args[3]);
    const displayName = typeof args[4] === "string" ? args[4] : null;
    if (handle === null || !selector) return outcome;

    this.providers.inlayHints.set(handle, {
      handle,
      selector,
      supportsResolve,
      eventHandle,
      displayName,
    });
    for (const language of selectorLanguages(selector)) {
      outcome.events.push({
        type: "provider/inlayHints",
        handle,
        language,
        supportsResolve,
        displayName,
        eventHandle,
      });
    }
    outcome.logs.push(
      `[providers] inlayHints map size=${this.providers.inlayHints.size} languages=[${this.languageSummary("inlayHints")}] resolve=${supportsResolve ? 1 : 0}`,
    );
    return outcome;
  }

  private registerInlineCompletionsProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 4) return outcome;
    const handle = finiteHandle(args[0]);
    const selector = normalizeSelector(args[1]);
    const supportsHandleEvents = args[2] === true;
    const extensionId = typeof args[3] === "string" ? args[3] : null;
    const extensionVersion = typeof args[4] === "string" ? args[4] : null;
    const groupId = typeof args[5] === "string" ? args[5] : null;
    const yieldsToGroupIds = Array.isArray(args[6])
      ? args[6].map(String).filter(Boolean)
      : [];
    const displayName = typeof args[7] === "string" ? args[7] : null;
    const debounceDelayMs =
      typeof args[8] === "number" && Number.isFinite(args[8]) ? args[8] : null;
    const excludesGroupIds = Array.isArray(args[9])
      ? args[9].map(String).filter(Boolean)
      : [];
    const eventHandle = finiteHandle(args[10]);
    if (handle === null || !selector) return outcome;

    this.providers.inlineCompletions.set(handle, {
      handle,
      selector,
      supportsHandleEvents,
      extensionId,
      extensionVersion,
      groupId,
      yieldsToGroupIds,
      excludesGroupIds,
      displayName,
      debounceDelayMs,
      eventHandle,
    });
    for (const language of selectorLanguages(selector)) {
      outcome.events.push({
        type: "provider/inlineCompletions",
        handle,
        language,
        supportsHandleEvents,
        extensionId,
        extensionVersion,
        groupId,
        yieldsToGroupIds,
        excludesGroupIds,
        displayName,
        debounceDelayMs,
        eventHandle,
      });
    }
    outcome.logs.push(
      `[providers] inlineCompletions map size=${this.providers.inlineCompletions.size} languages=[${this.languageSummary("inlineCompletions")}] handleEvents=${supportsHandleEvents ? 1 : 0}`,
    );
    return outcome;
  }

  private registerDocumentSemanticTokensProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 3) return outcome;
    const handle = finiteHandle(args[0]);
    const selector = normalizeSelector(args[1]);
    const legend = args[2];
    const eventHandle = finiteHandle(args[3]);
    if (handle === null || !selector || !legend) return outcome;

    this.providers.semanticTokens.set(handle, {
      handle,
      selector,
      legend,
      eventHandle,
    });
    for (const language of selectorLanguages(selector)) {
      outcome.events.push({
        type: "provider/semanticTokens",
        handle,
        language,
        legend,
        eventHandle,
      });
    }
    outcome.logs.push(
      `[providers] semanticTokens map size=${this.providers.semanticTokens.size} languages=[${this.languageSummary("semanticTokens")}] legendTypes=${tokenLegendLength(legend, "tokenTypes")} legendMods=${tokenLegendLength(legend, "tokenModifiers")}`,
    );
    return outcome;
  }

  private registerDocumentRangeSemanticTokensProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 3) return outcome;
    const handleValue = Number(args[0]);
    const selector = args[1];
    const legend = args[2];
    const eventHandle = finiteHandle(args[3]);
    const legendKeys = isRecord(legend) ? Object.keys(legend).join(",") : "N/A";
    outcome.logs.push(
      `[providers] range check: handle=${handleValue} isFinite=${Number.isFinite(handleValue)} isArrSelector=${Array.isArray(selector)} legendTruthy=${!!legend} legendType=${typeof legend} legendKeys=${legendKeys}`,
    );

    const handle = Number.isFinite(handleValue) ? handleValue : null;
    const normalizedSelector = normalizeSelector(selector);
    if (handle === null || !normalizedSelector || !legend) return outcome;

    try {
      this.providers.semanticTokens.set(handle, {
        handle,
        selector: normalizedSelector,
        legend,
        eventHandle,
        range: true,
      });
      for (const language of selectorLanguages(normalizedSelector)) {
        outcome.events.push({
          type: "provider/semanticTokens",
          handle,
          language,
          legend,
          eventHandle,
          range: true,
        });
      }
      outcome.logs.push(
        `[providers] semanticTokensRange map size=${this.providers.semanticTokens.size} languages=[${this.languageSummary("semanticTokens")}] legendTypes=${tokenLegendLength(legend, "tokenTypes")} legendMods=${tokenLegendLength(legend, "tokenModifiers")}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome.logs.push(
        `[providers] semanticTokensRange EXCEPTION: ${message}`,
      );
    }
    return outcome;
  }

  private registerDocumentColorProvider(
    args: unknown[],
  ): ProviderRegistrationOutcome {
    const outcome = emptyOutcome(true);
    if (args.length < 2) return outcome;
    const handleValue = Number(args[0]);
    const selector = args[1];
    outcome.logs.push(
      `[providers] $registerDocumentColorProvider handle=${handleValue} selector=${stringifyPreview(selector, 200)} isArr=${Array.isArray(selector)} isFinite=${Number.isFinite(handleValue)}`,
    );

    const handle = Number.isFinite(handleValue) ? handleValue : null;
    const normalizedSelector = normalizeSelector(selector);
    if (handle === null || !normalizedSelector) return outcome;

    this.providers.documentColors.set(handle, {
      handle,
      selector: normalizedSelector,
    });
    for (const language of selectorLanguages(normalizedSelector)) {
      outcome.events.push({
        type: "provider/documentColors",
        handle,
        language,
      });
    }
    outcome.logs.push(
      `[providers] documentColors map size=${this.providers.documentColors.size} languages=[${this.languageSummary("documentColors")}]`,
    );
    return outcome;
  }
}
