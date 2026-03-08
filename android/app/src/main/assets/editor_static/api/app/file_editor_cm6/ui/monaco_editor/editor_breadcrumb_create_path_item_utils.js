export function createBreadcrumbPathItem(doc, accumPath, isFile) {
  var item = doc.createElement('span');
  item.className = 'te2-bc-item';
  item.dataset.path = accumPath;
  item.dataset.isFile = isFile ? '1' : '0';
  return item;
}
