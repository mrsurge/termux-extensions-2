import type {
  SyntheticEditorKey,
  SyntheticKeyModifiers,
} from './terminal-special-key-bridge.ts';

export const MOBILE_EDITOR_FOCUS_EVENT = 'te2:mobile-editor-focus';
export const MOBILE_EDITOR_OWNER_EVENT = 'te2:mobile-editor-owner';
export const MOBILE_EDITOR_SPECIAL_KEY_REQUEST_EVENT =
  'te2:mobile-editor-special-key-request';
export const MOBILE_EDITOR_PANEL_TOGGLE_EVENT =
  'te2:mobile-editor-panel-toggle';
export const MOBILE_EDITOR_PANEL_STATE_EVENT =
  'te2:mobile-editor-panel-state';
export const MOBILE_EDITOR_MODIFIER_STATE_EVENT =
  'te2:mobile-editor-modifier-state';
export const MOBILE_EDITOR_MODIFIERS_CONSUMED_EVENT =
  'te2:mobile-editor-modifiers-consumed';

export type MobileEditorRole = 'primary' | 'secondary';

export interface MobileEditorModifierState extends SyntheticKeyModifiers {
  ctrlLocked: boolean;
}

export interface MobileEditorSpecialKeyRequestDetail {
  role: MobileEditorRole;
  key: SyntheticEditorKey;
  modifiers: SyntheticKeyModifiers;
  handled: boolean;
}

export interface MobileEditorPanelToggleDetail {
  role: MobileEditorRole;
  handled: boolean;
}

const ownerByWindow = new WeakMap<Window, MobileEditorRole>();
const modifiersByWindow = new WeakMap<Window, MobileEditorModifierState>();
const panelStateByWindow = new WeakMap<Window, boolean>();

export function currentMobileEditorOwner(win: Window): MobileEditorRole {
  return ownerByWindow.get(win) ?? 'primary';
}

export function setMobileEditorOwner(
  win: Window,
  role: MobileEditorRole,
): void {
  if (ownerByWindow.get(win) === role) return;
  ownerByWindow.set(win, role);
  win.dispatchEvent(new CustomEvent(MOBILE_EDITOR_OWNER_EVENT, {
    detail: { role },
  }));
}

export function publishMobileEditorFocus(
  win: Window,
  role: MobileEditorRole,
): void {
  setMobileEditorOwner(win, role);
  win.dispatchEvent(new CustomEvent(MOBILE_EDITOR_FOCUS_EVENT, {
    detail: { role },
  }));
}

export function currentMobileEditorModifiers(
  win: Window,
): MobileEditorModifierState {
  return modifiersByWindow.get(win) ?? {
    ctrl: false,
    ctrlLocked: false,
    alt: false,
    shift: false,
  };
}

export function publishMobileEditorModifierState(
  win: Window,
  state: MobileEditorModifierState,
): void {
  const snapshot = { ...state };
  modifiersByWindow.set(win, snapshot);
  win.dispatchEvent(new CustomEvent(MOBILE_EDITOR_MODIFIER_STATE_EVENT, {
    detail: snapshot,
  }));
}

export function publishMobileEditorModifiersConsumed(
  win: Window,
  role: MobileEditorRole,
): void {
  win.dispatchEvent(new CustomEvent(MOBILE_EDITOR_MODIFIERS_CONSUMED_EVENT, {
    detail: { role },
  }));
}

export function requestMobileEditorSpecialKey(
  win: Window,
  role: MobileEditorRole,
  key: SyntheticEditorKey,
  modifiers: SyntheticKeyModifiers,
): boolean {
  const detail: MobileEditorSpecialKeyRequestDetail = {
    role,
    key,
    modifiers,
    handled: false,
  };
  win.dispatchEvent(new CustomEvent<MobileEditorSpecialKeyRequestDetail>(
    MOBILE_EDITOR_SPECIAL_KEY_REQUEST_EVENT,
    { detail },
  ));
  return detail.handled;
}

export function markMobileEditorSpecialKeyHandled(event: Event): void {
  const detail = (
    event as CustomEvent<MobileEditorSpecialKeyRequestDetail>
  ).detail;
  if (detail) detail.handled = true;
}

export function requestMobileEditorPanelToggle(
  win: Window,
  role: MobileEditorRole,
): boolean {
  const detail: MobileEditorPanelToggleDetail = { role, handled: false };
  win.dispatchEvent(new CustomEvent<MobileEditorPanelToggleDetail>(
    MOBILE_EDITOR_PANEL_TOGGLE_EVENT,
    { detail },
  ));
  return detail.handled;
}

export function markMobileEditorPanelToggleHandled(event: Event): void {
  const detail = (event as CustomEvent<MobileEditorPanelToggleDetail>).detail;
  if (detail) detail.handled = true;
}

export function currentMobileEditorPanelState(win: Window): boolean {
  return panelStateByWindow.get(win) ?? true;
}

export function publishMobileEditorPanelState(win: Window, open: boolean): void {
  panelStateByWindow.set(win, open);
  win.dispatchEvent(new CustomEvent(MOBILE_EDITOR_PANEL_STATE_EVENT, {
    detail: { open },
  }));
}
