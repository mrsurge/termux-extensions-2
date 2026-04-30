export function appendBreadcrumbSeparator(doc: Document, parentEl: HTMLElement): void {
  const sep = doc.createElement('span');
  sep.className = 'te2-bc-sep';
  sep.textContent = '\u203A';
  parentEl.appendChild(sep);
}
