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
 *     miOpenSecondWindow: HTMLElement,
 *     miQuit: HTMLElement,
 *     miRunProfiles: HTMLElement,
 *     miInstallPagePreview: HTMLElement,
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
 *   quitApp: () => Promise<any> | any,
 *   openInSecondWindow: () => Promise<any> | any,
 *   getCurrentPath: () => string | null,
 *   openRunProfilesModal: () => Promise<any> | any,
 *   requestBackendPagePreviewTemplateInstall: (payload: any) => Promise<any>,
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
  b(e.miOpen, async () => {
    const p = await deps.pickFile();
    if (p) await deps.openFile(p);
  });
  b(e.miSave, () => deps.saveFile());
  b(e.miSaveAs, () => deps.saveAsDialog());
  b(e.miClose, () => deps.resetToNewFile());
  b(e.miOpenSecondWindow, () => void deps.openInSecondWindow());
  b(e.miQuit, () => void deps.quitApp());

  b(e.miRunProfiles, () => void deps.openRunProfilesModal());

  b(e.miInstallPagePreview, async () => {
    try {
      const result = await deps.requestBackendPagePreviewTemplateInstall({
        path: deps.getCurrentPath(),
      });
      const response = result && typeof result === 'object' ? (result as Record<string, any>) : {};
      if (response.ok === false) {
        deps.toast(typeof response.error === 'string' ? response.error : 'Failed to install Page Preview profile');
        return;
      }
      const data = response.data && typeof response.data === 'object' ? (response.data as Record<string, any>) : {};
      deps.toast(data.created === false ? 'Page Preview profile already installed' : 'Page Preview profile installed');
    } catch (error) {
      console.warn('[PagePreview] profile install failed', error);
      deps.toast('Failed to install Page Preview profile');
    }
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

  b(e.miUndo, () => {
    void editorCommand('undo');
  });
  b(e.miRedo, () => {
    void editorCommand('redo');
  });
  b(e.miCut, () => {
    void editorCommand('cut');
  });
  b(e.miCopy, () => {
    void editorCommand('copy');
  });
  b(e.miPaste, () => {
    void editorCommand('paste');
  });
  b(e.miSelectAll, () => {
    void editorCommand('selectAll');
  });

  b(e.miFind, () => {
    deps.triggerEditorSearchPanel('menu', { replace: true });
  });
  b(e.miGoto, async () => {
    const input = await window.teUI.dialog.prompt('Go to line:');
    if (!input) return;
    const line = parseInt(input, 10);
    if (isNaN(line) || line < 1) {
      deps.toast('Invalid line number');
      return;
    }
    await deps.jumpToCurrentFileLine(line);
  });
}
