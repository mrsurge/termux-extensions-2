import type {
  SidebarShortcutsHost,
  SidebarShortcutsOptions,
  SidebarShortcutsRuntime,
  UnknownRecord,
} from '../sidebar-shortcuts/types.ts';

export interface SidebarShortcutsBootstrapDeps {
  initSidebarShortcuts: (opts: SidebarShortcutsOptions) => SidebarShortcutsRuntime;
  host: SidebarShortcutsHost | null;
  homeDir: string;
  pickFile: (startPath?: string) => Promise<string | null>;
  openDrawer: () => void;
  closeAllMenus: () => void;
  setMenuChecked: (el: HTMLElement | null, checked: boolean) => void;
  emitSidebarIpc?: (eventName: string, payload?: UnknownRecord) => void;
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
      emitSidebarIpc: deps.emitSidebarIpc,
    });
    // init() is deferred — called after runBootSequence completes
    // so sidebar loading doesn't compete with core editor boot.
    return shortcuts || null;
  } catch (e) {
    console.warn('Failed to initialize sidebar shortcuts:', e);
    return null;
  }
}
