// @ts-check

export function initResponsiveLayout() {
  const update = () => {
    const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
    const root = document.querySelector('.fe-root');
    if (!root) return;
    if (isDesktop) {
      root.classList.add('layout-desktop');
      root.classList.remove('layout-mobile');
    } else {
      root.classList.add('layout-mobile');
      root.classList.remove('layout-desktop');
    }
  };

  update();
  window.addEventListener('resize', () => update());
  window.addEventListener('orientationchange', () => setTimeout(() => update(), 100));
}
