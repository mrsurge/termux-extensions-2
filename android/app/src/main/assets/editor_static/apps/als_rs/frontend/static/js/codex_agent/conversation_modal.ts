export type ConversationModalTab = 'settings' | 'project';

interface ConversationModalContext {
  getProjectDisabled(): boolean;
  onTabRequest(tab: ConversationModalTab): void;
  onCloseRequest(tab: ConversationModalTab): void;
  documentRef?: Document;
}

export interface ConversationModalBinding {
  show(tab: ConversationModalTab): boolean;
  hide(): void;
  setActiveTab(tab: ConversationModalTab): boolean;
  getActiveTab(): ConversationModalTab;
  isOpen(): boolean;
  isTabActive(tab: ConversationModalTab): boolean;
  syncProjectAvailability(): void;
}

const TAB_ORDER: ConversationModalTab[] = ['settings', 'project'];

export function bindConversationModal(ctx: ConversationModalContext): ConversationModalBinding {
  const doc = ctx.documentRef || document;
  const root = doc.getElementById('conversation-modal');
  const settingsTab = doc.getElementById('conversation-modal-settings-tab') as HTMLButtonElement | null;
  const projectTab = doc.getElementById('conversation-modal-project-tab') as HTMLButtonElement | null;
  const settingsPanel = doc.getElementById('conversation-modal-settings-panel');
  const projectPanel = doc.getElementById('conversation-modal-project-panel');
  const projectHeaderActions = doc.getElementById('conversation-modal-project-header-actions');
  const settingsFooter = doc.getElementById('conversation-modal-settings-footer');
  const projectFooter = doc.getElementById('conversation-modal-project-footer');
  const closeButton = doc.getElementById('conversation-modal-close');
  let activeTab: ConversationModalTab = 'settings';

  function tabElement(tab: ConversationModalTab): HTMLButtonElement | null {
    return tab === 'settings' ? settingsTab : projectTab;
  }

  function projectDisabled(): boolean {
    return Boolean(ctx.getProjectDisabled());
  }

  function syncProjectAvailability(): void {
    const disabled = projectDisabled();
    if (projectTab) {
      projectTab.disabled = disabled;
      projectTab.setAttribute('aria-disabled', String(disabled));
      projectTab.title = disabled ? 'Finish or cancel new conversation setup first' : '';
    }
    if (disabled && activeTab === 'project') {
      setActiveTab('settings');
    }
  }

  function setActiveTab(tab: ConversationModalTab): boolean {
    if (tab === 'project' && projectDisabled()) return false;
    activeTab = tab;
    const settingsActive = tab === 'settings';
    settingsTab?.classList.toggle('active', settingsActive);
    projectTab?.classList.toggle('active', !settingsActive);
    settingsTab?.setAttribute('aria-selected', String(settingsActive));
    projectTab?.setAttribute('aria-selected', String(!settingsActive));
    settingsTab?.setAttribute('tabindex', settingsActive ? '0' : '-1');
    projectTab?.setAttribute('tabindex', settingsActive ? '-1' : '0');
    settingsPanel?.classList.toggle('hidden', !settingsActive);
    projectPanel?.classList.toggle('hidden', settingsActive);
    settingsPanel?.setAttribute('aria-hidden', String(!settingsActive));
    projectPanel?.setAttribute('aria-hidden', String(settingsActive));
    projectHeaderActions?.classList.toggle('hidden', settingsActive);
    settingsFooter?.classList.toggle('hidden', !settingsActive);
    projectFooter?.classList.toggle('hidden', settingsActive);
    return true;
  }

  function show(tab: ConversationModalTab): boolean {
    const wasHidden = !root || root.classList.contains('hidden');
    syncProjectAvailability();
    setActiveTab(tab);
    root?.classList.remove('hidden');
    return wasHidden;
  }

  function hide(): void {
    root?.classList.add('hidden');
  }

  function isOpen(): boolean {
    return Boolean(root && !root.classList.contains('hidden'));
  }

  function isTabActive(tab: ConversationModalTab): boolean {
    return isOpen() && activeTab === tab;
  }

  function requestTab(tab: ConversationModalTab): void {
    syncProjectAvailability();
    if (tab === 'project' && projectDisabled()) return;
    ctx.onTabRequest(tab);
  }

  function hasOpenChildOverlay(): boolean {
    return Boolean(doc.querySelector(
      '#cwd-picker:not(.hidden), #rollout-picker:not(.hidden), #session-picker:not(.hidden), #warning-modal:not(.hidden)',
    ));
  }

  settingsTab?.addEventListener('click', () => requestTab('settings'));
  projectTab?.addEventListener('click', () => requestTab('project'));
  closeButton?.addEventListener('click', () => ctx.onCloseRequest(activeTab));
  root?.addEventListener('click', (event) => {
    if (event.target === root) ctx.onCloseRequest(activeTab);
  });
  doc.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      if (hasOpenChildOverlay()) return;
      ctx.onCloseRequest(activeTab);
      return;
    }
    const target = event.target;
    if (target !== settingsTab && target !== projectTab) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabledTabs = TAB_ORDER.filter((tab) => tab !== 'project' || !projectDisabled());
    const currentIndex = Math.max(0, enabledTabs.indexOf(activeTab));
    const nextTab = event.key === 'Home'
      ? enabledTabs[0]
      : event.key === 'End'
        ? enabledTabs[enabledTabs.length - 1]
        : enabledTabs[(currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + enabledTabs.length) % enabledTabs.length];
    requestTab(nextTab);
    tabElement(nextTab)?.focus();
  });

  syncProjectAvailability();
  setActiveTab('settings');

  return {
    show,
    hide,
    setActiveTab,
    getActiveTab: () => activeTab,
    isOpen,
    isTabActive,
    syncProjectAvailability,
  };
}
