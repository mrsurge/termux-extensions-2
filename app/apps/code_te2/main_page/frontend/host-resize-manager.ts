// Host resize manager - handle main-page panel resizing with drag handles.

import { clampTerminalDrawerHeight } from './ui/drawer-sizing.ts';

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

function eventClientPoint(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  const touch = 'touches' in event ? event.touches[0] : null;
  const mouse = event as MouseEvent;
  return {
    clientX: touch ? touch.clientX : mouse.clientX,
    clientY: touch ? touch.clientY : mouse.clientY,
  };
}

function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  const parsed: unknown = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
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
  return cssPixelProperty('--terminal-height') || 340;
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

export function initResizeManager(): void {
  const handles = document.querySelectorAll<HTMLElement>('.resize-handle');
  
  handles.forEach(handle => {
    let isDragging = false;
    let startPos = 0;
    let startSize = 0;
    let panel: ResizePanel = null;
    let dragShield: HTMLDivElement | null = null;

    const ensureDragShield = (cursor: string): HTMLDivElement => {
      // Remove any stale shield (e.g., if a prior drag ended unexpectedly).
      try {
        const existing = document.getElementById('fe-resize-drag-shield');
        if (existing) existing.remove();
      } catch (_) {}

      const shield = document.createElement('div');
      shield.id = 'fe-resize-drag-shield';
      shield.style.position = 'fixed';
      shield.style.left = '0';
      shield.style.top = '0';
      shield.style.right = '0';
      shield.style.bottom = '0';
      shield.style.background = 'transparent';
      shield.style.cursor = cursor;
      shield.style.zIndex = '2147483647';
      shield.style.touchAction = 'none';
      shield.style.userSelect = 'none';
      // Ensure touchmove can be canceled to avoid scroll-jank.
      shield.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
      document.body.appendChild(shield);
      return shield;
    };

    const removeDragShield = (): void => {
      if (!dragShield) return;
      try {
        dragShield.remove();
      } catch (_) {}
      dragShield = null;
    };
    
    const onStart = (e: MouseEvent | TouchEvent): void => {
      const { clientX, clientY } = eventClientPoint(e);
      
      const panelType: ResizePanel =
        handle.dataset.panel === 'explorer' ||
        handle.dataset.panel === 'agent' ||
        handle.dataset.panel === 'secondary' ||
        handle.dataset.panel === 'terminal'
          ? handle.dataset.panel
          : null;
      const terminalDrawer = panelType === 'terminal' ? document.getElementById('terminal-drawer') : null;
      const terminalCollapsed = !!(terminalDrawer && terminalDrawer.classList.contains('terminal-drawer--collapsed'));
      isDragging = true;
      panel = panelType;

      // While dragging, a transparent full-screen shield prevents iframes from
      // hijacking the pointer stream (which causes "snap" resizing).
      dragShield = ensureDragShield(panelType === 'terminal' ? 'row-resize' : 'col-resize');
      dragShield.addEventListener('mouseup', onEnd);
      dragShield.addEventListener('touchend', onEnd);
      dragShield.addEventListener('touchcancel', onEnd);
      
      if (panelType === 'explorer' || panelType === 'agent' || panelType === 'secondary') {
        startPos = clientX;
        startSize = currentPanelWidth(panelType);
      } else if (panelType === 'terminal') {
        startPos = clientY;
        if (terminalCollapsed) {
          startSize = 2;
        } else {
          startSize = currentPanelWidth('terminal');
        }
      }
      
      handle.classList.add('dragging');
      if (panelType === 'secondary') {
        window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize-start', {
          detail: { dockSize: startSize },
        }));
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
      e.preventDefault();
    };
    
    const onMove = (e: MouseEvent | TouchEvent): void => {
      if (!isDragging) return;
      
      const { clientX, clientY } = eventClientPoint(e);
      
      if (panel === 'explorer') {
        const delta = clientX - startPos;
        const newWidth = clamp(startSize + delta, PANEL_MIN_WIDTH, maxPanelWidth('explorer'));
        document.documentElement.style.setProperty('--explorer-width', `${newWidth}px`);
      } else if (panel === 'agent') {
        const delta = startPos - clientX;
        const newWidth = clamp(startSize + delta, PANEL_MIN_WIDTH, maxPanelWidth('agent'));
        document.documentElement.style.setProperty('--agent-width', `${newWidth}px`);
      } else if (panel === 'secondary') {
        const delta = startPos - clientX;
        const newWidth = clamp(
          startSize + delta,
          SECONDARY_MIN_WIDTH,
          maxPanelWidth('secondary'),
        );
        document.querySelector<HTMLElement>('.fe-root')?.style.setProperty(
          '--secondary-editor-dock-size',
          `${newWidth}px`,
        );
        window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize', {
          detail: { dockSize: newWidth },
        }));
      } else if (panel === 'terminal') {
        const terminalDrawer = document.getElementById('terminal-drawer');
        if (terminalDrawer && terminalDrawer.classList.contains('terminal-drawer--collapsed')) {
          e.preventDefault();
          return;
        }
        const delta = startPos - clientY;
        const mobileLayout = document.querySelector('.fe-root')
          ?.classList.contains('layout-mobile') === true;
        const newHeight = clampTerminalDrawerHeight(
          startSize + delta,
          150,
          mobileLayout,
          800,
        );
        document.documentElement.style.setProperty('--terminal-height', `${newHeight}px`);
      }
      
      // Trigger resize for CodeMirror
      window.dispatchEvent(new Event('resize'));
      e.preventDefault();
    };
    
    const onEnd = (): void => {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      removeDragShield();

      if (panel === 'secondary') {
        window.dispatchEvent(new CustomEvent('code-te2:secondary-editor-resize-end', {
          detail: { dockSize: currentPanelWidth('secondary') },
        }));
      }
      
      saveLayoutPreferences();
    };
    
    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart);
  });
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
