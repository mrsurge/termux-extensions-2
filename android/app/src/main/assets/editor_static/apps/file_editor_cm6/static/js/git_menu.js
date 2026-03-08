// app/apps/file_editor_cm6/static/js/git_menu.js
// Minimal branch menu wiring for Code CM6. Front-end logic stays thin
// and delegates all Git work to backend endpoints.

function toast(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    console.log(message);
  }
}

async function request(path, options) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await resp.json().catch(() => null);
  if (!json || json.ok === false) {
    const err = json?.error || resp.statusText || 'Git request failed';
    throw new Error(err);
  }
  return json.data || {};
}

export function initBranchMenu() {
  const btn = document.getElementById('menu-branch-btn');
  const dropdown = document.getElementById('menu-branch-dd');
  if (!btn || !dropdown) return { close: () => {} };

  function closeDropdown() {
    dropdown.classList.remove('show');
  }

  function setLabel(current) {
    const label = current ? `Branch: ${current}` : 'Branch';
    btn.textContent = `${label} ▾`;
  }

  async function loadBranches(showDropdown = false) {
    try {
      const data = await request('/api/app/file_editor_cm6/git/branches');
      setLabel(data.current);
      if (showDropdown) {
        renderDropdown(data.current, data.branches || []);
        dropdown.classList.add('show');
      }
    } catch (err) {
      toast(err.message || 'Unable to load branches');
    }
  }

  async function checkoutBranch(name) {
    try {
      await request('/api/app/file_editor_cm6/git/checkout', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await loadBranches(false);
      toast(`Checked out ${name}`);
      // Reload file to reflect changes
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        window.__cm6ReloadCurrentFile();
      }
    } catch (err) {
      toast(err.message || 'Checkout failed');
    }
  }

  async function addOrigin() {
    const url = prompt('Git Origin URL:');
    if (!url || !url.trim()) return;
    
    try {
      await request('/api/app/file_editor_cm6/git/remote/add', {
        method: 'POST',
        body: JSON.stringify({ name: 'origin', url: url.trim() }),
      });
      toast('Origin added');
      // Refresh state to update UI cache
      if (typeof window.__cm6SyncState === 'function') {
        window.__cm6SyncState(true);
      }
    } catch (err) {
      toast(err.message || 'Failed to add origin');
    }
  }

  async function createBranch() {
    const proposed = prompt('New branch name');
    const name = (proposed || '').trim();
    if (!name) return;
    try {
      await request('/api/app/file_editor_cm6/git/branch', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await loadBranches(false);
      toast(`Created ${name}`);
    } catch (err) {
      toast(err.message || 'Create branch failed');
    }
  }

  function renderDropdown(current, branches) {
    dropdown.innerHTML = '';
    
    // 1. Local Branches
    const localBranches = branches.filter(b => !b.includes('/'));
    // 2. Remote Branches (simple heuristic: contains '/')
    const remoteBranches = branches.filter(b => b.includes('/') && !b.includes('->'));

    if (!branches.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-dd-item';
      empty.style.opacity = '0.6';
      empty.textContent = 'No branches';
      dropdown.appendChild(empty);
    } else {
      // Render Local
      if (localBranches.length > 0) {
          const label = document.createElement('div');
          label.className = 'fe-dd-label';
          label.textContent = 'Local';
          label.style.fontSize = '0.75rem';
          label.style.padding = '4px 12px';
          label.style.opacity = '0.6';
          dropdown.appendChild(label);
          
          localBranches.forEach(renderBranchItem);
      }
      
      // Render Remote
      if (remoteBranches.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'fe-dd-separator';
          dropdown.appendChild(sep);
          
          const label = document.createElement('div');
          label.className = 'fe-dd-label';
          label.textContent = 'Remote';
          label.style.fontSize = '0.75rem';
          label.style.padding = '4px 12px 0 12px'; // Reduce bottom padding
          label.style.opacity = '0.6';
          dropdown.appendChild(label);

          const state = window.__cm6EditorState || {};
          if (state.projectOrigin) {
              const originUrl = document.createElement('div');
              originUrl.className = 'fe-dd-label';
              originUrl.textContent = state.projectOrigin;
              originUrl.style.fontSize = '0.65rem';
              originUrl.style.padding = '0 12px 4px 12px';
              originUrl.style.opacity = '0.4';
              originUrl.style.wordBreak = 'break-all';
              dropdown.appendChild(originUrl);
          } else {
              // Add padding back if no URL
              label.style.paddingBottom = '4px';
          }
          
          remoteBranches.forEach(renderBranchItem);
      }
    }

    function renderBranchItem(branch) {
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
        dropdown.appendChild(item);
    }

    const separator = document.createElement('div');
    separator.className = 'fe-dd-separator';
    dropdown.appendChild(separator);

    const createItem = document.createElement('div');
    createItem.className = 'fe-dd-item';
    createItem.textContent = 'Create new branch…';
    createItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeDropdown();
      createBranch();
    });
    dropdown.appendChild(createItem);
    
    // Add Origin option if missing (check global state)
    const state = window.__cm6EditorState || {};
    if (!state.projectOrigin) {
        const originItem = document.createElement('div');
        originItem.className = 'fe-dd-item';
        originItem.textContent = 'Add Origin…';
        originItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeDropdown();
            addOrigin();
        });
        dropdown.appendChild(originItem);
    }
  }

  btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const isOpen = dropdown.classList.contains('show');
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
