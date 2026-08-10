import {
  TERMINAL_SPECIAL_KEY_FOCUS_EVENT,
  dispatchSyntheticEditorKey,
  requestTerminalSpecialKey,
  type SyntheticEditorKey,
} from '../src/mobile-input/terminal-special-key-bridge.ts';

const CTRL_STATE_EVENT = 'android-terminalapp-ctrl-state';
const OPEN_TOUCH_MENU_EVENT = 'monaco-touch-selection:open-menu';

interface MobileNavigatorLike {
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}

interface MobileSpecialKeyEditor {
  focus?(): void;
  getDomNode?(): HTMLElement | null;
}

export type MobileEditorKey = SyntheticEditorKey;

interface ModifierState {
  ctrl: boolean;
  alt: boolean;
  setCtrl(active: boolean): void;
  setAlt(active: boolean): void;
  consume(): void;
}

type MobileSpecialKeysWindow = Window & {
  __androidTerminalCtrlDesired?: boolean;
  __androidTerminalSetCtrl?: (active: boolean) => void;
  ctrl?: boolean;
};

const activeModifierStates = new WeakMap<Window, ModifierState>();

export function isMobileUserAgent(navigatorLike: MobileNavigatorLike): boolean {
  if (navigatorLike.userAgentData?.mobile === true) return true;
  return /\b(?:Android|Mobile|iPhone|iPad|iPod)\b/i.test(
    navigatorLike.userAgent || '',
  );
}

function getEditorInput(editor: MobileSpecialKeyEditor): HTMLTextAreaElement | null {
  const editorDom = editor.getDomNode?.();
  return editorDom?.querySelector<HTMLTextAreaElement>(
    'textarea.inputarea, textarea',
  ) ?? null;
}

export function dispatchMobileEditorKey(
  editor: MobileSpecialKeyEditor,
  key: MobileEditorKey,
  win: Window = window,
  options: { useStickyModifiers?: boolean } = {},
): boolean {
  let input = getEditorInput(editor);
  if (!input) return false;

  if (win.document.activeElement !== input) {
    editor.focus?.();
    input = getEditorInput(editor);
  }
  if (!input) return false;

  const modifierState = activeModifierStates.get(win);
  const useStickyModifiers = options.useStickyModifiers !== false;
  const modifiers = {
    ctrl: useStickyModifiers && Boolean(modifierState?.ctrl),
    alt: useStickyModifiers && Boolean(modifierState?.alt),
  };

  dispatchSyntheticEditorKey(input, key, modifiers);
  modifierState?.consume();
  return true;
}

export function openMobileTouchSelectionMenu(
  editor: MobileSpecialKeyEditor,
  win: Window = window,
): boolean {
  const editorDom = editor.getDomNode?.();
  if (!editorDom) return false;
  editorDom.dispatchEvent(new CustomEvent(OPEN_TOUCH_MENU_EVENT, {
    detail: { touchMode: true },
  }));
  activeModifierStates.get(win)?.consume();
  return true;
}

function createButton(
  doc: Document,
  label: string,
  title: string,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'te2-mobile-special-key';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.tabIndex = -1;
  return button;
}

function bindPointerAction(
  button: HTMLButtonElement,
  action: () => void,
): () => void {
  const handler = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  button.addEventListener('pointerdown', handler, { passive: false });
  return () => button.removeEventListener('pointerdown', handler);
}

