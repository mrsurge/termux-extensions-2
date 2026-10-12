interface ShiftState { tapShift(now?: number): void; lockShift(): void }
interface ShiftBinding { (): void; cancel(): void }
export const SHIFT_LONG_PRESS_MS = 500;

/** Native pointer ownership keeps a press from blurring the terminal textarea. */
export function bindTerminalShiftButton(
  button: HTMLButtonElement,
  state: ShiftState,
  update: () => void,
  focus: () => void,
  win: Window = window,
): ShiftBinding {
  let timer: number | undefined;
  let pointer: number | undefined;
  const cancel = (): void => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    pointer = undefined;
  };
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    cancel(); pointer = event.pointerId;
    try { button.setPointerCapture(pointer); } catch { /* Window release also cancels. */ }
    state.tapShift(); update(); focus();
    timer = win.setTimeout(() => {
      timer = undefined;
      if (pointer === undefined) return;
      state.lockShift(); update();
    }, SHIFT_LONG_PRESS_MS);
  };
  const end = (event: PointerEvent): void => {
    if (event.pointerId === pointer) cancel();
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('lostpointercapture', end);
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
  win.addEventListener('blur', cancel);
  return Object.assign(() => {
    cancel();
    button.removeEventListener('pointerdown', down);
    button.removeEventListener('lostpointercapture', end);
    win.removeEventListener('pointerup', end);
    win.removeEventListener('pointercancel', end);
    win.removeEventListener('blur', cancel);
  }, { cancel });
}
