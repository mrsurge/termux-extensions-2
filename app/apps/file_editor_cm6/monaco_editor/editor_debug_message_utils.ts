interface DebugPartsLike {
  git?: string | null;
  draft?: string | null;
  diag?: string | null;
  flags?: string | null;
  mirror?: string | null;
  trace?: string | null;
  extra?: string | null;
}

export function buildDebugMessage(
  dbg: unknown,
  editor: MonacoRuntimeEditorLike | null | unknown,
  debugParts: DebugPartsLike,
  extra: string | null | undefined,
): string {
  if (!dbg) return '';
  const hasExt = !!(window['monaco-touch-selection'] && window['monaco-touch-selection']?.editorTouchSelectionHelp);
  const editorInstance = editor as MonacoRuntimeEditorLike | null;
  const domNode = editorInstance && editorInstance.getDomNode ? editorInstance.getDomNode() : null;
  const overflowGuard = domNode ? domNode.querySelector('.overflow-guard') : null;
  let message = 'ext=' + (hasExt ? 'yes' : 'no') + ' og=' + (overflowGuard ? 'yes' : 'no');
  if (extra) debugParts.extra = extra;
  if (debugParts.git) message += ' ' + debugParts.git;
  if (debugParts.draft) message += ' ' + debugParts.draft;
  if (debugParts.diag) message += ' ' + debugParts.diag;
  if (debugParts.flags) message += ' ' + debugParts.flags;
  if (debugParts.mirror) message += ' ' + debugParts.mirror;
  if (debugParts.trace) message += ' ' + debugParts.trace;
  if (debugParts.extra) message += ' ' + debugParts.extra;
  return message;
}
