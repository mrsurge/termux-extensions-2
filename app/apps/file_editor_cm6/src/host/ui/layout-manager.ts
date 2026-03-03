// @ts-check

/**
 * @param {{ scheduleToolbarTitleClamp: (opts?: any) => void }} deps
 */
export function initResponsiveLayout(deps) {
  const update = () => {
    const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
    const root = document.querySelector('.fe-root');
    if (!root) return;
    const wasDesktop = root.classList.contains('layout-desktop');
    const wasMobile = root.classList.contains('layout-mobile');
    if (isDesktop) {
      root.classList.add('layout-desktop');
      root.classList.remove('layout-mobile');
    } else {
      root.classList.add('layout-mobile');
      root.classList.remove('layout-desktop');
    }
    const modeChanged = isDesktop ? !wasDesktop : !wasMobile;
    deps.scheduleToolbarTitleClamp({ doubleRaf: true, resetBaseline: modeChanged });
  };

  update();
  window.addEventListener('resize', () => update());
  window.addEventListener('orientationchange', () => setTimeout(() => update(), 100));
}
