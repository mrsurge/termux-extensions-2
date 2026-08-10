interface AndroidKeyboardRecoveryEditor {
  getDomNode?(): HTMLElement | null;
}

export function isAndroidGeckoRuntime(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent) && /\bGecko\//i.test(userAgent);
}

export function resolveAndroidKeyboardRecoveryHost(
  editorDom: HTMLElement,
): HTMLElement | null {
  return editorDom.closest<HTMLElement>('#editor-frame');
}

export function recoverAndroidKeyboard(
  editor: AndroidKeyboardRecoveryEditor,
): boolean {
  const editorDom = editor.getDomNode?.();
  const input = editorDom?.querySelector<HTMLTextAreaElement>('textarea.inputarea, textarea');
  if (!input || input.disabled || input.readOnly || input.inputMode === 'none') return false;

  // Keep both calls inside the trusted click task; Gecko requires that user
  // activation to reopen the Android keyboard after it was dismissed.
  input.blur();
  input.focus({ preventScroll: true });
  return true;
}

function createRecoveryButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'te2-android-keyboard-recovery';
  button.title = 'Show keyboard';
  button.setAttribute('aria-label', 'Show keyboard');
  button.tabIndex = -1;
  Object.assign(button.style, {
    position: 'absolute',
    right: '14px',
    bottom: '14px',
    width: '44px',
    height: '44px',
    padding: '0',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: '12px',
    background: 'rgba(24, 28, 34, 0.34)',
    color: 'rgba(255, 255, 255, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    zIndex: '35',
  });
  button.innerHTML = [
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"',
    ' fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/>',
    '<path d="M6.5 9h.01M9.7 9h.01M12.9 9h.01M16.1 9h.01M7.9 12.2h.01M11.1 12.2h.01M14.3 12.2h.01M17.5 12.2h.01M7.5 15.4h9"/>',
    '</svg>',
  ].join('');
  return button;
}

export function bindAndroidKeyboardRecovery(
  editor: AndroidKeyboardRecoveryEditor,
  win: Window = window,
): { dispose(): void } | null {
  const editorDom = editor.getDomNode?.();
  if (!editorDom) return null;

  const androidGecko = isAndroidGeckoRuntime(win.navigator.userAgent || '');
  if (!androidGecko) return null;

  const overlayHost = resolveAndroidKeyboardRecoveryHost(editorDom);
  if (!overlayHost) return null;

  const doc = editorDom.ownerDocument;
  const button = createRecoveryButton(doc);
  const preserveEditorFocus = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const recover = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    recoverAndroidKeyboard(editor);
  };

  button.addEventListener('pointerdown', preserveEditorFocus);
  button.addEventListener('click', recover);
  overlayHost.appendChild(button);

  return {
    dispose() {
      button.removeEventListener('pointerdown', preserveEditorFocus);
      button.removeEventListener('click', recover);
      button.remove();
    },
  };
}
