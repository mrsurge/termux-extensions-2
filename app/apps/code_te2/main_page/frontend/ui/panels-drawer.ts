// @ts-check

interface Dependencies {  createTerminalDrawer: typeof import('../host-terminal-drawer.ts').createTerminalDrawer,
  createConsoleDrawer: typeof import('../host-console-drawer.ts').createConsoleDrawer,
  mobileSecondEditor?: ReturnType<typeof import('../mobile-secondary-editor.ts').createMobileSecondaryEditorController>,
  createExtensionActivityPanel: typeof import('./extension-activity.ts').createExtensionActivityPanel,
  createCodeInspectorPanel: typeof import('./code-inspector.ts').createCodeInspectorPanel,
  initDrawerAndShortcuts: typeof import('./drawer-shortcuts.ts').initDrawerAndShortcuts,
  bindMenuToggle: (el: HTMLElement, action: () => unknown) => void,
  requireEl: (selector: string) => HTMLElement,
  hostToast: (msg: string) => void,
  setFontScale: (preset: string) => Promise<unknown>,
  triggerEditorSearchPanel: (reason: string, opts?: { replace?: boolean }) => Promise<unknown>,
  openFile: (path: string, options?: import('../file-ops/open-flow.ts').OpenFileOptions) => Promise<unknown>,
  jumpToCurrentFileLine: (line: number) => Promise<unknown>,
  requestCodeInspectorCommand: (payload: Record<string, unknown>) => Promise<unknown>,
  emitImeIntent?: (active: boolean, params?: Record<string, unknown>) => void,
  saveFile: () => Promise<unknown>,
  resetToNewFile: () => void,
  openPickedFile: () => void,
}

export function initPanelsAndDrawer(deps: Dependencies) {
  const terminal = deps.createTerminalDrawer({
    onReady: () => console.log('Terminal drawer ready'),
    emitImeIntent: deps.emitImeIntent,
  });
  const consoleDrawer = deps.createConsoleDrawer();
  const extensionActivityPanel = deps.createExtensionActivityPanel({
    openDrawer: () => terminal.openDrawer(),
    closeDrawer: () => terminal.close(),
  });
  const codeInspectorPanel = deps.createCodeInspectorPanel({
    openDrawer: () => terminal.openDrawer(),
    closeDrawer: () => terminal.close(),
    requestCommand: (payload: Record<string, unknown>) => deps.requestCodeInspectorCommand(payload),
    openFile: (path: string, options?: Record<string, unknown>) => deps.openFile(path, options),
  });

  const consoleCollapseBtn = document.getElementById('console-collapse-btn');
  if (consoleCollapseBtn) consoleCollapseBtn.addEventListener('click', () => terminal.close());
  deps.mobileSecondEditor?.attachDrawer({
    open: () => terminal.openDrawer(),
    close: () => terminal.close(),
  });

  deps.initDrawerAndShortcuts({
    bindMenuToggle: deps.bindMenuToggle,
    requireEl: deps.requireEl,
    consoleDrawer,
    mobileSecondEditor: deps.mobileSecondEditor,
    extensionActivityPanel,
    codeInspectorPanel,
    toggleTerminal: () => terminal.toggle(),
    openDrawer: () => terminal.openDrawer(),
    closeDrawer: () => terminal.close(),
    isDrawerOpen: () => terminal.isOpen(),
    activateTerminal: () => terminal.activateTerminal(),
    setFontScale: (preset: string) => deps.setFontScale(preset),
    triggerEditorSearchPanel: (reason = 'menu', opts?: { replace?: boolean }) => deps.triggerEditorSearchPanel(reason, opts),
    hostToast: (msg: string) => deps.hostToast(msg),
    jumpToCurrentFileLine: (line: number) => deps.jumpToCurrentFileLine(line),
    saveFile: () => deps.saveFile(),
    resetToNewFile: () => deps.resetToNewFile(),
    openPickedFile: () => deps.openPickedFile(),
  });

  return { terminal, consoleDrawer, extensionActivityPanel, codeInspectorPanel };
}
