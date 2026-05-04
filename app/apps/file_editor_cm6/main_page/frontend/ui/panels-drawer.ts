// @ts-check

/**
 * @param {{
 *   createTerminalDrawer: (opts?: any) => any,
 *   createConsoleDrawer: () => any,
 *   createProblemsPanel: (opts: any) => any,
 *   initDrawerAndShortcuts: (opts: any) => any,
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   requireEl: (selector: string) => any,
 *   hostToast: (msg: string) => void,
 *   setFontScale: (preset: any) => Promise<any>,
 *   triggerEditorSearchPanel: (reason: string, opts?: any) => Promise<any>,
 *   openFile: (path: string, options?: any) => Promise<any>,
 *   jumpToCurrentFileLine: (line: number) => Promise<any>,
 *   requestDiagnosticsMention: (payload: any) => Promise<any>,
 *   saveFile: () => Promise<any>,
 *   resetToNewFile: () => void,
 *   openPickedFile: () => void,
 * }} deps
 */
export function initPanelsAndDrawer(deps: any) {
  const terminal = deps.createTerminalDrawer({
    onReady: () => console.log('Terminal drawer ready'),
  });
  const consoleDrawer = deps.createConsoleDrawer();
  const problemsPanel = deps.createProblemsPanel({
    containerId: 'problems-container',
    onNavigate: async (absPath: string, line: unknown, col: unknown) => {
      const targetLine = Number.isFinite(Number(line)) ? Number(line) : 1;
      const targetColumn = Number.isFinite(Number(col)) ? Number(col) : 1;
      await deps.openFile(absPath, {
        forceRefresh: true,
        line: targetLine,
        column: targetColumn,
        focus: true,
        scrollY: 'center',
      });
    },
    onMention: async (payload: Record<string, unknown> | null) => {
      try {
        await deps.requestDiagnosticsMention(payload || {});
        deps.hostToast('Mentioned in conversation');
      } catch (err) {
        console.warn('[Problems] mention failed:', err);
        deps.hostToast('Failed to mention in conversation');
      }
    },
  });

  const consoleCollapseBtn = document.getElementById('console-collapse-btn');
  if (consoleCollapseBtn) consoleCollapseBtn.addEventListener('click', () => terminal.close());
  const problemsCollapseBtn = document.getElementById('problems-collapse-btn');
  if (problemsCollapseBtn) problemsCollapseBtn.addEventListener('click', () => terminal.close());

  deps.initDrawerAndShortcuts({
    bindMenuToggle: deps.bindMenuToggle,
    requireEl: deps.requireEl,
    consoleDrawer,
    problemsPanel,
    toggleTerminal: () => terminal.toggle(),
    setFontScale: (preset: string) => deps.setFontScale(preset),
    triggerEditorSearchPanel: (reason: string, opts: any) => deps.triggerEditorSearchPanel(reason, opts),
    hostToast: (msg: string) => deps.hostToast(msg),
    jumpToCurrentFileLine: (line: number) => deps.jumpToCurrentFileLine(line),
    saveFile: () => deps.saveFile(),
    resetToNewFile: () => deps.resetToNewFile(),
    openPickedFile: () => deps.openPickedFile(),
  });

  return { terminal, consoleDrawer, problemsPanel };
}
