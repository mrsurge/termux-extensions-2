import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from '../rpc/contract.ts';
import {
  formatDiffBaseLabel,
  truncateText,
  type ExplorerDiffBaseInfo,
} from '../search/utils.ts';
import type { JsonObject } from '../../rpc/transport.ts';
import { getErrorMessage } from '../utils/errors.ts';

interface ExplorerDiffBaseControllerDeps {
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  toast(message: string): void;
  setGitControlsEnabled(enabled: boolean, showInit?: boolean): void;
  reloadCurrentFile(): void;
  isChangesMode(): boolean;
  refreshChangesResults(force?: boolean): Promise<void> | void;
  getEditorState(): unknown;
}

interface ExplorerCommitChoice {
  hash?: string;
  short_hash?: string;
  summary?: string;
}

interface ExplorerDiffBaseOption {
  ref: string;
  short?: string;
  summary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDiffBase(value: unknown): ExplorerDiffBaseInfo {
  if (!isRecord(value)) {
    return { ref: 'HEAD', mode: 'none', commit: null };
  }
  const commit = isRecord(value.commit) ? value.commit : null;
  return {
    ref: typeof value.ref === 'string' ? value.ref : 'HEAD',
    mode: typeof value.mode === 'string' ? value.mode : 'none',
    commit: commit
      ? {
          hash: typeof commit.hash === 'string' ? commit.hash : undefined,
          short: typeof commit.short === 'string' ? commit.short : undefined,
          subject:
            typeof commit.subject === 'string' ? commit.subject : undefined,
        }
      : null,
  };
}

function hasActiveProject(state: unknown): boolean {
  return Boolean(
    isRecord(state) && state.activeProject && state.activeProjectExists,
  );
}

export function createExplorerDiffBaseController(
  deps: ExplorerDiffBaseControllerDeps,
) {
  let gitDiffBase: ExplorerDiffBaseInfo = {
    ref: 'HEAD',
    mode: 'none',
    commit: null,
  };
  let gitBaseButton: HTMLButtonElement | null = null;
  let gitBaseDropdown: HTMLElement | null = null;

  function getDiffBase(): ExplorerDiffBaseInfo {
    return gitDiffBase;
  }

  function setDiffBase(next: ExplorerDiffBaseInfo): void {
    gitDiffBase = next;
  }

  function setDiffBaseRef(ref: string): void {
    gitDiffBase = {
      ...gitDiffBase,
      ref,
    };
  }

  function updateButtons(): void {
    if (!gitBaseButton) return;
    gitBaseButton.textContent = `${formatDiffBaseLabel(gitDiffBase, true)} ▾`;
    gitBaseButton.disabled = gitDiffBase.mode === 'none';
  }

  function applyGitControlsForState(state: unknown): void {
    const projectExists = hasActiveProject(state);
    if (!projectExists) {
      deps.setGitControlsEnabled(false, false);
    } else if (gitDiffBase.mode === 'none') {
      deps.setGitControlsEnabled(true, true);
    } else {
      deps.setGitControlsEnabled(true, false);
    }
  }

  function hydrateFromEditorState(): void {
    try {
      const state = deps.getEditorState();
      const base = isRecord(state) ? state.gitDiffBase : null;
      if (base) {
        gitDiffBase = normalizeDiffBase(base);
        applyGitControlsForState(state);
      }
    } catch {
      // Non-fatal; backend hydration still follows.
    }
  }

  async function initFromBackend(): Promise<void> {
    try {
      const response = await fetch('/api/app/file_editor_cm6/git/diff_base', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => null);
      const data = isRecord(json) ? json.data : null;
      if (!data) return;
      gitDiffBase = normalizeDiffBase(data);
      updateButtons();
      applyGitControlsForState(deps.getEditorState());
    } catch (error) {
      console.warn('Failed to initialize diff base from backend:', error);
    }
  }

  function closeMenus(except: Element | null = null): void {
    const dropdowns = document.querySelectorAll('#fe-search-base-dd, #fe-git-base-dd');
    dropdowns.forEach((dropdown) => {
      if (dropdown !== except) {
        dropdown.classList.remove('show');
      }
    });
  }

  async function changeDiffBase(ref: string): Promise<void> {
    if (!ref || !deps.hasExplorerRpc()) return;
    try {
      deps.notifyExplorer(EXPLORER_RPC_METHODS.gitDiffBaseSet, { ref });
      if (deps.isChangesMode()) {
        await deps.refreshChangesResults(true);
      }
      deps.reloadCurrentFile();
    } catch (error) {
      deps.toast(getErrorMessage(error, 'Failed to update diff base'));
    }
  }

  function renderDropdown(
    dropdown: HTMLElement,
    commits: readonly ExplorerCommitChoice[],
  ): void {
    dropdown.innerHTML = '';
    if (gitDiffBase.mode === 'none') {
      const empty = document.createElement('div');
      empty.className = 'fe-dd-item';
      empty.style.opacity = '0.65';
      empty.textContent = 'Not a git repository';
      dropdown.appendChild(empty);
      return;
    }

    const options: ExplorerDiffBaseOption[] = [
      { ref: 'HEAD', short: 'HEAD', summary: 'Working tree' },
      ...commits.map((commit) => ({
        ref: commit.hash || '',
        short: commit.short_hash,
        summary: commit.summary,
      })),
    ].filter((option) => option.ref);

    const currentHash = gitDiffBase.commit?.hash;
    const currentRef = gitDiffBase.ref || 'HEAD';
    const hasCurrent = options.some(
      (option) => option.ref === currentHash || option.ref === currentRef,
    );
    if (!hasCurrent && gitDiffBase.commit?.hash) {
      options.unshift({
        ref: gitDiffBase.commit.hash,
        short: gitDiffBase.commit.short,
        summary: gitDiffBase.commit.subject,
      });
    }

    options.forEach((option) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      const isCurrent =
        (option.ref === 'HEAD' && currentRef === 'HEAD') ||
        (option.ref !== 'HEAD' &&
          (option.ref === currentRef || option.ref === currentHash));
      if (isCurrent) {
        item.classList.add('fe-menu-item-checked');
      }
      item.textContent = `${option.short || option.ref} · ${truncateText(
        option.summary || '',
        40,
      )}`;
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenus();
        if (!isCurrent) {
          void changeDiffBase(option.ref);
        }
      });
      dropdown.appendChild(item);
    });
  }

  async function toggleMenu(
    button: HTMLButtonElement,
    dropdown: HTMLElement,
  ): Promise<void> {
    if (button.disabled) return;
    const isOpen = dropdown.classList.contains('show');
    closeMenus(dropdown);
    if (isOpen) {
      dropdown.classList.remove('show');
      return;
    }
    dropdown.innerHTML =
      '<div class="fe-dd-item" style="opacity:0.6">Loading…</div>';
    dropdown.classList.add('show');
    if (gitDiffBase.mode === 'none') {
      renderDropdown(dropdown, []);
      return;
    }
    try {
      const response = await fetch('/api/app/file_editor_cm6/git/commits', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => null);
      if (!json || json.ok === false) {
        throw new Error(
          json?.error || response.statusText || 'Failed to load commits',
        );
      }
      const commits = Array.isArray(json.data)
        ? (json.data as ExplorerCommitChoice[])
        : [];
      renderDropdown(dropdown, commits);
    } catch (error) {
      dropdown.innerHTML = `<div class="fe-dd-item" style="opacity:0.7">${getErrorMessage(
        error,
        'Failed to load commits',
      )}</div>`;
    }
  }

  function bindGitBaseButton(
    button: HTMLButtonElement | null,
    dropdown: HTMLElement | null,
  ): void {
    gitBaseButton = button;
    gitBaseDropdown = dropdown;
    if (!gitBaseButton || !gitBaseDropdown) return;
    gitBaseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleMenu(gitBaseButton!, gitBaseDropdown!);
    });
  }

  function bindGlobalCloseListener(): void {
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        const inBaseButton =
          target instanceof Element &&
          (target.closest('#fe-git-base-btn') ||
            target.closest('#fe-search-base-btn'));
        const inBaseDropdown =
          target instanceof Element &&
          (target.closest('#fe-git-base-dd') ||
            target.closest('#fe-search-base-dd'));
        if (!inBaseButton && !inBaseDropdown) {
          closeMenus();
        }
      },
      false,
    );
  }

  return {
    getDiffBase,
    setDiffBase,
    setDiffBaseRef,
    updateButtons,
    hydrateFromEditorState,
    initFromBackend,
    closeMenus,
    toggleMenu,
    bindGitBaseButton,
    bindGlobalCloseListener,
  };
}
