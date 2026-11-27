import { isUnknownArray } from '../../src/rpc/value-types.ts';
// Host resize manager - handle main-page panel resizing with drag handles.

import { resizedDrawerHeight } from './ui/drawer-sizing.ts';
import { observePortraitDrawer, dragPortraitDrawer, finishPortraitDrag } from './ui/portrait-drawer-split.ts';

type ResizePanel = 'explorer' | 'agent' | 'secondary' | 'terminal' | null;

interface LayoutPreferences {
  explorerWidth?: string;
  agentWidth?: string;
  terminalHeight?: string;
}

const EXPLORER_DEFAULT_WIDTH = 430;
const AGENT_DEFAULT_WIDTH = 400;
const PRIMARY_MIN_WIDTH = 200;
const SECONDARY_MIN_WIDTH = PRIMARY_MIN_WIDTH;
const SIDEBAR_MIN_WIDTH = 416;
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

let disposeResizeManager: (() => void) | null = null;

interface ResizeDrag {
  gap: number;
  span: number;
  explorer: number;
  sidebar: number;
  explorerMin: number;
  ratio: number | null;
  close: 'explorer' | 'agent' | 'terminal' | null;
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
  const disposePortrait = observePortraitDrawer();
  const root = document.querySelector<HTMLElement>('.fe-root');
  const toolbar = root?.querySelector<HTMLElement>('.fe-toolbar');
  const ratioKey = 'code_te2_desktop_secondary_ratio';
  let ratio: number | null = null;
  let ratioDirty = false;
  try {
    const stored = localStorage.getItem(ratioKey);
    if (stored?.trim() && +stored > 0 && +stored < 1) ratio = +stored;
  } catch { /* Session-only layout. */ }
  function splitSpan(): number {
    if (!root || !toolbar || !root.matches('.layout-desktop.te2-secondary-editor-docked:not(.te2-secondary-editor-collapsed)')) return 0;
    // The toolbar spans both editor tracks and their gutter, not the sidebars.
    return Math.max(0, toolbar.getBoundingClientRect().width -
      (parsePixelValue(getComputedStyle(root).getPropertyValue('--split-rail-size')) ?? 0));
  }
  function projectSplit(span = splitSpan()): void {
    if (!root || !span) return;
    const scale = Math.min(1, span / (PRIMARY_MIN_WIDTH + SECONDARY_MIN_WIDTH));
    ratio ??= clamp(secondaryDockWidth() ?? 480, SECONDARY_MIN_WIDTH * scale, span - PRIMARY_MIN_WIDTH * scale) / span;
    root.style.setProperty('--primary-floor', PRIMARY_MIN_WIDTH * scale + 'px');
    root.style.setProperty('--secondary-floor', SECONDARY_MIN_WIDTH * scale + 'px');
    root.style.setProperty('--primary-share', (1 - ratio) * 100 + 'fr');
    root.style.setProperty('--secondary-share', ratio * 100 + 'fr');
    root.dataset.desktopSplit = '';
  }
  const sizeObserver = toolbar ? new ResizeObserver(() => projectSplit()) : null;
  const modeObserver = toolbar ? new MutationObserver(() => projectSplit()) : null;
  if (toolbar && root) {
    sizeObserver?.observe(toolbar);
    modeObserver?.observe(root, {attributes:true, attributeFilter:['class']});
    projectSplit();
  }
  const handles = Array.from(document.querySelectorAll<HTMLElement>('.resize-handle'));
  let drag: ResizeDrag | null = null;
  let frame = 0;
  let pending: PointerEvent | null = null;
  let lastMove: PointerEvent | null = null;
  let disposed = false;

