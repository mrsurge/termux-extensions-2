export interface ExplorerDiagnosticCounts {
  errors: number;
  warnings: number;
}

export type ExplorerDiagnosticsSummary = Record<
  string,
  ExplorerDiagnosticCounts
>;

export type ExplorerDiagnosticsDetail = Record<string, unknown>;

interface ExplorerTreeDecorationsDeps {
  getTreeElement(): HTMLElement | null;
  setTreeElement(next: HTMLElement | null): void;
}

export interface ExplorerTreeDecorationsController {
  applyAggregatedGitStatusFlags(): void;
  setDiagnosticsSummary(next: unknown): void;
  applyAggregatedDiagnosticFlags(): void;
  applyDraftDecorations(payload: unknown): void;
  applyGitDecorations(payload: unknown): void;
  setDiagnosticsDetail(next: unknown): void;
  getDiagnosticsDetail(): ExplorerDiagnosticsDetail;
  deriveSummaryFromDetail(projectPath: string): ExplorerDiagnosticsSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getDiagnosticCounts(value: unknown): ExplorerDiagnosticCounts {
  if (!isRecord(value)) {
    return { errors: 0, warnings: 0 };
  }
  return {
    errors: Number(value.errors || 0),
    warnings: Number(value.warnings || 0),
  };
}

function hasDraftInfo(value: unknown): boolean {
  return isRecord(value) && value.hasDraft === true;
}

export function createExplorerTreeDecorationsController(
  deps: ExplorerTreeDecorationsDeps,
): ExplorerTreeDecorationsController {
  let diagnosticsByRel: ExplorerDiagnosticsSummary = {};
  let diagHasErrors = false;
  let diagHasWarnings = false;
  let diagErrorDirs = new Set<string>();
  let diagWarningDirs = new Set<string>();
  let explorerDiagDetail: ExplorerDiagnosticsDetail = {};

  function getTreeRoot(): HTMLElement | null {
    const existing = deps.getTreeElement();
    if (existing) {
      return existing;
    }
    const next = document.getElementById('fe-file-tree');
    deps.setTreeElement(next);
    return next;
  }

  function queryNodeByRel(
    root: ParentNode,
    kind: 'file' | 'dir',
    rel: string,
  ): HTMLLIElement | null {
    if (!rel) {
      return null;
    }
    try {
      const escaped =
        window.CSS && typeof CSS.escape === 'function'
          ? CSS.escape(rel)
          : null;
      if (escaped) {
        const match = root.querySelector<HTMLLIElement>(
          `li.fe-tree-node[data-kind="${kind}"][data-rel="${escaped}"]`,
        );
        if (match) {
          return match;
        }
      }
    } catch {
      // Fall back to a manual scan.
    }
    for (const li of root.querySelectorAll<HTMLLIElement>(
      `li.fe-tree-node[data-kind="${kind}"]`,
    )) {
      if ((li.dataset.rel || '') === rel) {
        return li;
      }
    }
    return null;
  }

  function applyAggregatedGitStatusFlags(): void {
    const root = getTreeRoot();
    if (!root) return;

    root.querySelectorAll<HTMLLIElement>('li.fe-tree-node[data-kind="dir"]').forEach((li) => {
      li.classList.remove(
        'fe-dir-has-modified',
        'fe-dir-has-staged',
        'fe-dir-has-untracked',
        'fe-dir-has-conflict',
      );
      if (!li.dataset.hasDraft) {
        li.classList.remove('fe-dir-has-draft');
      }
    });

    const nodesWithStatus = root.querySelectorAll<HTMLLIElement>(
      'li.fe-tree-node[data-git-status], li.fe-tree-node[data-git-flags]',
    );
    nodesWithStatus.forEach((node) => {
      const statusesToPropagate = new Set<string>();
      const status = node.dataset.gitStatus || '';
      if (status && status !== 'clean') {
        statusesToPropagate.add(status);
      }

      const flagsStr = node.dataset.gitFlags || '';
      if (flagsStr) {
        flagsStr.split(',').forEach((flag) => {
          if (flag) {
            statusesToPropagate.add(flag);
          }
        });
      }

      if (statusesToPropagate.size === 0) {
        return;
      }

      let current =
        node.dataset.kind === 'dir'
          ? node
          : node.parentElement?.closest<HTMLLIElement>(
              'li.fe-tree-node[data-kind="dir"]',
            ) || null;

      while (current) {
        const dirNode = current;
        statusesToPropagate.forEach((value) => {
          if (
            value === 'modified' ||
            value === 'staged_modified' ||
            value === 'deleted' ||
            value === 'renamed'
          ) {
            dirNode.classList.add('fe-dir-has-modified');
          }
          if (value === 'untracked') {
            dirNode.classList.add('fe-dir-has-untracked');
          }
          if (
            value === 'staged' ||
            value === 'staged_modified' ||
            value === 'added'
          ) {
            dirNode.classList.add('fe-dir-has-staged');
          }
          if (value === 'conflict') {
            dirNode.classList.add('fe-dir-has-conflict');
          }
        });

        current =
          dirNode.parentElement?.closest<HTMLLIElement>(
            'li.fe-tree-node[data-kind="dir"]',
          ) || null;
      }
    });

    root
      .querySelectorAll<HTMLLIElement>(
        'li.fe-tree-node.fe-draft, li.fe-tree-node.fe-dir-has-draft',
      )
      .forEach((node) => {
        let current =
          node.parentElement?.closest<HTMLLIElement>(
            'li.fe-tree-node[data-kind="dir"]',
          ) || null;
        while (current) {
          current.classList.add('fe-dir-has-draft');
          current =
            current.parentElement?.closest<HTMLLIElement>(
              'li.fe-tree-node[data-kind="dir"]',
            ) || null;
        }
      });
  }

  function setDiagnosticsSummary(next: unknown): void {
    const normalized: ExplorerDiagnosticsSummary = {};
    if (isRecord(next)) {
      Object.entries(next).forEach(([rel, counts]) => {
        normalized[rel] = getDiagnosticCounts(counts);
      });
    }
    diagnosticsByRel = normalized;
    diagHasErrors = false;
    diagHasWarnings = false;
    diagErrorDirs = new Set<string>();
    diagWarningDirs = new Set<string>();

    Object.entries(normalized).forEach(([rel, counts]) => {
      const { errors, warnings } = counts;
      if (errors <= 0 && warnings <= 0) return;
      if (errors > 0) diagHasErrors = true;
      if (warnings > 0) diagHasWarnings = true;

      const parts = String(rel || '').split('/');
      for (let i = 1; i < parts.length; i += 1) {
        const dirRel = parts.slice(0, i).join('/');
        if (errors > 0) diagErrorDirs.add(dirRel);
        if (warnings > 0) diagWarningDirs.add(dirRel);
      }
    });
  }

  function applyAggregatedDiagnosticFlags(): void {
    const root = getTreeRoot();
    if (!root) return;

    root.querySelectorAll<HTMLLIElement>('li.fe-tree-node').forEach((li) => {
      li.classList.remove(
        'fe-diag-error',
        'fe-diag-warning',
        'fe-dir-has-diag-error',
        'fe-dir-has-diag-warning',
      );
      delete li.dataset.diagErrors;
      delete li.dataset.diagWarnings;
    });

    try {
      Object.entries(diagnosticsByRel).forEach(([rel, counts]) => {
        const { errors, warnings } = getDiagnosticCounts(counts);
        if (errors <= 0 && warnings <= 0) return;

        const li = queryNodeByRel(root, 'file', rel);
        if (!li) return;
        if (errors > 0) {
          li.classList.add('fe-diag-error');
          li.dataset.diagErrors = String(errors);
        }
        if (warnings > 0) {
          li.classList.add('fe-diag-warning');
          li.dataset.diagWarnings = String(warnings);
        }
      });
    } catch {
      // Ignore partial DOM races while the tree is re-rendering.
    }

    new Set([...diagErrorDirs, ...diagWarningDirs]).forEach((dirRel) => {
      const li = queryNodeByRel(root, 'dir', dirRel);
      if (!li) return;
      if (diagErrorDirs.has(dirRel)) li.classList.add('fe-dir-has-diag-error');
      if (diagWarningDirs.has(dirRel)) {
        li.classList.add('fe-dir-has-diag-warning');
      }
    });

    const rootLi = root.querySelector<HTMLLIElement>('li.fe-tree-node.fe-tree-root');
    if (rootLi) {
      if (diagHasErrors) rootLi.classList.add('fe-dir-has-diag-error');
      if (diagHasWarnings) rootLi.classList.add('fe-dir-has-diag-warning');
    }

    root.querySelectorAll<HTMLLIElement>('li.fe-tree-node').forEach((li) => {
      const textSpan = li.querySelector<HTMLElement>('.fe-tree-text');
      if (!textSpan) return;

      let mark = textSpan.querySelector<HTMLSpanElement>('.fe-diag-mark');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'fe-diag-mark';
        textSpan.appendChild(mark);
      }

      if (
        li.classList.contains('fe-diag-error') ||
        li.classList.contains('fe-dir-has-diag-error')
      ) {
        mark.textContent = ' 🔴';
      } else if (
        li.classList.contains('fe-diag-warning') ||
        li.classList.contains('fe-dir-has-diag-warning')
      ) {
        mark.textContent = ' 🟡';
      } else {
        mark.textContent = '';
      }
    });
  }

