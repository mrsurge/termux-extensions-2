export function getBreadcrumbSymbolClickPosition(ev) {
  var el = ev.currentTarget;
  var line = parseInt(el.dataset.line, 10);
  var col = parseInt(el.dataset.col, 10) || 1;
  return { line: line, col: col };
}
