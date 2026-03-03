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
 *   triggerEditorSearchPanel: (reason: string, opts?: any) => any,
 *   jumpToCurrentFileLine: (line: number) => Promise<any> | any,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function installBasicMenuActions(deps) {
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

  b(e.miUndo, () => { document.execCommand('undo'); });
  b(e.miRedo, () => { document.execCommand('redo'); });
  b(e.miCut, () => document.execCommand('cut'));
  b(e.miCopy, () => document.execCommand('copy'));
  b(e.miPaste, () => { document.execCommand('paste'); });
  b(e.miSelectAll, () => { document.execCommand('selectAll'); });

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
