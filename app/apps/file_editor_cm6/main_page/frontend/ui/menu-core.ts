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
 *   showRunProfileSelector: () => void,
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
    installRunButtonInteractions(
      deps.runActiveBtn,
      deps.runCurrentFile,
      deps.showRunProfileSelector,
    );
    document.addEventListener('click', () => closeAllMenus());
  }

  return { closeAllMenus, bindMenuToggle, installPrimaryMenuButtons };
}

interface RunButtonInteractionOptions {
  longPressMs?: number;
  moveCancelPx?: number;
  suppressClickMs?: number;
}

export function installRunButtonInteractions(
  button: HTMLElement,
  runPrimaryAction: () => void,
  showProfileSelector: () => void,
  options: RunButtonInteractionOptions = {},
): void {
  const longPressMs = options.longPressMs ?? 520;
  const moveCancelPx = options.moveCancelPx ?? 8;
  const suppressClickMs = options.suppressClickMs ?? 900;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let suppressClickUntil = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLongPress = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
      return;
    }
    runPrimaryAction();
  });

  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearLongPress();
    showProfileSelector();
  });

  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      if (pointerId !== event.pointerId) return;
      longPressTimer = null;
      suppressClickUntil = Date.now() + suppressClickMs;
      showProfileSelector();
    }, longPressMs);
  });

  button.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > moveCancelPx) {
      clearLongPress();
    }
  });

  const finishPointer = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    clearLongPress();
    pointerId = null;
  };
  button.addEventListener('pointerup', finishPointer);
  button.addEventListener('pointercancel', finishPointer);
  button.addEventListener('lostpointercapture', finishPointer);
}
