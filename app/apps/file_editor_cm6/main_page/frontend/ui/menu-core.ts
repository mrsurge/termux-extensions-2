// @ts-check

/**
 * @param {{
 *   menuFileDD: HTMLElement,
 *   menuEditDD: HTMLElement,
 *   menuEditorDD: HTMLElement,
 *   menuViewDD: HTMLElement,
 *   getAgentShortcutLoadDD: () => HTMLElement | null,
 *   getAgentShortcutLoadBtn: () => HTMLElement | null,
 *   getBranchMenuHandle: () => any,
 *   menuFileBtn: HTMLElement,
 *   menuEditBtn: HTMLElement,
 *   menuEditorBtn: HTMLElement,
 *   menuViewBtn: HTMLElement,
 *   runActiveBtn: HTMLElement,
 *   runCurrentFile: () => void,
 * }} deps
 */
export function createMenuCoreController(deps: any) {
  function closeAllMenus() {
    deps.menuFileDD.classList.remove('show');
    deps.menuEditDD.classList.remove('show');
    deps.menuEditorDD.classList.remove('show');
    deps.menuViewDD.classList.remove('show');
    const agentShortcutLoadDD = deps.getAgentShortcutLoadDD();
    if (agentShortcutLoadDD) agentShortcutLoadDD.classList.remove('show');
    const agentShortcutLoadBtn = deps.getAgentShortcutLoadBtn();
    if (agentShortcutLoadBtn) agentShortcutLoadBtn.setAttribute('aria-expanded', 'false');
    try {
      if (typeof window.__cm6CloseLspMenus === 'function') window.__cm6CloseLspMenus();
    } catch {}
    const branchMenuHandle = deps.getBranchMenuHandle();
    if (branchMenuHandle && typeof branchMenuHandle.close === 'function') branchMenuHandle.close();
  }

  function bindMenuToggle(el: HTMLElement | null, action: () => void) {
    if (!el) return;
    const run = () => { closeAllMenus(); action(); };
    el.addEventListener('click', run);
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        run();
      }
    });
  }

  function installPrimaryMenuButtons() {
    const closeOthers = (except: HTMLElement) => {
      [deps.menuFileDD, deps.menuEditDD, deps.menuEditorDD, deps.menuViewDD].forEach((dd) => {
        if (dd !== except) dd.classList.remove('show');
      });
      const branchMenuHandle = deps.getBranchMenuHandle();
      if (branchMenuHandle) branchMenuHandle.close();
    };

    deps.menuFileBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); const open = deps.menuFileDD.classList.toggle('show'); if (open) closeOthers(deps.menuFileDD); });
    deps.menuEditBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); const open = deps.menuEditDD.classList.toggle('show'); if (open) closeOthers(deps.menuEditDD); });
    deps.menuEditorBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); const open = deps.menuEditorDD.classList.toggle('show'); if (open) closeOthers(deps.menuEditorDD); });
    deps.menuViewBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); const open = deps.menuViewDD.classList.toggle('show'); if (open) closeOthers(deps.menuViewDD); });
    deps.runActiveBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); deps.runCurrentFile(); });
    document.addEventListener('click', () => closeAllMenus());
  }

  return { closeAllMenus, bindMenuToggle, installPrimaryMenuButtons };
}
