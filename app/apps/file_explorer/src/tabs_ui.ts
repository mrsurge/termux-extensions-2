import type { TabRecord } from './tab_protocol';

export interface TabsUIDependencies {
  container: HTMLElement;
  footer: HTMLElement | null;
  list(): Promise<TabRecord[]>;
  catalog(): Promise<TabRecord[]>;
  create(): Promise<void>;
  attach(record: TabRecord): Promise<void>;
  close(record: TabRecord): Promise<void>;
  currentTab(): TabRecord | null;
  showTabs(): Promise<void>;
  closeMenus(): void;
  error(error: unknown): void;
  confirm(message: string): Promise<boolean>;
  splashPublished(): void;
}

/** Presentation only: tab attachment, creation and durable state stay with the caller. */
export function createTabsUI(deps: TabsUIDependencies) {
  const { container, footer } = deps;
  const document = container.ownerDocument;
  const splash = document.createElement('section');
  splash.className = 'fx-tab-splash';
  splash.setAttribute('aria-label', 'File Explorer tabs');
  container.before(splash);
  const menuGroup = container.querySelector<HTMLElement>('[data-menu="tabs"]');
  const menuPanel = container.querySelector<HTMLElement>('[data-menu-panel="tabs"]');
  let splashGeneration = 0;
  let catalogGeneration = 0;
  let disposed = false;

  function menuOpen(): boolean {
    return !disposed && Boolean(menuGroup?.hasAttribute('data-open'));
  }

  function chrome(active: boolean): void {
    if (disposed) return;
    container.style.display = active ? '' : 'none';
    if (footer) footer.style.display = active ? '' : 'none';
    splash.hidden = active;
  }

  function invalidateSplash(): void { splashGeneration++; }

  function renderChoices(target: HTMLElement, records: TabRecord[]): void {
    const newTab = document.createElement('button');
    newTab.textContent = 'New tab';
    target.append(newTab);
    newTab.addEventListener('click', async () => {
      if (disposed || newTab.disabled) return;
      newTab.disabled = true;
      deps.closeMenus();
      try { await deps.create(); }
      catch (error) { if (!disposed) deps.error(error); }
      finally { newTab.disabled = false; }
    });
    for (const record of records) {
      const row = document.createElement('div');
      row.className = 'fx-tab-row';
      const open = document.createElement('button');
      open.textContent = record.path;
      open.title = record.path;
      if (record.id === deps.currentTab()?.id) open.setAttribute('aria-current', 'true');
      open.addEventListener('click', async () => {
        if (disposed) return;
        deps.closeMenus();
        try { await deps.attach(record); }
        catch (error) { if (!disposed) deps.error(error); }
      });
      const close = document.createElement('button');
      close.className = 'fx-tab-close';
      close.setAttribute('aria-label', `Close tab ${record.path}`);
      close.title = 'Close tab';
      close.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      close.addEventListener('click', async () => {
        if (disposed || close.disabled) return;
        // Include the consent interval in the guard against duplicate close requests.
        close.disabled = true;
        try {
          const confirmed = await deps.confirm(record.shellId
            ? 'Close this tab and stop its terminal processes in all attached windows?'
            : 'Close this tab in all attached windows?');
          if (!confirmed || disposed) return;
          await deps.close(record);
          if (disposed) return;
          if (deps.currentTab()) await refreshMenu();
          else await deps.showTabs();
        } catch (error) { if (!disposed) deps.error(error); }
        finally { close.disabled = false; }
      });
      row.append(open, close);
      target.append(row);
    }
    if (!records.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No open tabs. New tab starts in your project (Sidebar) or Home.';
      target.append(empty);
    }
  }

  async function showSplash(): Promise<void> {
    if (disposed) return;
    const generation = ++splashGeneration;
    chrome(false);
    splash.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'File Explorer tabs';
    splash.append(heading);
    // list deliberately detaches; the menu's catalog must never do so.
    const records = await deps.list();
    if (disposed || generation !== splashGeneration) return;
    renderChoices(splash, records);
    deps.splashPublished();
  }

  async function refreshMenu(): Promise<void> {
    if (disposed) return;
    const generation = ++catalogGeneration;
    const records = await deps.catalog();
    if (disposed || generation !== catalogGeneration || !menuOpen() || !menuPanel) return;
    menuPanel.replaceChildren();
    renderChoices(menuPanel, records);
  }

  function loading(): void {
    if (disposed) return;
    invalidateSplash();
    chrome(false);
    splash.textContent = 'Loading tabs…';
  }

  function failed(message: string, retry: () => void): void {
    if (disposed) return;
    invalidateSplash();
    chrome(false);
    splash.textContent = message;
    const button = document.createElement('button');
    button.textContent = 'Retry';
    button.addEventListener('click', () => { if (!disposed) retry(); });
    splash.append(button);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    invalidateSplash();
    catalogGeneration++;
    splash.remove();
  }

  return { chrome, showSplash, refreshMenu, invalidateSplash, loading, failed, menuOpen, menuGroup, dispose };
}