  function applyDraftDecorations(payload: unknown): void {
    const drafts = isRecord(payload) && isRecord(payload.drafts) ? payload.drafts : {};
    const root = getTreeRoot();
    if (!root) return;

    root.querySelectorAll<HTMLLIElement>('li.fe-tree-node').forEach((li) => {
      li.classList.remove('fe-draft', 'fe-dir-has-draft');
      if (li.dataset.hasDraft) {
        delete li.dataset.hasDraft;
      }
    });

    Object.entries(drafts).forEach(([rel, info]) => {
      if (!hasDraftInfo(info)) return;
      const li = queryNodeByRel(root, 'file', rel);
      if (!li) return;
      li.dataset.hasDraft = '1';
      li.classList.add('fe-draft');
    });

    const draftDirs = new Set<string>();
    Object.entries(drafts).forEach(([rel, info]) => {
      if (!hasDraftInfo(info)) return;
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        draftDirs.add(parts.slice(0, i).join('/'));
      }
    });
// TE2_search_canary_#2
    draftDirs.forEach((dirRel) => {
      const li = queryNodeByRel(root, 'dir', dirRel);
      if (!li) return;
      li.dataset.hasDraft = '1';
      li.classList.add('fe-dir-has-draft');
    });

    if (draftDirs.size > 0 || Object.keys(drafts).length > 0) {
      const rootLi = root.querySelector<HTMLLIElement>('li.fe-tree-node.fe-tree-root');
      if (rootLi) {
        rootLi.dataset.hasDraft = '1';
        rootLi.classList.add('fe-dir-has-draft');
      }
    }
  }

  function applyGitDecorations(payload: unknown): void {
    const statuses =
      isRecord(payload) && isRecord(payload.statuses) ? payload.statuses : {};
    const root = getTreeRoot();
    if (!root) return;

    const outlineStatuses = new Set([
      'modified',
      'staged',
      'staged_modified',
      'added',
      'deleted',
      'renamed',
      'conflict',
    ]);
    const stagedStatuses = new Set(['staged', 'staged_modified', 'added']);

    root.querySelectorAll<HTMLLIElement>('li.fe-tree-node').forEach((li) => {
      const classesToRemove: string[] = [];
      li.classList.forEach((cls) => {
        if (
          cls.startsWith('fe-git-') ||
          (cls.startsWith('fe-dir-has-') &&
            !cls.includes('draft') &&
            !cls.includes('diag'))
        ) {
          classesToRemove.push(cls);
        }
      });
      classesToRemove.forEach((cls) => li.classList.remove(cls));
      delete li.dataset.gitStatus;
      delete li.dataset.gitFlags;
    });

    Object.entries(statuses).forEach(([rel, status]) => {
      if (typeof status !== 'string' || status === 'clean') return;
      const li = queryNodeByRel(root, 'file', rel);
      if (!li) return;
      li.dataset.gitStatus = status;
      li.classList.add(`fe-git-${status}`);
    });

    const modifiedDirs = new Set<string>();
    const stagedDirs = new Set<string>();
    const untrackedDirs = new Set<string>();

    Object.entries(statuses).forEach(([rel, status]) => {
      if (typeof status !== 'string' || status === 'clean') return;
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        const dirRel = parts.slice(0, i).join('/');
        if (outlineStatuses.has(status)) {
          modifiedDirs.add(dirRel);
        }
        if (stagedStatuses.has(status)) {
          stagedDirs.add(dirRel);
        }
        if (status === 'untracked') {
          untrackedDirs.add(dirRel);
        }
      }
    });

    new Set([...modifiedDirs, ...stagedDirs, ...untrackedDirs]).forEach(
      (dirRel) => {
        const li = queryNodeByRel(root, 'dir', dirRel);
        if (!li) return;

        if (modifiedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-modified');
          li.classList.add('fe-git-modified');
          li.dataset.gitStatus = 'modified';
        }
        if (stagedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-staged');
        }
        if (untrackedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-untracked');
          if (!modifiedDirs.has(dirRel)) {
            li.classList.add('fe-git-untracked');
            li.dataset.gitStatus = li.dataset.gitStatus || 'untracked';
          }
        }
      },
    );

    const rootLi = root.querySelector<HTMLLIElement>('li.fe-tree-node.fe-tree-root');
    if (rootLi) {
      if (modifiedDirs.size > 0) {
        rootLi.classList.add('fe-git-modified');
        rootLi.classList.add('fe-dir-has-modified');
      }
      if (stagedDirs.size > 0) {
        rootLi.classList.add('fe-dir-has-staged');
      }
      if (untrackedDirs.size > 0) {
        rootLi.classList.add('fe-dir-has-untracked');
        if (modifiedDirs.size === 0) {
          rootLi.classList.add('fe-git-untracked');
        }
      }
    }

    applyAggregatedDiagnosticFlags();
  }

  function setDiagnosticsDetail(next: unknown): void {
    explorerDiagDetail = isRecord(next) ? next : {};
  }

  function getDiagnosticsDetail(): ExplorerDiagnosticsDetail {
    return explorerDiagDetail;
  }

  function deriveSummaryFromDetail(
    projectPath: string,
  ): ExplorerDiagnosticsSummary {
    const normalizedProjectPath = projectPath.replace(/\/+$/, '');
    const summary: ExplorerDiagnosticsSummary = {};
    Object.entries(explorerDiagDetail).forEach(([absPath, markers]) => {
      if (!Array.isArray(markers) || markers.length === 0) return;
      const rel =
        normalizedProjectPath &&
        absPath.startsWith(`${normalizedProjectPath}/`)
          ? absPath.slice(normalizedProjectPath.length + 1)
          : absPath;
      if (!summary[rel]) {
        summary[rel] = { errors: 0, warnings: 0 };
      }
      markers.forEach((marker) => {
        const severity =
          isRecord(marker) && typeof marker.severity === 'number'
            ? marker.severity
            : 0;
        if (severity === 8) {
          summary[rel].errors += 1;
        } else if (severity === 4) {
          summary[rel].warnings += 1;
        }
      });
    });
    return summary;
  }

  return {
    applyAggregatedGitStatusFlags,
    setDiagnosticsSummary,
    applyAggregatedDiagnosticFlags,
    applyDraftDecorations,
    applyGitDecorations,
    setDiagnosticsDetail,
    getDiagnosticsDetail,
    deriveSummaryFromDetail,
  };
}
