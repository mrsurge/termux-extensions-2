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

let explorerPublicApiDeps: ExplorerPublicApiDeps | null = null;

export function registerExplorerPublicApi(
  deps: ExplorerPublicApiDeps,
): void {
  explorerPublicApiDeps = deps;
}

export async function scrollExplorerToActiveFile(): Promise<void> {
  await explorerPublicApiDeps?.scrollToActiveFile();
}

export function dispatchExplorerNotification(method: string, payload: unknown): void {
  if (!explorerPublicApiDeps) return;
  try {
    explorerPublicApiDeps.handleNotification(method, normalizePayload(payload));
  } catch (error) {
    console.warn('[Explorer] dispatch error', method, error);
  }
}

export function handleExplorerReconnect(): void {
  explorerPublicApiDeps?.handleReconnect();
}

export async function refreshExplorer(): Promise<void> {
  await explorerPublicApiDeps?.refreshExplorer();
}
