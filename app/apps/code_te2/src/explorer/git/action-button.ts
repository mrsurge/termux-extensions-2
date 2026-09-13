export type GitIcon = 'push' | 'pull' | 'fetch' | 'refresh';

// Fixed, local SVG geometry inherits the host button theme; labels remain
// accessible without relying on emoji fonts or desktop-only hover affordances.
export function gitActionButton(doc: Document, icon: GitIcon, label: string): HTMLButtonElement {
  const paths: Record<GitIcon, string> = {
    push: 'M8 13V3M4 7l4-4 4 4M3 14h10',
    pull: 'M8 2v10M4 8l4 4 4-4M3 14h10',
    fetch: 'M13 6A5 5 0 003 5M3 2v3h3M3 10a5 5 0 0010 1m0 3v-3h-3',
    refresh: 'M13 7a5 5 0 10-1 4M13 3v4H9',
  };
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'fe-btn fe-btn-sm';
  button.title = label; button.setAttribute('aria-label', label);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[icon]);
  svg.append(path); button.append(svg);
  return button;
}
