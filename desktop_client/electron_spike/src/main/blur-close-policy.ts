export type BlurCloseWindow = {
  on(event: "focus" | "blur", listener: () => void): unknown;
  off(event: "focus" | "blur", listener: () => void): unknown;
  isDestroyed(): boolean;
  isFocused(): boolean;
};

type Defer = (callback: () => void) => void;

export function installCloseOnBlur(
  window: BlurCloseWindow,
  close: () => void,
  defer: Defer = setImmediate,
): () => void {
  let armed = window.isFocused();
  let focusGeneration = 0;
  let closeRequested = false;

  const handleFocus = (): void => {
    armed = true;
    focusGeneration += 1;
  };
  const handleBlur = (): void => {
    if (!armed || closeRequested) return;
    armed = false;
    const blurredGeneration = focusGeneration;
    defer(() => {
      if (
        closeRequested ||
        window.isDestroyed() ||
        window.isFocused() ||
        blurredGeneration !== focusGeneration
      ) return;
      closeRequested = true;
      close();
    });
  };

  window.on("focus", handleFocus);
  window.on("blur", handleBlur);
  return () => {
    window.off("focus", handleFocus);
    window.off("blur", handleBlur);
  };
}
