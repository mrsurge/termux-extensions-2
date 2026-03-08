export function shouldDropMirrorForHotWindow(lastLocalEditAt, nowMs, hotMs) {
  return !!(hotMs > 0 && lastLocalEditAt > 0 && (nowMs - lastLocalEditAt) < hotMs);
}
