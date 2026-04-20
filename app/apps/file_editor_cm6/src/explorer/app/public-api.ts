interface ExplorerPublicApiDeps {
  scrollToActiveFile(): Promise<void>;
  handleNotification(method: string, payload: Record<string, unknown>): void;
  handleReconnect(): void;
  refreshExplorer(): Promise<void>;
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function registerExplorerPublicApi(
  deps: ExplorerPublicApiDeps,
): void {
  window.__explorerScrollToActiveFile = () => deps.scrollToActiveFile();
  window.__explorerHandleNotification = (method: string, payload: unknown) => {
    try {
      deps.handleNotification(method, normalizePayload(payload));
    } catch (error) {
      console.warn('[Explorer] dispatch error', method, error);
    }
  };
  window.__cm6ExplorerOnReconnect = () => {
    deps.handleReconnect();
  };
  window.__cm6RefreshExplorer = async () => {
    await deps.refreshExplorer();
  };
}
