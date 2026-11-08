export interface WorkingEditorMount {
  readonly root: HTMLElement;
  readonly editor: HTMLElement;
  readonly breadcrumbs: HTMLElement;
  readonly debug: HTMLElement | null;
}

/** Resolve only parts owned by this host, never a nested editor's parts. */
export function resolveWorkingEditorMount(root: HTMLElement): WorkingEditorMount {
  if (!root.hasAttribute('data-te2-working-editor-host')) {
    throw new Error('Working editor mount is missing its host marker.');
  }
  const owned = (part: string): HTMLElement | null => {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-te2-editor-part="${part}"]`)) {
      if (element.closest('[data-te2-working-editor-host]') === root) return element;
    }
    return null;
  };
  const editor = owned('editor');
  const breadcrumbs = owned('breadcrumbs');
  if (!editor || !breadcrumbs) throw new Error('Working editor mount requires its own editor and breadcrumb elements.');
  return { root, editor, breadcrumbs, debug: owned('debug') };
}
