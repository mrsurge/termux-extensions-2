interface WorkbenchBarrierFlowLike {
  openAckGeneration?: number;
  openAckPath?: string;
}

interface WorkbenchBarrierOptions {
  win?: Window & typeof globalThis;
  editor?: object | null;
  model?: object | null;
  currentPath?: string | null;
  path?: string | null;
  generation?: number | null;
  currentGeneration?: number | null;
  wbFlow?: WorkbenchBarrierFlowLike | null;
}

export function isAdapterReady(win: (Window & typeof globalThis) | null | undefined): boolean {
  return !!(win && (win as Window & typeof globalThis & { __te2AdapterReady?: boolean }).__te2AdapterReady);
}

export function wbIsFrameworkReady(editor: object | null | undefined, model: object | null | undefined, currentPath: string | null | undefined): boolean {
  return !!(editor && model && currentPath);
}

export function wbIsBarrierOpen(opts: WorkbenchBarrierOptions | null | undefined): boolean {
  const options = opts || {};
  if (!isAdapterReady(options.win)) return false;
  if (!wbIsFrameworkReady(options.editor, options.model, options.currentPath)) return false;
  const wantPath = String(options.path || options.currentPath || '');
  const wantGen = Number.isFinite(Number(options.generation)) ? Number(options.generation) : Number(options.currentGeneration || 0);
  return Number(options.wbFlow?.openAckGeneration || -1) === wantGen
    && String(options.wbFlow?.openAckPath || '') === wantPath;
}
