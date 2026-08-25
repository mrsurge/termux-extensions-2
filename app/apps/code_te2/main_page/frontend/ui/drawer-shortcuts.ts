
/**
 * @param {{
 *   bindMenuToggle: (el: Element, handler: Function) => void,
 *   requireEl: (selector: string) => HTMLElement,
 *   consoleDrawer: { show: Function, hide: Function },
 *   mobileSecondEditor?: { show: Function, hide: Function },
 *   extensionActivityPanel: { show: Function, hide: Function },
 *   codeInspectorPanel: { show: Function, hide: Function },
 *   toggleTerminal: () => void,
 *   openDrawer: () => void,
 *   activateTerminal: () => Promise<void>,
 *   setFontScale: (preset: 'small'|'medium'|'large') => void,
 *   triggerEditorSearchPanel: (reason?: string, opts?: any) => Promise<any>,
 *   hostToast: (msg: string) => void,
 *   jumpToCurrentFileLine: (line: number) => Promise<any>,
 *   saveFile: () => void,
 *   resetToNewFile: () => void,
 *   openPickedFile: () => void
 * }} deps
 */
export function initDrawerAndShortcuts(deps: any) {
  {
    const tabBar = document.querySelector<HTMLElement>('.drawer-tab-bar');
    const terminalHeader = document.querySelector<HTMLElement>('.terminal-header');
    const terminalContainer = document.getElementById('terminal-container');
    const consoleContainer = document.getElementById('console-container');
    const secondEditorContainer = document.getElementById('second-editor-container');
    const extensionLogContainer = document.getElementById('extension-log-container');
    const extensionLogHeader = document.getElementById('extension-log-header');
    const codeInspectorContainer = document.getElementById('code-inspector-container');
    const codeInspectorHeader = document.getElementById('code-inspector-header');

    if (tabBar) {
      tabBar.addEventListener('click', (e) => {
        const tab = (e.target instanceof Element)
          ? e.target.closest<HTMLElement>('.drawer-tab')
          : null;
        if (!tab) return;
        const target = tab.dataset.tab;
        tabBar.querySelectorAll<HTMLElement>('.drawer-tab').forEach(t => t.classList.toggle('active', t === tab));
        if (terminalHeader) terminalHeader.style.display = 'none';
        if (terminalContainer) terminalContainer.style.display = 'none';
        if (consoleContainer) consoleContainer.style.display = 'none';
        if (secondEditorContainer) secondEditorContainer.hidden = true;
        if (extensionLogContainer) extensionLogContainer.style.display = 'none';
        if (extensionLogHeader) extensionLogHeader.style.display = 'none';
        if (codeInspectorContainer) codeInspectorContainer.style.display = 'none';
        if (codeInspectorHeader) codeInspectorHeader.style.display = 'none';
        deps.consoleDrawer.hide();
        deps.mobileSecondEditor?.hide();
        deps.extensionActivityPanel.hide();
        deps.codeInspectorPanel.hide();

        if (target === 'terminal') {
          if (terminalHeader) terminalHeader.style.display = '';
          if (terminalContainer) terminalContainer.style.display = '';
          void deps.activateTerminal();
        } else if (target === 'console') {
          deps.consoleDrawer.show();
        } else if (target === 'second-window') {
          deps.mobileSecondEditor?.show();
        } else if (target === 'extensions') {
          deps.extensionActivityPanel.show();
        } else if (target === 'code-inspector') {
          deps.codeInspectorPanel.show();
        }
      });
    }
  }

  const miToggleTerminal = deps.requireEl('#mi-toggle-terminal');
  deps.bindMenuToggle(miToggleTerminal, () => deps.toggleTerminal());

  const miToggleConsole = document.getElementById('mi-toggle-console');
  if (miToggleConsole) {
    deps.bindMenuToggle(miToggleConsole, () => {
      const drawer = document.getElementById('terminal-drawer');
      const isOpen = drawer && drawer.classList.contains('open');
      const consoleTab = document.querySelector<HTMLElement>('.drawer-tab[data-tab="console"]');
      if (consoleTab) consoleTab.click();
      if (!isOpen) deps.openDrawer();
    });
  }

  const miFontSmall = document.getElementById('mi-font-small');
  const miFontMedium = document.getElementById('mi-font-medium');
  const miFontLarge = document.getElementById('mi-font-large');
  if (miFontSmall) miFontSmall.addEventListener('click', () => deps.setFontScale('small'));
  if (miFontMedium) miFontMedium.addEventListener('click', () => deps.setFontScale('medium'));
  if (miFontLarge) miFontLarge.addEventListener('click', () => deps.setFontScale('large'));

  document.addEventListener('keydown', (e) => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    if (cmdOrCtrl && e.key === '`') { e.preventDefault(); deps.toggleTerminal(); }
    if (cmdOrCtrl && e.key === 's') { e.preventDefault(); deps.saveFile(); }
    if (cmdOrCtrl && e.key === 'f') { e.preventDefault(); deps.triggerEditorSearchPanel('shortcut', { replace: false }); }
    if (cmdOrCtrl && e.key === 'n') { e.preventDefault(); deps.resetToNewFile(); }
    if (cmdOrCtrl && e.key === 'o') { e.preventDefault(); deps.openPickedFile(); }

    if ((e.ctrlKey || e.metaKey) && e.key === '=' && !e.shiftKey) {
      e.preventDefault();
      const currentScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-font-scale') || '0.85');
      if (currentScale < 0.75) deps.setFontScale('medium');
      else if (currentScale < 1.0) deps.setFontScale('large');
    }

    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      const currentScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-font-scale') || '0.85');
      if (currentScale > 1.0) deps.setFontScale('medium');
      else if (currentScale > 0.75) deps.setFontScale('small');
    }
  });
}
