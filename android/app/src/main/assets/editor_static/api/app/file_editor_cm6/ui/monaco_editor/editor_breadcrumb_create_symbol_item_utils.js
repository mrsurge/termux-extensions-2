export function createBreadcrumbSymbolItem(doc, chainItem, idx, iconHtml) {
  var sitem = doc.createElement('span');
  sitem.className = 'te2-bc-item';
  var si = doc.createElement('span');
  si.className = 'te2-bc-sym-icon';
  si.innerHTML = iconHtml;
  sitem.appendChild(si);
  var slabel = doc.createElement('span');
  slabel.textContent = chainItem.name || '';
  sitem.appendChild(slabel);
  sitem.dataset.symIdx = String(idx);
  return sitem;
}
