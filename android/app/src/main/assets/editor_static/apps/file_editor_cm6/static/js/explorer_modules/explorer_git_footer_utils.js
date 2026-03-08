export function createExplorerGitFooterUtils(deps) {
  let prevGitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
  let gitProgressBarEl = null;
  let gitProgressTextEl = null;

  function renderGitSummary() {
    const gitSummaryEl = deps.getGitSummaryElement();
    if (!gitSummaryEl) return;
    const s = deps.getGitStatus();
    if (!s) {
      gitSummaryEl.textContent = 'Git status unavailable.';
      return;
    }
    const branch = s.branch || '(no branch)';
    const detached = !!s.detached;
    const ahead = s.ahead || 0;
    const behind = s.behind || 0;
    const stagedCount = Array.isArray(s.staged) ? s.staged.length : 0;
    const unstagedCount = Array.isArray(s.unstaged) ? s.unstaged.length : 0;
    const untrackedCount = Array.isArray(s.untracked) ? s.untracked.length : 0;

    const changed =
      stagedCount !== prevGitStatus.staged ||
      unstagedCount !== prevGitStatus.unstaged ||
      untrackedCount !== prevGitStatus.untracked ||
      ahead !== prevGitStatus.ahead ||
      behind !== prevGitStatus.behind;

    const bits = [];
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
        if (deps.getGitSummaryElement()) {
          deps.getGitSummaryElement().style.color = '';
        }
      }, 400);
    }

    prevGitStatus = { staged: stagedCount, unstaged: unstagedCount, untracked: untrackedCount, ahead, behind };
  }

  function setGitControlsEnabled(enabled, showInit = false) {
    const gitButtons = deps.getGitButtons();
    if (!gitButtons) return;
    Object.entries(gitButtons).forEach(([key, btn]) => {
      if (!btn) return;
      if (key === 'init') {
        btn.style.display = showInit ? 'inline-block' : 'none';
        btn.disabled = !enabled;
      } else if (key === 'reset') {
        const visible = enabled && !showInit;
        btn.style.display = visible ? 'inline-block' : 'none';
        btn.disabled = !visible;
      } else {
        btn.style.display = showInit ? 'none' : 'inline-block';
        btn.disabled = !enabled || showInit;
      }
    });
  }

  function ensureProgressBarElements() {
    if (!gitProgressBarEl) {
      const footer = document.querySelector('.fe-git-footer');
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
      const summaryRow = document.querySelector('.fe-git-row.fe-git-meta');
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

  function showGitProgressBar(pct, detail) {
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

  function hideGitProgressBar() {
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

  function safeSend(type, payload) {
    if (!deps.hasExplorerBus()) {
      deps.toast('Explorer connection unavailable.');
      return false;
    }
    try {
      deps.sendExplorerBus(type, payload || {});
    } catch (err) {
      deps.toast(err?.message || 'Explorer command failed.');
      return false;
    }
    return true;
  }

  function bindGitFooterActions() {
    const gitButtons = deps.getGitButtons();
    if (!gitButtons) return;

    gitButtons.stage?.addEventListener('click', () => {
      safeSend('git:stageAll', {});
    });

    gitButtons.unstage?.addEventListener('click', () => {
      safeSend('git:unstageAll', {});
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
      safeSend('git:commit', { message: trimmed });
    });

    gitButtons.push?.addEventListener('click', () => {
      if (!window.confirm('Are you sure you want to push changes to remote?')) {
        return;
      }
      safeSend('git:push', {});
    });

    gitButtons.pull?.addEventListener('click', () => {
      if (!window.confirm('Are you sure you want to pull changes from remote?')) {
        return;
      }
      safeSend('git:pull', {});
    });

    gitButtons.reset?.addEventListener('click', () => {
      if (!window.confirm('⚠️ Hard reset will discard ALL uncommitted changes!\n\nReset to HEAD?')) {
        return;
      }
      if (!safeSend('git:reset', { commit: 'HEAD' })) return;
      if (typeof deps.reloadCurrentFile === 'function') {
        try {
          deps.reloadCurrentFile();
        } catch (err) {
          console.warn('Failed to reload current file after reset:', err);
        }
      }
    });

    gitButtons.init?.addEventListener('click', () => {
      if (!window.confirm('Initialize a Git repository in this project?')) {
        return;
      }
      safeSend('git:init', {});
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
