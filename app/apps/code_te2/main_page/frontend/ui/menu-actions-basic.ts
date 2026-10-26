import { objectValue } from './settings-contracts.ts';
// @ts-check

interface Dependencies {  bindMenuToggle: (el: HTMLElement, action: () => unknown) => void,
  els: {
    miNew: HTMLElement,
    miOpen: HTMLElement,
    miSave: HTMLElement,
    miSaveAs: HTMLElement,
    miClose: HTMLElement,
    miOpenSecondWindow: HTMLElement,
    miQuit: HTMLElement,
    miRunProfiles: HTMLElement,
    miInstallPagePreview: HTMLElement,
    miDebugProjects: HTMLElement,
    miExportDiagnostics: HTMLElement,
    miUndo: HTMLElement,
    miRedo: HTMLElement,
    miCut: HTMLElement,
    miCopy: HTMLElement,
    miPaste: HTMLElement,
    miSelectAll: HTMLElement,
    miFind: HTMLElement,
    miGoto: HTMLElement,
  },
  resetToNewFile: () => void,
  pickFile: () => Promise<string | null>,
  openFile: (path: string) => Promise<unknown>,
  saveFile: () => Promise<unknown> | unknown,
  saveAsDialog: () => Promise<unknown> | unknown,
  quitApp: () => Promise<unknown> | unknown,
  openInSecondWindow: () => Promise<unknown> | unknown,
  getCurrentPath: () => string | null,
  openRunProfilesModal: () => Promise<unknown> | unknown,
  requestBackendPagePreviewTemplateInstall: (payload: Record<string, unknown>) => Promise<unknown>,
  showProjectsDebugModal: () => void,
  exportDiagnosticsToFile: () => void,
  requestBackendEditorCommand: (payload: Record<string, unknown>) => Promise<unknown>,
  triggerEditorSearchPanel: (reason: string, opts?: { replace?: boolean }) => unknown,
  jumpToCurrentFileLine: (line: number) => Promise<unknown> | unknown,
  toast: (msg: string) => void,
}

export function installBasicMenuActions(deps: Dependencies) {
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
      const response = objectValue(result);
      if (response.ok === false) {
        deps.toast(typeof response.error === 'string' ? response.error : 'Failed to install Page Preview profile');
        return;
      }
      const data = objectValue(response.data);
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
