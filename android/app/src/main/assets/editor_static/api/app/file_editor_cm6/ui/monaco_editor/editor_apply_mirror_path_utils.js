export function shouldApplyMirrorPath(currentPath, nextPath) {
  if (currentPath && nextPath && String(nextPath) !== String(currentPath)) return false;
  return true;
}
