export function shouldDropMirrorForHotWindow(lastLocalEditAt: number, nowMs: number, hotMs: number): boolean {
  return !!(hotMs > 0 && lastLocalEditAt > 0 && (nowMs - lastLocalEditAt) < hotMs);
}
