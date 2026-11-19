import { isUnknownArray } from '../../src/rpc/value-types.ts';
// Host resize manager - handle main-page panel resizing with drag handles.

import { resizedDrawerHeight } from './ui/drawer-sizing.ts';

type ResizePanel = 'explorer' | 'agent' | 'secondary' | 'terminal' | null;

interface LayoutPreferences {
  explorerWidth?: string;
  agentWidth?: string;
  terminalHeight?: string;
}

const EXPLORER_DEFAULT_WIDTH = 430;
const AGENT_DEFAULT_WIDTH = 400;
const SECONDARY_MIN_WIDTH = 320;
const PRIMARY_MIN_WIDTH = 240;
const PANEL_MIN_WIDTH = 0;
const LAYOUT_PREFERENCES_KEY = 'code_te2_layout_prefs';
const LEGACY_LAYOUT_PREFERENCES_KEY = 'code_cm6_layout_prefs';
const LAYOUT_PREFERENCES_MIGRATION_KEY = 'code_te2_layout_prefs_migrated_v1';

function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  const parsed: unknown = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' && !isUnknownArray(parsed)
    ? parsed as LayoutPreferences
    : {};
}

function parsePixelValue(value: string | null | undefined): number | null {
  const parsed = parseFloat((value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function rootLayoutWidth(): number {
  const root = document.querySelector<HTMLElement>('.fe-root');
  const measured = root?.getBoundingClientRect().width || 0;
  return measured > 0 ? measured : window.innerWidth;
}

function cssPixelProperty(prop: string): number | null {
  return parsePixelValue(getComputedStyle(document.documentElement).getPropertyValue(prop));
}

function measuredAgentWidth(): number | null {
  const drawer = document.getElementById('agent-drawer');
  const measured = drawer?.getBoundingClientRect().width || 0;
  return measured > 0 ? measured : null;
}

function measuredExplorerWidth(): number | null {
  const drawer = document.getElementById('fe-drawer');
  const measured = drawer?.getBoundingClientRect().width || 0;
  return measured > 0 ? measured : null;
}

function measuredSecondaryWidth(): number | null {
  const host = document.getElementById('secondary-editor-host');
  const measured = host?.getBoundingClientRect().width || 0;
  return measured > 0 ? measured : null;
}

function secondaryDockWidth(): number | null {
  const root = document.querySelector<HTMLElement>('.fe-root');
  return parsePixelValue(
    root ? getComputedStyle(root).getPropertyValue('--secondary-editor-dock-size') : null,
  );
}

function currentPanelWidth(panel: Exclude<ResizePanel, null>): number {
  if (panel === 'agent') {
    return measuredAgentWidth() || cssPixelProperty('--agent-width') || AGENT_DEFAULT_WIDTH;
  }
  if (panel === 'explorer') {
    return measuredExplorerWidth() ||
      cssPixelProperty('--explorer-width') ||
      EXPLORER_DEFAULT_WIDTH;
  }
  if (panel === 'secondary') {
    return measuredSecondaryWidth() || secondaryDockWidth() || SECONDARY_MIN_WIDTH;
  }
  return document.getElementById('terminal-drawer')?.getBoundingClientRect().height || cssPixelProperty('--terminal-height') || 340;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function effectiveExplorerWidthForMath(): number {
  const root = document.querySelector<HTMLElement>('.fe-root');
  if (root?.classList.contains('explorer-collapsed')) return 0;
  return measuredExplorerWidth() ||
    cssPixelProperty('--explorer-width') ||
    EXPLORER_DEFAULT_WIDTH;
}

function effectiveAgentWidthForMath(): number {
  const drawer = document.getElementById('agent-drawer');
  if (!drawer?.classList.contains('open')) return 0;
  return measuredAgentWidth() ||
    cssPixelProperty('--agent-width') ||
    AGENT_DEFAULT_WIDTH;
}

function effectiveSecondaryWidthForMath(): number {
  const root = document.querySelector<HTMLElement>('.fe-root');
  if (!root?.classList.contains('te2-secondary-editor-docked')) return 0;
  return measuredSecondaryWidth() || secondaryDockWidth() || SECONDARY_MIN_WIDTH;
}

function maxPanelWidth(panel: Exclude<ResizePanel, null>): number {
  const rootWidth = Math.floor(rootLayoutWidth());
  if (panel === 'explorer') {
    return Math.max(
      PANEL_MIN_WIDTH,
      rootWidth - effectiveAgentWidthForMath() - effectiveSecondaryWidthForMath(),
    );
  }
  if (panel === 'agent') {
    return Math.max(
      PANEL_MIN_WIDTH,
      rootWidth - effectiveExplorerWidthForMath() - effectiveSecondaryWidthForMath(),
    );
  }
  if (panel === 'secondary') {
    return Math.max(
      SECONDARY_MIN_WIDTH,
      rootWidth
        - effectiveExplorerWidthForMath()
        - effectiveAgentWidthForMath()
        - PRIMARY_MIN_WIDTH,
    );
  }
  return rootWidth;
}

function clampedPanelWidth(value: string | null | undefined): string | null {
  const parsed = parsePixelValue(value);
  if (parsed === null) return null;
  return `${clamp(parsed, PANEL_MIN_WIDTH, Math.floor(rootLayoutWidth()))}px`;
}

function fitPersistedSideWidthsToRoot(): void {
  const rootWidth = Math.floor(rootLayoutWidth());
  if (rootWidth <= 0) return;
  const explorerWidth =
    cssPixelProperty('--explorer-width') || EXPLORER_DEFAULT_WIDTH;
  const agentWidth = cssPixelProperty('--agent-width') || AGENT_DEFAULT_WIDTH;
  if (explorerWidth + agentWidth <= rootWidth) return;
  document.documentElement.style.setProperty(
    '--agent-width',
    `${Math.max(PANEL_MIN_WIDTH, rootWidth - explorerWidth)}px`,
  );
}

let disposeResizeManager: (() => void) | null = null;

interface ResizeDrag {
  handle: HTMLElement;
  pointerId: number;
  panel: Exclude<ResizePanel, null>;
  startPos: number;
  startSize: number;
  restoreInteraction(): void;
}

/** Preserve real iframe boundaries without covering the tiled editors. */
function suspendResizeInteraction(panel: Exclude<ResizePanel, null>): () => void {
  const saved: Array<{ element: HTMLElement; property: string; value: string; priority: string }> = [];
  const set = (element: HTMLElement, property: string, value: string): void => {
    saved.push({ element, property, value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property) });
    element.style.setProperty(property, value, 'important');
  };
  document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(frame => set(frame, 'pointer-events', 'none'));
  set(document.documentElement, 'user-select', 'none');
  set(document.documentElement, 'cursor', panel === 'terminal' ? 'row-resize' : 'col-resize');
  return () => {
    saved.forEach(({ element, property, value, priority }) => {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    });
  };
}

export function initResizeManager(): () => void {
  disposeResizeManager?.();
  const handles = Array.from(document.querySelectorAll<HTMLElement>('.resize-handle'));
  let drag: ResizeDrag | null = null;
  let disposed = false;

  const finish = (): void => {
    const current = drag;
    if (!current) return;
    drag = null;
    current.handle.classList.remove('dragging');
    try {
      if (current.handle.hasPointerCapture?.(current.pointerId)) {
        current.handle.releasePointerCapture(current.pointerId);
      }
    } catch { /* Capture may already be lost when the window is deactivated. */ }
    current.restoreInteraction();
    if (current.panel === 'secondary') {
      window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize-end', {
        detail: { dockSize: currentPanelWidth('secondary') },
      }));
    }
    try { saveLayoutPreferences(); } catch {
      // Optional layout storage must not leave input capture or iframe guards active.
    }
  };

  const onStart = (event: PointerEvent): void => {
    if (disposed || drag || event.button !== 0 || event.isPrimary === false) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    const panel = handle.dataset.panel;
    if (panel !== 'explorer' && panel !== 'agent' && panel !== 'secondary' && panel !== 'terminal') return;
    if (panel === 'terminal'
        && document.getElementById('terminal-drawer')?.classList.contains('terminal-drawer--collapsed')) return;
    const startSize = currentPanelWidth(panel);
    drag = { handle, pointerId: event.pointerId, panel,
      startPos: panel === 'terminal' ? event.clientY : event.clientX,
      startSize, restoreInteraction: suspendResizeInteraction(panel) };
    handle.classList.add('dragging');
    try { handle.setPointerCapture(event.pointerId); } catch {
      // Page-level capture and real-iframe guards retain the same pointer fallback.
    }
    if (panel === 'secondary') {
      window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize-start', {
        detail: { dockSize: startSize },
      }));
    }
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    const { panel, startPos, startSize } = current;
    if (panel === 'explorer' || panel === 'agent') {
      const delta = panel === 'explorer' ? event.clientX - startPos : startPos - event.clientX;
      const width = clamp(startSize + delta, PANEL_MIN_WIDTH, maxPanelWidth(panel));
      document.documentElement.style.setProperty(panel === 'explorer' ? '--explorer-width' : '--agent-width', `${width}px`);
    } else if (panel === 'secondary') {
      const width = clamp(startSize + startPos - event.clientX, SECONDARY_MIN_WIDTH, maxPanelWidth('secondary'));
      document.querySelector<HTMLElement>('.fe-root')?.style.setProperty('--secondary-editor-dock-size', `${width}px`);
      window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize', {
        detail: { dockSize: width },
      }));
    } else {
      if (document.getElementById('terminal-drawer')?.classList.contains('terminal-drawer--collapsed')) {
        finish();
        return;
      }
      const height = resizedDrawerHeight(startSize + startPos - event.clientY, 150, 800);
      document.documentElement.style.setProperty('--terminal-height', `${height}px`);
    }
    // Existing Monaco/terminal/native placement observers consume the resize event.
    window.dispatchEvent(new Event('resize'));
    event.preventDefault();
  };

  const onEnd = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) finish();
  };
  const onVisibility = (): void => { if (document.hidden) finish(); };
  handles.forEach(handle => handle.addEventListener('pointerdown', onStart));
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('lostpointercapture', onEnd, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', finish);
  window.addEventListener('pagehide', dispose, { once: true });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    finish();
    handles.forEach(handle => handle.removeEventListener('pointerdown', onStart));
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('lostpointercapture', onEnd, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', finish);
    window.removeEventListener('pagehide', dispose);
    if (disposeResizeManager === dispose) disposeResizeManager = null;
  }
  disposeResizeManager = dispose;
  return dispose;
}

