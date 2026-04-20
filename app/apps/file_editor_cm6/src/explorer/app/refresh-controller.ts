import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';

interface ExplorerRefreshControllerDeps {
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  getOpenDirectories(): Set<string>;
  setReconnectResyncPending(next: boolean): void;
}

export function createExplorerRefreshController(
  deps: ExplorerRefreshControllerDeps,
) {
  function refreshRootAndOpenDirectories(): void {
    if (!deps.hasExplorerRpc()) return;
    deps.notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
    deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
    deps.getOpenDirectories().forEach((rel) => {
      if (!rel || rel === '.') return;
      deps.notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
    });
  }

  function handleReconnect(): void {
    if (!deps.hasExplorerRpc()) return;
    deps.setReconnectResyncPending(true);
    try {
      deps.notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
      deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
    } catch {
      // Reconnect recovery should not throw into the host caller.
    }
  }

  async function refreshExplorer(): Promise<void> {
    if (!deps.hasExplorerRpc()) return;
    deps.notifyExplorer(EXPLORER_RPC_METHODS.refresh, {});
  }

  function bindManualRefreshButton(button: HTMLElement | null): void {
    if (!button) return;
    button.addEventListener('click', () => {
      refreshRootAndOpenDirectories();
    });
  }

  return {
    handleReconnect,
    refreshExplorer,
    bindManualRefreshButton,
  };
}
