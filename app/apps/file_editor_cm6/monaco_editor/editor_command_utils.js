export function runIssuesCommand(editor, action) {
  try {
    if (!editor) return;
    var id = 'editor.action.marker.next';
    if (action === 'toggle') action = 'next';
    if (action === 'prev') id = 'editor.action.marker.prev';
    var act = editor.getAction ? editor.getAction(id) : null;
    if (act && act.run) act.run();
  } catch (_) {}
}

export function runFindCommand(editor, action, onError) {
  try {
    if (!editor) return;
    var act = editor.getAction ? editor.getAction('actions.find') : null;
    if (act && act.run) act.run();
    else editor.trigger('keyboard', 'actions.find', null);
    if (action === 'replace') {
      setTimeout(function() {
        try { editor.trigger('keyboard', 'editor.action.startFindReplaceAction', null); } catch (_) {}
      }, 50);
    }
  } catch (e) {
    try { onError(e); } catch (_) {}
  }
}
