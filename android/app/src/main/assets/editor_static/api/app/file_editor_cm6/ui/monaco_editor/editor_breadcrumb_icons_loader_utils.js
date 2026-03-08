export function loadBreadcrumbIcons(dynamicImportFn, onLoaded, onError) {
  return dynamicImportFn('/static/vendor/seti-icons/seti-icons.js')
    .then(function(mod) {
      mod.ensureLoaded();
      onLoaded(mod.getIcon);
    })
    .catch(function(e) {
      if (typeof onError === 'function') onError(e);
    });
}
