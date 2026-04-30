export function shouldUpdateBreadcrumbPath(
  absPath: string | null | undefined,
  lastPath: string | null,
  deferSymbols?: boolean,
): boolean {
  if (!absPath) return false;
  if (absPath === lastPath && !deferSymbols) return false;
  return true;
}
