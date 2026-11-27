import type { SecondaryPanelBridge, SecondaryPanelSnapshot } from './secondary-panel-contracts';

export function installSecondaryPanelTabs(root: HTMLElement, bridge: SecondaryPanelBridge, report: (message: string) => void) {
  const header = root.querySelector<HTMLElement>('.te2-secondary-editor-header')!;
  const body = root.querySelector<HTMLElement>('.te2-secondary-editor-body')!;
  const strip = header.querySelector<HTMLElement>('.te2-secondary-file-tabs .fe-file-tabs-track')!;
  const panelTabs = new Map<string, HTMLDivElement>();
  let state: SecondaryPanelSnapshot = { panels: [], active: '' };
  let stopped = false;
  let frame = 0;
  let revision = 0;
  let lastPlacement = '';
  const fail = (error: unknown) => { if (!stopped) report(String(error)); };
  const files = () => { if (state.active) void bridge.secondaryPanelAction('files').catch(fail); };
  function schedule() {
    if (stopped || frame || !state.active) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const panel = state.panels.find(p => p.surfaceId === state.active);
      if (!panel) return;
      const r = body.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const visible = document.visibilityState !== 'hidden' && hit && body.contains(hit) &&
        !document.querySelector('.fe-modal[aria-hidden="false"], #fe-agent-dd.show');
      const bounds = { x: r.x, y: r.y, width: visible ? r.width : 0, height: visible ? r.height : 0 };
      const key = JSON.stringify([panel.presentationId, bounds]);
      if (key === lastPlacement) return;
      lastPlacement = key;
      void bridge.placeSecondaryPanel(panel.surfaceId, panel.presentationId, bounds).catch(fail);
    });
  }
  function syncTabs() {
    for (const [id, tab] of panelTabs) {
      if (!state.panels.some(p => p.presentationId === id)) { tab.remove(); panelTabs.delete(id); }
    }
    for (const tab of strip.querySelectorAll<HTMLElement>('.fe-file-tab[data-path]')) {
      if (tab.classList.contains('active')) tab.dataset.fileCurrent = '';
      const current = tab.hasAttribute('data-file-current');
      tab.classList.toggle('active',current && !state.active);
      tab.setAttribute('aria-selected',String(current && !state.active));
    }
    for (const p of state.panels) {
      let el = panelTabs.get(p.presentationId);
      if (!el) {
        el = document.createElement('div');
        el.className = 'fe-file-tab te2-panel-tab'; el.setAttribute('role','tab');
        el.tabIndex = 0;
        const label = document.createElement('span');
        label.className = 'fe-file-tab-label';
        el.append(label);
        const menu = () => void bridge.secondaryPanelAction('menu',p.surfaceId,p.presentationId).catch(fail);
        el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); menu(); });
        el.addEventListener('keydown', e => {
          if(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menu(); }
          else if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el?.click(); }
        });
        el.addEventListener('click', () => void bridge.secondaryPanelAction('select',p.surfaceId,p.presentationId).catch(fail));
        panelTabs.set(p.presentationId, el);
      }
      if (el.firstElementChild && el.firstElementChild.textContent !== p.label) el.firstElementChild.textContent = p.label;
      el.title = p.label;
      el.classList.toggle('active',state.active === p.surfaceId);
      el.setAttribute('aria-selected', String(state.active === p.surfaceId));
      if (el.parentElement !== strip) strip.append(el);
    }
  }
  function render(next: SecondaryPanelSnapshot) {
    if (stopped) return;
    revision++;
    state = next;
    syncTabs();
    lastPlacement = '';
    schedule();
  }
  const unsubscribe = bridge.onSecondaryPanels(render);
  const initial = revision;
  void bridge.secondaryPanelSnapshot().then(s => { if (revision === initial) render(s); }).catch(fail);
  const resize = new ResizeObserver(schedule);
  resize.observe(body);
  // Observe layout chrome only. Token painting and terminal output can produce
  // thousands of unrelated descendant mutations in the same document.
  const observer = new MutationObserver(schedule);
  for (const el of [root, root.parentElement, ...document.querySelectorAll(
    '.fe-root, #terminal-drawer, #agent-drawer, #second-editor-container, .fe-modal, #fe-agent-dd')]) {
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
  }
  document.addEventListener('transitionend', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('code-te2:pane-bounds-changed', schedule);
  return { files, syncTabs, populated: () => !!state.panels.length, dispose() {
    stopped = true; unsubscribe(); resize.disconnect(); observer.disconnect();
    cancelAnimationFrame(frame); for (const tab of panelTabs.values()) tab.remove();
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('transitionend', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('code-te2:pane-bounds-changed', schedule);
  } };
}