function saveLayoutPreferences(): void {
  const prefs: LayoutPreferences = {
    explorerWidth: getComputedStyle(document.documentElement).getPropertyValue('--explorer-width').trim(),
    agentWidth: getComputedStyle(document.documentElement).getPropertyValue('--agent-width').trim(),
    terminalHeight: getComputedStyle(document.documentElement).getPropertyValue('--terminal-height').trim()
  };
  
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify(prefs));
}

export function loadLayoutPreferences(): void {
  try {
    let rawPreferences = localStorage.getItem(LAYOUT_PREFERENCES_KEY);
    if (
      rawPreferences === null &&
      localStorage.getItem(LAYOUT_PREFERENCES_MIGRATION_KEY) !== '1'
    ) {
      rawPreferences = localStorage.getItem(LEGACY_LAYOUT_PREFERENCES_KEY);
      if (rawPreferences !== null) {
        localStorage.setItem(LAYOUT_PREFERENCES_KEY, rawPreferences);
        localStorage.removeItem(LEGACY_LAYOUT_PREFERENCES_KEY);
      }
      localStorage.setItem(LAYOUT_PREFERENCES_MIGRATION_KEY, '1');
    }
    const prefs = parseLayoutPreferences(rawPreferences);
    
    const explorerWidth = clampedPanelWidth(prefs.explorerWidth);
    if (explorerWidth) {
      document.documentElement.style.setProperty('--explorer-width', explorerWidth);
    }
    const agentWidth = clampedPanelWidth(prefs.agentWidth);
    if (agentWidth) {
      document.documentElement.style.setProperty('--agent-width', agentWidth);
    }
    fitPersistedSideWidthsToRoot();
    if (prefs.terminalHeight) {
      document.documentElement.style.setProperty('--terminal-height', prefs.terminalHeight);
    }
  } catch (e) {
    console.warn('Failed to load layout preferences:', e);
  }
}
