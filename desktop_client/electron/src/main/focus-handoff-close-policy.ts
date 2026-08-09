export type FocusHandoffWindow = {
  on(event: "focus" | "blur" | "closed", listener: () => void): unknown;
  off(event: "focus" | "blur" | "closed", listener: () => void): unknown;
  isDestroyed(): boolean;
  isFocused(): boolean;
};

export type WindowFocusSource<TWindow> = {
  on(
    event: "browser-window-focus",
    listener: (event: unknown, focusedWindow: TWindow) => void,
  ): unknown;
  off(
    event: "browser-window-focus",
    listener: (event: unknown, focusedWindow: TWindow) => void,
  ): unknown;
};

export function installCloseOnFocusHandoff<TWindow extends FocusHandoffWindow>(
  window: TWindow,
  focusSource: WindowFocusSource<TWindow>,
  close: () => void,
): () => void {
  let armed = window.isFocused();
  let blurred = false;
  let closeRequested = false;
  let disposed = false;

  const handleFocus = (): void => {
    if (disposed) return;
    armed = true;
    blurred = false;
  };
  const handleBlur = (): void => {
    if (disposed || !armed || closeRequested) return;
    armed = false;
    blurred = true;
  };
  const handleWindowFocus = (
    _event: unknown,
    focusedWindow: TWindow,
  ): void => {
    if (disposed || closeRequested || !blurred) return;
    if (focusedWindow === window) {
      handleFocus();
      return;
    }
    if (window.isDestroyed()) return;
    blurred = false;
    closeRequested = true;
    close();
  };
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    blurred = false;
    window.off("focus", handleFocus);
    window.off("blur", handleBlur);
    window.off("closed", dispose);
    focusSource.off("browser-window-focus", handleWindowFocus);
  }

  window.on("focus", handleFocus);
  window.on("blur", handleBlur);
  window.on("closed", dispose);
  focusSource.on("browser-window-focus", handleWindowFocus);
  return dispose;
}
