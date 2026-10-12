/** Keep the DOM renderer's themed cursor above RGB cell styling. */
export function bindTerminalCursor(surface: HTMLElement, terminal: {
  onRender(callback: () => void): { dispose(): void };
}): { dispose(): void } {
  const paint = (): void => {
    for (const cursor of surface.querySelectorAll<HTMLElement>('.xterm-cursor-block')) {
      // xterm's generated cursor rules already follow its theme and OSC colors.
      // Inline cell RGB attributes otherwise override those rules.
      cursor.style.removeProperty('background-color');
      cursor.style.removeProperty('color');
    }
  };
  paint();
  return terminal.onRender(paint);
}
