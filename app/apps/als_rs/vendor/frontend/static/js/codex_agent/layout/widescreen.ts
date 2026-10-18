const WIDESCREEN_BREAKPOINT = 1280;
const WIDESCREEN_SPLIT_STORAGE_KEY = 'codex_widescreen_split';
const WIDESCREEN_SPLIT_DEFAULT = 420;
const WIDESCREEN_SPLIT_MIN = 320;
const WIDESCREEN_SPLIT_MAX = 720;

interface WidescreenLayoutContext {
  drawerEl: HTMLElement | null;
  splashViewEl: HTMLElement | null;
  widescreenResizerEl: HTMLElement | null;
  getActiveView(): string | null;
  documentRef: Document;
  windowRef: Window;
}

export function bindWidescreenLayout(ctx: WidescreenLayoutContext) {
  const {
    drawerEl,
    splashViewEl,
    widescreenResizerEl,
    getActiveView,
    documentRef,
    windowRef,
  } = ctx;

  const widescreenMedia = typeof windowRef.matchMedia === 'function'
    ? windowRef.matchMedia(`(min-width: ${WIDESCREEN_BREAKPOINT}px)`)
    : null;
  let widescreenLayout = Boolean(widescreenMedia?.matches);
  let widescreenResizing = false;

  function setDrawerOpen(open: boolean) {
    if (!drawerEl) return;
    const shouldOpen = widescreenLayout || Boolean(open);
    drawerEl.classList.toggle('open', shouldOpen);
    documentRef.body.classList.toggle('drawer-open', shouldOpen);
  }

  function clampWidescreenSplit(width: number) {
    const numericWidth = Number(width);
    const viewportWidth = Math.max(windowRef.innerWidth || 0, 0);
    const viewportCap = viewportWidth > 0
      ? Math.floor(viewportWidth * 0.6)
      : WIDESCREEN_SPLIT_MAX;
    const maxWidth = Math.max(WIDESCREEN_SPLIT_MIN, Math.min(WIDESCREEN_SPLIT_MAX, viewportCap));
    if (!Number.isFinite(numericWidth)) {
      return Math.max(WIDESCREEN_SPLIT_MIN, Math.min(WIDESCREEN_SPLIT_DEFAULT, maxWidth));
    }
    return Math.max(WIDESCREEN_SPLIT_MIN, Math.min(Math.round(numericWidth), maxWidth));
  }

  function getStoredWidescreenSplit() {
    try {
      const raw = windowRef.localStorage.getItem(WIDESCREEN_SPLIT_STORAGE_KEY);
      if (!raw) return WIDESCREEN_SPLIT_DEFAULT;
      return clampWidescreenSplit(Number(raw));
    } catch {
      return WIDESCREEN_SPLIT_DEFAULT;
    }
  }

  function applyWidescreenSplit(width: number, { persist = true } = {}) {
    const clampedWidth = clampWidescreenSplit(width);
    documentRef.documentElement.style.setProperty('--codex-widescreen-splash-width', `${clampedWidth}px`);
    if (persist) {
      try {
        windowRef.localStorage.setItem(WIDESCREEN_SPLIT_STORAGE_KEY, String(clampedWidth));
      } catch {
        // ignore storage failures
      }
    }
    return clampedWidth;
  }

  function applyWidescreenResizeFromClientX(clientX: number) {
    if (!widescreenLayout || !splashViewEl) return;
    const gridEl = splashViewEl.parentElement;
    if (!gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    applyWidescreenSplit(clientX - rect.left);
  }

  function finishWidescreenResize() {
    if (!widescreenResizing) return;
    widescreenResizing = false;
    documentRef.body.classList.remove('widescreen-resizing');
    windowRef.removeEventListener('pointermove', handleWidescreenResizeMove);
    windowRef.removeEventListener('pointerup', finishWidescreenResize);
    windowRef.removeEventListener('pointercancel', finishWidescreenResize);
  }

  function updateWidescreenLayout() {
    widescreenLayout = Boolean(widescreenMedia?.matches);
    documentRef.body.classList.toggle('widescreen-layout', widescreenLayout);
    if (widescreenLayout) {
      applyWidescreenSplit(getStoredWidescreenSplit(), { persist: false });
    } else {
      finishWidescreenResize();
    }
    if (widescreenResizerEl) {
      widescreenResizerEl.setAttribute('aria-hidden', widescreenLayout ? 'false' : 'true');
    }
    setDrawerOpen(getActiveView() === 'conversation');
  }

  function isWidescreenLayout() {
    return widescreenLayout;
  }

  function handleWidescreenResizeMove(event: PointerEvent) {
    if (!widescreenResizing) return;
    applyWidescreenResizeFromClientX(event.clientX);
  }

  function handleWidescreenResizeStart(event: PointerEvent) {
    if (!widescreenLayout || !widescreenResizerEl) return;
    event.preventDefault();
    widescreenResizing = true;
    documentRef.body.classList.add('widescreen-resizing');
    widescreenResizerEl.focus({ preventScroll: true });
    if (typeof widescreenResizerEl.setPointerCapture === 'function' && event.pointerId != null) {
      try {
        widescreenResizerEl.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer-capture failures
      }
    }
    windowRef.addEventListener('pointermove', handleWidescreenResizeMove);
    windowRef.addEventListener('pointerup', finishWidescreenResize);
    windowRef.addEventListener('pointercancel', finishWidescreenResize);
    applyWidescreenResizeFromClientX(event.clientX);
  }

  function handleWidescreenResizeKeydown(event: KeyboardEvent) {
    if (!widescreenLayout) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.shiftKey ? 64 : 24;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    applyWidescreenSplit(getStoredWidescreenSplit() + (direction * delta));
  }

  function bindWidescreenResizer() {
    if (!widescreenResizerEl) return;
    widescreenResizerEl.addEventListener('pointerdown', handleWidescreenResizeStart);
    widescreenResizerEl.addEventListener('keydown', handleWidescreenResizeKeydown);
    widescreenResizerEl.addEventListener('dblclick', () => {
      if (!widescreenLayout) return;
      applyWidescreenSplit(WIDESCREEN_SPLIT_DEFAULT);
    });
    if (widescreenMedia) {
      if (typeof widescreenMedia.addEventListener === 'function') {
        widescreenMedia.addEventListener('change', updateWidescreenLayout);
      } else if (typeof widescreenMedia.addListener === 'function') {
        widescreenMedia.addListener(updateWidescreenLayout);
      }
    }
    windowRef.addEventListener('resize', updateWidescreenLayout);
  }

  return {
    setDrawerOpen,
    updateWidescreenLayout,
    isWidescreenLayout,
    bindWidescreenResizer,
  };
}
