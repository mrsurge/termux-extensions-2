// @ts-check

/**
 * @param {{
 *   createTerminalDrawer: (opts?: any) => any,
 *   createConsoleDrawer: () => any,
 *   mobileSecondEditor?: { attachDrawer: Function, show: Function, hide: Function },
 *   createExtensionActivityPanel: (opts: any) => any,
 *   createCodeInspectorPanel: (opts: any) => any,
 *   initDrawerAndShortcuts: (opts: any) => any,
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   requireEl: (selector: string) => any,
 *   hostToast: (msg: string) => void,
 *   setFontScale: (preset: any) => Promise<any>,
 *   triggerEditorSearchPanel: (reason: string, opts?: any) => Promise<any>,
 *   openFile: (path: string, options?: any) => Promise<any>,
 *   jumpToCurrentFileLine: (line: number) => Promise<any>,
 *   requestCodeInspectorCommand: (payload: any) => Promise<any>,
 *   emitImeIntent?: (active: boolean, params?: Record<string, unknown>) => void,
 *   saveFile: () => Promise<any>,
 *   resetToNewFile: () => void,
 *   openPickedFile: () => void,
 * }} deps
 */
export function initPanelsAndDrawer(deps: any) {
  const terminal = deps.createTerminalDrawer({
    onReady: () => console.log('Terminal drawer ready'),
    emitImeIntent: deps.emitImeIntent,
  });
  const consoleDrawer = deps.createConsoleDrawer();
  const extensionActivityPanel = deps.createExtensionActivityPanel({
    openDrawer: () => terminal.open(),
    closeDrawer: () => terminal.close(),
  });
  const codeInspectorPanel = deps.createCodeInspectorPanel({
    openDrawer: () => terminal.open(),
    closeDrawer: () => terminal.close(),
    requestCommand: (payload: Record<string, unknown>) => deps.requestCodeInspectorCommand(payload),
    openFile: (path: string, options?: Record<string, unknown>) => deps.openFile(path, options),
  });

  const consoleCollapseBtn = document.getElementById('console-collapse-btn');
  if (consoleCollapseBtn) consoleCollapseBtn.addEventListener('click', () => terminal.close());
  deps.mobileSecondEditor?.attachDrawer(terminal);

  deps.initDrawerAndShortcuts({
    bindMenuToggle: deps.bindMenuToggle,
    requireEl: deps.requireEl,
    consoleDrawer,
    mobileSecondEditor: deps.mobileSecondEditor,
    extensionActivityPanel,
    codeInspectorPanel,
    toggleTerminal: () => terminal.toggle(),
    setFontScale: (preset: string) => deps.setFontScale(preset),
    triggerEditorSearchPanel: (reason: string, opts: any) => deps.triggerEditorSearchPanel(reason, opts),
    hostToast: (msg: string) => deps.hostToast(msg),
    jumpToCurrentFileLine: (line: number) => deps.jumpToCurrentFileLine(line),
    saveFile: () => deps.saveFile(),
    resetToNewFile: () => deps.resetToNewFile(),
    openPickedFile: () => deps.openPickedFile(),
  });

  return { terminal, consoleDrawer, extensionActivityPanel, codeInspectorPanel };
}
