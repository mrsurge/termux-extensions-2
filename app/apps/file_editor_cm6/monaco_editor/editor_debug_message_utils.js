export function buildDebugMessage(dbg, editor, debugParts, extra) {
  if (!dbg) return '';
  var hasExt = !!(window['monaco-touch-selection'] && window['monaco-touch-selection'].editorTouchSelectionHelp);
  var og = editor && editor.getDomNode ? editor.getDomNode().querySelector('.overflow-guard') : null;
  var msg = 'ext=' + (hasExt ? 'yes' : 'no') + ' og=' + (og ? 'yes' : 'no');
  if (extra) debugParts.extra = extra;
  if (debugParts.git) msg += ' ' + debugParts.git;
  if (debugParts.draft) msg += ' ' + debugParts.draft;
  if (debugParts.diag) msg += ' ' + debugParts.diag;
  if (debugParts.flags) msg += ' ' + debugParts.flags;
  if (debugParts.mirror) msg += ' ' + debugParts.mirror;
  if (debugParts.trace) msg += ' ' + debugParts.trace;
  if (debugParts.extra) msg += ' ' + debugParts.extra;
  return msg;
}
