export const ANDROID_IME_DISMISSED_EVENT = 'te2:android-ime-dismissed';

interface AndroidImeEditor {
  getDomNode?(): HTMLElement | null;
  hasTextFocus?(): boolean;
}

type KeyboardHostWindow = Window & {
  electromux?: { virtualKeyboard?: { subscribe?: () => () => void } };
};

export function releaseAndroidEditorFocus(
  editor: AndroidImeEditor,
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

export function bindAndroidImeDismissal(
  editor: AndroidImeEditor,
  win: KeyboardHostWindow = window,
): { dispose(): void } | null {
  const editorDom = editor.getDomNode?.();
  const host = editorDom?.closest<HTMLElement>('[data-te2-working-editor-host]')
    ?? editorDom?.closest<HTMLElement>('#editor-frame');
  if (!editorDom || !host) return null;

  let pendingFocusFrame: number | null = null;
  const onDismissed = (): void => {
    releaseAndroidEditorFocus(editor, win.document);
    if (pendingFocusFrame !== null) {
      win.cancelAnimationFrame(pendingFocusFrame);
    }
    pendingFocusFrame = win.requestAnimationFrame(() => {
      pendingFocusFrame = null;
      releaseAndroidEditorFocus(editor, win.document);
    });
  };
  win.addEventListener(ANDROID_IME_DISMISSED_EVENT, onDismissed);

  // Cefrium already emits the window event; Electromux opts each document in.
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = win.electromux?.virtualKeyboard?.subscribe?.();
  } catch {
    // The host capability is optional. Keep listening for legacy delivery.
  }
  return {
    dispose() {
      win.removeEventListener(ANDROID_IME_DISMISSED_EVENT, onDismissed);
      if (pendingFocusFrame !== null) {
        win.cancelAnimationFrame(pendingFocusFrame);
        pendingFocusFrame = null;
      }
      unsubscribe?.();
    },
  };
}