  const hint = document.createElement('div');
  hint.className = 'fe-resize-close-hint';
  hint.setAttribute('role','status');
  hint.hidden = true;
  root?.append(hint);
  function preview(current: ResizeDrag, close: ResizeDrag['close']): void {
    if (current.close === close) return;
    current.close = close;
    if (root) {
      if (close) root.dataset.resizeClose = close;
      else delete root.dataset.resizeClose;
    }
    hint.hidden = !close;
    if (close) hint.textContent = 'Release to close ' + ({explorer:'Explorer',agent:'sidebar',terminal:'bottom panel'})[close];
  }
  const finish = (commit = false): void => {
    const current = drag;
    if (!current) return;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    lastMove = null;
    drag = null;
    current.handle.classList.remove('dragging');
    try {
      if (current.handle.hasPointerCapture?.(current.pointerId)) {
        current.handle.releasePointerCapture(current.pointerId);
      }
    } catch { /* Capture may already be lost when the window is deactivated. */ }
    current.restoreInteraction();
    const close = current.close;
    preview(current, null);
    const setWidth = (key: string, width: number) => document.documentElement.style.setProperty(key, width + 'px');
    if (current.panel === 'agent' || current.panel === 'explorer') {
      if ((!commit || close === 'explorer') && current.explorer) setWidth('--explorer-width',current.explorer);
      if ((!commit || close === 'agent') && current.sidebar) setWidth('--agent-width',current.sidebar);
    }
    if (current.panel === 'terminal' && (!commit || close)) {
      if (!dragPortraitDrawer(current.startSize)) setWidth('--terminal-height',current.startSize);
    }
    if (!commit && current.panel === 'secondary') {
      ratio = current.ratio; ratioDirty = false;
      root?.style.setProperty('--secondary-editor-dock-size',current.startSize+'px'); projectSplit();
    }
    if (commit && close) document.getElementById(({explorer:'fe-drawer-close',agent:'agent-close',terminal:'terminal-collapse'})[close])?.click();
    if (current.panel === 'terminal') finishPortraitDrag();
    if (current.panel === 'secondary') {
      if (ratioDirty && ratio !== null) {
        ratioDirty = false;
        try { localStorage.setItem(ratioKey, String(ratio)); } catch { /* optional */ }
      }
      window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize-end', {
        detail: { dockSize: currentPanelWidth('secondary') },
      }));
    }
    try { if (commit) saveLayoutPreferences(); } catch {
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
    const footer = root?.querySelector<HTMLElement>('.fe-git-footer');
    const buttons = Array.from(footer?.querySelectorAll<HTMLElement>('.fe-git-actions:not(.fe-git-actions-secondary) button') ?? []);
    const pad = footer ? getComputedStyle(footer) : null;
    const explorerMin = Math.ceil(buttons.reduce((s,b)=>s+b.getBoundingClientRect().width,0) +
      (parseFloat(pad?.paddingLeft || '') || 0) + (parseFloat(pad?.paddingRight || '') || 0));
    drag = { handle, pointerId: event.pointerId, panel, close:null, ratio,
      span: panel === 'secondary' ? splitSpan() : 0,
      gap: root ? parsePixelValue(getComputedStyle(root).getPropertyValue('--split-rail-size')) ?? 5 : 5,
      explorer:effectiveExplorerWidthForMath(), sidebar:effectiveAgentWidthForMath(), explorerMin:explorerMin || 160,
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

  const applyMove = (event: PointerEvent): void => {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    const { panel, startPos, startSize } = current;
    if (panel === 'explorer' || panel === 'agent') {
      const delta = panel === 'explorer' ? event.clientX - startPos : startPos - event.clientX;
      let width: number;
      if (root?.classList.contains('layout-desktop')) {
        const gap = current.gap;
        const docked = root.classList.contains('te2-secondary-editor-docked');
        const budget = Math.max(0,(root.clientWidth || rootLayoutWidth()) - PRIMARY_MIN_WIDTH -
          (docked ? gap + (root.classList.contains('te2-secondary-editor-collapsed') ? 52 : SECONDARY_MIN_WIDTH) : 0));
        const requested = startSize + delta;
        const min = panel === 'agent' ? SIDEBAR_MIN_WIDTH : current.explorerMin;
        let close: ResizeDrag['close'] = requested < min ? panel : null;
        let other = panel === 'agent' ? current.explorer : current.sidebar;
        if (!close && panel === 'agent' && other) {
          other = Math.min(other, budget - 2 * gap - requested);
          if (other < current.explorerMin) { close = 'explorer'; other = 0; }
          if (other) document.documentElement.style.setProperty('--explorer-width', other+'px');
        } else if (panel === 'agent' && current.explorer) {
          document.documentElement.style.setProperty('--explorer-width',current.explorer+'px');
        }
        preview(current,close);
        width = clamp(requested,0,Math.max(0,budget-gap-(other ? other+gap : 0)));
      } else width = clamp(startSize + delta, PANEL_MIN_WIDTH, maxPanelWidth(panel));
      document.documentElement.style.setProperty(panel === 'explorer' ? '--explorer-width' : '--agent-width', `${width}px`);
    } else if (panel === 'secondary') {
      const span = current.span;
      const scale = Math.min(1, span / (PRIMARY_MIN_WIDTH + SECONDARY_MIN_WIDTH));
      const requested = startSize + startPos - event.clientX;
      const width = span ? clamp(requested, SECONDARY_MIN_WIDTH * scale, span - PRIMARY_MIN_WIDTH * scale)
        : clamp(requested, SECONDARY_MIN_WIDTH, maxPanelWidth('secondary'));
      if (span && scale === 1) {
        ratio = width / span;
        ratioDirty = true;
        projectSplit(span);
      }
      document.querySelector<HTMLElement>('.fe-root')?.style.setProperty('--secondary-editor-dock-size', `${width}px`);
      window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize', {
        detail: { dockSize: width },
      }));
    } else {
      if (document.getElementById('terminal-drawer')?.classList.contains('terminal-drawer--collapsed')) {
        finish();
        return;
      }
      const requested = startSize + startPos - event.clientY;
      preview(current,requested < 30 ? 'terminal' : null);
      if (!current.close && !dragPortraitDrawer(requested)) {
        const height = resizedDrawerHeight(requested, 30, 800);
        document.documentElement.style.setProperty('--terminal-height', `${height}px`);
      }
    }
  };
  const notifyPlacement = () => window.dispatchEvent(new Event('code-te2:pane-bounds-changed'));
  const flush = (): void => {
    frame = 0;
    const move = pending;
    pending = null;
    if (move) { applyMove(move); notifyPlacement(); }
  };
  const onMove = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    lastMove = event;
    pending = event;
    if (!frame) frame = window.requestAnimationFrame(flush);
  };

  const onEnd = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup' && lastMove) {
      if (lastMove.clientX !== event.clientX || lastMove.clientY !== event.clientY) pending = event;
      if (pending) { window.cancelAnimationFrame(frame); flush(); }
    }
    finish(event.type === 'pointerup');
  };
  const onVisibility = (): void => { if (document.hidden) finish(); };
  handles.forEach(handle => handle.addEventListener('pointerdown', onStart));
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('lostpointercapture', onEnd, true);
  document.addEventListener('visibilitychange', onVisibility);
  const cancel = (): void => finish();
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', dispose, { once: true });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    finish();
    hint.remove();
    disposePortrait();
    sizeObserver?.disconnect();
    modeObserver?.disconnect();
    handles.forEach(handle => handle.removeEventListener('pointerdown', onStart));
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('lostpointercapture', onEnd, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', cancel);
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
    if (prefs.terminalHeight) {
      document.documentElement.style.setProperty('--terminal-height', prefs.terminalHeight);
    }
  } catch (e) {
    console.warn('Failed to load layout preferences:', e);
  }
}
