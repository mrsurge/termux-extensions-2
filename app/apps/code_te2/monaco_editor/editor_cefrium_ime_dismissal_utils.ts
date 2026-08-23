export const CEFRIUM_IME_DISMISSED_EVENT = 'te2:android-ime-dismissed';

interface CefriumImeEditor {
  getDomNode?(): HTMLElement | null;
  hasTextFocus?(): boolean;
}

export function isCefriumAndroidRuntime(search: string): boolean {
  const params = new URLSearchParams(search || '');
  return params.get('gv_native') === '1'
    && params.get('te2_renderer')?.trim().toLowerCase() === 'cefrium';
}

export function releaseCefriumEditorFocus(
  editor: CefriumImeEditor,
  doc: Document = document,
): boolean {
  const editorDom = editor.getDomNode?.();
  const input = editorDom?.querySelector<HTMLTextAreaElement>(
    'textarea.inputarea.android-ime-input',
  );
  if (!editorDom || !input) return false;
  const ownsFocus = doc.activeElement === input || editor.hasTextFocus?.() === true;
  if (!ownsFocus) return false;

  const focusTarget = doc.getElementById('menu-file-btn');
  if (
    !focusTarget
    || focusTarget.tagName !== 'BUTTON'
    || typeof focusTarget.focus !== 'function'
  ) return false;
  focusTarget.focus({ preventScroll: true });
  return doc.activeElement === focusTarget;
}

export function bindCefriumImeDismissal(
  editor: CefriumImeEditor,
  win: Window = window,
): { dispose(): void } | null {
  if (!isCefriumAndroidRuntime(win.location.search)) return null;
  const editorDom = editor.getDomNode?.();
  const host = editorDom?.closest<HTMLElement>('#editor-frame');
  if (!editorDom || !host) return null;

  let pendingFocusFrame: number | null = null;
  const onDismissed = (): void => {
    releaseCefriumEditorFocus(editor, win.document);
    if (pendingFocusFrame !== null) {
      win.cancelAnimationFrame(pendingFocusFrame);
    }
    pendingFocusFrame = win.requestAnimationFrame(() => {
      pendingFocusFrame = null;
      releaseCefriumEditorFocus(editor, win.document);
    });
  };
  win.addEventListener(CEFRIUM_IME_DISMISSED_EVENT, onDismissed);

  return {
    dispose() {
      win.removeEventListener(CEFRIUM_IME_DISMISSED_EVENT, onDismissed);
      if (pendingFocusFrame !== null) {
        win.cancelAnimationFrame(pendingFocusFrame);
        pendingFocusFrame = null;
      }
    },
  };
}
