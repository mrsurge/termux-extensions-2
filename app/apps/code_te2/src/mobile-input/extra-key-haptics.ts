export const DEFAULT_EXTRA_KEY_VIBRATION_MS = 100;

/** One optional pulse per press, independent of key routing and hold repeats. */
export function bindExtraKeyHaptics(
  root: HTMLElement,
  getDurationMs: () => number = () => DEFAULT_EXTRA_KEY_VIBRATION_MS,
): () => void {
  const win = root.ownerDocument.defaultView;
  const press = (event: PointerEvent): void => {
    if (event.button !== 0 || event.isPrimary === false || !win) return;
    const target = event.target;
    if (!(target instanceof win.Element)) return;
    const button = target.closest('button');
    if (!button || !root.contains(button) || button.disabled) return;
    try {
      const configured = getDurationMs();
      const duration = Number.isFinite(configured)
        ? Math.max(0, Math.round(configured)) : DEFAULT_EXTRA_KEY_VIBRATION_MS;
      if (duration > 0) win.navigator.vibrate?.(duration);
    } catch {
      // Unsupported/denied haptics must never interfere with input or focus.
    }
  };
  root.addEventListener('pointerdown', press, true);
  return () => root.removeEventListener('pointerdown', press, true);
}
