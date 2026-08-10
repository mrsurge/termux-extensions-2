export function shouldApplyMirrorPath(
  currentPath: string | null | undefined,
  nextPath: string | null | undefined,
): boolean {
  if (currentPath && nextPath && String(nextPath) !== String(currentPath)) return false;
  return true;
}
