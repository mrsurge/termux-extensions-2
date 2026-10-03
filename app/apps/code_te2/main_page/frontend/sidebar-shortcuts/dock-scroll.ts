// Scrolling owns horizontal touch gestures only when the dock overflows.
// Vertical-start touch gestures and mouse drags remain owned by icon reorder.
export function bindDockOverflowScroll(
  viewport: HTMLElement,
  onScrollStart: () => void,
): () => void {
  let pointer: { id: number; x: number; y: number; left: number; scrolling: boolean } | null = null;
  let suppressClick = false;
  const overflows = () => viewport.scrollWidth > viewport.clientWidth + 1;
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || !overflows()) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
    const before = viewport.scrollLeft;
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, before + delta * scale));
    if (before === viewport.scrollLeft) return;
    onScrollStart();
    event.preventDefault();
  };
  const down = (event: PointerEvent) => {
    suppressClick = false;
    pointer = event.pointerType === 'touch' && overflows()
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, scrolling: false }
      : null;
  };
  const move = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.scrolling) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
      if (Math.abs(dy) >= Math.abs(dx)) { pointer = null; return; }
      pointer.scrolling = true;
      suppressClick = true;
      onScrollStart();
      try { viewport.setPointerCapture(event.pointerId); } catch { /* unsupported capture */ }
    }
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, pointer.left - dx));
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const end = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const scrolling = pointer.scrolling;
    pointer = null;
    if (scrolling) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try { viewport.releasePointerCapture(event.pointerId); } catch { /* unsupported capture */ }
    }
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const lost = (event: PointerEvent) => {
    if (event.target === viewport && pointer?.id === event.pointerId) pointer = null;
  };
  viewport.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', down, true);
  viewport.addEventListener('pointermove', move, { capture: true, passive: false });
  viewport.addEventListener('pointerup', end, true);
  viewport.addEventListener('pointercancel', end, true);
  viewport.addEventListener('lostpointercapture', lost);
  viewport.addEventListener('click', click, true);
  return () => {
    if (pointer?.scrolling) {
      try { viewport.releasePointerCapture(pointer.id); } catch { /* unsupported capture */ }
    }
    pointer = null;
    viewport.removeEventListener('wheel', wheel);
    viewport.removeEventListener('pointerdown', down, true);
    viewport.removeEventListener('pointermove', move, true);
    viewport.removeEventListener('pointerup', end, true);
    viewport.removeEventListener('pointercancel', end, true);
    viewport.removeEventListener('lostpointercapture', lost);
    viewport.removeEventListener('click', click, true);
  };
}
