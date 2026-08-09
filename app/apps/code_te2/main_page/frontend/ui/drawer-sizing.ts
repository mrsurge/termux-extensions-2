export const MOBILE_TERMINAL_DRAWER_MAX_HEIGHT = 397;

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
