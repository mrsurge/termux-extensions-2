type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

declare global {
  interface Window {
    CodexAgentModules?: Array<(ctx: CodexAgentModuleApi | undefined) => void>;
  }
}

async function callAsyncHelper(ctx: CodexAgentModuleApi | undefined, helperName: string, ...args: unknown[]): Promise<unknown> {
  const helper = ctx?.helpers?.[helperName];
  if (typeof helper === 'function') {
    return await helper(...args);
  }
  return undefined;
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
  const rolloutCloseBtn = document.getElementById('rollout-close');
  const rolloutListEl = document.getElementById('rollout-list');

  rolloutCloseBtn?.addEventListener('click', () => callHelper(ctx, 'closeRolloutPicker'));
  rolloutListEl?.addEventListener('click', async (evt) => {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest<HTMLElement>('.rollout-item');
    if (!row) return;
    const rolloutId = row.dataset.rolloutId;
    if (rolloutId) {
      await callAsyncHelper(ctx, 'loadRolloutPreview', rolloutId);
    }
  });
});

export {};
