export function createExplorerUiHelpers(deps) {
  function setCheckableMenuItem(el, checked) {
    if (!el) return;
    el.classList.toggle('fe-menu-item-checked', !!checked);
    el.setAttribute('aria-checked', checked ? 'true' : 'false');
  }

  function closeExplorerMenu() {
    deps.getExplorerMenuDropdown()?.classList.remove('show');
  }

  function syncExplorerPrefsUI() {
    const checked = deps.getExplorerStickyHeadersEnabled() === true;
    setCheckableMenuItem(deps.getExplorerMenuStickyHeadersItem(), checked);
  }

  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function basename(path) {
    if (!path || path === '/') return '/';
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '/';
  }

  function toast(message) {
    if (window.host && typeof window.host.toast === 'function') {
      window.host.toast(message);
    } else {
      console.log(message);
    }
  }

  function isMobileLayout() {
    const root = document.querySelector('.fe-root');
    return root?.classList.contains('layout-mobile') || false;
  }

  function closeDrawerIfMobile() {
    if (!isMobileLayout()) return;
    const root = document.querySelector('.fe-root');
    if (root) root.classList.remove('drawer-open');
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
