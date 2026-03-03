export function shouldUpdateBreadcrumbPath(absPath, lastPath, deferSymbols) {
  if (!absPath) return false;
  if (absPath === lastPath && !deferSymbols) return false;
  return true;
}
