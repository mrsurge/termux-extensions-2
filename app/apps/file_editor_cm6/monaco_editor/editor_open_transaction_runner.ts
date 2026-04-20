import type {
  CoercePositiveIntFn,
  EditorLike,
  EditorModelLike,
  EditorOpenJumpPayload,
  EditorOpenTransaction,
  EditorOpenTransactionStore,
} from './editor_open_contract.ts';
import { getOpenTransactionForPath } from './editor_open_transaction_state.ts';

interface EditorOpenRunnerDeps {
  getCurrentPath(): string | null | undefined;
  getEditor(): EditorLike | null | undefined;
  getModel(): EditorModelLike | null | undefined;
  absPathFromVscodeUri(uri: string): string | null;
  applyJumpToLine(editor: EditorLike, model: EditorModelLike, jumpPayload: EditorOpenJumpPayload): void;
  coercePositiveInt: CoercePositiveIntFn;
  logAppliedOpenJump?(detail: {
    path: string | null | undefined;
    line: number;
    column: number;
    request_id: string;
    reason: string;
  }): void;
}

export function applyResolvedOpenJump(
  deps: EditorOpenRunnerDeps,
  store: EditorOpenTransactionStore,
  reason: string,
  jumpPayload: EditorOpenJumpPayload | null | undefined,
  tx: EditorOpenTransaction | null | undefined,
): boolean {
  try {
    const editor = deps.getEditor();
    const model = deps.getModel();
    const currentPath = deps.getCurrentPath();
    if (!jumpPayload || !editor || !model) return false;
    const targetTx = tx || getOpenTransactionForPath(store, currentPath);
    if (targetTx && String(targetTx.path || '') !== String(currentPath || '')) return false;
    const activeModel = editor.getModel ? editor.getModel() : model;
    if (!activeModel || !activeModel.uri) return false;
    if (String(deps.absPathFromVscodeUri(String(activeModel.uri.toString()))) !== String(currentPath || '')) return false;
    deps.applyJumpToLine(editor, activeModel, jumpPayload);
    if (targetTx && targetTx.hasExplicitNavigation) {
      targetTx.navigationApplied = true;
      targetTx.guardUntil = Date.now() + 5000;
    }
    if (deps.logAppliedOpenJump) {
      deps.logAppliedOpenJump({
        path: currentPath,
        line: jumpPayload.line,
        column: jumpPayload.column != null ? jumpPayload.column : 1,
        request_id: targetTx && targetTx.request_id ? targetTx.request_id : '',
        reason: reason || '',
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function isEditorOpenSatisfied(
  deps: EditorOpenRunnerDeps,
  tx: EditorOpenTransaction | null | undefined,
): boolean {
  try {
    const editor = deps.getEditor();
    const model = deps.getModel();
    const currentPath = deps.getCurrentPath();
    if (!editor) return false;
    const activeModel = editor.getModel ? editor.getModel() : model;
    if (!activeModel || !activeModel.uri) return false;
    const activePath = String(deps.absPathFromVscodeUri(String(activeModel.uri.toString())) || '');
    if (!activePath || activePath !== String(currentPath || '')) return false;
    if (!tx || !tx.hasExplicitNavigation) return true;
    const pos = editor.getPosition ? editor.getPosition() : null;
    if (!pos) return false;
    const wantLine = deps.coercePositiveInt(tx.line) || 1;
    const wantCol = deps.coercePositiveInt(tx.column) || 1;
    return Number(pos.lineNumber) === wantLine && Number(pos.column) === wantCol;
  } catch (_) {
    return false;
  }
}

export function awaitOpenCompletion(
  deps: EditorOpenRunnerDeps,
  store: EditorOpenTransactionStore,
  tx: EditorOpenTransaction | null | undefined,
  jumpPayload: EditorOpenJumpPayload | null | undefined,
  attempts: number,
  reasonBase: string,
): Promise<boolean> {
  let remaining = Number.isFinite(Number(attempts)) ? Number(attempts) : 0;
  const reason = String(reasonBase || 'editor:open');

  function tick(label: string): Promise<boolean> {
    if (jumpPayload) {
      applyResolvedOpenJump(deps, store, `${reason}:${label}`, jumpPayload, tx);
    }
    if (isEditorOpenSatisfied(deps, tx)) return Promise.resolve(true);
    if (remaining <= 0) return Promise.resolve(false);
    remaining -= 1;
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve(tick(`retry${remaining}`));
      }, 0);
    });
  }

  return tick('initial');
}
