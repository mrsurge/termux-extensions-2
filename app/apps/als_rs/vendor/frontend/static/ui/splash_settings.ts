type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

declare global {
  interface Window {
    CodexAgentModules?: Array<(api: CodexAgentModuleApi | undefined) => void>;
  }
}

function callHelper(ctx: CodexAgentModuleApi | undefined, helperName: string): unknown {
  const helper = ctx?.helpers?.[helperName];
  if (typeof helper === 'function') {
    return helper();
  }
  return undefined;
}

window.CodexAgentModules = window.CodexAgentModules || [];
window.CodexAgentModules.push((ctx: CodexAgentModuleApi | undefined) => {
  const splashSettingsBtn = document.getElementById('splash-settings');
  const splashSettingsCloseBtn = document.getElementById('splash-settings-close');
  const splashSettingsCancelBtn = document.getElementById('splash-settings-cancel');
  const splashSettingsSaveBtn = document.getElementById('splash-settings-save');

  splashSettingsBtn?.addEventListener('click', () => {
    callHelper(ctx, 'openSplashSettingsModal');
  });
  splashSettingsCloseBtn?.addEventListener('click', () => {
    callHelper(ctx, 'closeSplashSettingsModal');
  });
  splashSettingsCancelBtn?.addEventListener('click', () => {
    callHelper(ctx, 'closeSplashSettingsModal');
  });
  splashSettingsSaveBtn?.addEventListener('click', async () => {
    await callHelper(ctx, 'saveSplashSettings');
  });
});

export {};
