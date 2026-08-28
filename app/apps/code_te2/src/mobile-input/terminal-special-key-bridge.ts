export const TERMINAL_SPECIAL_KEY_FOCUS_EVENT =
  'te2:terminal-drawer-special-key-focus';
export const TERMINAL_SPECIAL_KEY_REQUEST_EVENT =
  'te2:terminal-drawer-special-key-request';

export interface SyntheticEditorKey {
  key: string;
  code: string;
  keyCode: number;
  shiftKey?: boolean;
}

export interface SyntheticKeyModifiers {
  ctrl: boolean;
  alt: boolean;
  shift?: boolean;
}

interface TerminalSpecialKeyRequestDetail {
  key: SyntheticEditorKey;
  modifiers: SyntheticKeyModifiers;
  handled: boolean;
}

function createKeyboardEvent(
  type: 'keydown' | 'keyup',
  key: SyntheticEditorKey,
  modifiers: SyntheticKeyModifiers,
): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key: key.key,
    code: key.code,
    ctrlKey: modifiers.ctrl,
    altKey: modifiers.alt,
    shiftKey: Boolean(key.shiftKey || modifiers.shift),
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  try {
    Object.defineProperty(event, 'keyCode', { get: () => key.keyCode });
    Object.defineProperty(event, 'which', { get: () => key.keyCode });
  } catch {
    // Modern keyboard consumers can use key/code if legacy fields are sealed.
  }
  return event;
}

export function dispatchSyntheticEditorKey(
  target: HTMLElement,
  key: SyntheticEditorKey,
  modifiers: SyntheticKeyModifiers,
): void {
  target.dispatchEvent(createKeyboardEvent('keydown', key, modifiers));
  target.dispatchEvent(createKeyboardEvent('keyup', key, modifiers));
}

export function publishTerminalSpecialKeyFocus(
  win: Window,
  active: boolean,
): void {
  win.dispatchEvent(new CustomEvent(TERMINAL_SPECIAL_KEY_FOCUS_EVENT, {
    detail: { active },
  }));
}

export function requestTerminalSpecialKey(
  win: Window,
  key: SyntheticEditorKey,
  modifiers: SyntheticKeyModifiers,
): boolean {
  const detail: TerminalSpecialKeyRequestDetail = {
    key,
    modifiers,
    handled: false,
  };
  win.dispatchEvent(new CustomEvent<TerminalSpecialKeyRequestDetail>(
    TERMINAL_SPECIAL_KEY_REQUEST_EVENT,
    { detail },
  ));
  return detail.handled;
}

export function bindTerminalSpecialKeyTarget(
  win: Window,
  getTarget: () => HTMLTextAreaElement | null,
): () => void {
  const handleRequest = (event: Event): void => {
    const detail = (
      event as CustomEvent<TerminalSpecialKeyRequestDetail>
    ).detail;
    const target = getTarget();
    if (!detail || !target || win.document.activeElement !== target) return;
    dispatchSyntheticEditorKey(target, detail.key, detail.modifiers);
    detail.handled = true;
  };
  win.addEventListener(TERMINAL_SPECIAL_KEY_REQUEST_EVENT, handleRequest);
  return () => {
    win.removeEventListener(TERMINAL_SPECIAL_KEY_REQUEST_EVENT, handleRequest);
  };
}
