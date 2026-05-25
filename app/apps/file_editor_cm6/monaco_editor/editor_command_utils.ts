interface EditorActionLike {
  run?(): void;
}

interface EditorCommandTargetLike {
  focus?(): void;
  getAction?(id: string): EditorActionLike | null;
  trigger?(source: string, commandId: string, payload: unknown): void;
}

const EDIT_COMMAND_ACTIONS: Record<string, string[]> = {
  undo: ['undo'],
  redo: ['redo'],
  cut: ['editor.action.clipboardCutAction', 'cut'],
  copy: ['editor.action.clipboardCopyAction', 'copy'],
  paste: ['editor.action.clipboardPasteAction', 'paste'],
  selectAll: ['editor.action.selectAll', 'selectAll'],
};

export function runEditCommand(editor: EditorCommandTargetLike | null | undefined, command: string): boolean {
  try {
    if (!editor) return false;
    const candidates = EDIT_COMMAND_ACTIONS[command] || [];
    try { editor.focus?.(); } catch (_) {}
    for (const id of candidates) {
      const action = editor.getAction ? editor.getAction(id) : null;
      if (action && action.run) {
        action.run();
        return true;
      }
    }
    for (const id of candidates) {
      try {
        editor.trigger?.('menu', id, null);
        return true;
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

export function runIssuesCommand(editor: EditorCommandTargetLike | null | undefined, action: string): void {
  try {
    if (!editor) return;
    let id = 'editor.action.marker.next';
    if (action === 'toggle') action = 'next';
    if (action === 'prev') id = 'editor.action.marker.prev';
    const act = editor.getAction ? editor.getAction(id) : null;
    if (act && act.run) act.run();
  } catch (_) {}
}

export function runFindCommand(
  editor: EditorCommandTargetLike | null | undefined,
  action: string,
  onError: (error: unknown) => void,
): void {
  try {
    if (!editor) return;
    const act = editor.getAction ? editor.getAction('actions.find') : null;
    if (act && act.run) act.run();
    else editor.trigger?.('keyboard', 'actions.find', null);
    if (action === 'replace') {
      setTimeout(function() {
        try { editor.trigger?.('keyboard', 'editor.action.startFindReplaceAction', null); } catch (_) {}
      }, 50);
    }
  } catch (e) {
    try { onError(e); } catch (_) {}
  }
}
