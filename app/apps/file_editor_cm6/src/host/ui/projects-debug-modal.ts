
import { EXPLORER_RPC_METHODS } from '../../explorer/rpc/contract.ts';

// ---------- Projects & Sidecars debug modal ----------
// Extracted from main.js — fully self-contained (no closure deps).

let projectsDebugModal = null;

function ensureProjectsDebugModal() {
  if (projectsDebugModal) return projectsDebugModal;
  const modal = document.createElement('div');
  modal.id = 'fe-projects-debug-modal';
  modal.className = 'fe-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 640px;">
      <div class="fe-modal-header">
        <strong>Projects</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-projects-debug-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <div id="fe-projects-debug-content" style="font-size:0.85rem; line-height:1.5;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  projectsDebugModal = {
    root: modal,
    contentEl: modal.querySelector('#fe-projects-debug-content'),
    closeBtn: modal.querySelector('#fe-projects-debug-close'),
  };
  projectsDebugModal.closeBtn.addEventListener('click', () => hideProjectsDebugModal());
  projectsDebugModal.root.addEventListener('click', (evt) => {
    if (evt.target === projectsDebugModal.root) {
      hideProjectsDebugModal();
    }
  });
  return projectsDebugModal;
}

export function hideProjectsDebugModal() {
  if (!projectsDebugModal) return;
  projectsDebugModal.root.classList.remove('show');
  projectsDebugModal.root.setAttribute('aria-hidden', 'true');
}

async function loadProjectsDebugContent() {
  const modal = ensureProjectsDebugModal();
  modal.contentEl.textContent = 'Loading recent projects…';
  try {
    const resp = await fetch('/api/app/file_editor_cm6/debug/projects', { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Request failed');
    }
    const items = Array.isArray(json.data) ? json.data.slice() : [];
    if (!items.length) {
      modal.contentEl.innerHTML = '<p>No recent projects recorded.</p>';
      return;
    }

    // Sort so that the active project (if any) appears first, then by
    // most recently opened.
    items.sort((a, b) => {
      const aActive = !!a.is_active;
      const bActive = !!b.is_active;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const ao = a.opened_at || '';
      const bo = b.opened_at || '';
      if (ao > bo) return -1;
      if (ao < bo) return 1;
      return 0;
    });

    const frag = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'fe-projects-debug-row';
      if (entry.is_active) {
        row.classList.add('fe-projects-debug-row--active');
      }

      const info = document.createElement('div');
      info.className = 'fe-projects-debug-info';

      const title = document.createElement('div');
      title.className = 'fe-projects-debug-title';
      const label = entry.label || '(no label)';
      const path = entry.path || '(no path)';
      title.textContent = `${label} — ${path}`;

      const meta = document.createElement('div');
      meta.className = 'fe-projects-debug-meta';
      const scPath = entry.sidecar_path || '(no sidecar path)';
      const exists = entry.sidecar_exists ? 'exists' : 'missing';
      const session =
        typeof entry.session_count === 'number'
          ? `, session_count=${entry.session_count}`
          : '';
      const lastBoot = entry.last_boot_at
        ? `, last_boot_at=${entry.last_boot_at}`
        : '';
      const drafts = typeof entry.draft_count === 'number' && entry.draft_count > 0
        ? `, drafts=${entry.draft_count}`
        : '';
      meta.textContent = `State: ${scPath} (${exists}${session}${lastBoot}${drafts})`;

      info.appendChild(title);
      info.appendChild(meta);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'fe-projects-debug-trash';

      const trashBtn = document.createElement('button');
      trashBtn.className = 'fe-btn';
      trashBtn.textContent = '🗑';
      trashBtn.title = entry.is_active ? 'Reset project state' : 'Remove project entry and sidecar';
      trashBtn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        const p = entry.path;
        if (!p) return;
        const confirmText = entry.is_active
          ? [
              'Reset history and draft cache for the CURRENT project:',
              p,
              '',
              'This does not delete the project folder itself, and the project',
              'will remain in the list. All recents, diff base, and drafts for',
              'this project will be cleared.',
            ].join('\n')
          : [
              'Remove project entry and sidecar for:',
              p,
              '',
              'This does not delete the project folder itself, but it will be',
              'removed from the recent projects list and its drafts will be lost.',
            ].join('\n');
        if (!window.confirm(confirmText)) return;
        try {
          const respDel = await fetch('/api/app/file_editor_cm6/debug/projects', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: p }),
          });
          const jsonDel = await respDel.json().catch(() => ({}));
          if (!respDel.ok || jsonDel?.ok === false) {
            throw new Error(jsonDel?.error || respDel.statusText || 'Delete failed');
          }
          await loadProjectsDebugContent();

          // If we just soft-reset the CURRENT project, treat this as the user
          // having just opened a "fresh" project: clear host editor state and
          // let the iframe reload into its null-document state for this project.
          if (entry.is_active && typeof window.__cm6HandleProjectOpened === 'function') {
            try {
              window.__cm6HandleProjectOpened(p);
              hideProjectsDebugModal();
            } catch (err) {
              console.warn('[ProjectsDebug] Failed to resync editor after reset:', err);
            }
          }
        } catch (e) {
          window.alert(
            `Failed to delete project entry: ${
              /** @type {any} */ (e) && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e || 'unknown error')
            }`,
          );
        }
      });

      actions.appendChild(trashBtn);
      row.appendChild(actions);
      frag.appendChild(row);

      // Clicking the info area (not the trash) can act as a quick
      // "open project" shortcut for non-active projects.
      if (!entry.is_active) {
        info.style.cursor = 'pointer';
        info.addEventListener('click', () => {
          const p = entry.path;
          if (!p) return;
          if (
            !window.confirm(
              'Any unsaved changes in the current project will be lost. Continue?',
            )
          ) {
            return;
          }
          if (!window.__explorerRpc) {
            window.alert('Explorer connection unavailable.');
            return;
          }
          window.__explorerRpc.notify(EXPLORER_RPC_METHODS.projectOpen, { path: p });
          hideProjectsDebugModal();
        });
      }
    });

    modal.contentEl.innerHTML = '';
    modal.contentEl.appendChild(frag);
  } catch (err) {
    modal.contentEl.textContent = `Failed to load debug info: ${
      /** @type {any} */ (err) && /** @type {any} */ (err).message ? /** @type {any} */ (err).message : String(err || 'unknown error')
    }`;
  }
}

export async function showProjectsDebugModal() {
  const modal = ensureProjectsDebugModal();
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');
  await loadProjectsDebugContent();
}
