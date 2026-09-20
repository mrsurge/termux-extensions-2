
// Production Projects modal. Legacy CSS/DOM names retain "debug" for compatibility.
// All intents use host-owned RPC callbacks; state projection belongs to the backend.
interface ProjectsModalDeps {
  list(): Promise<unknown>;
  reset(path: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  open(path: string): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Projects response');
  }
  return value as Record<string, unknown>;
}

function result(value: unknown): Record<string, unknown> {
  const reply = record(value);
  if (reply.ok !== true) {
    throw new Error(typeof reply.error === 'string' ? reply.error
      : typeof reply.reason === 'string' ? reply.reason : 'Projects request failed');
  }
  return reply;
}

function projectEntries(value: unknown): ProjectDebugEntry[] {
  const rows = result(value).data;
  if (!Array.isArray(rows)) throw new Error('Invalid Projects list');
  return rows.map((value: unknown) => {
    const row = record(value);
    if (typeof row.path !== 'string') throw new Error('Invalid project path');
    return {
      path: row.path,
      is_active: row.is_active === true,
      label: typeof row.label === 'string' ? row.label : undefined,
      opened_at: typeof row.opened_at === 'string' ? row.opened_at : undefined,
      sidecar_path: typeof row.sidecar_path === 'string' ? row.sidecar_path : undefined,
      sidecar_exists: row.sidecar_exists === true,
      session_count: typeof row.session_count === 'number' ? row.session_count : undefined,
      last_boot_at: typeof row.last_boot_at === 'string' ? row.last_boot_at : undefined,
      draft_count: typeof row.draft_count === 'number' ? row.draft_count : undefined,
    };
  });
}

interface ProjectsDebugModalController {
  root: HTMLDivElement;
  contentEl: HTMLElement;
  closeBtn: HTMLButtonElement;
}

interface ProjectDebugEntry {
  is_active?: boolean;
  opened_at?: string;
  label?: string;
  path?: string;
  sidecar_path?: string;
  sidecar_exists?: boolean;
  session_count?: number;
  last_boot_at?: string;
  draft_count?: number;
}

function errorMessage(err: unknown, fallback: string): string {
  return err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message || fallback)
    : String(err || fallback);
}

let projectsDebugModal: ProjectsDebugModalController | null = null;
let projectsModalDeps: ProjectsModalDeps | null = null;

// Host installs the transport once; File menu and Explorer share this UI entry
// without either importing or opening the other surface's private RPC socket.
export function configureProjectsModal(deps: ProjectsModalDeps): void {
  projectsModalDeps = deps;
}

function ensureProjectsDebugModal() {
  if (projectsDebugModal) return projectsDebugModal;
  const modal = document.createElement('div');
  modal.id = 'fe-projects-debug-modal';
  modal.className = 'fe-modal';
  modal.dataset.teDialogSurface = 'code-te2.projects-debug';
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
    contentEl: modal.querySelector<HTMLElement>('#fe-projects-debug-content')!,
    closeBtn: modal.querySelector<HTMLButtonElement>('#fe-projects-debug-close')!,
  };
  projectsDebugModal.closeBtn.addEventListener('click', () => hideProjectsDebugModal());
  projectsDebugModal.root.addEventListener('click', (evt) => {
    if (evt.target === modal) {
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

async function loadProjectsDebugContent(deps: ProjectsModalDeps) {
  const modal = ensureProjectsDebugModal();
  modal.contentEl.textContent = 'Loading recent projects…';
  try {
    const items = projectEntries(await deps.list());
    if (!items.length) {
      modal.contentEl.innerHTML = '<p>No recent projects recorded.</p>';
      return;
    }

    // Sort so that the active project (if any) appears first, then by
    // most recently opened.
    items.sort((a: ProjectDebugEntry, b: ProjectDebugEntry) => {
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
    items.forEach((entry: ProjectDebugEntry) => {
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
        if (!(await window.teUI.dialog.confirm(confirmText))) return;
        try {
          trashBtn.disabled = true;
          result(await (entry.is_active ? deps.reset(p) : deps.remove(p)));
          // Backend facts refresh every client; never synthesize a local project open.
          await loadProjectsDebugContent(deps);
          if (entry.is_active) hideProjectsDebugModal();
        } catch (e) {
          await window.teUI.dialog.alert(
            `Failed to update project state: ${errorMessage(e, 'unknown error')}`,
          );
        } finally {
          trashBtn.disabled = false;
        }
      });

      actions.appendChild(trashBtn);
      row.appendChild(actions);
      frag.appendChild(row);

      // Clicking the info area (not the trash) can act as a quick
      // "open project" shortcut for non-active projects.
      if (!entry.is_active) {
        info.style.cursor = 'pointer';
        info.addEventListener('click', async () => {
          const p = entry.path;
          if (!p) return;
          if (
            !(await window.teUI.dialog.confirm(
              'Any unsaved changes in the current project could be lost. Continue?',
            ))
          ) {
            return;
          }
          try {
            result(await deps.open(p));
          } catch (error) {
            await window.teUI.dialog.alert(errorMessage(error, 'Project open failed'));
            return;
          }
          hideProjectsDebugModal();
        });
      }
    });

    modal.contentEl.innerHTML = '';
    modal.contentEl.appendChild(frag);
  } catch (err) {
    modal.contentEl.textContent = `Failed to load project info: ${errorMessage(err, 'unknown error')}`;
  }
}

export async function showProjectsDebugModal() {
  const modal = ensureProjectsDebugModal();
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');
  if (!projectsModalDeps) {
    modal.contentEl.textContent = 'Projects connection is not ready. Reopen Projects to retry.';
    return;
  }
  await loadProjectsDebugContent(projectsModalDeps);
}
