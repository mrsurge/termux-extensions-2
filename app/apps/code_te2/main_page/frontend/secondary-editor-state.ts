export interface SecondaryEditorHostState {
  activeProject?: string | null;
  currentPath?: string | null;
  clientForeground?: { path?: string | null } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve the exact-client foreground without reviving the legacy shared path.
 * Once the backend supplies a clientForeground record, an explicit null path
 * is authoritative empty state for that client.
 */
export function secondaryEditorActivePath(state: SecondaryEditorHostState): string {
  if (
    isRecord(state.clientForeground)
    && Object.prototype.hasOwnProperty.call(state.clientForeground, 'path')
  ) {
    return stringValue(state.clientForeground.path);
  }
  return stringValue(state.currentPath);
}

export type SecondaryEditorMode = 'closed' | 'docked' | 'collapsed' | 'detached';

export interface MobileSecondaryModeTransition {
  hostMode: 'closed' | 'docked' | 'collapsed';
  rendererMode: 'docked';
}

/**
 * Mobile collapse/close are outer-drawer presentation actions. The retained
 * iframe itself stays fully rendered so reopening never leaves its compact
 * header/body in Electron's collapsed geometry.
 */
export function mobileSecondaryModeTransition(
  requested: SecondaryEditorMode,
): MobileSecondaryModeTransition {
  if (requested === 'closed') {
    return { hostMode: 'closed', rendererMode: 'docked' };
  }
  if (requested === 'collapsed') {
    return { hostMode: 'collapsed', rendererMode: 'docked' };
  }
  return { hostMode: 'docked', rendererMode: 'docked' };
}

export function mobileSecondaryTabVisible(options: {
  supported: boolean;
  mobileLayout: boolean;
  populated: boolean;
  dismissed: boolean;
}): boolean {
  return options.supported
    && options.mobileLayout
    && options.populated
    && !options.dismissed;
}

export function mobileSecondaryShortcutVisible(options: {
  supported: boolean;
  mobileLayout: boolean;
  populated: boolean;
}): boolean {
  return options.supported && options.mobileLayout && options.populated;
}
