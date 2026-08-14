import type {
  SidebarShortcutsHost,
  SidebarShortcutsOptions,
  SidebarShortcutsRuntime,
  UnknownRecord,
} from '../sidebar-shortcuts/types.ts';
import type { UiIpcRpcMethod } from '../../../src/ui_ipc/rpc_contract.ts';
import type { SidebarIpcRpcMethod } from '../../../src/sidebar_ipc/rpc_contract.ts';

export interface SidebarShortcutsBootstrapDeps {
  initSidebarShortcuts: (opts: SidebarShortcutsOptions) => SidebarShortcutsRuntime;
  host: SidebarShortcutsHost | null;
  homeDir: string;
  pickFile: (startPath?: string) => Promise<string | null>;
  openDrawer: () => void;
  closeAllMenus: () => void;
  setMenuChecked: (el: HTMLElement | null, checked: boolean) => void;
  emitSidebarUiRequest?: (method: UiIpcRpcMethod, payload?: UnknownRecord) => void;
  emitSidebarRpcRequest?: (method: SidebarIpcRpcMethod, payload?: UnknownRecord) => void;
  getClientId: () => string;
  getWindowId: () => string;
}

export function initSidebarShortcutsSafe(deps: SidebarShortcutsBootstrapDeps): SidebarShortcutsRuntime | null {
  try {
    const shortcuts = deps.initSidebarShortcuts({
      host: deps.host,
      homeDir: deps.homeDir,
      pickFile: deps.pickFile,
      openDrawer: deps.openDrawer,
      closeAllMenus: deps.closeAllMenus,
      setMenuChecked: deps.setMenuChecked,
      emitSidebarUiRequest: deps.emitSidebarUiRequest,
      emitSidebarRpcRequest: deps.emitSidebarRpcRequest,
      getClientId: deps.getClientId,
      getWindowId: deps.getWindowId,
    });
    // init() is deferred — called after runBootSequence completes
    // so sidebar loading doesn't compete with core editor boot.
    return shortcuts || null;
  } catch (e) {
    console.warn('Failed to initialize sidebar app dock:', e);
    return null;
  }
}
