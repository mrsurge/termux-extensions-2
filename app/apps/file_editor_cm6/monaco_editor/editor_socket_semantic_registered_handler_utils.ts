interface SemanticTokensLegendLike {
  tokenTypes?: unknown[];
  tokenModifiers?: unknown[];
}

interface SemanticTokensBridgeLike {
  registeredSemanticTokens: Set<string>;
  semanticTokensLegendCache: Record<string, unknown>;
  semanticTokensRangeFlag: Record<string, unknown>;
}

export interface SemanticTokensRegisteredPayload {
  language?: string;
  legend?: SemanticTokensLegendLike;
  range?: boolean;
}

function asSemanticTokensRegisteredPayload(value: unknown): SemanticTokensRegisteredPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as SemanticTokensRegisteredPayload
    : null;
}

export function handleSemanticTokensProviderRegistered(
  data: unknown,
  languageBridge: SemanticTokensBridgeLike,
  registerSemanticTokensFn: (lang: string, legend: SemanticTokensLegendLike, isRange: boolean) => void,
): void {
  const typedData = asSemanticTokensRegisteredPayload(data);
  const lang = typedData?.language;
  const legend = typedData?.legend;
  if (!lang || !legend || !legend.tokenTypes || !legend.tokenModifiers) return;
  if (languageBridge.registeredSemanticTokens.has(lang)) return;
  console.log(
    '[semanticTokens] push cached legend for ' + lang
    + ' types=' + legend.tokenTypes.length
    + ' mods=' + legend.tokenModifiers.length
    + ' range=' + !!typedData?.range,
  );
  languageBridge.semanticTokensLegendCache[lang] = legend;
  if (typedData?.range) languageBridge.semanticTokensRangeFlag[lang] = true;
  registerSemanticTokensFn(lang, legend, !!typedData?.range);
}
