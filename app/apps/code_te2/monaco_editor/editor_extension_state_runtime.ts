interface DisposableLike {
  dispose?(): void;
}

export interface ExtensionEditorSelectionLike extends Record<string, unknown> {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  selectionStartLineNumber?: number;
  selectionStartColumn?: number;
  positionLineNumber?: number;
  positionColumn?: number;
}

interface CursorSelectionEventLike {
  source?: string;
}

export interface ExtensionEditorLike {
  getModel?(): unknown;
  getSelection?(): ExtensionEditorSelectionLike | null;
  getPosition?(): { lineNumber?: number; column?: number } | null;
  onDidChangeCursorSelection?(
    listener: (event: CursorSelectionEventLike) => void,
  ): DisposableLike;
  onDidChangeModel?(listener: () => void): DisposableLike;
}

interface ExtensionEditorStateRuntimeDeps {
  getCurrentPath(): string | null;
  notify(method: string, params: Record<string, unknown>): boolean;
  setTimeoutFn(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

export function buildExtensionEditorSelection(
  editor: ExtensionEditorLike | null,
): Record<string, number> {
  const raw = editor?.getSelection?.() ?? null;
  const position = editor?.getPosition?.() ?? null;
  const startLineNumber = positiveInteger(
    raw?.startLineNumber,
    positiveInteger(position?.lineNumber, 1),
  );
  const startColumn = positiveInteger(
    raw?.startColumn,
    positiveInteger(position?.column, 1),
  );
  const endLineNumber = positiveInteger(raw?.endLineNumber, startLineNumber);
  const endColumn = positiveInteger(raw?.endColumn, startColumn);
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    selectionStartLineNumber: positiveInteger(
      raw?.selectionStartLineNumber,
      startLineNumber,
    ),
    selectionStartColumn: positiveInteger(
      raw?.selectionStartColumn,
      startColumn,
    ),
    positionLineNumber: positiveInteger(raw?.positionLineNumber, endLineNumber),
    positionColumn: positiveInteger(raw?.positionColumn, endColumn),
  };
}

function selectionSource(value: unknown): string {
  const source = typeof value === "string" ? value : "";
  if (source === "mouse" || source === "keyboard") return source;
  if (source === "code.navigation" || source === "code.jump") return source;
  return "api";
}

export function createEditorExtensionStateRuntime(
  deps: ExtensionEditorStateRuntimeDeps,
) {
  let editor: ExtensionEditorLike | null = null;
  let editorDisposables: DisposableLike[] = [];
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSource = "api";
  let lastPublishedKey = "";

  function snapshot(source: string): Record<string, unknown> | null {
    const path = deps.getCurrentPath();
    if (!path || !editor?.getModel?.()) return null;
    return {
      path,
      source: selectionSource(source),
      selection: buildExtensionEditorSelection(editor),
    };
  }

  function publish(reason = "selection", force = false): boolean {
    const current = snapshot(pendingSource);
    if (!current) return false;
    const key = JSON.stringify([current.path, current.selection]);
    if (!force && key === lastPublishedKey) return true;
    const sent = deps.notify("vscode.editorState.update", {
      ...current,
      reason,
    });
    if (sent) lastPublishedKey = key;
    return sent;
  }

  function schedule(event?: CursorSelectionEventLike): void {
    pendingSource = selectionSource(event?.source);
    if (publishTimer != null) return;
    publishTimer = deps.setTimeoutFn(() => {
      publishTimer = null;
      publish("selection");
    }, 16);
  }

  function attach(nextEditor: ExtensionEditorLike | null): void {
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = nextEditor;
    lastPublishedKey = "";
    pendingSource = "api";
    if (editor?.onDidChangeCursorSelection) {
      editorDisposables.push(editor.onDidChangeCursorSelection(schedule));
    }
    if (editor?.onDidChangeModel) {
      editorDisposables.push(
        editor.onDidChangeModel(() => {
          lastPublishedKey = "";
          pendingSource = "api";
        }),
      );
    }
  }

  function resync(reason = "resync"): boolean {
    pendingSource = "api";
    return publish(reason, true);
  }

  function dispose(): void {
    if (publishTimer != null) deps.clearTimeoutFn(publishTimer);
    publishTimer = null;
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = null;
    lastPublishedKey = "";
  }

  return {
    attach,
    publish,
    resync,
    dispose,
  };
}
