export function createBreadcrumbPathItem(
  doc: Document,
  accumPath: string,
  isFile: boolean,
): HTMLSpanElement {
  const item = doc.createElement('span');
  item.className = 'te2-bc-item';
  item.dataset.path = accumPath;
  item.dataset.isFile = isFile ? '1' : '0';
  return item;
}
