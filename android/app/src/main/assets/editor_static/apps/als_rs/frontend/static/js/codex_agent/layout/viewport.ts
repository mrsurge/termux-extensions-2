interface ViewportLayoutContext {
  documentRef: Document;
  windowRef: Window;
  getAutoScroll?: () => boolean;
  onViewportChanged?: () => void;
}

type ViewportWindow = Window & {
  refreshAlsViewportLayout?: () => void;
};

export function bindViewportLayout(ctx: ViewportLayoutContext) {
  const {
    documentRef,
    windowRef,
    getAutoScroll,
    onViewportChanged,
  } = ctx;
  const viewportWindow = windowRef as ViewportWindow;
  let layoutRaf = 0;
  let lastViewportHeight = 0;
  let lastKeyboardInset = 0;

  function readLayoutViewportHeight(): number {
    return Math.round(
      windowRef.innerHeight
      || documentRef.documentElement.clientHeight
      || 0,
    );
  }

  function readVisualViewportExtent(): number {
    const visualViewport = windowRef.visualViewport || null;
    const visualViewportHeight = visualViewport && Number.isFinite(visualViewport.height)
      ? visualViewport.height
      : null;
    const visualViewportOffsetTop = visualViewport && Number.isFinite(visualViewport.offsetTop)
      ? visualViewport.offsetTop
      : 0;
    const viewportExtent = visualViewportHeight != null
      ? visualViewportHeight + visualViewportOffsetTop
      : null;
    return Math.round(
      viewportExtent
      || windowRef.innerHeight
      || documentRef.documentElement.clientHeight
      || 0,
    );
  }

  function updateViewportLayout() {
    layoutRaf = 0;
    const root = documentRef.documentElement;
    const viewportHeight = readVisualViewportExtent();
    const layoutViewportHeight = readLayoutViewportHeight();
    const keyboardInset = Math.max(0, layoutViewportHeight - viewportHeight);
    const changed = viewportHeight !== lastViewportHeight || keyboardInset !== lastKeyboardInset;

    if (viewportHeight > 0) {
      root.style.setProperty('--als-viewport-height', `${viewportHeight}px`);
      lastViewportHeight = viewportHeight;
    }
    root.style.setProperty('--als-keyboard-inset-bottom', `${keyboardInset}px`);
    lastKeyboardInset = keyboardInset;
    documentRef.body.classList.toggle('visual-keyboard-open', keyboardInset > 80);

    if (changed && getAutoScroll?.() === true) {
      onViewportChanged?.();
    }
  }

  function scheduleViewportLayout() {
    if (layoutRaf) return;
    layoutRaf = windowRef.requestAnimationFrame(updateViewportLayout);
  }

  function bindViewportListeners() {
    viewportWindow.refreshAlsViewportLayout = scheduleViewportLayout;
    if (documentRef.readyState === 'loading') {
      documentRef.addEventListener('DOMContentLoaded', scheduleViewportLayout);
    } else {
      scheduleViewportLayout();
    }
    windowRef.addEventListener('load', scheduleViewportLayout);
    windowRef.addEventListener('resize', scheduleViewportLayout);
    windowRef.visualViewport?.addEventListener('resize', scheduleViewportLayout);
    windowRef.visualViewport?.addEventListener('scroll', scheduleViewportLayout);
  }

  return {
    bindViewportListeners,
    scheduleViewportLayout,
    updateViewportLayout,
  };
}
