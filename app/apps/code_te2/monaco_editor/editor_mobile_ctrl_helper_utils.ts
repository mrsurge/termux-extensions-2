const HELPER_BASE_URL = '/apps/code_te2/vendor/android-terminalapp-assets-js';

interface MonacoTermShimState {
  editor: MonacoRuntimeEditorLike | null;
  monacoRef: unknown;
  input: HTMLTextAreaElement | null;
  handler: ((event: KeyboardEvent) => boolean | void) | null;
  disposeHandler: (() => void) | null;
  replayingControlChord: boolean;
}

interface ControlChordLike {
  key: string;
  code: string;
  keyCode: number;
  shiftKey: boolean;
}

const state: MonacoTermShimState = {
  editor: null,
  monacoRef: null,
  input: null,
  handler: null,
  disposeHandler: null,
  replayingControlChord: false,
};

const monacoTermShim: MonacoRuntimeTermShim = {
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean | void) {
    state.handler = typeof handler === 'function' ? handler : null;
    installHandlerOnCurrentInput();
  },
  input(data: string) {
    dispatchControlInput(data);
  },
};

function loadHelperScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = (event) => {
      script.remove();
      reject(event);
    };
    document.head.appendChild(script);
  });
}

function helperUrl(name: string, fresh = false): string {
  const url = `${HELPER_BASE_URL}/${name}`;
  if (!fresh) return url;
  return `${url}?ts=${Date.now()}`;
}

function getEditorInputArea(editorInstance: MonacoRuntimeEditorLike | null | undefined): HTMLTextAreaElement | null {
  try {
    const dom = editorInstance && editorInstance.getDomNode ? editorInstance.getDomNode() : null;
    if (!dom) return null;
    return (dom.querySelector('textarea.inputarea') || dom.querySelector('textarea')) as HTMLTextAreaElement | null;
  } catch (_) {
    return null;
  }
}

function clearDomHandler(): void {
  if (state.disposeHandler) {
    try { state.disposeHandler(); } catch (_) {}
    state.disposeHandler = null;
  }
}

function installHandlerOnCurrentInput(): void {
  clearDomHandler();
  const input = state.input;
  const handler = state.handler;
  if (!input || typeof handler !== 'function') return;

  const forwardEvent = (event: KeyboardEvent): void => {
    // Replayed Ctrl chords must reach Monaco instead of re-entering the
    // vendored Gboard interceptor that produced them.
    if (state.replayingControlChord) return;

    let keepDefault = true;
    try {
      keepDefault = handler(event) !== false;
    } catch (error) {
      console.warn('[editor_ctrl_helper] vendored ctrl handler failed', error);
      return;
    }
    if (keepDefault) return;
    try { event.preventDefault(); } catch (_) {}
    try { event.stopImmediatePropagation(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
  };

  input.addEventListener('keydown', forwardEvent, true);
  input.addEventListener('keyup', forwardEvent, true);

  state.disposeHandler = () => {
    input.removeEventListener('keydown', forwardEvent, true);
    input.removeEventListener('keyup', forwardEvent, true);
  };
}

function controlCharToChord(ch: string): ControlChordLike | null {
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 1 && code <= 26) {
    const upper = String.fromCharCode(code + 64);
    return { key: upper.toLowerCase(), code: `Key${upper}`, keyCode: upper.charCodeAt(0), shiftKey: false };
  }
  switch (code) {
    case 27: return { key: '[', code: 'BracketLeft', keyCode: 219, shiftKey: false };
    case 28: return { key: '\\', code: 'Backslash', keyCode: 220, shiftKey: false };
    case 29: return { key: ']', code: 'BracketRight', keyCode: 221, shiftKey: false };
    case 30: return { key: '^', code: 'Digit6', keyCode: 54, shiftKey: true };
    case 31: return { key: '_', code: 'Minus', keyCode: 189, shiftKey: true };
    default: return null;
  }
}

function buildKeyboardEvent(type: 'keydown' | 'keyup', chord: ControlChordLike): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key: chord.key,
    code: chord.code,
    ctrlKey: true,
    shiftKey: !!chord.shiftKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  try { Object.defineProperty(event, 'keyCode', { get: () => chord.keyCode }); } catch (_) {}
  try { Object.defineProperty(event, 'which', { get: () => chord.keyCode }); } catch (_) {}
  return event;
}

function dispatchControlInput(data: string): void {
  const text = typeof data === 'string' ? data : '';
  if (!text) return;

  const input = state.input || getEditorInputArea(state.editor);
  if (!input) return;

  try { state.editor?.focus?.(); } catch (_) {}

  state.replayingControlChord = true;
  try {
    for (let index = 0; index < text.length; index += 1) {
      const chord = controlCharToChord(text.charAt(index));
      if (!chord) continue;
      try { input.dispatchEvent(buildKeyboardEvent('keydown', chord)); } catch (_) {}
      try { input.dispatchEvent(buildKeyboardEvent('keyup', chord)); } catch (_) {}
    }
  } finally {
    state.replayingControlChord = false;
    if (typeof window.__androidTerminalSetCtrl === 'function') {
      window.__androidTerminalSetCtrl(false);
    } else {
      window.__androidTerminalCtrlDesired = false;
      window.ctrl = false;
    }
  }
}

export async function rebindVendoredCtrlHelper(
  editorInstance: MonacoRuntimeEditorLike | null | undefined,
  monacoRef: unknown,
): Promise<boolean> {
  if (!editorInstance) return false;
  const input = getEditorInputArea(editorInstance);
  if (!input) return false;

  state.editor = editorInstance;
  state.monacoRef = monacoRef || null;
  state.input = input;

  window.term = monacoTermShim;
  window.ctrl = !!window.ctrl;
  installHandlerOnCurrentInput();
  await loadHelperScript(helperUrl('ctrl_key_handler.js', true));
  return true;
}

export function clearVendoredCtrlHelper(editorInstance?: MonacoRuntimeEditorLike | null): void {
  if (editorInstance && state.editor && state.editor !== editorInstance) return;
  clearDomHandler();
  state.editor = null;
  state.monacoRef = null;
  state.input = null;
}

export function bindVendoredCtrlHelperFocus(
  ed: MonacoRuntimeEditorLike | null | unknown,
  monacoRef: unknown,
): { dispose(): void } | null {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!editor || !editor.onDidFocusEditorWidget || !editor.onDidBlurEditorWidget) return null;
  const disposables: MonacoRuntimeDisposableLike[] = [];

  const bindNow = (): void => {
    rebindVendoredCtrlHelper(editor, monacoRef).catch((error: unknown) => {
      console.warn('[editor_ctrl_helper] failed to bind vendored ctrl helper', error);
    });
  };

  disposables.push(editor.onDidFocusEditorWidget(() => { bindNow(); }));
  disposables.push(editor.onDidBlurEditorWidget(() => { clearVendoredCtrlHelper(editor); }));

  try {
    if (editor.hasTextFocus && editor.hasTextFocus()) bindNow();
  } catch (_) {}

  return {
    dispose() {
      disposables.forEach((disposable) => { disposable.dispose?.(); });
      clearVendoredCtrlHelper(editor);
    },
  };
}
