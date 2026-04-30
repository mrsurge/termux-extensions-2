interface BreadcrumbNamedItem {
  name?: unknown;
  [key: string]: unknown;
}

export function createBreadcrumbSymbolItem(
  doc: Document,
  chainItem: BreadcrumbNamedItem,
  idx: number,
  iconHtml: string,
): HTMLSpanElement {
  const item = doc.createElement('span');
  item.className = 'te2-bc-item';

  const icon = doc.createElement('span');
  icon.className = 'te2-bc-sym-icon';
  icon.innerHTML = iconHtml;
  item.appendChild(icon);

  const label = doc.createElement('span');
  label.textContent = typeof chainItem.name === 'string' ? chainItem.name : '';
  item.appendChild(label);

  item.dataset.symIdx = String(idx);
  return item;
}
