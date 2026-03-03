export function getBreadcrumbPathClickTarget(ev) {
  var el = ev.currentTarget;
  return {
    isFile: el.dataset.isFile === '1',
    absDir: el.dataset.path || '',
  };
}
