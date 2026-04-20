import { EXPLORER_RPC_METHODS, type ExplorerRpcMethod } from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';
import { getErrorMessage } from '../utils/errors.ts';

type ExplorerGitButtonKey =
  | 'stage'
  | 'unstage'
  | 'commit'
  | 'push'
  | 'pull'
  | 'reset'
  | 'init';

type ExplorerGitButtons = Partial<
  Record<ExplorerGitButtonKey, HTMLButtonElement | null>
>;

export interface ExplorerGitStatus {
  branch?: string;
  detached?: boolean;
  ahead?: number;
  behind?: number;
  staged?: unknown[];
  unstaged?: unknown[];
  untracked?: unknown[];
}

interface ExplorerGitFooterUtilsDeps {
  getGitSummaryElement(): HTMLElement | null;
  getGitStatus(): ExplorerGitStatus | null;
  getGitButtons(): ExplorerGitButtons | null;
  hasExplorerBus(): boolean;
  sendExplorerBus(method: ExplorerRpcMethod, payload: JsonObject): void;
  toast(message: string): void;
  reloadCurrentFile?(): void;
}

interface ExplorerGitSummaryCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

const GIT_BUTTON_KEYS: ExplorerGitButtonKey[] = [
  'stage',
  'unstage',
  'commit',
  'push',
  'pull',
  'reset',
  'init',
];

