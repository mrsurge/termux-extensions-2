import { currentMobileEditorOwner, MOBILE_EDITOR_OWNER_EVENT, MOBILE_EDITOR_PANEL_STATE_EVENT } from '../../../src/mobile-input/editor-special-key-bridge.ts';

const storageKey = 'code_te2_portrait_drawer_ratio';
const minimumContent = 80;
type Geometry = { usable: number; base: number };
let adjust: ((height: number) => boolean) | undefined;
let commit: (() => void) | undefined;
export const dragPortraitDrawer = (height: number): boolean => adjust?.(height) ?? false;
export const finishPortraitDrag = (): void => commit?.();

export function projectDrawer({usable, base}: Geometry, ratio: number): number {
  const min = Math.min(minimumContent, usable / 2);
  return Math.round(base + Math.max(min, Math.min(usable - min, ratio * usable)));
}

export function observePortraitDrawer(): () => void {
  const root = document.querySelector<HTMLElement>('.fe-root');
  const drawer = root?.querySelector<HTMLElement>('#terminal-drawer');
  const primary = root?.querySelector<HTMLElement>('.fe-editor-container');
  const header = drawer?.querySelector<HTMLElement>('.drawer-tab-bar');
  if (!root || !drawer || !primary || !header) return () => {};
  let preferred: number | null = null, dirty = false, frame = 0;
  try {
    const value = localStorage.getItem(storageKey);
    if (value !== null && value.trim() && Number.isFinite(+value) && +value >= 0 && +value <= 1) preferred = +value;
  } catch { /* Session-only split. */ }
  const strips = new Set<HTMLElement>();
  const geometry = (): Geometry | null => {
    if (!root.matches('.layout-mobile:not(.desktop-user-agent)') ||
        !drawer.matches('.open:not(.fullscreen):not(.terminal-drawer--collapsed)')) return null;
    const p = primary.getBoundingClientRect();
    const secondPanel = drawer.querySelector<HTMLElement>('#second-editor-container:not([hidden])');
    const secondHeader = secondPanel?.querySelector('.te2-secondary-editor-header');
    const chrome = header.getBoundingClientRect().height + drawer.clientTop +
      (secondHeader?.getBoundingClientRect().height ?? 0);
    const secondary = currentMobileEditorOwner(window) === 'secondary' &&
      !!secondPanel;
    const overlay = (secondary ? drawer : primary).querySelector<HTMLElement>('.te2-mobile-editor-overlay:not([hidden])');
    for (const strip of strips) if (!strip.isConnected) { ro.unobserve(strip); strips.delete(strip); }
    if (overlay && !strips.has(overlay)) { strips.add(overlay); ro.observe(overlay); }
    const keys = overlay?.getBoundingClientRect().height ?? 0;
    // Bottom key panel is a separate grid row: it is already outside this span.
    const footer = root.querySelector('#extension-statusbar')?.getBoundingClientRect().height ?? 0;
    const keyPanel = root.querySelector(':scope > .te2-mobile-special-key-panel')?.getBoundingClientRect().height ?? 0;
    const usable = root.getBoundingClientRect().bottom - p.top - footer - keyPanel - chrome - keys;
    return usable > 0 ? { usable, base: chrome + (secondary ? keys : 0) } : null;
  };
  function apply(g: Geometry, ratio: number): void {
    drawer!.style.setProperty('--portrait-split-height', projectDrawer(g, ratio) + 'px');
  }
  function refresh(): void {
    frame = 0;
    const g = geometry();
    if (!g) return;
    preferred ??= Math.max(0, Math.min(1, (drawer!.getBoundingClientRect().height - g.base) / g.usable));
    apply(g, preferred);
  }
  const schedule = (): void => { if (!frame) frame = window.requestAnimationFrame(refresh); };
  adjust = height => {
    const g = geometry();
    if (!g) return false;
    const effective = projectDrawer(g, (height-g.base)/g.usable);
    preferred = Math.max(0, Math.min(1, (effective-g.base)/g.usable));
    dirty = true;
    apply(g, preferred);
    return true;
  };
  commit = () => {
    if (!dirty || preferred === null) return;
    dirty = false;
    try { localStorage.setItem(storageKey, String(preferred)); } catch { /* optional */ }
  };
  const ro = new ResizeObserver(schedule);
  for (const el of [root, primary, drawer, header]) ro.observe(el);
  const mo = new MutationObserver(schedule);
  for (const el of [root, drawer, drawer.querySelector('#second-editor-container')]) {
    if (el) mo.observe(el,{attributes:true,attributeFilter:['hidden','class']});
  }
  schedule();
  window.addEventListener(MOBILE_EDITOR_OWNER_EVENT,schedule);
  window.addEventListener(MOBILE_EDITOR_PANEL_STATE_EVENT,schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  return () => {
    window.cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect();
    window.removeEventListener(MOBILE_EDITOR_OWNER_EVENT,schedule);
    window.removeEventListener(MOBILE_EDITOR_PANEL_STATE_EVENT,schedule);
    window.visualViewport?.removeEventListener('resize',schedule);
    adjust = commit = undefined;
  };
}
