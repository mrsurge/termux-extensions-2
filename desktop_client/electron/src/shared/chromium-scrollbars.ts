export const CHROMIUM_SCROLLBAR_STYLE = `
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.58) transparent;
}

.xterm-viewport,
.monaco-scrollable-element {
  scrollbar-width: auto;
  scrollbar-color: auto;
}
`;

export function installChromiumScrollbarStyle(document: Document): void {
  const prior = document.querySelector<HTMLStyleElement>(
    "style[data-te2-chromium-scrollbars]",
  );
  if (prior) return;
  const style = document.createElement("style");
  style.dataset.te2ChromiumScrollbars = "true";
  style.textContent = CHROMIUM_SCROLLBAR_STYLE;
  (document.head || document.documentElement).appendChild(style);
}
