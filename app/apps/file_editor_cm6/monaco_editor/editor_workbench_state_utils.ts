export interface WorkbenchPendingDidChangePayload {
  path: string;
  text: string;
  languageId: string;
  generation: number;
}

export interface WorkbenchPendingSymbolsPayload {
  path: string;
  generation: number;
}

export interface WorkbenchFlowLike {
  activePath?: string;
  generation?: number;
  openAckGeneration?: number;
  openAckPath?: string;
  openAckPromise?: Promise<unknown> | null;
  openAckPromiseGeneration?: number;
  openAckPromisePath?: string;
  pendingDidChange?: WorkbenchPendingDidChangePayload | null;
  pendingSymbols?: WorkbenchPendingSymbolsPayload | null;
}

export function wbCurrentGeneration(wbFlow: WorkbenchFlowLike | null | undefined): number {
  return Number(wbFlow?.generation || 0);
}

export function wbSetOpenAck(
  wbFlow: WorkbenchFlowLike | null | undefined,
  path: string | null | undefined,
  generation: number | null | undefined,
  currentGenerationFn?: (() => number) | null,
): void {
  if (!wbFlow) return;
  wbFlow.openAckPath = String(path || '');
  const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.openAckGeneration = Number.isFinite(Number(generation)) ? Number(generation) : fallback;
}

export function wbQueueDidChange(
  wbFlow: WorkbenchFlowLike | null | undefined,
  path: string | null | undefined,
  text: string | null | undefined,
  languageId: string | null | undefined,
  generation: number | null | undefined,
  currentGenerationFn?: (() => number) | null,
): void {
  if (!wbFlow) return;
  const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.pendingDidChange = {
    path: String(path || ''),
    text: String(text || ''),
    languageId: String(languageId || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
}

export function wbQueueSymbols(
  wbFlow: WorkbenchFlowLike | null | undefined,
  path: string | null | undefined,
  generation: number | null | undefined,
  currentGenerationFn?: (() => number) | null,
): void {
  if (!wbFlow) return;
  const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  wbFlow.pendingSymbols = {
    path: String(path || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
}
