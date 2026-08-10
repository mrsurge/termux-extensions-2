interface ExtensionMenuAction extends Record<string, unknown> {
  command: string;
  title: string;
  category: string | null;
  extensionId: string;
  group: string | null;
  icon: string | null;
}

interface DisposableLike {
  dispose?(): void;
}

interface SelectionLike extends Record<string, unknown> {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  selectionStartLineNumber?: number;
  selectionStartColumn?: number;
  positionLineNumber?: number;
  positionColumn?: number;
}

interface ModelLike {
  getLanguageId?(): string;
}

interface EditorLike {
  getModel?(): ModelLike | null;
  getSelection?(): SelectionLike | null;
  getPosition?(): { lineNumber?: number; column?: number } | null;
  onDidChangeCursorSelection?(listener: () => void): DisposableLike;
  onDidChangeModel?(listener: () => void): DisposableLike;
}

interface ExtensionEditorMenuRuntimeDeps {
  getDocument(): Document;
  getCurrentPath(): string | null;
  rpcCall(
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  notify(message: string): void;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" && value[key]
    ? String(value[key])
    : null;
}

function parseActions(value: unknown): ExtensionMenuAction[] {
  if (!isRecord(value) || !Array.isArray(value.actions)) return [];
  const actions: ExtensionMenuAction[] = [];
  for (const raw of value.actions) {
    const command = stringField(raw, "command");
    const title = stringField(raw, "title");
    const extensionId = stringField(raw, "extensionId");
    if (!command || !title || !extensionId) continue;
    actions.push({
      command,
      title,
      extensionId,
      category: stringField(raw, "category"),
      group: stringField(raw, "group"),
      icon: stringField(raw, "icon"),
    });
  }
  return actions;
}

function selectionPayload(editor: EditorLike | null): Record<string, number> {
  const raw = editor?.getSelection?.() ?? null;
  const position = editor?.getPosition?.() ?? null;
  const number = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
  };
  const startLineNumber = number(raw?.startLineNumber, number(position?.lineNumber, 1));
  const startColumn = number(raw?.startColumn, number(position?.column, 1));
  const endLineNumber = number(raw?.endLineNumber, startLineNumber);
  const endColumn = number(raw?.endColumn, startColumn);
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    selectionStartLineNumber: number(raw?.selectionStartLineNumber, startLineNumber),
    selectionStartColumn: number(raw?.selectionStartColumn, startColumn),
    positionLineNumber: number(raw?.positionLineNumber, endLineNumber),
    positionColumn: number(raw?.positionColumn, endColumn),
  };
}

function actionLabel(action: ExtensionMenuAction): string {
  return action.category ? `${action.category}: ${action.title}` : action.title;
}

function buildToolIcon(documentRef: Document, action: ExtensionMenuAction): HTMLElement {
  const root = documentRef.createElement("span");
  root.className = "icon fe-extension-context-icon";
  root.setAttribute("aria-hidden", "true");
  if (action.icon) {
    const image = documentRef.createElement("img");
    image.src = action.icon;
    image.alt = "";
    root.appendChild(image);
  } else {
    root.textContent = "◇";
  }
  return root;
}

export function createEditorExtensionMenuRuntime(
  deps: ExtensionEditorMenuRuntimeDeps,
) {
  let editor: EditorLike | null = null;
  let editorDisposables: DisposableLike[] = [];
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshSequence = 0;
  let titleActions: ExtensionMenuAction[] = [];
  let contextActions: ExtensionMenuAction[] = [];

  function context(): Record<string, unknown> | null {
    const path = deps.getCurrentPath();
    const activeModel = editor?.getModel?.() ?? null;
    if (!path || !activeModel) return null;
    return {
      path,
      languageId: activeModel.getLanguageId?.() ?? "plaintext",
      selection: selectionPayload(editor),
    };
  }

  function toolbarRoot(): HTMLElement | null {
    return deps.getDocument().getElementById("fe-extension-editor-actions");
  }

  function renderTitleActions(): void {
    const root = toolbarRoot();
    if (!root) return;
    root.replaceChildren();
    root.hidden = titleActions.length === 0;
    for (const action of titleActions) {
      const button = deps.getDocument().createElement("button");
      button.type = "button";
      button.className = "fe-btn fe-icon-btn fe-extension-editor-action";
      button.title = actionLabel(action);
      button.setAttribute("aria-label", actionLabel(action));
      if (action.icon) {
        const image = deps.getDocument().createElement("img");
        image.src = action.icon;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        button.appendChild(image);
      } else {
        button.textContent = action.title.slice(0, 1).toUpperCase();
      }
      button.addEventListener("click", () => {
        void execute(action);
      });
      root.appendChild(button);
    }
  }

  async function resolveMenu(
    menu: "editor/title" | "editor/context",
    currentContext: Record<string, unknown>,
  ): Promise<ExtensionMenuAction[]> {
    const result = await deps.rpcCall(
      "vscode.extensionMenus.resolve",
      { ...currentContext, menu },
      { timeoutMs: 12000 },
    );
    return parseActions(result);
  }

  async function refresh(reason = "refresh"): Promise<void> {
    const sequence = ++refreshSequence;
    const currentContext = context();
    if (!currentContext) {
      titleActions = [];
      contextActions = [];
      renderTitleActions();
      return;
    }
    try {
      const [nextTitleActions, nextContextActions] = await Promise.all([
        resolveMenu("editor/title", currentContext),
        resolveMenu("editor/context", currentContext),
      ]);
      if (sequence !== refreshSequence) return;
      titleActions = nextTitleActions;
      contextActions = nextContextActions;
      renderTitleActions();
    } catch (error) {
      if (sequence !== refreshSequence) return;
      titleActions = [];
      contextActions = [];
      renderTitleActions();
      console.warn(`[extension-menus] ${reason} failed`, error);
    }
  }

  function scheduleSelectionRefresh(): void {
    if (selectionTimer != null) deps.clearTimeoutFn(selectionTimer);
    selectionTimer = deps.setTimeoutFn(() => {
      selectionTimer = null;
      void refresh("selection");
    }, 40);
  }

  async function execute(action: ExtensionMenuAction): Promise<void> {
    const currentContext = context();
    if (!currentContext) return;
    try {
      await deps.rpcCall(
        "vscode.extensionCommands.execute",
        { ...currentContext, command: action.command },
        { timeoutMs: 35000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.notify(`Extension command failed: ${message}`);
      console.error("[extension-menus] command failed", action.command, error);
    }
  }

  function attach(nextEditor: EditorLike | null): void {
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = nextEditor;
    if (editor?.onDidChangeCursorSelection) {
      editorDisposables.push(editor.onDidChangeCursorSelection(scheduleSelectionRefresh));
    }
    if (editor?.onDidChangeModel) {
      editorDisposables.push(editor.onDidChangeModel(() => void refresh("model")));
    }
    void refresh("attach");
  }

  function navigationTools(): MonacoTouchSelectionTool[] {
    return contextActions.map((action) => ({
      name: actionLabel(action),
      innerHTML: buildToolIcon(deps.getDocument(), action),
      action: () => execute(action),
    }));
  }

  function dispose(): void {
    refreshSequence += 1;
    if (selectionTimer != null) deps.clearTimeoutFn(selectionTimer);
    selectionTimer = null;
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = null;
    titleActions = [];
    contextActions = [];
    renderTitleActions();
  }

  return {
    attach,
    refresh,
    navigationTools,
    dispose,
  };
}
