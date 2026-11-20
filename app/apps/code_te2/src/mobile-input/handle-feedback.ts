const lensKey = 'te2.codeTe2.selectionMagnifier'
const hapticsKey = 'te2.codeTe2.touchHaptics'
export const TOUCH_HAPTIC_MS = 1

export function touchHapticsEnabled(): boolean {
  try { return window.localStorage.getItem(hapticsKey) !== 'false' }
  catch { return true }
}

export function getHandleFeedback() {
  let magnifier = true
  try {
    magnifier = localStorage.getItem(lensKey) !== 'false'
  } catch { /* Storage can be disabled for embedded editors. */ }
  return { magnifier, vibrationMs: touchHapticsEnabled() ? TOUCH_HAPTIC_MS : 0 }
}

export function setSelectionMagnifier(enabled: boolean): void {
  localStorage.setItem(lensKey, String(enabled))
}

export function setTouchHaptics(enabled: boolean): void {
  window.localStorage.setItem(hapticsKey, String(enabled))
}
