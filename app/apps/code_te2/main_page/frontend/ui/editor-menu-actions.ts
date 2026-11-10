import { UI_IPC_RPC_METHODS, type UiIpcRpcMethod } from '../../../src/ui_ipc/rpc_contract.ts';
import { objectValue } from './settings-contracts.ts';

export type EditorMenuAction = 'open' | 'save' | 'saveAs' | 'close' | 'find' | 'goto'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

interface Dependencies {
  request(method: UiIpcRpcMethod, params: Record<string, unknown>): Promise<unknown>;
  pickFile(): Promise<string | null>;
  pickSavePath(path: string): Promise<string | null>;
  promptLine(): Promise<string | null>;
  toast(message: string): void;
  saveUntitled(): Promise<unknown> | unknown;
}

export function createEditorMenuActions(deps: Dependencies): (action: EditorMenuAction) => Promise<void> {
  return async action => {
    try {
      const response = objectValue(await deps.request(UI_IPC_RPC_METHODS.hostEditorStateGet,
        { captureEditorTarget: true }));
      const target = objectValue(response.editorTarget);
      if (typeof target.rendererId !== 'string' || typeof target.projectPath !== 'string'
          || typeof target.projectGeneration !== 'number' || typeof target.revision !== 'number'
          || (target.path !== null && typeof target.path !== 'string')) {
        throw new Error('Editor target unavailable; refresh the worker and assets');
      }
      const captured = {
        menuRendererId: target.rendererId, menuProjectPath: target.projectPath,
        menuProjectGeneration: target.projectGeneration, menuPath: target.path,
      };
      const request = async (method: UiIpcRpcMethod, params: Record<string, unknown>) => {
        const result = objectValue(await deps.request(method, { ...params, ...captured }));
        if (result.ok === false) throw new Error(typeof result.error === 'string' ? result.error : 'Editor action failed');
      };
      if (action === 'open') {
        const path = await deps.pickFile();
        if (path) await request(UI_IPC_RPC_METHODS.hostFileOpen, { path });
        return;
      }
      if (!target.path) {
        if ((action === 'save' || action === 'saveAs') && target.area === 'primary') await deps.saveUntitled();
        return;
      }
      if (action === 'save' || action === 'saveAs') {
        const destination = action === 'saveAs' ? await deps.pickSavePath(target.path) : null;
        if (action === 'saveAs' && !destination) return;
        await request(UI_IPC_RPC_METHODS.hostFileSave, {
          expected_path: target.path,
          ...(destination ? { target_path: destination, force: true } : { path: target.path }),
        });
        // Save As follows the existing secondary-editor contract: present the new file.
        if (destination) await request(UI_IPC_RPC_METHODS.hostFileOpen, { path: destination });
      } else if (action === 'close') {
        await request(UI_IPC_RPC_METHODS.hostRecentFileClose, {
          path: target.path, projectPath: target.projectPath,
          projectGeneration: target.projectGeneration, revision: target.revision,
        });
      } else if (action === 'find') {
        await request(UI_IPC_RPC_METHODS.hostEditorFind, { action: 'replace', reason: 'menu' });
      } else if (action === 'goto') {
        const input = await deps.promptLine();
        if (!input) return;
        const line = Number(input);
        if (!Number.isSafeInteger(line) || line < 1) throw new Error('Invalid line number');
        await request(UI_IPC_RPC_METHODS.hostEditorJumpToLine, { path: target.path, line });
      } else {
        await request(UI_IPC_RPC_METHODS.hostEditorCommand, { command: action });
      }
    } catch (error) {
      deps.toast(error instanceof Error ? error.message : 'Editor menu action failed');
    }
  };
}
