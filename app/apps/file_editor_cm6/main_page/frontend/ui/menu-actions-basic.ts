// @ts-check

/**
 * @param {{
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   els: {
 *     miNew: HTMLElement,
 *     miOpen: HTMLElement,
 *     miSave: HTMLElement,
 *     miSaveAs: HTMLElement,
 *     miClose: HTMLElement,
 *     miQuit: HTMLElement,
 *     miDebugProjects: HTMLElement,
 *     miExportDiagnostics: HTMLElement,
 *     miUndo: HTMLElement,
 *     miRedo: HTMLElement,
 *     miCut: HTMLElement,
 *     miCopy: HTMLElement,
 *     miPaste: HTMLElement,
 *     miSelectAll: HTMLElement,
 *     miFind: HTMLElement,
 *     miGoto: HTMLElement,
 *   },
 *   resetToNewFile: () => void,
 *   pickFile: () => Promise<string | null>,
 *   openFile: (path: string) => Promise<any>,
 *   saveFile: () => Promise<any> | any,
 *   saveAsDialog: () => Promise<any> | any,
 *   closeWebSocket: () => void,
 *   clearOnQuit: () => void,
 *   showProjectsDebugModal: () => void,
 *   exportDiagnosticsToFile: () => void,
 *   requestBackendEditorCommand: (payload: any) => Promise<any>,
 *   triggerEditorSearchPanel: (reason: string, opts?: any) => any,
 *   jumpToCurrentFileLine: (line: number) => Promise<any> | any,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function installBasicMenuActions(deps: any) {
  const b = deps.bindMenuToggle;
  const e = deps.els;

  b(e.miNew, () => deps.resetToNewFile());
  b(e.miOpen, async () => { const p = await deps.pickFile(); if (p) await deps.openFile(p); });
  b(e.miSave, () => deps.saveFile());
  b(e.miSaveAs, () => deps.saveAsDialog());
  b(e.miClose, () => deps.resetToNewFile());
  b(e.miQuit, () => {
    deps.closeWebSocket();
    deps.clearOnQuit();
  });

  b(e.miDebugProjects, () => deps.showProjectsDebugModal());
  b(e.miExportDiagnostics, () => deps.exportDiagnosticsToFile());

  const editorCommand = async (command: string) => {
    try {
      await deps.requestBackendEditorCommand({ command });
    } catch (error) {
      console.warn('[Edit] command request failed', command, error);
      deps.toast('Editor command failed');
    }
  };

  b(e.miUndo, () => { void editorCommand('undo'); });
  b(e.miRedo, () => { void editorCommand('redo'); });
  b(e.miCut, () => { void editorCommand('cut'); });
  b(e.miCopy, () => { void editorCommand('copy'); });
  b(e.miPaste, () => { void editorCommand('paste'); });
  b(e.miSelectAll, () => { void editorCommand('selectAll'); });

  b(e.miFind, () => { deps.triggerEditorSearchPanel('menu', { replace: true }); });
  b(e.miGoto, async () => {
    const input = window.prompt('Go to line:');
    if (!input) return;
    const line = parseInt(input, 10);
    if (isNaN(line) || line < 1) {
      deps.toast('Invalid line number');
      return;
    }
    await deps.jumpToCurrentFileLine(line);
  });
}
