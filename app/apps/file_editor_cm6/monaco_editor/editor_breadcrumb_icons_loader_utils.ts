interface BreadcrumbIconModule {
  ensureLoaded(): void;
  getIcon: (...args: unknown[]) => unknown;
}

export function loadBreadcrumbIcons(
  dynamicImportFn: (path: string) => Promise<BreadcrumbIconModule>,
  onLoaded: (getIcon: (...args: unknown[]) => unknown) => void,
  onError?: ((error: unknown) => void) | null,
): Promise<void> {
  return dynamicImportFn('/static/vendor/seti-icons/seti-icons.js')
    .then((mod) => {
      mod.ensureLoaded();
      onLoaded(mod.getIcon);
    })
    .catch((error) => {
      if (typeof onError === 'function') onError(error);
    });
}
