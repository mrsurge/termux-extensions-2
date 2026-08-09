import type { WorkbenchFlowLike, WorkbenchPendingDidChangePayload, WorkbenchPendingSymbolsPayload } from './editor_workbench_state_utils.js';

export function wbFlushDidChangeIfReady(
  wbFlow: WorkbenchFlowLike | null | undefined,
  isBarrierOpenFn: ((path: string, generation: number) => boolean) | null | undefined,
  emitDidChangeFn: ((payload: WorkbenchPendingDidChangePayload) => boolean) | null | undefined,
): void {
  const pending = wbFlow?.pendingDidChange;
  if (!pending) return;
  if (!(typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(pending.path, pending.generation))) return;
  wbFlow.pendingDidChange = null;
  if (typeof emitDidChangeFn === 'function') emitDidChangeFn(pending);
}

export function wbFlushSymbolsIfReady(
  wbFlow: WorkbenchFlowLike | null | undefined,
  isBarrierOpenFn: ((path: string, generation: number) => boolean) | null | undefined,
  requestSymbolsFn: ((path: string, opts: { generation: number; fromQueue: boolean }) => void) | null | undefined,
): void {
  const pending = wbFlow?.pendingSymbols;
  if (!pending) return;
  if (!(typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(pending.path, pending.generation))) return;
  wbFlow.pendingSymbols = null;
  if (typeof requestSymbolsFn === 'function') {
    requestSymbolsFn(pending.path, { generation: pending.generation, fromQueue: true });
  }
}

export function wbFlushPendingAfterOpen(
  flushDidChangeFn: (() => void) | null | undefined,
  flushSymbolsFn: (() => void) | null | undefined,
): void {
  if (typeof flushDidChangeFn === 'function') flushDidChangeFn();
  if (typeof flushSymbolsFn === 'function') flushSymbolsFn();
}

export function wbPublishDidChange(
  wbFlow: WorkbenchFlowLike | null | undefined,
  path: string | null | undefined,
  text: string | null | undefined,
  languageId: string | null | undefined,
  generation: number | null | undefined,
  currentGenerationFn: (() => number) | null | undefined,
  isBarrierOpenFn: ((path: string, generation: number) => boolean) | null | undefined,
  emitDidChangeFn: ((payload: WorkbenchPendingDidChangePayload) => boolean) | null | undefined,
  queueDidChangeFn: ((path: string, text: string, languageId: string, generation: number) => void) | null | undefined,
): boolean {
  const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : 0;
  const payload: WorkbenchPendingDidChangePayload = {
    path: String(path || ''),
    text: String(text || ''),
    languageId: String(languageId || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
  if (typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(payload.path, payload.generation)) {
    return typeof emitDidChangeFn === 'function' ? emitDidChangeFn(payload) : false;
  }
  if (typeof queueDidChangeFn === 'function') {
    queueDidChangeFn(payload.path, payload.text, payload.languageId, payload.generation);
  }
  return false;
}
