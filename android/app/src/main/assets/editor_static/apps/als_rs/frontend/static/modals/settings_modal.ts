type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

type TextValueElement = HTMLElement & { value: string };
type PickerOptions = { input: TextValueElement | null };

declare global {
  interface Window {
    CodexAgentModules?: Array<(ctx: CodexAgentModuleApi | undefined) => void>;
  }
}

function callHelper(ctx: CodexAgentModuleApi | undefined, helperName: string, ...args: unknown[]): unknown {
  const helper = ctx?.helpers?.[helperName];
  if (typeof helper === 'function') {
    return helper(...args);
  }
  return undefined;
}

window.CodexAgentModules = window.CodexAgentModules || [];
window.CodexAgentModules.push((ctx: CodexAgentModuleApi | undefined) => {
  const settingsCancelBtn = document.getElementById('settings-cancel');
  const settingsSaveBtn = document.getElementById('settings-save');
  const settingsCwdEl = document.getElementById('settings-cwd') as TextValueElement | null;
  const settingsCwdBrowseBtn = document.getElementById('settings-cwd-browse');
  const settingsRolloutBrowseBtn = document.getElementById('settings-rollout-browse');

  settingsCancelBtn?.addEventListener('click', () => {
    callHelper(ctx, 'cancelSettingsModal');
  });
  settingsSaveBtn?.addEventListener('click', async () => {
    await callHelper(ctx, 'saveSettings');
  });
  settingsCwdBrowseBtn?.addEventListener('click', () => {
    callHelper(ctx, 'openPicker', settingsCwdEl?.value || '~', 'cwd', { input: settingsCwdEl || null } satisfies PickerOptions);
  });
  settingsRolloutBrowseBtn?.addEventListener('click', () => {
    callHelper(ctx, 'openRolloutPicker');
  });

  const footerApprovalValue = document.getElementById('footer-approval-value');
  const footerApprovalOptions = document.getElementById('footer-approval-options');
  const toggleFooterApproval = (evt: Event) => {
    evt?.preventDefault();
    footerApprovalOptions?.classList.toggle('open');
  };
  footerApprovalValue?.addEventListener('click', toggleFooterApproval);
  footerApprovalOptions?.addEventListener('click', (evt) => {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('dropdown-item')) return;
    const value = target.dataset.value?.trim() || target.textContent?.trim();
    if (!value) return;
    if (footerApprovalValue) footerApprovalValue.textContent = value;
    footerApprovalOptions.classList.remove('open');
    callHelper(ctx, 'saveApprovalQuick', value);
  });
});

export {};
