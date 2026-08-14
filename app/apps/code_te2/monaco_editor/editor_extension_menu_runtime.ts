import {
  buildExtensionEditorSelection,
  type ExtensionEditorLike,
} from "./editor_extension_state_runtime.ts";

interface ExtensionMenuAction extends Record<string, unknown> {
  command: string;
  title: string;
  category: string | null;
  extensionId: string;
  group: string | null;
  icon: string | null;
  enabled: boolean;
  alternate: { command: string; title: string } | null;
}

interface DisposableLike {
  dispose?(): void;
}

interface ModelLike {
  getLanguageId?(): string;
}

interface EditorLike extends ExtensionEditorLike {
  getModel?(): ModelLike | null;
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
      enabled: raw.enabled !== false,
      alternate: isRecord(raw.alternate)
        && typeof raw.alternate.command === "string"
        && typeof raw.alternate.title === "string"
        ? {
            command: raw.alternate.command,
            title: raw.alternate.title,
          }
        : null,
    });
  }
  return actions;
}

function actionLabel(action: ExtensionMenuAction): string {
  return action.category ? `${action.category}: ${action.title}` : action.title;
}

function buildContextLauncherIcon(documentRef: Document): HTMLElement {
  const root = documentRef.createElement("span");
  root.className = "icon fe-extension-context-icon";
  root.setAttribute("aria-hidden", "true");
  root.textContent = "🧩";
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
  let toolbarScrollRoot: HTMLElement | null = null;
  let toolbarWheelListener: ((event: WheelEvent) => void) | null = null;
  let contextMenuRoot: HTMLElement | null = null;
  let documentPointerListener: ((event: PointerEvent) => void) | null = null;
  let documentKeyListener: ((event: KeyboardEvent) => void) | null = null;

  function context(): Record<string, unknown> | null {
    const path = deps.getCurrentPath();
    const activeModel = editor?.getModel?.() ?? null;
    if (!path || !activeModel) return null;
    return {
      path,
      languageId: activeModel.getLanguageId?.() ?? "plaintext",
      selection: buildExtensionEditorSelection(editor),
    };
  }

  function toolbarRoot(): HTMLElement | null {
    return deps.getDocument().getElementById("fe-extension-editor-actions");
  }

  function installToolbarScroll(): void {
    const root = toolbarRoot();
    if (root === toolbarScrollRoot) return;
    if (toolbarScrollRoot && toolbarWheelListener) {
      toolbarScrollRoot.removeEventListener("wheel", toolbarWheelListener);
    }
    toolbarScrollRoot = root;
    toolbarWheelListener = null;
    if (!root) return;
    toolbarWheelListener = (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (!delta || root.scrollWidth <= root.clientWidth) return;
      const previous = root.scrollLeft;
      root.scrollLeft += delta;
      if (root.scrollLeft !== previous) event.preventDefault();
    };
    root.addEventListener("wheel", toolbarWheelListener, { passive: false });
  }

  function renderTitleActions(): void {
    installToolbarScroll();
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
      button.disabled = !action.enabled;
      if (action.icon) {
        const image = deps.getDocument().createElement("img");
        image.src = action.icon;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        button.appendChild(image);
      } else {
        button.textContent = action.title.slice(0, 1).toUpperCase();
      }
      button.addEventListener("click", (event) => {
        void execute(action, event.altKey);
      });
      root.appendChild(button);
    }
  }

  async function resolveMenu(
    menu: "editor/title" | "editor/title/context" | "editor/context",
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
      renderTitleActions();
      return;
    }
    try {
      const nextTitleActions = await resolveMenu("editor/title", currentContext);
      if (sequence !== refreshSequence) return;
      titleActions = nextTitleActions;
      renderTitleActions();
    } catch (error) {
      if (sequence !== refreshSequence) return;
      titleActions = [];
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

  async function execute(
    action: ExtensionMenuAction,
    useAlternate = false,
  ): Promise<void> {
    if (!action.enabled) return;
    const currentContext = context();
    if (!currentContext) return;
    const command = useAlternate && action.alternate
      ? action.alternate.command
      : action.command;
    try {
      await deps.rpcCall(
        "vscode.extensionCommands.execute",
        { ...currentContext, command, surface: "editor" },
        { timeoutMs: 35000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.notify(`Extension command failed: ${message}`);
      console.error("[extension-menus] command failed", command, error);
    }
  }

  function closeContextMenu(): void {
    contextMenuRoot?.remove();
    contextMenuRoot = null;
  }

  function installContextMenuDismissal(): void {
    if (documentPointerListener || documentKeyListener) return;
    documentPointerListener = (event) => {
      if (contextMenuRoot && !contextMenuRoot.contains(event.target as Node)) {
        closeContextMenu();
      }
    };
    documentKeyListener = (event) => {
      if (event.key === "Escape") closeContextMenu();
    };
    deps.getDocument().addEventListener("pointerdown", documentPointerListener, true);
    deps.getDocument().addEventListener("keydown", documentKeyListener, true);
  }

  function positionContextMenu(
    root: HTMLElement,
    anchorRect: DOMRect | null,
  ): void {
    const view = deps.getDocument().defaultView;
    const viewportWidth = view?.innerWidth ?? 1024;
    const viewportHeight = view?.innerHeight ?? 768;
    const margin = 8;
    const preferredX = anchorRect?.right ?? viewportWidth / 2;
    const preferredY = anchorRect?.top ?? viewportHeight / 2;
    const left = Math.max(
      margin,
      Math.min(preferredX, viewportWidth - root.offsetWidth - margin),
    );
    const top = Math.max(
      margin,
      Math.min(preferredY, viewportHeight - root.offsetHeight - margin),
    );
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  async function openContextMenu(
    anchor: HTMLElement,
    closeTouchMenu?: () => void,
  ): Promise<void> {
    const currentContext = context();
    if (!currentContext) return;
    const anchorRect = anchor.closest("button")?.getBoundingClientRect() ?? null;
    closeTouchMenu?.();
    closeContextMenu();
    installContextMenuDismissal();
    const root = deps.getDocument().createElement("div");
    root.className = "fe-extension-editor-context-menu";
    root.setAttribute("role", "menu");
    const loading = deps.getDocument().createElement("button");
    loading.type = "button";
    loading.disabled = true;
    loading.textContent = "Loading extension actions…";
    root.appendChild(loading);
    deps.getDocument().body.appendChild(root);
    contextMenuRoot = root;
    positionContextMenu(root, anchorRect);
    try {
      const [titleContextActions, editorContextActions] = await Promise.all([
        resolveMenu("editor/title/context", currentContext),
        resolveMenu("editor/context", currentContext),
      ]);
      if (contextMenuRoot !== root) return;
      root.replaceChildren();
      for (const action of [...titleContextActions, ...editorContextActions]) {
        const button = deps.getDocument().createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = actionLabel(action);
        button.disabled = !action.enabled;
        button.addEventListener("click", (event) => {
          closeContextMenu();
          void execute(action, event.altKey);
        });
        root.appendChild(button);
      }
      if (!root.childElementCount) {
        closeContextMenu();
        deps.notify("No extension actions are available here.");
        return;
      }
      positionContextMenu(root, anchorRect);
      root.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } catch (error) {
      if (contextMenuRoot === root) closeContextMenu();
      console.warn("[extension-menus] context resolution failed", error);
    }
  }

  function attach(nextEditor: EditorLike | null): void {
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = nextEditor;
    installToolbarScroll();
    if (editor?.onDidChangeCursorSelection) {
      editorDisposables.push(editor.onDidChangeCursorSelection(scheduleSelectionRefresh));
    }
    if (editor?.onDidChangeModel) {
      editorDisposables.push(editor.onDidChangeModel(() => void refresh("model")));
    }
    void refresh("attach");
  }

  function navigationTools(controls?: {
    closeMenu(): void;
  }): MonacoTouchSelectionTool[] {
    const icon = buildContextLauncherIcon(deps.getDocument());
    return [{
      name: "extension context",
      innerHTML: icon,
      action: () => openContextMenu(icon, controls?.closeMenu),
    }];
  }

  function dispose(): void {
    refreshSequence += 1;
    if (selectionTimer != null) deps.clearTimeoutFn(selectionTimer);
    selectionTimer = null;
    for (const disposable of editorDisposables) disposable.dispose?.();
    editorDisposables = [];
    editor = null;
    titleActions = [];
    closeContextMenu();
    renderTitleActions();
    if (toolbarScrollRoot && toolbarWheelListener) {
      toolbarScrollRoot.removeEventListener("wheel", toolbarWheelListener);
    }
    toolbarScrollRoot = null;
    toolbarWheelListener = null;
    if (documentPointerListener) {
      deps.getDocument().removeEventListener(
        "pointerdown",
        documentPointerListener,
        true,
      );
    }
    if (documentKeyListener) {
      deps.getDocument().removeEventListener("keydown", documentKeyListener, true);
    }
    documentPointerListener = null;
    documentKeyListener = null;
  }

  return {
    attach,
    refresh,
    navigationTools,
    dispose,
  };
}
