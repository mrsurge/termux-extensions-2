interface MonacoPositionLike {
  [key: string]: unknown;
}

interface MonacoDisposableLike {
  dispose?(): void;
}

interface MonacoModelLike extends MonacoDisposableLike {
  getValue?(): string;
  getLanguageId?(): string;
}

interface MonacoEditorLike extends MonacoDisposableLike {
  setModel?(model: MonacoModelLike | null): void;
  getScrollTop?(): number;
  setScrollTop?(scrollTop: number): void;
  getPosition?(): MonacoPositionLike | null;
  setPosition?(position: MonacoPositionLike): void;
  updateOptions?(options: Record<string, unknown>): void;
  onDidChangeConfiguration?(listener: () => void): void;
}

interface MonacoDiffEditorLike extends MonacoDisposableLike {
  setModel?(model: Record<string, unknown> | null): void;
  getModifiedEditor?(): MonacoEditorLike | null;
  getOriginalEditor?(): MonacoEditorLike | null;
}

interface MonacoEditorNamespaceLike {
  create(container: HTMLElement, options: Record<string, unknown>): MonacoEditorLike;
  createDiffEditor(container: HTMLElement, options: Record<string, unknown>): MonacoDiffEditorLike;
}

interface MonacoRefLike {
  editor: MonacoEditorNamespaceLike;
}

