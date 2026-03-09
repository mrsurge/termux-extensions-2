// @ts-check

/**
 * @param {{
 *   createTerminalDrawer: (opts?: any) => any,
 *   createConsoleDrawer: () => any,
 *   createProblemsPanel: (opts: any) => any,
 *   initDrawerAndShortcuts: (opts: any) => any,
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   requireEl: (selector: string) => any,
 *   getEditorSocket: () => any,
 *   hostToast: (msg: string) => void,
 *   setFontScale: (preset: any) => Promise<any>,
 *   triggerEditorSearchPanel: (reason: string, opts?: any) => Promise<any>,
 *   jumpToCurrentFileLine: (line: number) => Promise<any>,
 *   saveFile: () => Promise<any>,
 *   resetToNewFile: () => void,
 *   openPickedFile: () => void,
 * }} deps
 */
export function initPanelsAndDrawer(deps) {
  const terminal = deps.createTerminalDrawer({
    onReady: () => console.log('Terminal drawer ready'),
  });
  const consoleDrawer = deps.createConsoleDrawer();
  const problemsPanel = deps.createProblemsPanel({
    containerId: 'problems-container',
    onNavigate: (absPath, line, col) => {
      const editorSocket = deps.getEditorSocket();
      if (editorSocket && editorSocket.connected) {
        editorSocket.emit('editor_open_file', { path: absPath });
        setTimeout(() => {
          editorSocket.emit('editor_issues_cmd', { action: 'goto', line, column: col });
        }, 300);
      }
    },
    onMention: async (payload) => {
      try {
        const hostBase = typeof window.__agentHostBase === 'string'
          ? window.__agentHostBase.trim()
          : '';
        if (!hostBase) {
          deps.hostToast('Agent host unavailable');
          return;
        }
        const resp = await fetch(`${hostBase}/api/appserver/mention`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await resp.json();
        if (result && result.ok) {
          deps.hostToast('Mentioned in conversation');
        } else {
          deps.hostToast(result?.error || 'Failed to mention');
        }
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
    setFontScale: (preset) => deps.setFontScale(preset),
    triggerEditorSearchPanel: (reason, opts) => deps.triggerEditorSearchPanel(reason, opts),
    hostToast: (msg) => deps.hostToast(msg),
    jumpToCurrentFileLine: (line) => deps.jumpToCurrentFileLine(line),
    saveFile: () => deps.saveFile(),
    resetToNewFile: () => deps.resetToNewFile(),
    openPickedFile: () => deps.openPickedFile(),
  });

  return { terminal, consoleDrawer, problemsPanel };
}
