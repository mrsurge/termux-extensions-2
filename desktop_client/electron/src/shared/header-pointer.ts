// A touchscreen and a mouse can both be attached to the same device.
export function trackHeaderPointer(): void {
  const root = document.documentElement;
  function update(event: PointerEvent): void {
    root.toggleAttribute("data-header-mouse", event.pointerType === "mouse");
  }
  window.addEventListener("pointerover", update, true);
  window.addEventListener("pointerdown", update, true);
  window.addEventListener("pointerout", event => {
    if (!event.relatedTarget) root.removeAttribute("data-header-mouse");
  }, true);
  window.addEventListener("blur", () => root.removeAttribute("data-header-mouse"));
}
