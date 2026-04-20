interface ExplorerUiHelpersDeps {
  getExplorerMenuDropdown(): HTMLElement | null;
  getExplorerStickyHeadersEnabled(): boolean | null;
  getExplorerMenuStickyHeadersItem(): HTMLElement | null;
}

export function createExplorerUiHelpers(deps: ExplorerUiHelpersDeps) {
  function setCheckableMenuItem(
    el: HTMLElement | null,
    checked: boolean,
  ): void {
    if (!el) return;
    el.classList.toggle('fe-menu-item-checked', checked);
    el.setAttribute('aria-checked', checked ? 'true' : 'false');
  }

  function closeExplorerMenu(): void {
    deps.getExplorerMenuDropdown()?.classList.remove('show');
  }

  function syncExplorerPrefsUI(): void {
    const checked = deps.getExplorerStickyHeadersEnabled() === true;
    setCheckableMenuItem(deps.getExplorerMenuStickyHeadersItem(), checked);
  }

  function clearElement(el: HTMLElement | null): void {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function basename(path: string): string {
    if (!path || path === '/') return '/';
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '/';
  }

  function toast(message: string): void {
    if (typeof window.host?.toast === 'function') {
      window.host.toast(message);
      return;
    }
    console.log(message);
  }

  function isMobileLayout(): boolean {
    const root = document.querySelector('.fe-root');
    return root?.classList.contains('layout-mobile') || false;
  }

  function closeDrawerIfMobile(): void {
    if (!isMobileLayout()) return;
    const root = document.querySelector('.fe-root');
    if (root instanceof HTMLElement) {
      root.classList.remove('drawer-open');
    }
  }

  return {
    setCheckableMenuItem,
    closeExplorerMenu,
    syncExplorerPrefsUI,
    clearElement,
    basename,
    toast,
    isMobileLayout,
    closeDrawerIfMobile,
  };
}
