import { isUnknownArray } from '../../../src/rpc/value-types.ts';
import { createModalFrame } from './modal-kit/modal-frame.tsx';

interface Dependencies {
  getProject(): string | null;
  request(payload: Record<string, unknown>): Promise<unknown>;
  refresh(): Promise<unknown>;
  toast(message: string): void;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? value as Record<string, unknown> : {};
}
export function createAutosaveModalController(deps: Dependencies) {
  let busy = false;
  async function showAutosaveModal(): Promise<boolean> {
    if (busy) return false;
    const project = deps.getProject();
    if (!project) { deps.toast('Open a project first'); return false; }
    busy = true;
    try {
      const response = record(await deps.request({ key: 'autoSave', value: true, stage: 'preview', project }));
      const preview = record(response.preview);
      if (response.ok !== true || preview.project !== project || typeof preview.token !== 'string'
        || typeof preview.count !== 'number') throw new Error(String(response.error || 'Unable to inspect project drafts'));
      if (deps.getProject() !== project) return false;
      const choice = await new Promise<'save' | 'discard' | null>((resolve) => {
        const finish = (value: 'save' | 'discard' | null) => {
          window.removeEventListener('keydown', keydown, true);
          window.removeEventListener('code-te2:project-switching', cancel);
          frame.root.remove();
          frame.dispose();
          resolve(value);
        };
        const cancel = () => finish(null);
        const keydown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        };
        const frame = createModalFrame(document, {
          id: 'fe-autosave-modal', surfaceId: 'code-te2.autosave-enable',
          title: 'Enable project autosave?', onClose: cancel,
        });
        const text = document.createElement('p');
        text.textContent = `${project}: ${preview.count} unsaved file(s). Save or discard all of this project's drafts before enabling autosave. Other projects are unaffected.`;
        frame.body.append(text);
        for (const [label, value] of [['Save All and Enable', 'save'], ['Discard All and Enable', 'discard'], ['Cancel', null]] as const) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'fe-btn'; button.textContent = label;
          button.addEventListener('click', () => finish(value));
          frame.footer.append(button);
        }
        document.body.append(frame.root);
        frame.root.classList.add('show'); frame.root.setAttribute('aria-hidden', 'false');
        window.addEventListener('keydown', keydown, true);
        window.addEventListener('code-te2:project-switching', cancel);
        (frame.footer.lastElementChild as HTMLButtonElement).focus();
      });
      if (!choice || deps.getProject() !== project) return false;
      const result = record(await deps.request({ key: 'autoSave', value: true, project, token: preview.token, choice }));
      if (result.ok !== true) throw new Error(String(result.message || result.error || 'Autosave was not enabled'));
      await deps.refresh();
      return true;
    } catch (error) {
      deps.toast(error instanceof Error ? error.message : String(error));
      return false;
    } finally { busy = false; }
  }
  return { showAutosaveModal };
}
