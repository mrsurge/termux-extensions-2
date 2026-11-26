// @ts-check

interface Dependencies {  menuFileDD: HTMLElement,
  menuEditDD: HTMLElement,
  menuEditorDD: HTMLElement,
  menuViewDD: HTMLElement,
  getAgentShortcutLoadDD: () => HTMLElement | null,
  getAgentShortcutLoadBtn: () => HTMLElement | null,
  getBranchMenuHandle: () => { open(): void; close(): void } | null,
  menuFileBtn: HTMLElement,
  menuEditBtn: HTMLElement,
  menuEditorBtn: HTMLElement,
  menuViewBtn: HTMLElement,
  runActiveBtn: HTMLElement,
  stopRunProfilesBtn: HTMLElement,
  runCurrentFile: () => void,
  stopRunningProfiles: () => void,
  showRunProfileSelector: () => void,
}

export function createMenuCoreController(deps: Dependencies) {
  const menus = [
    { button: deps.menuFileBtn, panel: deps.menuFileDD },
    { button: deps.menuEditBtn, panel: deps.menuEditDD },
    { button: deps.menuEditorBtn, panel: deps.menuEditorDD },
    { button: deps.menuViewBtn, panel: deps.menuViewDD },
  ];
  const branchButton = document.getElementById('menu-branch-btn');
  const branchPanel = document.getElementById('menu-branch-dd');
  if (branchButton && branchPanel) menus.push({ button: branchButton, panel: branchPanel });
  let mouseMenu: HTMLElement | null = null;

  function closeAllMenus() {
    mouseMenu = null;
    for (const { button, panel } of menus) {
      panel.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
    }
    const agentShortcutLoadDD = deps.getAgentShortcutLoadDD();
    if (agentShortcutLoadDD) agentShortcutLoadDD.classList.remove('show');
    const agentShortcutLoadBtn = deps.getAgentShortcutLoadBtn();
    if (agentShortcutLoadBtn) agentShortcutLoadBtn.setAttribute('aria-expanded', 'false');
    try {
      if (typeof window.__codeTe2CloseLspMenus === 'function') window.__codeTe2CloseLspMenus();
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
    for (const { button, panel } of menus) {
      button.setAttribute('aria-controls', panel.id);
      button.setAttribute('aria-expanded', 'false');
      let pressedWith = '';
      button.addEventListener('pointerdown', event => { pressedWith = event.pointerType; });
      button.addEventListener('pointercancel', () => { pressedWith = ''; });

      const open = (mouse: boolean) => {
        closeAllMenus();
        if (panel === branchPanel) {
          const branch = deps.getBranchMenuHandle();
          if (!branch) return;
          branch.open();
        } else {
          panel.classList.add('show');
        }
        button.setAttribute('aria-expanded', 'true');
        if (mouse) mouseMenu = panel;
      };
      button.addEventListener('click', event => {
        event.stopPropagation();
        // Keyboard and programmatic clicks have no pointer activation.
        const mouse = event.detail !== 0 &&
          (('pointerType' in event && event.pointerType) || pressedWith) === 'mouse';
        pressedWith = '';
        if (panel.classList.contains('show')) closeAllMenus();
        else open(mouse);
      });
      button.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse' || mouseMenu === panel ||
            !mouseMenu?.classList.contains('show')) return;
        open(true);
        button.focus({ preventScroll: true });
      });
    }
    document.addEventListener('pointerdown', event => {
      if (!mouseMenu || menus.some(({ button, panel }) =>
        event.composedPath().includes(button) || event.composedPath().includes(panel))) return;
      closeAllMenus();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !mouseMenu?.classList.contains('show')) return;
      const trigger = menus.find(menu => menu.panel === mouseMenu)?.button;
      closeAllMenus();
      trigger?.focus({ preventScroll: true });
    });
    window.addEventListener('blur', () => { if (mouseMenu) closeAllMenus(); });
    installRunButtonInteractions(
      deps.runActiveBtn,
      deps.runCurrentFile,
      deps.showRunProfileSelector,
    );
    deps.stopRunProfilesBtn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      deps.stopRunningProfiles();
    });
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
