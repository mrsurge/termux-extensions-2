interface SemanticTokensLegendLike {
  tokenTypes?: unknown[];
  tokenModifiers?: unknown[];
}

interface SemanticTokensBridgeLike {
  registeredSemanticTokens: Set<string>;
  semanticTokensProviderKeysByLanguage: Record<string, Set<string>>;
  semanticTokensLegendCache: Record<string, unknown>;
  semanticTokensRangeFlag: Record<string, unknown>;
  semanticTokensLanguagesByEventHandle: Record<string, string[]>;
}

export interface SemanticTokensRegisteredPayload {
  handle?: unknown;
  language?: string;
  legend?: SemanticTokensLegendLike;
  range?: boolean;
  eventHandle?: unknown;
  resync?: boolean;
}

function asSemanticTokensRegisteredPayload(value: unknown): SemanticTokensRegisteredPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as SemanticTokensRegisteredPayload
    : null;
}

export function handleSemanticTokensProviderRegistered(
  data: unknown,
  languageBridge: SemanticTokensBridgeLike,
  registerSemanticTokensFn: (
    lang: string,
    legend: SemanticTokensLegendLike,
    isRange: boolean,
    options?: {
      providerKey?: string;
      replay?: boolean;
    },
  ) => void,
): void {
  const typedData = asSemanticTokensRegisteredPayload(data);
  const lang = typedData?.language;
  const legend = typedData?.legend;
  if (!lang || !legend || !legend.tokenTypes || !legend.tokenModifiers) return;
  const eventHandle = Number(typedData?.eventHandle);
  if (Number.isFinite(eventHandle)) {
    const key = String(eventHandle);
    const languages = languageBridge.semanticTokensLanguagesByEventHandle[key] || [];
    if (!languages.includes(lang)) languages.push(lang);
    languageBridge.semanticTokensLanguagesByEventHandle[key] = languages;
  }
  console.log(
    '[semanticTokens] push cached legend for ' + lang
    + ' types=' + legend.tokenTypes.length
    + ' mods=' + legend.tokenModifiers.length
    + ' range=' + !!typedData?.range,
  );
  const handle = typedData?.handle == null
    ? ""
    : String(typedData.handle).trim();
  registerSemanticTokensFn(lang, legend, !!typedData?.range, {
    providerKey: handle
      ? `${handle}:${typedData?.range ? "range" : "full"}`
      : undefined,
    replay: typedData?.resync === true,
  });
}
