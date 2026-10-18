export type RemoteGitAction = 'push' | 'pull' | 'fetch';

// Geometry shared with Code TE2's explorer/git/action-button.ts.
export function projectGitButton(doc: Document, action: RemoteGitAction): HTMLButtonElement {
  const paths: Record<RemoteGitAction, string> = {
    push: 'M8 13V3M4 7l4-4 4 4M3 14h10',
    pull: 'M8 2v10M4 8l4 4 4-4M3 14h10',
    fetch: 'M13 6A5 5 0 003 5M3 2v3h3M3 10a5 5 0 0010 1m0 3v-3h-3',
  };
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `btn ghost project-git-remote ${action}`;
  button.dataset.remoteAction = action;
  button.title = action === 'pull' ? 'Pull (fast-forward only)' : `${action[0].toUpperCase()}${action.slice(1)}`;
  button.setAttribute('aria-label', button.title);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = doc.createElementNS(svg.namespaceURI!, 'path');
  path.setAttribute('d', paths[action]);
  svg.append(path);
  button.append(svg);
  return button;
}
