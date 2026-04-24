interface EditorActionLike {
  run?(): void;
}

interface EditorCommandTargetLike {
  getAction?(id: string): EditorActionLike | null;
  trigger?(source: string, commandId: string, payload: unknown): void;
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
