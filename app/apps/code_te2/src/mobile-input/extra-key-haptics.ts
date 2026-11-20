import { touchHapticsEnabled, TOUCH_HAPTIC_MS } from './handle-feedback.ts';

/** One optional pulse per press, independent of key routing and hold repeats. */
export function bindExtraKeyHaptics(
  root: HTMLElement,
): () => void {
  const win = root.ownerDocument.defaultView;
  const press = (event: PointerEvent): void => {
    if (event.button !== 0 || event.isPrimary === false || !win) return;
    const target = event.target;
    if (!(target instanceof win.Element)) return;
    const button = target.closest('button');
    if (!button || !root.contains(button) || button.disabled) return;
    try {
      if (touchHapticsEnabled()) win.navigator.vibrate?.(TOUCH_HAPTIC_MS);
    } catch {
      // Unsupported/denied haptics must never interfere with input or focus.
    }
  };
  root.addEventListener('pointerdown', press, true);
  return () => root.removeEventListener('pointerdown', press, true);
}
