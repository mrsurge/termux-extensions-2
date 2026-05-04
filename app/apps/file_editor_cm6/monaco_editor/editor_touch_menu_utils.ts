interface MentionPayload {
  path: string;
  lineNo?: number;
  col?: number;
  endLineNo?: number;
  endCol?: number;
  content?: string;
}

interface MentionRequestDeps {
  getEditor(): MonacoRuntimeEditorLike | null;
  getDiffEditor?(): MonacoRuntimeDiffEditorLike | null;
  getCurrentPath(): string | null;
  sendEditorMentionRequest(payload: Record<string, unknown>): boolean;
  updateDebug(extra?: string): void;
}

function buildMentionPayload(
  editorInstance: MonacoRuntimeEditorLike | null,
  currentPath: string | null,
): MentionPayload | null {
  if (!editorInstance || !currentPath) return null;
  const selection = editorInstance.getSelection ? editorInstance.getSelection() : null;
  const payload: MentionPayload = { path: currentPath };
  if (selection && !(selection.isEmpty && selection.isEmpty())) {
    payload.lineNo = selection.startLineNumber;
    payload.col = selection.startColumn;
    payload.endLineNo = selection.endLineNumber;
    payload.endCol = selection.endColumn;
    const model = editorInstance.getModel ? editorInstance.getModel() : null;
    let content = model && model.getValueInRange ? model.getValueInRange(selection) : '';
    if (content) {
      const lines = content.split('\n');
      if (lines.length > 20) {
        content = lines.slice(0, 20).join('\n') + '\n... (truncated, ' + lines.length + ' total lines)';
      }
      payload.content = content;
    }
  } else {
    const pos = editorInstance.getPosition ? editorInstance.getPosition() : null;
    if (pos) {
      payload.lineNo = pos.lineNumber;
      payload.col = pos.column;
    }
  }
  return payload;
}

export function sendMentionRequest(deps: MentionRequestDeps): void {
  let editor = deps.getEditor();
  const diff = deps.getDiffEditor ? deps.getDiffEditor() : null;
  if (diff && diff.getModifiedEditor) editor = diff.getModifiedEditor();
  const path = deps.getCurrentPath();
  const payload = buildMentionPayload(editor, path);
  if (!payload) return;
  const sent = deps.sendEditorMentionRequest({
    path: payload.path,
    lineNo: payload.lineNo,
    col: payload.col,
    endLineNo: payload.endLineNo,
    endCol: payload.endCol,
    content: payload.content,
  });
  if (!sent) {
    console.warn('[mention] editor RPC socket not connected');
  }
}

const mentionBoundDoms = typeof WeakSet !== 'undefined' ? new WeakSet<HTMLElement>() : null;

export function ensureTouchSelection(reason: string, deps: MentionRequestDeps): void {
  try {
    const lib = window['monaco-touch-selection'];
    if (!lib || !lib.editorTouchSelectionHelp) return;
    const editor = deps.getEditor();
    const diff = deps.getDiffEditor ? deps.getDiffEditor() : null;
    const target = diff && diff.getModifiedEditor ? diff.getModifiedEditor() : editor;
    if (!target || !target.getDomNode) return;
    const dom = target.getDomNode();
    if (!dom) return;
    const hasUi = !!dom.querySelector('.monaco-editor-touch-selections');
    if (!hasUi) {
      lib.editorTouchSelectionHelp(target);
      deps.updateDebug('touch=reinit' + (reason ? ':' + reason : ''));
    }
    if (mentionBoundDoms && !mentionBoundDoms.has(dom)) {
      mentionBoundDoms.add(dom);
      dom.addEventListener('te2:mention-request', () => {
        sendMentionRequest(deps);
      });
    }
  } catch (error) {
    console.warn('[MonacoTouchSelection] ensure failed', error);
  }
}
