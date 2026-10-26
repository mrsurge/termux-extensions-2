import { objectValue } from './settings-contracts.ts';

interface Dependencies {  getCurrentPath: () => string | null,
  getProjectRoot: () => string | null,
  requestBackendEditorFind: (payload: Record<string, unknown>) => Promise<unknown>,
  toast: (msg: string) => void
}

export function createSearchPanelController(deps: Dependencies) {
  async function triggerEditorSearchPanel(reason = 'menu', opts: { replace?: boolean } = {}) {
    const action = opts.replace ? 'replace' : 'find';
    const payload = {
      path: deps.getCurrentPath() || null,
      project: deps.getProjectRoot() || null,
      action,
      reason,
    };
    try {
      const result = objectValue(await deps.requestBackendEditorFind(payload));
      if (result?.ok === false) {
        const message = typeof result.error === 'string' ? result.error : 'Search unavailable';
        deps.toast(message);
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message || 'Search unavailable')
        : 'Search unavailable';
      deps.toast(message);
    }
  }

  return { triggerEditorSearchPanel };
}
