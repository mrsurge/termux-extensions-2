export interface SecondaryEditorHostState {
  secondaryContent?: unknown;
  activeProject?: string | null;
  currentPath?: string | null;
  clientForeground?: { path?: string | null } | null;
}

export type SecondaryContentPresentation =
  | { kind: 'empty' }
  | { kind: 'workingFile'; label: string }
  | { kind: 'historicalDiff'; label: string; commitId: string };

/** Presentation messages do not contain text or confer working-file ownership. */
export function parseSecondaryContentPresentation(value: unknown): SecondaryContentPresentation | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'empty') return { kind: 'empty' };
  if (typeof value.label !== 'string' || !value.label || value.label.length > 4096) return null;
  if (value.kind === 'workingFile') return { kind: 'workingFile', label: value.label };
  if (value.kind === 'historicalDiff' && typeof value.commitId === 'string'
      && /^[0-9a-f]{40}$/.test(value.commitId)) {
    return { kind: 'historicalDiff', label: value.label, commitId: value.commitId };
  }
  return null;
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
