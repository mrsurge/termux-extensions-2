import { runEditCommand } from './editor_command_utils.ts';
import {
  TERMINAL_SPECIAL_KEY_FOCUS_EVENT,
  dispatchSyntheticEditorKey,
  requestTerminalSpecialKey,
  type SyntheticEditorKey,
} from '../src/mobile-input/terminal-special-key-bridge.ts';

const CTRL_STATE_EVENT = 'android-terminalapp-ctrl-state';
const OPEN_TOUCH_MENU_EVENT = 'monaco-touch-selection:open-menu';
const CTRL_DOUBLE_TAP_MS = 350;

interface MobileNavigatorLike {
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}

interface MobileSpecialKeyEditorAction {
  run?(): unknown;
}

interface MobileSpecialKeyEditor {
  focus?(): void;
  getDomNode?(): HTMLElement | null;
  getAction?(id: string): MobileSpecialKeyEditorAction | null;
  trigger?(source: string, commandId: string, payload: unknown): void;
}

export type MobileEditorKey = SyntheticEditorKey;
type CtrlMode = 'off' | 'armed' | 'locked';

interface ModifierState {
  readonly ctrl: boolean;
  ctrlMode: CtrlMode;
  alt: boolean;
  shift: boolean;
  setCtrlMode(mode: CtrlMode, publish?: boolean): void;
  setAlt(active: boolean): void;
  setShift(active: boolean): void;
  consumeOneShot(): void;
}

type MobileSpecialKeysWindow = Window & {
  __androidTerminalCtrlDesired?: boolean;
  __androidTerminalSetCtrl?: (active: boolean) => void;
  __te2MobileCtrlLocked?: boolean;
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
    shift: useStickyModifiers && Boolean(modifierState?.shift),
  };

  dispatchSyntheticEditorKey(input, key, modifiers);
  modifierState?.consumeOneShot();
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
  activeModifierStates.get(win)?.consumeOneShot();
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

function createOverlayButton(
  doc: Document,
  label: string,
  title: string,
): HTMLButtonElement {
  const button = createButton(doc, label, title);
  button.classList.add('te2-mobile-special-key-overlay-trigger');
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

function runEditorAction(
  editor: MobileSpecialKeyEditor,
  actionId: string,
): boolean {
  try { editor.focus?.(); } catch (_) {}
  try {
    const action = editor.getAction?.(actionId);
    if (action?.run) {
      const result = action.run();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) => {
          console.warn(`[mobile_special_keys] ${actionId} failed`, error);
        });
      }
      return true;
    }
  } catch (error) {
    console.warn(`[mobile_special_keys] ${actionId} failed`, error);
    return false;
  }
  try {
    editor.trigger?.('mobile-special-keys', actionId, null);
    return typeof editor.trigger === 'function';
  } catch (error) {
    console.warn(`[mobile_special_keys] ${actionId} failed`, error);
    return false;
  }
}