interface EditorLifecycleDeps {
  getMonaco(): MonacoRefLike | null;
  getEditorContainer(): HTMLElement | null;
  fetchSSOTState(): Promise<unknown>;
  getCachedPrefs(): unknown;
  setCachedPrefs(value: unknown): void;
  getEditor(): MonacoEditorLike | null;
  setEditor(value: MonacoEditorLike | null): void;
  getDiffEditor(): MonacoDiffEditorLike | null;
  setDiffEditor(value: MonacoDiffEditorLike | null): void;
  getModel(): MonacoModelLike | null;
  getCurrentPath(): string | null;
  disposeMirrorPublisher(): void;
  setScrollPublisherInstalled(value: boolean): void;
  clearEditorDecorationState(): void;
  clearGitBaselineModels(): void;
  buildMonacoOptionsFromPrefs(state: unknown): Record<string, unknown>;
  forceSemanticHighlighting(): void;
  installMarkerNavBindings(editor: MonacoEditorLike): void;
  applyMonacoTheme(themeKey: string): void;
  ensureTouchSelection(reason: string): void;
  syncReadOnlyInputMode(editor: MonacoEditorLike): void;
  onEditorConfigChanged(editor: MonacoEditorLike): void;
  updateDebug(extra: string): void;
  ensureLayoutObserver(): void;
  bindUIIPCEditorHooks(): void;
  installMirrorPublisher(): void;
  installScrollPublisher(): void;
  requestBreadcrumbSymbols(absPath: string): void;
  layoutEditors(): void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function themeFromPrefs(state: unknown): string {
  const root = asRecord(state);
  const prefs = asRecord(root && root.preferences ? root.preferences : root);
  const editor = asRecord(prefs && prefs.editor);
  return editor && typeof editor.theme === 'string' ? editor.theme : '';
}

function themeFromOptions(options: Record<string, unknown> | null | undefined): string {
  return options && typeof options.theme === 'string' ? options.theme : '';
}

function restoreEditorViewState(
  editor: MonacoEditorLike | null,
  scrollTop: number | null,
  position: MonacoPositionLike | null,
): void {
  try {
    if (editor && scrollTop != null && typeof editor.setScrollTop === 'function') {
      editor.setScrollTop(scrollTop);
    }
    if (editor && position && typeof editor.setPosition === 'function') {
      editor.setPosition(position);
    }
  } catch (_) {}
}

function bindEditorConfiguration(deps: EditorLifecycleDeps, editor: MonacoEditorLike | null): void {
  if (!editor || typeof editor.onDidChangeConfiguration !== 'function') return;
  editor.onDidChangeConfiguration(() => {
    deps.onEditorConfigChanged(editor);
  });
}

function applySharedPlainEditorSetup(
  deps: EditorLifecycleDeps,
  editor: MonacoEditorLike,
  options: {
    themeKey: string;
    touchReason: string;
  },
): void {
  try {
    deps.forceSemanticHighlighting();
  } catch (_) {}
  try {
    deps.installMarkerNavBindings(editor);
  } catch (_) {}
  try {
    if (options.themeKey) deps.applyMonacoTheme(options.themeKey);
  } catch (_) {}
  deps.ensureTouchSelection(options.touchReason);
  deps.syncReadOnlyInputMode(editor);
  bindEditorConfiguration(deps, editor);
  deps.ensureLayoutObserver();
}

export function disposeDiffEditorOnly(deps: EditorLifecycleDeps): void {
  deps.disposeMirrorPublisher();
  try {
    const diffEditor = deps.getDiffEditor();
    if (diffEditor && typeof diffEditor.setModel === 'function') {
      diffEditor.setModel(null);
    }
  } catch (_) {}
  try {
    const diffEditor = deps.getDiffEditor();
    if (diffEditor && typeof diffEditor.dispose === 'function') diffEditor.dispose();
  } catch (_) {}
  deps.setDiffEditor(null);
  deps.clearEditorDecorationState();
  deps.setScrollPublisherInstalled(false);
}

export function disposePlainEditorOnly(deps: EditorLifecycleDeps): void {
  deps.disposeMirrorPublisher();
  try {
    const editor = deps.getEditor();
    if (editor && typeof editor.dispose === 'function') editor.dispose();
  } catch (_) {}
  deps.setEditor(null);
  deps.clearEditorDecorationState();
  deps.setScrollPublisherInstalled(false);
}

export function disposeGitBaselines(deps: EditorLifecycleDeps): void {
  try {
    const diffEditor = deps.getDiffEditor();
    if (diffEditor && typeof diffEditor.setModel === 'function') {
      diffEditor.setModel(null);
    }
  } catch (_) {}
  deps.clearGitBaselineModels();
}

export async function ensureEditorWithPrefs(deps: EditorLifecycleDeps): Promise<MonacoEditorLike | null> {
  const existing = deps.getEditor();
  if (existing) return existing;

  const container = deps.getEditorContainer();
  const monacoRef = deps.getMonaco();
  if (!container || !monacoRef) return null;

  try {
    if (!deps.getCachedPrefs()) deps.setCachedPrefs(await deps.fetchSSOTState());
  } catch (error) {
    deps.updateDebug('ssot=fail');
    throw error;
  }

  const created = monacoRef.editor.create(container, deps.buildMonacoOptionsFromPrefs(deps.getCachedPrefs()));
  deps.setEditor(created);
  const model = deps.getModel();
  if (model && typeof created.setModel === 'function') {
    try { created.setModel(model); } catch (_) {}
    deps.installMirrorPublisher();
    deps.installScrollPublisher();
  }
  applySharedPlainEditorSetup(deps, created, {
    themeKey: themeFromPrefs(deps.getCachedPrefs()),
    touchReason: 'boot',
  });
  deps.updateDebug('ssot=ok');
  deps.bindUIIPCEditorHooks();
  return created;
}

export function ensurePlainEditorWithPrefs(deps: EditorLifecycleDeps): MonacoEditorLike | null {
  const current = deps.getEditor();
  const diffEditor = deps.getDiffEditor();

  let savedScrollTop: number | null = null;
  let savedPosition: MonacoPositionLike | null = null;
  if (diffEditor && typeof diffEditor.getModifiedEditor === 'function') {
    try {
      const modified = diffEditor.getModifiedEditor();
      if (modified && typeof modified.getScrollTop === 'function') {
        savedScrollTop = modified.getScrollTop();
      }
      if (modified && typeof modified.getPosition === 'function') {
        savedPosition = modified.getPosition() || null;
      }
    } catch (_) {}
    disposeDiffEditorOnly(deps);
    deps.setEditor(null);
  } else if (current) {
    return current;
  }

  const container = deps.getEditorContainer();
  const monacoRef = deps.getMonaco();
  if (!container || !monacoRef) return null;

  const created = monacoRef.editor.create(container, deps.buildMonacoOptionsFromPrefs(deps.getCachedPrefs()));
  deps.setEditor(created);
  applySharedPlainEditorSetup(deps, created, {
    themeKey: themeFromPrefs(deps.getCachedPrefs()),
    touchReason: 'plain',
  });

  const model = deps.getModel();
  if (model && typeof created.setModel === 'function') {
    try { created.setModel(model); } catch (_) {}
    deps.installMirrorPublisher();
    deps.installScrollPublisher();
  }

  deps.layoutEditors();
  restoreEditorViewState(created, savedScrollTop, savedPosition);
  deps.bindUIIPCEditorHooks();
  return created;
}

export function ensureDiffEditorWithPrefs(deps: EditorLifecycleDeps): MonacoDiffEditorLike | null {
  const existing = deps.getDiffEditor();
  if (existing) return existing;

  let savedScrollTop: number | null = null;
  let savedPosition: MonacoPositionLike | null = null;
  const currentEditor = deps.getEditor();
  try {
    if (currentEditor && typeof currentEditor.getScrollTop === 'function') {
      savedScrollTop = currentEditor.getScrollTop();
    }
    if (currentEditor && typeof currentEditor.getPosition === 'function') {
      savedPosition = currentEditor.getPosition() || null;
    }
  } catch (_) {}

  if (currentEditor) {
    disposePlainEditorOnly(deps);
  }

  const container = deps.getEditorContainer();
  const monacoRef = deps.getMonaco();
  if (!container || !monacoRef) return null;

  const diffEditor = monacoRef.editor.createDiffEditor(container, {
    renderSideBySide: false,
    readOnly: false,
    originalEditable: false,
    enableSplitViewResizing: false,
    automaticLayout: true,
    experimental: { useTrueInlineView: false },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    renderGutterMenu: false,
  });
  deps.setDiffEditor(diffEditor);

  try {
    const options = deps.buildMonacoOptionsFromPrefs(deps.getCachedPrefs());
    const themeKey = themeFromOptions(options) || themeFromPrefs(deps.getCachedPrefs());
    const diffOptions = Object.assign({}, options, { minimap: { enabled: false } });
    delete diffOptions.theme;
    const originalOptions = Object.assign({}, options, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
    delete originalOptions.theme;
    const scrollOptions = { scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0, horizontal: 'hidden', horizontalScrollbarSize: 0 } };

    const modifiedEditor = typeof diffEditor.getModifiedEditor === 'function' ? diffEditor.getModifiedEditor() : null;
    const originalEditor = typeof diffEditor.getOriginalEditor === 'function' ? diffEditor.getOriginalEditor() : null;
    try { if (modifiedEditor && typeof modifiedEditor.updateOptions === 'function') modifiedEditor.updateOptions(diffOptions); } catch (_) {}
    try { if (originalEditor && typeof originalEditor.updateOptions === 'function') originalEditor.updateOptions(originalOptions); } catch (_) {}
    try {
      if (modifiedEditor && typeof modifiedEditor.updateOptions === 'function') modifiedEditor.updateOptions(scrollOptions);
      if (originalEditor && typeof originalEditor.updateOptions === 'function') originalEditor.updateOptions(scrollOptions);
    } catch (_) {}
    try { if (themeKey) deps.applyMonacoTheme(themeKey); } catch (_) {}
  } catch (_) {}

  const modifiedEditor = typeof diffEditor.getModifiedEditor === 'function' ? diffEditor.getModifiedEditor() : null;
  if (!modifiedEditor) return diffEditor;
  deps.setEditor(modifiedEditor);

  const model = deps.getModel();
  if (model && typeof modifiedEditor.setModel === 'function') {
    try { modifiedEditor.setModel(model); } catch (_) {}
    deps.installMirrorPublisher();
    deps.installScrollPublisher();
  }

  if (deps.getCurrentPath()) {
    try { deps.requestBreadcrumbSymbols(deps.getCurrentPath() || ''); } catch (_) {}
  }
  deps.ensureTouchSelection('diff');

  const originalEditor = typeof diffEditor.getOriginalEditor === 'function' ? diffEditor.getOriginalEditor() : null;
  if (originalEditor) deps.syncReadOnlyInputMode(originalEditor);
  deps.syncReadOnlyInputMode(modifiedEditor);
  bindEditorConfiguration(deps, modifiedEditor);
  deps.ensureLayoutObserver();
  deps.layoutEditors();
  restoreEditorViewState(modifiedEditor, savedScrollTop, savedPosition);
  deps.bindUIIPCEditorHooks();
  return diffEditor;
}
