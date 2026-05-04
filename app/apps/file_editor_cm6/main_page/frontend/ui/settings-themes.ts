// @ts-check

/**
 * @param {{
 *   themesModalEl: HTMLElement,
 *   themesCloseEl: HTMLElement,
 *   themesListEl: HTMLElement,
 *   settingsThemeStripEl: HTMLElement,
 *   settingsThemeSummaryEl: HTMLElement,
 *   getEditorViewState: () => any,
 *   setEditorTheme: (themeId: string) => void,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   toast: (msg: string, ms?: number) => void,
 * }} deps
 */
export function createSettingsThemesController(deps: any) {
  function openEditorThemesModal() {
    deps.themesModalEl.classList.add('show');
    deps.themesModalEl.setAttribute('aria-hidden', 'false');
    void refreshEditorThemesModal();
  }

  function closeEditorThemesModal() {
    deps.themesModalEl.classList.remove('show');
    deps.themesModalEl.setAttribute('aria-hidden', 'true');
  }

  async function refreshEditorThemesModal() {
    deps.themesListEl.textContent = 'Loading…';
    let themes = [];
    try {
      const res = await fetch('/api/app/file_editor_cm6/ui/monaco_editor/available_themes', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        themes = data?.themes || [];
      }
    } catch (_) {}

    const currentTheme = deps.getEditorViewState()?.theme || 'github-dark-default';
    deps.themesListEl.innerHTML = '';
    const vendored = themes.filter((t: any) => t.source === 'vendored');
    const fromExts = themes.filter((t: any) => t.source === 'extension');

    function renderSection(title: string, items: any[]) {
      if (!items.length) return;
      const heading = document.createElement('div');
      heading.style.cssText = 'font-weight:600; margin:12px 0 8px; font-size:13px; opacity:0.7; text-transform:uppercase; letter-spacing:0.5px;';
      heading.textContent = title;
      deps.themesListEl.appendChild(heading);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;';
      items.forEach((t: any) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border, #333); border-radius:8px; cursor:pointer;';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'te2-theme-radio';
        input.value = t.id;
        input.checked = String(currentTheme) === String(t.id);
        if (input.checked) {
          row.style.borderColor = 'var(--accent, #58a6ff)';
          row.style.background = 'rgba(88, 166, 255, 0.08)';
        }
        const isDark = (t.uiTheme || '').includes('dark') || (t.uiTheme || '').includes('hc-black');
        const swatch = document.createElement('span');
        swatch.style.cssText = `display:inline-block; width:16px; height:16px; border-radius:50%; border:1px solid var(--border,#444); background:${isDark ? '#1a1a2e' : '#f0f0f0'};`;
        const text = document.createElement('div');
        text.style.flex = '1';
        text.textContent = t.label;
        input.addEventListener('change', async () => {
          if (!input.checked) return;
          const ok = await deps.updatePreference('theme', t.id);
          if (!ok) deps.toast('Failed to change theme');
          deps.setEditorTheme(t.id);
          deps.settingsThemeSummaryEl.textContent = t.label;
          (deps.themesListEl as HTMLElement).querySelectorAll<HTMLLabelElement>('label').forEach((l) => {
            l.style.borderColor = 'var(--border, #333)';
            l.style.background = '';
          });
          row.style.borderColor = 'var(--accent, #58a6ff)';
          row.style.background = 'rgba(88, 166, 255, 0.08)';
        });
        row.appendChild(input);
        row.appendChild(swatch);
        row.appendChild(text);
        grid.appendChild(row);
      });
      deps.themesListEl.appendChild(grid);
    }

    renderSection('Bundled', vendored);
    renderSection('From Extensions', fromExts);
    if (!themes.length) deps.themesListEl.textContent = 'No themes available';
  }

  function install() {
    deps.themesCloseEl.addEventListener('click', closeEditorThemesModal);
    deps.themesModalEl.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === deps.themesModalEl) closeEditorThemesModal();
    });
    deps.settingsThemeStripEl.addEventListener('click', () => {
      openEditorThemesModal();
    });
  }

  return { openEditorThemesModal, closeEditorThemesModal, refreshEditorThemesModal, install };
}
