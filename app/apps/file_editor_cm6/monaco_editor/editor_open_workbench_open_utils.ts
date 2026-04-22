interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  getValue?(): string;
  getLanguageId?(): string;
  uri?: MonacoUriLike;
}

interface QueueBackendWorkbenchOpenOptions {
  model: MonacoModelLike | null;
  currentPath: string;
  lang: string;
  generation: number;
  queueDidChangeFn(path: string, text: string, languageId: string, generation: number): void;
  queueSymbolsFn(path: string, generation: number): void;
  openFileFlowFn(opts: Record<string, unknown>): Promise<unknown>;
}

export function queueBackendWorkbenchOpen(opts: QueueBackendWorkbenchOpenOptions | null | undefined): void {
  const options = opts;
  if (!options) return;
  try {
    const requestId = 'diag_' + Date.now() + '_backend';
    const text = options.model && options.model.getValue ? options.model.getValue() : '';
    options.queueDidChangeFn(options.currentPath, text, options.model && options.model.getLanguageId ? options.model.getLanguageId() : options.lang, options.generation);
    options.queueSymbolsFn(options.currentPath, options.generation);
    options.openFileFlowFn({
      path: options.currentPath,
      languageId: options.lang,
      uri: options.model && options.model.uri ? String(options.model.uri.toString()) : '',
      requestId,
      forceRefresh: true,
      generation: options.generation,
      source: 'openPathFromBackend',
      timeoutMs: 8000,
    }).catch(() => {});
  } catch (_) {}
}
