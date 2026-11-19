export const MOBILE_TERMINAL_DRAWER_MAX_HEIGHT = 397;

export function resizedDrawerHeight(requested: number, minimum: number, desktopMaximum: number): number {
  const root = document.querySelector('.fe-root');
  const narrow = root?.classList.contains('layout-mobile') === true;
  if (narrow && root?.classList.contains('desktop-user-agent')) {
    const drawer = root.querySelector('#terminal-drawer');
    const editor = root.querySelector('.fe-editor-container');
    const header = drawer?.querySelector('.drawer-tab-bar');
    if (drawer && editor && header) {
      const maximum = drawer.getBoundingClientRect().bottom - editor.getBoundingClientRect().top;
      const headerHeight = Math.ceil(header.getBoundingClientRect().height) + drawer.clientTop;
      if (maximum > 0) return Math.min(maximum, Math.max(headerHeight, requested));
    }
  }
  return clampTerminalDrawerHeight(requested, minimum, narrow, desktopMaximum);
}

export function clampTerminalDrawerHeight(
  requestedHeight: number,
  minimumHeight: number,
  mobileLayout: boolean,
  desktopMaximumHeight: number,
): number {
  const safeMinimum = Math.max(0, minimumHeight);
  const safeDesktopMaximum = Number.isFinite(desktopMaximumHeight)
    ? Math.max(safeMinimum, desktopMaximumHeight)
    : safeMinimum;
  const maximumHeight = mobileLayout
    ? Math.min(MOBILE_TERMINAL_DRAWER_MAX_HEIGHT, safeDesktopMaximum)
    : safeDesktopMaximum;
  return Math.max(safeMinimum, Math.min(maximumHeight, requestedHeight));
}
