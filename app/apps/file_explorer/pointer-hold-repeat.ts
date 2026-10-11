export const POINTER_HOLD_REPEAT_DELAY_MS = 420;
export const POINTER_HOLD_REPEAT_INTERVAL_MS = 55;

export interface PointerHoldRepeatClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PointerHoldRepeatHandlers {
  start(): void;
  repeat(): void;
  finish(): void;
}

export interface PointerHoldRepeatOptions {
  clock?: PointerHoldRepeatClock;
  delayMs?: number;
  intervalMs?: number;
  window?: Window;
}

function windowClock(win: Window): PointerHoldRepeatClock {
  return {
    setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
    clearTimeout: (handle) => win.clearTimeout(handle as number),
    setInterval: (callback, intervalMs) => win.setInterval(callback, intervalMs),
    clearInterval: (handle) => win.clearInterval(handle as number),
  };
}

export function bindPointerHoldRepeat(
  button: HTMLButtonElement,
  handlers: PointerHoldRepeatHandlers,
  options: PointerHoldRepeatOptions = {},
): () => void {
  const win = options.window ?? button.ownerDocument.defaultView ?? window;
  const clock = options.clock ?? windowClock(win);
  const delayMs = options.delayMs ?? POINTER_HOLD_REPEAT_DELAY_MS;
  const intervalMs = options.intervalMs ?? POINTER_HOLD_REPEAT_INTERVAL_MS;
  let activePointerId: number | null = null;
  let delayHandle: unknown = null;
  let intervalHandle: unknown = null;

  const clearTimers = (): void => {
    if (delayHandle !== null) clock.clearTimeout(delayHandle);
    if (intervalHandle !== null) clock.clearInterval(intervalHandle);
    delayHandle = null;
    intervalHandle = null;
  };

  const finish = (event?: PointerEvent): void => {
    if (
      event
      && activePointerId !== null
      && event.pointerId !== activePointerId
    ) return;
    if (activePointerId === null) return;
    const pointerId = activePointerId;
    activePointerId = null;
    clearTimers();
    try {
      if (button.hasPointerCapture?.(pointerId)) {
        button.releasePointerCapture(pointerId);
      }
    } catch {
      // Cancellation remains authoritative when capture is unavailable.
    }
    handlers.finish();
  };

  const start = (event: PointerEvent): void => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    finish();
    activePointerId = event.pointerId;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Window-level release listeners still terminate the gesture.
    }
    handlers.start();
    delayHandle = clock.setTimeout(() => {
      delayHandle = null;
      if (activePointerId === null) return;
      handlers.repeat();
      intervalHandle = clock.setInterval(() => {
        if (activePointerId !== null) handlers.repeat();
      }, intervalMs);
    }, delayMs);
  };

  const finishFromPointer = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    finish(event);
  };
  const finishFromWindow = (event: PointerEvent): void => finish(event);
  const finishFromBlur = (): void => finish();
  const finishFromVisibility = (): void => {
    if (button.ownerDocument.hidden) finish();
  };
  const preventContextMenu = (event: Event): void => event.preventDefault();

  button.addEventListener('pointerdown', start, { passive: false });
  button.addEventListener('pointerup', finishFromPointer, { passive: false });
  button.addEventListener('pointercancel', finishFromPointer, { passive: false });
  button.addEventListener('lostpointercapture', finishFromPointer, { passive: false });
  button.addEventListener('contextmenu', preventContextMenu);
  win.addEventListener('pointerup', finishFromWindow);
  win.addEventListener('pointercancel', finishFromWindow);
  win.addEventListener('blur', finishFromBlur);
  button.ownerDocument.addEventListener('visibilitychange', finishFromVisibility);

  return () => {
    finish();
    button.removeEventListener('pointerdown', start);
    button.removeEventListener('pointerup', finishFromPointer);
    button.removeEventListener('pointercancel', finishFromPointer);
    button.removeEventListener('lostpointercapture', finishFromPointer);
    button.removeEventListener('contextmenu', preventContextMenu);
    win.removeEventListener('pointerup', finishFromWindow);
    win.removeEventListener('pointercancel', finishFromWindow);
    win.removeEventListener('blur', finishFromBlur);
    button.ownerDocument.removeEventListener('visibilitychange', finishFromVisibility);
  };
}
