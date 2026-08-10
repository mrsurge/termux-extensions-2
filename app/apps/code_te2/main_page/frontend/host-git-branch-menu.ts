// Host branch menu wiring for Code CM6.
// Minimal branch menu wiring for Code CM6. Front-end logic stays thin
// and delegates all Git work to backend endpoints.

import { UI_IPC_RPC_METHODS, type UiIpcRpcMethod } from '../../src/ui_ipc/rpc_contract.ts';
import type { JsonObject } from '../../src/rpc/transport.ts';

interface HostBranchMenuWindow extends Window {
  __codeTe2ReloadCurrentFile?: () => void;
  __codeTe2SyncState?: (force?: boolean) => void;
  __codeTe2EditorState?: { projectOrigin?: string };
}

interface BranchListResponse {
  current?: string;
  branches?: string[];
}

interface BranchMenuController {
  close(): void;
  refresh(): Promise<void>;
}

interface BranchMenuDeps {
  requestUiIpc(method: UiIpcRpcMethod, params?: JsonObject, timeoutMs?: number): Promise<unknown>;
}

function hostWindow(): HostBranchMenuWindow {
  return window as HostBranchMenuWindow;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asBranchListResponse(value: unknown): BranchListResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    current: typeof record.current === 'string' ? record.current : undefined,
    branches: Array.isArray(record.branches)
      ? record.branches.filter((branch): branch is string => typeof branch === 'string')
      : undefined,
  };
}

function toast(message: string): void {
  const win = hostWindow();
  if (win.host && typeof win.host.toast === 'function') {
    win.host.toast(message);
  } else {
    console.log(message);
  }
}

