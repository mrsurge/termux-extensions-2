const HELPER_BASE_URL = '/apps/file_editor_cm6/vendor/android-terminalapp-assets-js';

const state = {
  editor: null,
  monacoRef: null,
  input: null,
  handler: null,
  disposeHandler: null,
};

const monacoTermShim = {
  attachCustomKeyEventHandler(handler) {
    state.handler = typeof handler === 'function' ? handler : null;
    installHandlerOnCurrentInput();
  },
  input(data) {
    dispatchControlInput(data);
  },
};

function loadHelperScript(src) {
  return new Promise((resolve, reject) => {
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

function helperUrl(name, fresh = false) {
  const url = `${HELPER_BASE_URL}/${name}`;
  if (!fresh) return url;
  return `${url}?ts=${Date.now()}`;
}

function getEditorInputArea(editorInstance) {
  try {
    const dom = editorInstance && editorInstance.getDomNode ? editorInstance.getDomNode() : null;
    if (!dom) return null;
    return dom.querySelector('textarea.inputarea') || dom.querySelector('textarea');
  } catch (_) {
    return null;
  }
}

function clearDomHandler() {
  if (state.disposeHandler) {
    try { state.disposeHandler(); } catch (_) {}
    state.disposeHandler = null;
  }
}

function installHandlerOnCurrentInput() {
  clearDomHandler();
  const input = state.input;
  const handler = state.handler;
  if (!input || typeof handler !== 'function') return;

  const forwardEvent = (event) => {
    let keepDefault = true;
    try {
      keepDefault = handler(event) !== false;
    } catch (err) {
      console.warn('[editor_ctrl_helper] vendored ctrl handler failed', err);
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

function controlCharToChord(ch) {
  if (!ch || typeof ch !== 'string') return null;
  const code = ch.charCodeAt(0);
  if (code >= 1 && code <= 26) {
    const upper = String.fromCharCode(code + 64);
    return {
      key: upper.toLowerCase(),
      code: `Key${upper}`,
      keyCode: upper.charCodeAt(0),
      shiftKey: false,
    };
  }
  switch (code) {
    case 27:
      return { key: '[', code: 'BracketLeft', keyCode: 219, shiftKey: false };
    case 28:
      return { key: '\\', code: 'Backslash', keyCode: 220, shiftKey: false };
    case 29:
      return { key: ']', code: 'BracketRight', keyCode: 221, shiftKey: false };
    case 30:
      return { key: '^', code: 'Digit6', keyCode: 54, shiftKey: true };
    case 31:
      return { key: '_', code: 'Minus', keyCode: 189, shiftKey: true };
    default:
      return null;
  }
}

function buildKeyboardEvent(type, chord) {
  const event = new KeyboardEvent(type, {
    key: chord.key,
    code: chord.code,
    ctrlKey: true,
    shiftKey: !!chord.shiftKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  if (typeof chord.keyCode === 'number') {
    try { Object.defineProperty(event, 'keyCode', { get: () => chord.keyCode }); } catch (_) {}
    try { Object.defineProperty(event, 'which', { get: () => chord.keyCode }); } catch (_) {}
  }
  return event;
}

function dispatchControlInput(data) {
  const text = typeof data === 'string' ? data : '';
  if (!text) return;

  const input = state.input || getEditorInputArea(state.editor);
  if (!input) return;

  try { if (state.editor && state.editor.focus) state.editor.focus(); } catch (_) {}

  for (let index = 0; index < text.length; index += 1) {
    const chord = controlCharToChord(text.charAt(index));
    if (!chord) continue;
    try { input.dispatchEvent(buildKeyboardEvent('keydown', chord)); } catch (_) {}
    try { input.dispatchEvent(buildKeyboardEvent('keyup', chord)); } catch (_) {}
  }
}

export async function rebindVendoredCtrlHelper(editorInstance, monacoRef) {
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

export function clearVendoredCtrlHelper(editorInstance) {
  if (editorInstance && state.editor && state.editor !== editorInstance) return;
  clearDomHandler();
  state.editor = null;
  state.monacoRef = null;
  state.input = null;
}

export function bindVendoredCtrlHelperFocus(ed, monacoRef) {
  if (!ed) return null;
  const disposables = [];

  const bindNow = () => {
    rebindVendoredCtrlHelper(ed, monacoRef).catch((err) => {
      console.warn('[editor_ctrl_helper] failed to bind vendored ctrl helper', err);
    });
  };

  disposables.push(ed.onDidFocusEditorWidget(() => {
    bindNow();
  }));
  disposables.push(ed.onDidBlurEditorWidget(() => {
    clearVendoredCtrlHelper(ed);
  }));

  try {
    if (ed.hasTextFocus && ed.hasTextFocus()) bindNow();
  } catch (_) {}

  return {
    dispose() {
      disposables.forEach((d) => {
        try { d.dispose(); } catch (_) {}
      });
      clearVendoredCtrlHelper(ed);
    },
  };
}
