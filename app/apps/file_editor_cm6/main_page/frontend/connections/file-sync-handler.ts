// @ts-check

interface FileSyncHandlerDeps {
  getLastSaveTime: () => number;
  getInflightOpId: () => string | null;
  selfEchoGraceMs: number;
  toAbsolute: (path: string, base?: string | null, home?: string) => string;
  homeDir: string;
  getCurrentPath: () => string;
  setCurrentPath: (path: string) => void;
  updatePathDisplay: () => void;
  setLastSavedContent: (content: string) => void;
  getLastSha256: () => string | null;
  setLastSha256: (sha: string | null) => void;
  markUnsaved: (flag: boolean) => void;
  setStatus: (text: string) => void;
  getUnsaved: () => boolean;
  clearInflightOpId: () => void;
  refreshExplorer: () => Promise<void> | void;
}

interface FileSyncMessage {
  type?: string;
  path?: string;
  content?: string;
  sha256?: string | null;
  op_id?: string | null;
  meta?: {
    sha256?: string | null;
  };
}

export function createFileSyncHandler(deps: FileSyncHandlerDeps) {
  let explorerRefreshTimer: number | null = null;

  function isFileSyncMessage(value: unknown): value is FileSyncMessage {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function handleWSMessage(msg: unknown): void {
    if (!isFileSyncMessage(msg)) return;
    const type = msg.type;
    if (type === 'replace_full') {
      const isInGracePeriod = deps.getInflightOpId() || (Date.now() - deps.getLastSaveTime()) < deps.selfEchoGraceMs;
      if (isInGracePeriod) return;
      if (msg.path) {
        const normalized = deps.toAbsolute(msg.path, null, deps.homeDir);
        if (normalized !== deps.getCurrentPath()) {
          deps.setCurrentPath(normalized);
          deps.updatePathDisplay();
        }
      }
      deps.setLastSavedContent(msg.content || '');
      deps.setLastSha256(msg.sha256 || null);
      deps.markUnsaved(false);
      deps.setStatus('Updated from disk');
      setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 2000);
    } else if (type === 'save_ack') {
      if (msg.op_id === deps.getInflightOpId()) {
        deps.clearInflightOpId();
        deps.setLastSha256(msg.meta?.sha256 || deps.getLastSha256() || null);
        deps.setStatus('Saved');
        setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
      }
    }
  }

  function scheduleExplorerRefresh(): void {
    if (explorerRefreshTimer) clearTimeout(explorerRefreshTimer);
    explorerRefreshTimer = setTimeout(() => {
      Promise.resolve(deps.refreshExplorer()).catch((err) => console.error('Failed to refresh explorer:', err));
    }, 500);
  }

  return { handleWSMessage, scheduleExplorerRefresh };
}
