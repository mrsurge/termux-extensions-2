export const CTRL_DOUBLE_TAP_MS = 350;
export const MINIBAR_INTERACTION_GUARD_MS = 300;

export type CtrlMode = 'off' | 'armed' | 'locked';

export interface SyntheticTerminalKey {
  key: string;
  code: string;
  keyCode: number;
}

export interface TerminalKeyModifiers {
  ctrl: boolean;
  alt: boolean;
}

interface KeyboardEventConstructor {
  new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
}

interface InputEventConstructor {
  new (type: string, eventInitDict?: InputEventInit): InputEvent;
}

interface MobileNavigatorLike {
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}

export const TERMINAL_KEYS = {
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  dash: { key: '-', code: 'Minus', keyCode: 189 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  pageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
} as const satisfies Record<string, SyntheticTerminalKey>;

export function isMobileUserAgent(navigatorLike: MobileNavigatorLike): boolean {
  if (navigatorLike.userAgentData?.mobile === true) return true;
  return /\b(?:Android|Mobile|iPhone|iPad|iPod)\b/i.test(
    navigatorLike.userAgent || '',
  );
}

export class TerminalModifierState {
  public ctrlMode: CtrlMode = 'off';
  public alt = false;
  private lastCtrlTapAt = Number.NEGATIVE_INFINITY;

  public get ctrl(): boolean {
    return this.ctrlMode !== 'off';
  }

  public setCtrlMode(mode: CtrlMode): void {
    this.ctrlMode = mode;
    if (mode !== 'armed') this.lastCtrlTapAt = Number.NEGATIVE_INFINITY;
  }

  public tapCtrl(now = Date.now()): CtrlMode {
    if (this.ctrlMode === 'locked') {
      this.setCtrlMode('off');
      return this.ctrlMode;
    }
    if (
      this.ctrlMode === 'armed'
      && now - this.lastCtrlTapAt <= CTRL_DOUBLE_TAP_MS
    ) {
      this.setCtrlMode('locked');
      return this.ctrlMode;
    }
    if (this.ctrlMode === 'armed') {
      this.setCtrlMode('off');
      return this.ctrlMode;
    }
    this.ctrlMode = 'armed';
    this.lastCtrlTapAt = now;
    return this.ctrlMode;
  }

  public toggleAlt(): boolean {
    this.alt = !this.alt;
    return this.alt;
  }

  public consumeOneShot(): void {
    if (this.ctrlMode === 'armed') this.setCtrlMode('off');
    this.alt = false;
  }

  public reset(): void {
    this.setCtrlMode('off');
    this.alt = false;
  }
}

export function shouldSuppressMinibarInteraction(
  guardUntil: number,
  now: number,
): boolean {
  return guardUntil > 0 && now <= guardUntil;
}

function createKeyboardEvent(
  type: 'keydown' | 'keyup',
  key: SyntheticTerminalKey,
  modifiers: TerminalKeyModifiers,
  EventConstructor: KeyboardEventConstructor,
): KeyboardEvent {
  const event = new EventConstructor(type, {
    key: key.key,
    code: key.code,
    ctrlKey: modifiers.ctrl,
    altKey: modifiers.alt,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  try {
    Object.defineProperty(event, 'keyCode', { get: () => key.keyCode });
    Object.defineProperty(event, 'which', { get: () => key.keyCode });
  } catch {
    // xterm can use key/code when a browser seals the legacy fields.
  }
  return event;
}

export function dispatchSyntheticTerminalKey(
  target: HTMLElement,
  key: SyntheticTerminalKey,
  modifiers: TerminalKeyModifiers,
  EventConstructor: KeyboardEventConstructor = KeyboardEvent,
): void {
  target.dispatchEvent(createKeyboardEvent('keydown', key, modifiers, EventConstructor));
  target.dispatchEvent(createKeyboardEvent('keyup', key, modifiers, EventConstructor));
}

export function dispatchSyntheticTerminalText(
  target: HTMLTextAreaElement,
  text: string,
  EventConstructor: InputEventConstructor = InputEvent,
): void {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.setRangeText(text, start, end, 'end');
  target.dispatchEvent(new EventConstructor('input', {
    data: text,
    inputType: 'insertText',
    bubbles: true,
    composed: true,
  }));
}