export function createExplorerGitFooterUtils(
  deps: ExplorerGitFooterUtilsDeps,
) {
  let prevGitStatus: ExplorerGitSummaryCounts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
  };
  let gitProgressBarEl: HTMLDivElement | null = null;
  let gitProgressTextEl: HTMLSpanElement | null = null;

  function renderGitSummary(): void {
    const gitSummaryEl = deps.getGitSummaryElement();
    if (!gitSummaryEl) return;
    const status = deps.getGitStatus();
    if (!status) {
      gitSummaryEl.textContent = 'Git status unavailable.';
      return;
    }

    const branch = status.branch || '(no branch)';
    const detached = status.detached === true;
    const ahead = typeof status.ahead === 'number' ? status.ahead : 0;
    const behind = typeof status.behind === 'number' ? status.behind : 0;
    const stagedCount = Array.isArray(status.staged) ? status.staged.length : 0;
    const unstagedCount = Array.isArray(status.unstaged)
      ? status.unstaged.length
      : 0;
    const untrackedCount = Array.isArray(status.untracked)
      ? status.untracked.length
      : 0;

    const changed =
      stagedCount !== prevGitStatus.staged ||
      unstagedCount !== prevGitStatus.unstaged ||
      untrackedCount !== prevGitStatus.untracked ||
      ahead !== prevGitStatus.ahead ||
      behind !== prevGitStatus.behind;

    const bits: string[] = [];
    bits.push(detached ? 'DETACHED HEAD' : branch);
    if (ahead) bits.push(`↑${ahead}`);
    if (behind) bits.push(`↓${behind}`);

    const counts = `staged ${stagedCount} · changes ${unstagedCount} · untracked ${untrackedCount}`;
    gitSummaryEl.textContent = `${bits.join(' ')} · ${counts}`;

    if (
      changed &&
      (prevGitStatus.staged !== 0 ||
        prevGitStatus.unstaged !== 0 ||
        prevGitStatus.untracked !== 0)
    ) {
      gitSummaryEl.style.transition = 'color 0.15s ease';
      gitSummaryEl.style.color = '#60a5fa';
      setTimeout(() => {
        deps.getGitSummaryElement()?.style.setProperty('color', '');
      }, 400);
    }

    prevGitStatus = {
      staged: stagedCount,
      unstaged: unstagedCount,
      untracked: untrackedCount,
      ahead,
      behind,
    };
  }

  function setGitControlsEnabled(enabled: boolean, showInit = false): void {
    const gitButtons = deps.getGitButtons();
    if (!gitButtons) return;
    for (const key of GIT_BUTTON_KEYS) {
      const button = gitButtons[key];
      if (!button) continue;
      if (key === 'init') {
        button.style.display = showInit ? 'inline-block' : 'none';
        button.disabled = !enabled;
      } else if (key === 'reset') {
        const visible = enabled && !showInit;
        button.style.display = visible ? 'inline-block' : 'none';
        button.disabled = !visible;
      } else {
        button.style.display = showInit ? 'none' : 'inline-block';
        button.disabled = !enabled || showInit;
      }
    }
  }

  function ensureProgressBarElements(): void {
    if (!gitProgressBarEl) {
      const footer = document.querySelector<HTMLElement>('.fe-git-footer');
      if (footer) {
        gitProgressBarEl = document.createElement('div');
        gitProgressBarEl.className = 'fe-git-progress-bar';
        gitProgressBarEl.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
          transition: width 0.2s ease, opacity 0.3s ease;
          z-index: 10;
          pointer-events: none;
          opacity: 1;
        `;
        footer.style.position = 'relative';
        footer.insertBefore(gitProgressBarEl, footer.firstChild);
      }
    }

    if (!gitProgressTextEl) {
      const summaryRow = document.querySelector<HTMLElement>(
        '.fe-git-row.fe-git-meta',
      );
      if (summaryRow) {
        gitProgressTextEl = document.createElement('span');
        gitProgressTextEl.className = 'fe-git-progress-text';
        gitProgressTextEl.style.cssText = `
          margin-left: auto;
          font-size: 0.6em;
          color: #60a5fa;
          white-space: nowrap;
          opacity: 0;
          transition: opacity 0.3s ease;
        `;
        summaryRow.appendChild(gitProgressTextEl);
      }
    }
  }

  function showGitProgressBar(pct: number, detail?: string): void {
    ensureProgressBarElements();
    if (gitProgressBarEl) {
      gitProgressBarEl.style.opacity = '1';
      gitProgressBarEl.style.height = '3px';
      gitProgressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
    if (gitProgressTextEl) {
      gitProgressTextEl.style.opacity = '1';
      gitProgressTextEl.textContent = detail || `${pct}%`;
    }
  }

  function hideGitProgressBar(): void {
    if (gitProgressBarEl) {
      gitProgressBarEl.style.opacity = '0';
      setTimeout(() => {
        if (gitProgressBarEl && gitProgressBarEl.style.opacity === '0') {
          gitProgressBarEl.style.width = '0';
          gitProgressBarEl.style.height = '0';
        }
      }, 300);
    }
    if (gitProgressTextEl) {
      gitProgressTextEl.style.opacity = '0';
      setTimeout(() => {
        if (gitProgressTextEl && gitProgressTextEl.style.opacity === '0') {
          gitProgressTextEl.textContent = '';
        }
      }, 300);
    }
  }

  function safeSend(method: ExplorerRpcMethod, payload: JsonObject = {}): boolean {
    if (!deps.hasExplorerBus()) {
      deps.toast('Explorer connection unavailable.');
      return false;
    }
    try {
      deps.sendExplorerBus(method, payload);
    } catch (error) {
      deps.toast(getErrorMessage(error, 'Explorer command failed.'));
      return false;
    }
    return true;
  }

  function bindGitFooterActions(): void {
    const gitButtons = deps.getGitButtons();
    if (!gitButtons) return;

    gitButtons.stage?.addEventListener('click', () => {
      safeSend(EXPLORER_RPC_METHODS.gitStageAll, {});
    });

    gitButtons.unstage?.addEventListener('click', () => {
      safeSend(EXPLORER_RPC_METHODS.gitUnstageAll, {});
    });

    gitButtons.commit?.addEventListener('click', () => {
      const status = deps.getGitStatus();
      const stagedCount = Array.isArray(status?.staged) ? status.staged.length : 0;
      if (!stagedCount) {
        deps.toast('No staged changes to commit.');
        return;
      }
      const message = window.prompt('Commit message');
      if (!message) return;
      const trimmed = message.trim();
      if (!trimmed) {
        deps.toast('Commit message cannot be empty.');
        return;
      }
      safeSend(EXPLORER_RPC_METHODS.gitCommit, { message: trimmed });
    });

    gitButtons.push?.addEventListener('click', () => {
      if (!window.confirm('Are you sure you want to push changes to remote?')) {
        return;
      }
      safeSend(EXPLORER_RPC_METHODS.gitPush, {});
    });

    gitButtons.pull?.addEventListener('click', () => {
      if (!window.confirm('Are you sure you want to pull changes from remote?')) {
        return;
      }
      safeSend(EXPLORER_RPC_METHODS.gitPull, {});
    });

    gitButtons.reset?.addEventListener('click', () => {
      if (!window.confirm('⚠️ Hard reset will discard ALL uncommitted changes!\n\nReset to HEAD?')) {
        return;
      }
      if (!safeSend(EXPLORER_RPC_METHODS.gitReset, { commit: 'HEAD' })) return;
      try {
        deps.reloadCurrentFile?.();
      } catch (error) {
        console.warn('Failed to reload current file after reset:', error);
      }
    });

    gitButtons.init?.addEventListener('click', () => {
      if (!window.confirm('Initialize a Git repository in this project?')) {
        return;
      }
      safeSend(EXPLORER_RPC_METHODS.gitInit, {});
    });
  }

  return {
    renderGitSummary,
    setGitControlsEnabled,
    showGitProgressBar,
    hideGitProgressBar,
    bindGitFooterActions,
  };
}
