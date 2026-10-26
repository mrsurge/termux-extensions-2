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
  getSelections?(): ExtensionEditorSelectionLike[] | null;
  getVisibleRanges?(): ExtensionEditorSelectionLike[];
  getOption?(id: unknown): unknown;
  getPosition?(): { lineNumber?: number; column?: number } | null;
  onDidChangeCursorSelection?(
    listener: (event: CursorSelectionEventLike) => void,
  ): DisposableLike;
  onDidChangeModel?(listener: () => void): DisposableLike;
  onDidScrollChange?(listener: () => void): DisposableLike;
  onDidLayoutChange?(listener: () => void): DisposableLike;
  onDidChangeConfiguration?(listener: () => void): DisposableLike;
  onDidChangeModelOptions?(listener: () => void): DisposableLike;
  onDidDispose?(listener: () => void): DisposableLike;
}

interface ExtensionEditorStateRuntimeDeps {
  getCurrentPath(): string | null;
  getGeneration?(): number;
  canPublish?(): boolean;
  getEditorOptionIds?(): { cursorStyle: number; lineNumbers: number } | null;
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
  selection?: ExtensionEditorSelectionLike,
): Record<string, number> {
  const raw = selection ?? editor?.getSelection?.() ?? null;
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelWithOptions(value: unknown): value is { getOptions(): unknown } {
  return record(value) && typeof value.getOptions === "function";
}

function editorOptions(editor: ExtensionEditorLike, deps: ExtensionEditorStateRuntimeDeps): Record<string, unknown> | null {
  const ids = deps.getEditorOptionIds?.();
  const model = editor.getModel?.();
  const modelOptions = modelWithOptions(model) ? model.getOptions() : null;
  if (!ids || !record(modelOptions)) return null;
  const lineNumbers = editor.getOption?.(ids.lineNumbers);
  const cursorStyle = editor.getOption?.(ids.cursorStyle);
  if (!record(lineNumbers) || typeof lineNumbers.renderType !== "number" ||
      typeof cursorStyle !== "number" || typeof modelOptions.insertSpaces !== "boolean" ||
      typeof modelOptions.tabSize !== "number" || typeof modelOptions.indentSize !== "number" ||
      !(typeof modelOptions.originalIndentSize === "number" || modelOptions.originalIndentSize === "tabSize")) return null;
  return {
    insertSpaces: modelOptions.insertSpaces, tabSize: modelOptions.tabSize,
    indentSize: modelOptions.indentSize, originalIndentSize: modelOptions.originalIndentSize,
    cursorStyle, lineNumbers: lineNumbers.renderType,
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
  const lastPublished = new Map<string, string>();
  let attachmentEpoch = 0;
  let lastIdentity = "";
  let pendingReason = "selection";

  function snapshot(source: string): Record<string, unknown> | null {
    const path = deps.getCurrentPath();
    if (!path || !editor?.getModel?.() || deps.canPublish?.() === false) return null;
    const selections = editor.getSelections?.();
    const ranges = editor.getVisibleRanges?.();
    const options = editorOptions(editor, deps);
    return {
      path,
      ...(deps.getGeneration ? { generation: deps.getGeneration() } : {}),
      source: selectionSource(source),
      selection: buildExtensionEditorSelection(editor),
      ...(selections ? { selections: selections.map(value => buildExtensionEditorSelection(editor, value)) } : {}),
      ...(ranges ? { visibleRanges: ranges.map(value => ({
        startLineNumber: value.startLineNumber, startColumn: value.startColumn,
        endLineNumber: value.endLineNumber, endColumn: value.endColumn,
      })) } : {}),
      ...(options ? { options } : {}),
    };
  }

  function publish(reason = "selection", force = false): boolean {
    const current = snapshot(pendingSource);
    if (!current) return false;
    const identity = JSON.stringify([current.path, current.generation]);
    if (identity !== lastIdentity) { lastPublished.clear(); lastIdentity = identity; }
    const payload: Record<string, unknown> = { path: current.path, source: current.source, reason };
    if (current.generation !== undefined) payload.generation = current.generation;
    const keys = new Map<string, string>();
    for (const property of ["selections", "visibleRanges", "options"]) {
      if (current[property] === undefined) continue;
      const key = JSON.stringify(current[property]);
      if (force || lastPublished.get(property) !== key) {
        payload[property] = current[property]; keys.set(property, key);
      }
    }
    // Preserve legacy peers' primary-selection field, without fabricating
    // selection events on viewport-only updates in matched WBA versions.
    const selectionKey = JSON.stringify(current.selection);
    if (force || lastPublished.get("selection") !== selectionKey) keys.set("selection", selectionKey);
    if (!keys.size) return true;
    payload.selection = current.selection;
    const sent = deps.notify("vscode.editorState.update", payload);
    if (sent) for (const [property, key] of keys) lastPublished.set(property, key);
    return sent;
  }

  function schedule(event?: CursorSelectionEventLike): void {
    if (event) pendingSource = selectionSource(event.source);
    if (publishTimer != null) return;
    publishTimer = deps.setTimeoutFn(() => {
      publishTimer = null;
      publish(pendingReason);
    }, 16);
  }

  function attach(nextEditor: ExtensionEditorLike | null): void {
    const epoch = ++attachmentEpoch;
    if (publishTimer != null) deps.clearTimeoutFn(publishTimer);
    publishTimer = null;
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = nextEditor;
    lastPublished.clear();
    pendingSource = "api";
    if (editor?.onDidChangeCursorSelection) {
      editorDisposables.push(editor.onDidChangeCursorSelection(event => {
        if (epoch !== attachmentEpoch) return;
        pendingReason = "selection";
        schedule(event);
      }));
    }
    if (editor?.onDidChangeModel) {
      editorDisposables.push(
        editor.onDidChangeModel(() => {
          if (epoch !== attachmentEpoch) return;
          if (publishTimer != null) deps.clearTimeoutFn(publishTimer);
          publishTimer = null;
          lastPublished.clear();
          pendingSource = "api";
        }),
      );
    }
    const scheduleProperties = () => {
      if (epoch !== attachmentEpoch) return;
      pendingReason = "properties";
      schedule();
    };
    for (const subscribe of [editor?.onDidScrollChange, editor?.onDidLayoutChange,
      editor?.onDidChangeConfiguration, editor?.onDidChangeModelOptions]) {
      if (subscribe && editor) editorDisposables.push(subscribe.call(editor, scheduleProperties));
    }
    if (editor?.onDidDispose) editorDisposables.push(editor.onDidDispose(() => {
      if (epoch === attachmentEpoch) attach(null);
    }));
  }

  function resync(reason = "resync"): boolean {
    if (publishTimer != null) deps.clearTimeoutFn(publishTimer);
    publishTimer = null;
    pendingSource = "api";
    return publish(reason, true);
  }

  function dispose(): void {
    attachmentEpoch++;
    if (publishTimer != null) deps.clearTimeoutFn(publishTimer);
    publishTimer = null;
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = null;
    lastPublished.clear();
  }

  return {
    attach,
    publish,
    resync,
    dispose,
  };
}
