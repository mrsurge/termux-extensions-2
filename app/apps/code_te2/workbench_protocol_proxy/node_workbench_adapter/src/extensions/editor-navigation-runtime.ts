export interface ExtensionEditorNavigationRpcIds {
  MainThreadTextEditors: number;
}

export interface ExtensionEditorNavigationRequest {
  kind: "ext";
  type?: number;
  req?: number;
  rpcId?: number;
  method?: string;
  args?: unknown[];
}

export interface ExtensionEditorNavigationResult {
  handled: boolean;
  replyResult?: unknown;
  pending?: Promise<unknown>;
  error?: unknown;
}

interface PendingOpen {
  path: string;
  selection: Record<string, unknown> | null;
  returnEditorId: boolean;
  backendAccepted: boolean;
  completing: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingEditorOperation {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ExtensionEditorNavigationRuntimeOptions {
  rpcIds: ExtensionEditorNavigationRpcIds;
  fsPathFromUri(uri: unknown): string | null;
  activePath(): string | null;
  activeEditorId(): string | null;
  emitBackendEvent(payload: Record<string, unknown>): void;
  notifyEditor(method: string, params: Record<string, unknown>): void;
  createId(): string;
  log(...args: unknown[]): void;
  setTimeoutFn?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeoutFn?(timer: ReturnType<typeof setTimeout>): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.trunc(numeric));
}

function firstSelection(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return isRecord(first) ? first : null;
}

export class ExtensionEditorNavigationRuntime {
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private readonly pendingEditorOperations = new Map<string, PendingEditorOperation>();
  private readonly setTimeoutFn: NonNullable<ExtensionEditorNavigationRuntimeOptions["setTimeoutFn"]>;
  private readonly clearTimeoutFn: NonNullable<ExtensionEditorNavigationRuntimeOptions["clearTimeoutFn"]>;

