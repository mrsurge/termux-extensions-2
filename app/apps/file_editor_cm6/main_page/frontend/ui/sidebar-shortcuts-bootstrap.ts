// @ts-check

/**
 * @param {{
 *   initSidebarShortcuts: (opts: any) => any,
 *   host: any,
 *   homeDir: string,
 *   pickFile: (startPath?: string) => Promise<string | null>,
 *   openDrawer: () => void,
 *   closeAllMenus: () => void,
 *   setMenuChecked: (el: HTMLElement, checked: boolean) => void,
 *   emitSidebarIpc?: (eventName: string, payload?: any) => void,
 * }} deps
 */
export function initSidebarShortcutsSafe(deps: any) {
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
