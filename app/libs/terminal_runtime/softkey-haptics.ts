/** Capture pointerdown before modifier and repeat handlers consume it. */
export function bindSoftkeyHaptics(root: HTMLElement, enabled: () => boolean = () => true): () => void {
  const win = root.ownerDocument.defaultView;
  const press = (event: PointerEvent) => {
    if (!win || event.button !== 0 || event.isPrimary === false || !(event.target instanceof win.Element)) return;
    const button = event.target.closest('button');
    if (!button || button.disabled || !root.contains(button)) return;
    try { if (enabled()) win.navigator.vibrate?.(1); } catch { /* Optional client feedback. */ }
  };
  root.addEventListener('pointerdown', press, true);
  return () => root.removeEventListener('pointerdown', press, true);
}