function setPressed(button: HTMLButtonElement, active: boolean): void {
  button.classList.toggle('toggle', active);
  button.setAttribute('aria-pressed', String(active));
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
  const editorContainer = host.closest<HTMLElement>('.fe-editor-container') ?? host;

  const doc = editorDom.ownerDocument;
  const trigger = createOverlayButton(doc, 'Ctrl', 'Toggle editor special keys');
  trigger.classList.add('te2-mobile-special-key-trigger');

  const hover = createOverlayButton(doc, '\ud83d\ude81', 'Show hover');
  const context = createOverlayButton(doc, 'Ctx', 'Context menu');
  const cut = createOverlayButton(doc, 'Cut', 'Cut selection');
  const copy = createOverlayButton(doc, 'Copy', 'Copy selection');
  const paste = createOverlayButton(doc, 'Paste', 'Paste');
  const saveTrigger = createOverlayButton(doc, 'Save', 'Save current file');
  saveTrigger.classList.add('te2-mobile-special-key-save-trigger');

  const overlay = doc.createElement('div');
  overlay.className = 'te2-mobile-editor-overlay';
  overlay.setAttribute('aria-label', 'Editor mobile actions');
  const overlayLeft = doc.createElement('div');
  overlayLeft.className = 'te2-mobile-editor-overlay-left';
  const overlayRight = doc.createElement('div');
  overlayRight.className = 'te2-mobile-editor-overlay-right';
  overlayLeft.append(trigger, hover, context, cut, copy, paste);
  overlayRight.append(saveTrigger);
  overlay.append(overlayLeft, overlayRight);
  overlay.classList.toggle(
    'te2-mobile-editor-overlay-with-keyboard-recovery',
    Boolean(host.querySelector('.te2-android-keyboard-recovery')),
  );

  const secondWindowShortcut = editorContainer.querySelector<HTMLElement>(
    '.te2-mobile-second-window-trigger',
  );
  if (secondWindowShortcut) overlayLeft.append(secondWindowShortcut);

  const panel = doc.createElement('div');
  panel.className = 'te2-mobile-special-key-panel';
  panel.setAttribute('aria-label', 'Editor special keys');
  const primaryRow = doc.createElement('div');
  primaryRow.className = [
    'te2-mobile-special-key-row',
    'te2-mobile-special-key-primary-row',
  ].join(' ');
  const navigationRow = doc.createElement('div');
  navigationRow.className = [
    'te2-mobile-special-key-row',
    'te2-mobile-special-key-navigation-row',
  ].join(' ');

  const ctrl = createButton(doc, 'Ctrl', 'Control');
  const alt = createButton(doc, 'Alt', 'Alt');
  const select = createButton(doc, 'Sel', 'Toggle selection (Shift)');
  const left = createButton(doc, '\u2190', 'Left');
  const up = createButton(doc, '\u2191', 'Up');
  const down = createButton(doc, '\u2193', 'Down');
  const right = createButton(doc, '\u2192', 'Right');
  primaryRow.append(ctrl, alt, select, left, up, down, right);

  const tab = createButton(doc, 'Tab', 'Tab');
  const home = createButton(doc, 'Home', 'Home');
  const end = createButton(doc, 'End', 'End');
  const pageUp = createButton(doc, 'PgUp', 'Page up');
  const pageDown = createButton(doc, 'PgDn', 'Page down');
  navigationRow.append(tab, home, end, pageUp, pageDown);
  panel.append(primaryRow, navigationRow);

  const ctrlWindow = win as MobileSpecialKeysWindow;
  let syncingCtrl = false;
  let lastCtrlTapAt = Number.NEGATIVE_INFINITY;
  const ctrlButtons = [ctrl];
  const selectButtons = [select];

  const syncCtrlButtons = (): void => {
    const active = state.ctrlMode !== 'off';
    ctrlButtons.forEach((button) => {
      setPressed(button, active);
      button.classList.toggle('locked', state.ctrlMode === 'locked');
      button.title = state.ctrlMode === 'locked' ? 'Control locked' : 'Control';
      button.setAttribute('aria-label', button.title);
    });
  };
  const setCtrlMode = (mode: CtrlMode, publish = true): void => {
    state.ctrlMode = mode;
    ctrlWindow.__te2MobileCtrlLocked = mode === 'locked';
    syncCtrlButtons();
    if (!publish) return;
    const active = mode !== 'off';
    ctrlWindow.__androidTerminalCtrlDesired = active;
    syncingCtrl = true;
    try {
      if (typeof ctrlWindow.__androidTerminalSetCtrl === 'function') {
        ctrlWindow.__androidTerminalSetCtrl(active);
      } else {
        ctrlWindow.ctrl = active;
        win.dispatchEvent(new CustomEvent(CTRL_STATE_EVENT, {
          detail: { active },
        }));
      }
    } finally {
      syncingCtrl = false;
    }
  };
  const setAlt = (active: boolean): void => {
    state.alt = active;
    setPressed(alt, active);
  };
  const setShift = (active: boolean): void => {
    state.shift = active;
    selectButtons.forEach((button) => setPressed(button, active));
  };
  const initialCtrlMode: CtrlMode = ctrlWindow.ctrl
    ? (ctrlWindow.__te2MobileCtrlLocked ? 'locked' : 'armed')
    : 'off';
  const state: ModifierState = {
    get ctrl() {
      return state.ctrlMode !== 'off';
    },
    ctrlMode: initialCtrlMode,
    alt: false,
    shift: false,
    setCtrlMode,
    setAlt,
    setShift,
    consumeOneShot() {
      if (state.ctrlMode === 'armed') state.setCtrlMode('off');
      if (state.alt) state.setAlt(false);
    },
  };
  syncCtrlButtons();
  setPressed(alt, false);
  selectButtons.forEach((button) => setPressed(button, false));
  activeModifierStates.set(win, state);

  let terminalFocused = Boolean(
    doc.activeElement
    && doc.getElementById('terminal-container')?.contains(doc.activeElement),
  );
  const syncTerminalFocus = (event: Event): void => {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    const active = Boolean(detail?.active);
    if (terminalFocused === active) return;
    state.consumeOneShot();
    terminalFocused = active;
  };
  win.addEventListener(TERMINAL_SPECIAL_KEY_FOCUS_EVENT, syncTerminalFocus);

  const syncCtrl = (event: Event): void => {
    if (syncingCtrl) return;
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    const active = Boolean(detail?.active);
    if (!active && state.ctrlMode === 'locked') {
      state.setCtrlMode('locked');
      return;
    }
    state.setCtrlMode(
      active
        ? (ctrlWindow.__te2MobileCtrlLocked ? 'locked' : 'armed')
        : 'off',
      false,
    );
  };
  win.addEventListener(CTRL_STATE_EVENT, syncCtrl);

  const dispatchActiveKey = (key: MobileEditorKey): void => {
    if (terminalFocused) {
      const handled = requestTerminalSpecialKey(win, key, {
        ctrl: state.ctrl,
        alt: state.alt,
        shift: state.shift,
      });
      if (handled) state.consumeOneShot();
      return;
    }
    dispatchMobileEditorKey(editor, key, win);
  };

  const handleCtrlTap = (): void => {
    const now = Date.now();
    if (state.ctrlMode === 'locked') {
      lastCtrlTapAt = Number.NEGATIVE_INFINITY;
      state.setCtrlMode('off');
      return;
    }
    if (
      state.ctrlMode === 'armed'
      && now - lastCtrlTapAt <= CTRL_DOUBLE_TAP_MS
    ) {
      lastCtrlTapAt = Number.NEGATIVE_INFINITY;
      state.setCtrlMode('locked');
      return;
    }
    if (state.ctrlMode === 'armed') {
      lastCtrlTapAt = Number.NEGATIVE_INFINITY;
      state.setCtrlMode('off');
      return;
    }
    lastCtrlTapAt = now;
    state.setCtrlMode('armed');
  };

  const overlayTools = [hover, context, cut, copy, paste];
  const setPanelOpen = (open: boolean): void => {
    panel.hidden = !open;
    overlayTools.forEach((button) => {
      button.hidden = !open;
    });
    saveTrigger.hidden = !open;
    appRoot.classList.toggle('te2-mobile-special-keys-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  };

  const cleanups = [
    bindPointerAction(trigger, () => setPanelOpen(panel.hidden)),
    bindPointerAction(saveTrigger, () => {
      state.consumeOneShot();
      onSave?.();
    }),
    bindPointerAction(hover, () => {
      state.consumeOneShot();
      runEditorAction(editor, 'editor.action.showHover');
    }),
    bindPointerAction(ctrl, handleCtrlTap),
    bindPointerAction(alt, () => state.setAlt(!state.alt)),
    bindPointerAction(select, () => state.setShift(!state.shift)),
    bindPointerAction(context, () => openMobileTouchSelectionMenu(editor, win)),
    bindPointerAction(cut, () => {
      state.consumeOneShot();
      runEditCommand(editor, 'cut');
    }),
    bindPointerAction(copy, () => {
      state.consumeOneShot();
      runEditCommand(editor, 'copy');
    }),
    bindPointerAction(paste, () => {
      state.consumeOneShot();
      runEditCommand(editor, 'paste');
    }),
    bindPointerAction(left, () => dispatchActiveKey({
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      keyCode: 37,
    })),
    bindPointerAction(up, () => dispatchActiveKey({
      key: 'ArrowUp',
      code: 'ArrowUp',
      keyCode: 38,
    })),
    bindPointerAction(down, () => dispatchActiveKey({
      key: 'ArrowDown',
      code: 'ArrowDown',
      keyCode: 40,
    })),
    bindPointerAction(right, () => dispatchActiveKey({
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode: 39,
    })),
    bindPointerAction(tab, () => dispatchActiveKey({
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
    })),
    bindPointerAction(home, () => dispatchActiveKey({
      key: 'Home',
      code: 'Home',
      keyCode: 36,
    })),
    bindPointerAction(end, () => dispatchActiveKey({
      key: 'End',
      code: 'End',
      keyCode: 35,
    })),
    bindPointerAction(pageUp, () => dispatchActiveKey({
      key: 'PageUp',
      code: 'PageUp',
      keyCode: 33,
    })),
    bindPointerAction(pageDown, () => dispatchActiveKey({
      key: 'PageDown',
      code: 'PageDown',
      keyCode: 34,
    })),
  ];

  appRoot.append(panel);
  editorContainer.append(overlay);
  setPanelOpen(true);

  return {
    dispose() {
      cleanups.forEach((cleanup) => cleanup());
      win.removeEventListener(
        TERMINAL_SPECIAL_KEY_FOCUS_EVENT,
        syncTerminalFocus,
      );
      win.removeEventListener(CTRL_STATE_EVENT, syncCtrl);
      if (activeModifierStates.get(win) === state) {
        state.setCtrlMode('off');
        state.setAlt(false);
        state.setShift(false);
        activeModifierStates.delete(win);
      }
      appRoot.classList.remove('te2-mobile-special-keys-open');
      const retainedSecondWindow = overlayLeft.querySelector<HTMLElement>(
        '.te2-mobile-second-window-trigger',
      );
      if (retainedSecondWindow) editorContainer.append(retainedSecondWindow);
      panel.remove();
      overlay.remove();
    },
  };
}
