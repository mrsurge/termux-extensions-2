import type { JsonObject } from '../../rpc/transport.ts';
import { EXPLORER_RPC_METHODS, type ExplorerRpcMethod } from '../rpc/contract.ts';

interface RestoreDeps {
  getProjectPath(): string | null;
  requestExplorer(method: ExplorerRpcMethod, payload: JsonObject, timeoutMs?: number): Promise<JsonObject>;
  toast(message: string): void;
  getErrorMessage(error: unknown, fallback: string): string;
}

export interface HunkRestoreIdentity {
  commit: string;
  sourceSha256: string;
  hunkIndex: number;
}

export async function restoreExplorerHunk(deps: RestoreDeps, rel: string, identity: HunkRestoreIdentity): Promise<void> {
  try {
    const project = deps.getProjectPath();
    if (!project) throw new Error('Open a project before restoring');
    const preview = await deps.requestExplorer(EXPLORER_RPC_METHODS.gitRestore, {
      path: rel, phase: 'hunkPrepare', projectPath: project, ...identity,
    });
    if (typeof preview.token !== 'string') throw new Error('Invalid hunk confirmation');
    const draft = preview.hasDraft === true ? "\n\nThis will DISCARD this file's entire unsaved draft." : '';
    const confirmed = await window.teUI.dialog.confirm(
      `Restore this hunk in ${rel} from commit ${identity.commit.slice(0, 10)} directly to disk?${draft}\n\nOther disk hunks, HEAD, and the index will remain unchanged.`,
    );
    if (!confirmed) return;
    if (project !== deps.getProjectPath()) throw new Error('Project changed; confirm again');
    const result = await deps.requestExplorer(EXPLORER_RPC_METHODS.gitRestore, {
      path: rel, phase: 'hunkApply', projectPath: project, token: preview.token,
      discardDraft: preview.hasDraft === true,
    });
    deps.toast(result.draftRetained === true ? 'Hunk restored on disk; a newer draft was retained. Review before saving.' : 'Hunk restored on disk');
  } catch (error) {
    deps.toast(deps.getErrorMessage(error, 'Hunk Restore failed'));
  }
}

export async function restoreExplorerFile(deps: RestoreDeps, rel: string, name: string): Promise<void> {
  try {
    const project = deps.getProjectPath();
    if (!project) throw new Error('Open a project before restoring');
    let preview = await deps.requestExplorer(EXPLORER_RPC_METHODS.gitRestore, { path: rel, phase: 'prepare', projectPath: project });
    const request = async (phase: 'unstage' | 'apply'): Promise<JsonObject> => {
      if (project !== deps.getProjectPath()) throw new Error('Project changed; confirm Restore again');
      if (typeof preview.token !== 'string' || typeof preview.path !== 'string') throw new Error('Invalid restore confirmation');
      return deps.requestExplorer(EXPLORER_RPC_METHODS.gitRestore, {
        path: preview.path, phase, token: preview.token, discardDraft: preview.hasDraft === true, projectPath: project,
      });
    };
    if (preview.staged === true) {
      const unstage = await window.teUI.dialog.confirm(
        `${name} has staged changes. Unstage only this file before restoring?\n\nStaged-only contents may differ from disk and will no longer be retained in the index. This step does not change the working file or its draft.`,
      );
      if (!unstage) return;
      preview = await request('unstage');
    }
    if (typeof preview.commit !== 'string') throw new Error('Missing source commit');
    const source = `${preview.ref === 'HEAD' ? 'HEAD' : 'commit'} ${preview.commit.slice(0, 10)}`;
    const action = preview.delete === true
      ? `${name} does not exist in ${source}. Delete the working file?`
      : `Restore ${name} from ${source}? This replaces its current disk contents.`;
    const draft = preview.hasDraft === true ? '\n\nThis will also DISCARD this file\'s unsaved draft.' : '';
    const confirmed = await window.teUI.dialog.confirm(
      `${action}${draft}\n\nExisting edits can be lost. HEAD and the index will not be changed.`,
    );
    if (!confirmed) return;
    const result = await request('apply');
    deps.toast(result.draftRetained === true
      ? 'Disk restored; a draft changed during Restore or could not be cleared, so it was kept. Review it before saving.'
      : result.editorClosed === true ? 'Restored on disk. The tab was closed because the restored file is not supported by the editor.'
      : preview.delete === true ? 'Historical deletion applied' : `Restored from ${source}`);
  } catch (error) {
    deps.toast(deps.getErrorMessage(error, 'Restore failed'));
  }
}