export function initBranchMenu(deps: BranchMenuDeps): BranchMenuController {
  const btn = document.getElementById('menu-branch-btn');
  const dropdown = document.getElementById('menu-branch-dd');
  const branchLabel = document.getElementById('menu-branch-label');
  if (!btn || !dropdown || !branchLabel) {
    return { close: () => {}, refresh: () => Promise.resolve() };
  }
  const btnEl = btn;
  const dropdownEl = dropdown;
  const branchLabelEl = branchLabel;

  function closeDropdown(): void {
    dropdownEl.classList.remove('show');
  }

  function setLabel(current?: string): void {
    const label = current ? `Git branch: ${current}` : 'Git branches';
    branchLabelEl.textContent = label;
    btnEl.title = label;
    btnEl.setAttribute('aria-label', label);
  }

  async function loadBranches(showDropdown = false): Promise<void> {
    try {
      const data = asBranchListResponse(await deps.requestUiIpc(UI_IPC_RPC_METHODS.hostGitBranchesList));
      setLabel(data.current);
      if (showDropdown) {
        renderDropdown(data.current, data.branches || []);
        dropdownEl.classList.add('show');
      }
    } catch (err) {
      toast(errorMessage(err, 'Unable to load branches'));
    }
  }

  async function checkoutBranch(name: string): Promise<void> {
    try {
      await deps.requestUiIpc(UI_IPC_RPC_METHODS.hostGitBranchCheckout, { name });
      await loadBranches(false);
      toast(`Checked out ${name}`);
      // Reload file to reflect changes
      const reloadCurrentFile = hostWindow().__codeTe2ReloadCurrentFile;
      if (typeof reloadCurrentFile === 'function') {
        reloadCurrentFile();
      }
    } catch (err) {
      toast(errorMessage(err, 'Checkout failed'));
    }
  }

  async function addOrigin(): Promise<void> {
    const url = await window.teUI.dialog.prompt('Git Origin URL:');
    if (!url || !url.trim()) return;
    
    try {
      await deps.requestUiIpc(UI_IPC_RPC_METHODS.hostGitRemoteAdd, { name: 'origin', url: url.trim() });
      toast('Origin added');
      // Refresh state to update UI cache
      const syncState = hostWindow().__codeTe2SyncState;
      if (typeof syncState === 'function') {
        syncState(true);
      }
    } catch (err) {
      toast(errorMessage(err, 'Failed to add origin'));
    }
  }

  async function createBranch(): Promise<void> {
    const proposed = await window.teUI.dialog.prompt('New branch name');
    const name = (proposed || '').trim();
    if (!name) return;
    try {
      await deps.requestUiIpc(UI_IPC_RPC_METHODS.hostGitBranchCreate, { name });
      await loadBranches(false);
      toast(`Created ${name}`);
    } catch (err) {
      toast(errorMessage(err, 'Create branch failed'));
    }
  }

  function renderDropdown(current: string | undefined, branches: string[]): void {
    dropdownEl.innerHTML = '';
    
    // 1. Local Branches
    const localBranches = branches.filter(b => !b.includes('/'));
    // 2. Remote Branches (simple heuristic: contains '/')
    const remoteBranches = branches.filter(b => b.includes('/') && !b.includes('->'));

    if (!branches.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-dd-item';
      empty.style.opacity = '0.6';
      empty.textContent = 'No branches';
      dropdownEl.appendChild(empty);
    } else {
      // Render Local
      if (localBranches.length > 0) {
          const label = document.createElement('div');
          label.className = 'fe-dd-label';
          label.textContent = 'Local';
          label.style.fontSize = '0.75rem';
          label.style.padding = '4px 12px';
          label.style.opacity = '0.6';
          dropdownEl.appendChild(label);
          
          localBranches.forEach(renderBranchItem);
      }
      
      // Render Remote
      if (remoteBranches.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'fe-dd-separator';
          dropdownEl.appendChild(sep);
          
          const label = document.createElement('div');
          label.className = 'fe-dd-label';
          label.textContent = 'Remote';
          label.style.fontSize = '0.75rem';
          label.style.padding = '4px 12px 0 12px'; // Reduce bottom padding
          label.style.opacity = '0.6';
          dropdownEl.appendChild(label);

          const state = hostWindow().__codeTe2EditorState || {};
          if (state.projectOrigin) {
              const originUrl = document.createElement('div');
              originUrl.className = 'fe-dd-label';
              originUrl.textContent = state.projectOrigin;
              originUrl.style.fontSize = '0.65rem';
              originUrl.style.padding = '0 12px 4px 12px';
              originUrl.style.opacity = '0.4';
              originUrl.style.wordBreak = 'break-all';
              dropdownEl.appendChild(originUrl);
          } else {
              // Add padding back if no URL
              label.style.paddingBottom = '4px';
          }
          
          remoteBranches.forEach(renderBranchItem);
      }
    }

    function renderBranchItem(branch: string): void {
        const item = document.createElement('div');
        item.className = 'fe-dd-item';
        if (branch === current) {
          item.classList.add('fe-menu-item-checked');
        }
        item.textContent = branch;
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeDropdown();
          if (branch !== current) {
            checkoutBranch(branch);
          }
        });
        dropdownEl.appendChild(item);
    }

    const separator = document.createElement('div');
    separator.className = 'fe-dd-separator';
    dropdownEl.appendChild(separator);

    const createItem = document.createElement('div');
    createItem.className = 'fe-dd-item';
    createItem.textContent = 'Create new branch…';
    createItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeDropdown();
      createBranch();
    });
    dropdownEl.appendChild(createItem);
    
    // Add Origin option if missing (check global state)
    const state = hostWindow().__codeTe2EditorState || {};
    if (!state.projectOrigin) {
        const originItem = document.createElement('div');
        originItem.className = 'fe-dd-item';
        originItem.textContent = 'Add Origin…';
        originItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeDropdown();
            addOrigin();
        });
        dropdownEl.appendChild(originItem);
    }
  }

  btnEl.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const isOpen = dropdownEl.classList.contains('show');
    // Close all other menus
    document.querySelectorAll('.fe-dropdown').forEach(d => {
      if (d.id !== 'menu-branch-dd') {
        d.classList.remove('show');
      }
    });

    if (isOpen) {
      closeDropdown();
    } else {
      await loadBranches(true);
    }
  });

  // Prime label (don't open dropdown on initial load).
  loadBranches(false);

  return { close: closeDropdown, refresh: () => loadBranches(false) };
}
