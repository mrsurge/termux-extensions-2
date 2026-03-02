export function wbCurrentGeneration(wbFlow) {
  return Number((wbFlow && wbFlow.generation) || 0);
}

export function wbSetOpenAck(wbFlow, path, generation, currentGenerationFn) {
  if (!wbFlow) return;
  wbFlow.openAckPath = String(path || '');
  var fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.openAckGeneration = Number.isFinite(Number(generation)) ? Number(generation) : fallback;
}

export function wbQueueDidChange(wbFlow, path, text, languageId, generation, currentGenerationFn) {
  if (!wbFlow) return;
  var fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.pendingDidChange = {
    path: String(path || ''),
    text: String(text || ''),
    languageId: String(languageId || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
}

export function wbQueueSymbols(wbFlow, path, generation, currentGenerationFn) {
  if (!wbFlow) return;
  var fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.pendingSymbols = {
    path: String(path || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
}
