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

export interface WorkbenchPendingOpenFilePayload {
  path: string;
  languageId: string;
  uri: string;
  requestId: string;
  forceRefresh: boolean;
  generation: number;
  source: string;
  timeoutMs: number;
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
  pendingOpenFile?: WorkbenchPendingOpenFilePayload | null;
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

export function wbQueueOpenFile(
  wbFlow: WorkbenchFlowLike | null | undefined,
  payload: Partial<WorkbenchPendingOpenFilePayload> | null | undefined,
  currentGenerationFn?: (() => number) | null,
): WorkbenchPendingOpenFilePayload | null {
  if (!wbFlow || !payload) return null;
  const path = String(payload.path || '');
  if (!path) return null;
  const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
  const generation = Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : fallback;
  const queued: WorkbenchPendingOpenFilePayload = {
    path,
    languageId: String(payload.languageId || ''),
    uri: String(payload.uri || ''),
    requestId: String(payload.requestId || ('open_' + Date.now())),
    forceRefresh: !!payload.forceRefresh,
    generation,
    source: String(payload.source || 'open'),
    timeoutMs: Number.isFinite(Number(payload.timeoutMs)) ? Number(payload.timeoutMs) : 8000,
  };
  wbFlow.pendingOpenFile = queued;
  return queued;
}