  constructor(private readonly options: ExtensionEditorNavigationRuntimeOptions) {
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  reset(reason = "navigation_reset"): void {
    const error = new Error(reason);
    for (const pending of this.pendingOpens.values()) {
      this.clearTimeoutFn(pending.timer);
      pending.reject(error);
    }
    this.pendingOpens.clear();
    for (const pending of this.pendingEditorOperations.values()) {
      this.clearTimeoutFn(pending.timer);
      pending.reject(error);
    }
    this.pendingEditorOperations.clear();
  }

  handleMainThreadRequest(
    message: ExtensionEditorNavigationRequest,
  ): ExtensionEditorNavigationResult {
    if (message.rpcId !== this.options.rpcIds.MainThreadTextEditors) {
      return { handled: false };
    }
    const args = Array.isArray(message.args) ? message.args : [];
    switch (message.method) {
      case "$tryShowTextDocument":
        return {
          handled: true,
          pending: this.requestVisibleOpen(args[0], isRecord(args[1]) ? args[1] : {}, true),
        };
      case "$tryShowEditor":
        return {
          handled: true,
          pending: this.showEditor(args[0]),
        };
      case "$trySetSelections":
        return {
          handled: true,
          pending: this.runEditorOperation(args[0], "setSelections", {
            selections: Array.isArray(args[1]) ? args[1] : [],
          }),
        };
      case "$tryRevealRange":
        return {
          handled: true,
          pending: this.runEditorOperation(args[0], "revealRange", {
            range: isRecord(args[1]) ? args[1] : null,
            revealType: Number.isFinite(Number(args[2])) ? Number(args[2]) : 0,
          }),
        };
      case "$tryHideEditor":
        return {
          handled: true,
          error: new Error("TE2 does not expose hidden editor groups"),
        };
      default:
        return {
          handled: true,
          error: new Error(
            `Unsupported MainThreadTextEditors method: ${String(message.method)}`,
          ),
        };
    }
  }

  openFromWorkbenchCommand(uri: unknown, options: unknown): Promise<unknown> {
    const normalizedOptions = isRecord(options)
      ? options
      : Array.isArray(options) && isRecord(options[1])
        ? options[1]
        : {};
    return this.requestVisibleOpen(uri, normalizedOptions, false);
  }

  completeBackendOpen(params: Record<string, unknown>): Record<string, unknown> {
    const requestId = stringValue(params.requestId) ?? stringValue(params.request_id);
    if (!requestId) throw new Error("Missing extension navigation request id");
    const pending = this.pendingOpens.get(requestId);
    if (!pending) return { ok: false, stale: true, requestId };
    if (params.ok !== true) {
      this.failOpen(requestId, new Error(stringValue(params.error) ?? "Editor open failed"));
      return { ok: true, requestId };
    }
    const completedPath = stringValue(params.path);
    if (completedPath && completedPath !== pending.path) {
      this.failOpen(requestId, new Error("Editor open completed for a different path"));
      return { ok: true, requestId };
    }
    pending.backendAccepted = true;
    this.maybeCompleteOpen(requestId, pending);
    return { ok: true, requestId };
  }

  completeEditorOperation(params: Record<string, unknown>): Record<string, unknown> {
    const operationId = stringValue(params.operationId) ?? stringValue(params.operation_id);
    if (!operationId) throw new Error("Missing editor operation id");
    const pending = this.pendingEditorOperations.get(operationId);
    if (!pending) return { ok: false, stale: true, operationId };
    this.pendingEditorOperations.delete(operationId);
    this.clearTimeoutFn(pending.timer);
    if (params.ok === false) {
      pending.reject(new Error(stringValue(params.error) ?? "Editor operation failed"));
    } else {
      pending.resolve();
    }
    return { ok: true, operationId };
  }

  activeEditorChanged(path: string): void {
    for (const [requestId, pending] of this.pendingOpens) {
      if (pending.path === path) this.maybeCompleteOpen(requestId, pending);
    }
  }

  private requestVisibleOpen(
    uri: unknown,
    options: Record<string, unknown>,
    returnEditorId: boolean,
  ): Promise<unknown> {
    const path = this.options.fsPathFromUri(uri);
    if (!path) {
      return Promise.reject(new Error("TE2 can only open file-backed extension resources"));
    }
    const requestId = `extension_open_${this.options.createId()}`;
    const selection = firstSelection(options.selection);
    const line = positiveInteger(selection?.startLineNumber);
    const column = positiveInteger(selection?.startColumn);
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        this.failOpen(requestId, new Error(`Extension editor open timed out: ${path}`));
      }, 30000);
      this.pendingOpens.set(requestId, {
        path,
        selection,
        returnEditorId,
        backendAccepted: false,
        completing: false,
        resolve,
        reject,
        timer,
      });
    });
    this.options.emitBackendEvent({
      type: "extension/editorOpenRequested",
      ts_ms: Date.now(),
      requestId,
      path,
      uri,
      line,
      column,
      focus: options.preserveFocus !== true,
      selection,
    });
    return promise;
  }

  private showEditor(rawEditorId: unknown): Promise<void> {
    return this.runEditorOperation(rawEditorId, "showEditor", { focus: true });
  }

  private runEditorOperation(
    rawEditorId: unknown,
    operation: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const editorId = stringValue(rawEditorId);
    const activeEditorId = this.options.activeEditorId();
    const path = this.options.activePath();
    if (!editorId || !activeEditorId || editorId !== activeEditorId || !path) {
      return Promise.reject(new Error(`TextEditor(${String(rawEditorId)}) is not active`));
    }
    const operationId = `extension_editor_${this.options.createId()}`;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        const pending = this.pendingEditorOperations.get(operationId);
        if (!pending) return;
        this.pendingEditorOperations.delete(operationId);
        pending.reject(new Error(`Extension editor operation timed out: ${operation}`));
      }, 12000);
      this.pendingEditorOperations.set(operationId, { resolve, reject, timer });
    });
    this.options.notifyEditor("vscode.editorOperation", {
      operationId,
      operation,
      editorId,
      path,
      ...data,
    });
    return promise;
  }

  private maybeCompleteOpen(requestId: string, pending: PendingOpen): void {
    const editorId = this.options.activeEditorId();
    if (
      !pending.backendAccepted ||
      pending.completing ||
      this.options.activePath() !== pending.path ||
      !editorId
    ) {
      return;
    }
    pending.completing = true;
    const selectionPromise = pending.selection
      ? this.runEditorOperation(editorId, "setSelections", {
          selections: [pending.selection],
          revealSelection: true,
        })
      : Promise.resolve();
    selectionPromise.then(() => {
      const current = this.pendingOpens.get(requestId);
      if (current !== pending) return;
      this.pendingOpens.delete(requestId);
      this.clearTimeoutFn(pending.timer);
      pending.resolve(pending.returnEditorId ? editorId : undefined);
      this.options.log(`[extension-navigation] completed ${requestId} path=${pending.path}`);
    }).catch((error) => this.failOpen(
      requestId,
      error instanceof Error ? error : new Error(String(error)),
    ));
  }

  private failOpen(requestId: string, error: Error): void {
    const pending = this.pendingOpens.get(requestId);
    if (!pending) return;
    this.pendingOpens.delete(requestId);
    this.clearTimeoutFn(pending.timer);
    pending.reject(error);
  }
}
