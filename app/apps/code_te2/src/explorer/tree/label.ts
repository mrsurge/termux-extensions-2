export type ExplorerTreeDiagnosticSeverity = 'error' | 'warning' | null;

function basenameFromRel(rel: string): string {
  const normalized = rel.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === '.') {
    return '';
  }
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function getCanonicalTreeNodeName(node: HTMLLIElement): string {
  if (typeof node.dataset.name === 'string' && node.dataset.name) {
    return node.dataset.name;
  }
  return basenameFromRel(node.dataset.rel || '');
}

export function renderExplorerTreeLabel(
  container: HTMLElement,
  name: string,
): void {
  container.replaceChildren();

  const label = document.createElement('span');
  label.className = 'fe-tree-label-text';
  label.textContent = name;

  const diagnostic = document.createElement('span');
  diagnostic.className = 'fe-diag-mark';
  diagnostic.setAttribute('aria-hidden', 'true');

  container.append(label, diagnostic);
}

export function getTreeNodeDiagnosticSeverity(
  node: HTMLLIElement,
): ExplorerTreeDiagnosticSeverity {
  if (
    node.classList.contains('fe-diag-error') ||
    node.classList.contains('fe-dir-has-diag-error')
  ) {
    return 'error';
  }
  if (
    node.classList.contains('fe-diag-warning') ||
    node.classList.contains('fe-dir-has-diag-warning')
  ) {
    return 'warning';
  }
  return null;
}
