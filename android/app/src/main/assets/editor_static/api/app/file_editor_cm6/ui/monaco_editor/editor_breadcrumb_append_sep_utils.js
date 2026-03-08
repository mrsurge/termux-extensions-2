export function appendBreadcrumbSeparator(doc, parentEl) {
  var sep = doc.createElement('span');
  sep.className = 'te2-bc-sep';
  sep.textContent = '\u203A';
  parentEl.appendChild(sep);
}
