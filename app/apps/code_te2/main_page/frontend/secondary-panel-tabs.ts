import type { SecondaryPanelBridge, SecondaryPanelSnapshot } from './secondary-panel-contracts';

export function installSecondaryPanelTabs(root: HTMLElement, bridge: SecondaryPanelBridge, report: (message: string) => void) {
  const header = root.querySelector<HTMLElement>('.te2-secondary-editor-header')!;
  const body = root.querySelector<HTMLElement>('.te2-secondary-editor-body')!;
  const strip = document.createElement('div');
  strip.className = 'te2-secondary-panel-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Extension panels');
  header.querySelector('.te2-secondary-file-tabs')?.after(strip);
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
  function button(label: string, action: () => void) {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label; el.title = label;
    el.addEventListener('click', action);
    strip.append(el);
    return el;
  }
  function render(next: SecondaryPanelSnapshot) {
    if (stopped) return;
    revision++;
    state = next;
    strip.replaceChildren();
    strip.hidden = !state.panels.length;
    if (state.active) button('Editor', files);
    for (const p of state.panels) {
      const el = button(p.label, () => void bridge.secondaryPanelAction('select', p.surfaceId, p.presentationId).catch(fail));
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(state.active === p.surfaceId));
      if (state.active === p.surfaceId) button('Return to sidebar', () =>
        void bridge.secondaryPanelAction('return', p.surfaceId, p.presentationId).catch(fail));
    }
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
  const fileTabs = header.querySelector('.te2-secondary-file-tabs');
  fileTabs?.addEventListener('click', files, true);
  return { files, populated: () => !!state.panels.length, dispose() {
    stopped = true; unsubscribe(); resize.disconnect(); observer.disconnect();
    cancelAnimationFrame(frame); strip.remove();
    fileTabs?.removeEventListener('click', files, true);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('transitionend', schedule);
    window.removeEventListener('resize', schedule);
  } };
}
