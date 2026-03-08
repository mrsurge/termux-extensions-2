export function handleSemanticTokensProviderRegistered(data, languageBridge, registerSemanticTokensFn) {
  var lang = data && data.language;
  var legend = data && data.legend;
  if (!lang || !legend || !legend.tokenTypes || !legend.tokenModifiers) return;
  if (languageBridge.registeredSemanticTokens.has(lang)) return;
  console.log('[semanticTokens] push cached legend for ' + lang + ' types=' + legend.tokenTypes.length + ' mods=' + legend.tokenModifiers.length + ' range=' + !!data.range);
  languageBridge.semanticTokensLegendCache[lang] = legend;
  if (data.range) languageBridge.semanticTokensRangeFlag[lang] = true;
  registerSemanticTokensFn(lang, legend, !!data.range);
}
