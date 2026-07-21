export function createAutosaveModalController() {
  async function showAutosaveModal(fileLabel: string, hasOtherDrafts: boolean): Promise<boolean> {
    const safeLabel = fileLabel ? `“${fileLabel}”` : 'this document';
    const tail = hasOtherDrafts
      ? 'Any other unsaved drafts in different files will be discarded when autosave is on.'
      : 'Autosave will overwrite the current document and discard draft caches for other files.';
    return window.teUI.dialog.confirm(
      `Enabling autosave will immediately save ${safeLabel}. ${tail} Continue?`,
      {
        title: 'Enable Autosave?',
        confirmLabel: 'Enable Autosave',
        surface: { id: 'code-te2.autosave-enable' },
      },
    );
  }

  return { showAutosaveModal };
}
