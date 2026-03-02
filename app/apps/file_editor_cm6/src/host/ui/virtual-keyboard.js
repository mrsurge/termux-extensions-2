// @ts-check

/**
 * @param {{ root: HTMLElement | null }} params
 */
export function initVirtualKeyboardAdjustments({ root }) {
  if (!root) return;

  const docEl = document.documentElement;
  const viewport = window.visualViewport;

  const getViewportHeight = () => {
    if (viewport) return viewport.height;
    return window.innerHeight || docEl.clientHeight || 0;
  };

  let baselineHeight = getViewportHeight() || window.innerHeight || docEl.clientHeight || 0;
  let keyboardActive = false;

  const updateKeyboardState = () => {
    const currentHeight = getViewportHeight();
    if (!currentHeight) return;

    const diff = baselineHeight - currentHeight;
    const likelyKeyboard = diff > 150;
    if (likelyKeyboard !== keyboardActive) {
      keyboardActive = likelyKeyboard;
      root.classList.toggle('keyboard-open', keyboardActive);
    }

    if (currentHeight > baselineHeight) baselineHeight = currentHeight;
  };

  if (viewport) viewport.addEventListener('resize', updateKeyboardState);
  else window.addEventListener('resize', updateKeyboardState);

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      baselineHeight = getViewportHeight() || window.innerHeight || baselineHeight;
      updateKeyboardState();
    }, 250);
  });

  updateKeyboardState();
}
