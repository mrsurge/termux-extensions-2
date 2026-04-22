export function shouldDropMirrorForPath(payloadPath: unknown, currentPath: string | null | undefined): boolean {
  return !!(currentPath && String(payloadPath) !== String(currentPath));
}