export function bindMobileEditorSpecialKeys(
  editor: MobileSpecialKeyEditor,
  win: Window = window,
  onSave: (() => void) | null = null,
): { dispose(): void } | null {
  const editorDom = editor.getDomNode?.();
  if (!editorDom || !isMobileUserAgent(win.navigator)) return null;
  const host = editorDom.closest<HTMLElement>('#editor-frame');
  if (!host) return null;
  const appRoot = host.closest<HTMLElement>('.fe-root');
  if (!appRoot) return null;

  const doc = editorDom.ownerDocument;
  const trigger = createButton(doc, 'Ctrl', 'Show editor special keys');
  trigger.classList.add(
    'te2-mobile-special-key-overlay-trigger',
    'te2-mobile-special-key-trigger',
  );
  trigger.setAttribute('aria-expanded', 'false');

  const saveTrigger = createButton(doc, 'Save', 'Save current file');
  saveTrigger.classList.add(
    'te2-mobile-special-key-overlay-trigger',
    'te2-mobile-special-key-save-trigger',
  );
  saveTrigger.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'te2-mobile-special-key-panel';
  panel.setAttribute('aria-label', 'Editor special keys');
  panel.hidden = true;

  const ctrl = createButton(doc, 'Ctrl', 'Control');
  const alt = createButton(doc, 'Alt', 'Alt');
  const context = createButton(doc, 'Ctx', 'Context menu');
  const left = createButton(doc, '\u2190', 'Left');
  const up = createButton(doc, '\u2191', 'Up');
  const down = createButton(doc, '\u2193', 'Down');
  const right = createButton(doc, '\u2192', 'Right');
  panel.append(ctrl, alt, context, left, up, down, right);

  const ctrlWindow = win as MobileSpecialKeysWindow;
  const setCtrl = (active: boolean): void => {
    ctrlWindow.__androidTerminalCtrlDesired = active;
    if (typeof ctrlWindow.__androidTerminalSetCtrl === 'function') {
      ctrlWindow.__androidTerminalSetCtrl(active);
    } else {
      ctrlWindow.ctrl = active;
      win.dispatchEvent(new CustomEvent(CTRL_STATE_EVENT, {
        detail: { active },
      }));
    }
    state.ctrl = active;
    ctrl.classList.toggle('toggle', active);
  };
  const setAlt = (active: boolean): void => {
    state.alt = active;
    alt.classList.toggle('toggle', active);
  };
  const state: ModifierState = {
    ctrl: Boolean(ctrlWindow.ctrl),
    alt: false,
    setCtrl,
    setAlt,
    consume() {
      if (state.ctrl) setCtrl(false);
      if (state.alt) setAlt(false);
    },
  };
  ctrl.classList.toggle('toggle', state.ctrl);
  activeModifierStates.set(win, state);

  let terminalFocused = Boolean(
    doc.activeElement
    && doc.getElementById('terminal-container')?.contains(doc.activeElement),
  );
  const syncTargetMode = (active: boolean): void => {
    if (terminalFocused === active) return;
    state.consume();
    terminalFocused = active;
    context.textContent = active ? 'Tab' : 'Ctx';
    const title = active ? 'Tab' : 'Context menu';
    context.title = title;
    context.setAttribute('aria-label', title);
  };
  if (terminalFocused) {
    context.textContent = 'Tab';
    context.title = 'Tab';
    context.setAttribute('aria-label', 'Tab');
  }
  const syncTerminalFocus = (event: Event): void => {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    syncTargetMode(Boolean(detail?.active));
  };
  win.addEventListener(TERMINAL_SPECIAL_KEY_FOCUS_EVENT, syncTerminalFocus);

  const syncCtrl = (event: Event): void => {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    state.ctrl = Boolean(detail?.active);
    ctrl.classList.toggle('toggle', state.ctrl);
  };
  win.addEventListener(CTRL_STATE_EVENT, syncCtrl);

  const dispatchActiveKey = (key: MobileEditorKey): void => {
    if (terminalFocused) {
      const handled = requestTerminalSpecialKey(win, key, {
        ctrl: state.ctrl,
        alt: state.alt,
      });
      if (handled) state.consume();
      return;
    }
    dispatchMobileEditorKey(editor, key, win);
  };

  const cleanups = [
    bindPointerAction(trigger, () => {
      const open = panel.hidden !== false;
      panel.hidden = !open;
      saveTrigger.hidden = !open;
      appRoot.classList.toggle('te2-mobile-special-keys-open', open);
      trigger.setAttribute('aria-expanded', String(open));
    }),
    bindPointerAction(saveTrigger, () => {
      state.consume();
      onSave?.();
    }),
    bindPointerAction(ctrl, () => state.setCtrl(!state.ctrl)),
    bindPointerAction(alt, () => state.setAlt(!state.alt)),
    bindPointerAction(context, () => {
      if (terminalFocused) {
        dispatchActiveKey({
          key: 'Tab',
          code: 'Tab',
          keyCode: 9,
        });
      } else {
        openMobileTouchSelectionMenu(editor, win);
      }
    }),
    bindPointerAction(left, () => {
      dispatchActiveKey({
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        keyCode: 37,
      });
    }),
    bindPointerAction(up, () => {
      dispatchActiveKey({
        key: 'ArrowUp',
        code: 'ArrowUp',
        keyCode: 38,
      });
    }),
    bindPointerAction(down, () => {
      dispatchActiveKey({
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
      });
    }),
    bindPointerAction(right, () => {
      dispatchActiveKey({
        key: 'ArrowRight',
        code: 'ArrowRight',
        keyCode: 39,
      });
    }),
  ];

  appRoot.append(panel);
  host.append(trigger, saveTrigger);

  return {
    dispose() {
      cleanups.forEach((cleanup) => cleanup());
      win.removeEventListener(
        TERMINAL_SPECIAL_KEY_FOCUS_EVENT,
        syncTerminalFocus,
      );
      win.removeEventListener(CTRL_STATE_EVENT, syncCtrl);
      if (activeModifierStates.get(win) === state) {
        state.consume();
        activeModifierStates.delete(win);
      }
      appRoot.classList.remove('te2-mobile-special-keys-open');
      panel.remove();
      saveTrigger.remove();
      trigger.remove();
    },
  };
}
