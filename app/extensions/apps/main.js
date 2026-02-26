export default function(container) {
  const grid = container.querySelector('#apps-grid');
  const refreshBtn = container.querySelector('#apps-refresh-btn');

  const state = { apps: [], loading: false };
  
  function resolveIconSrc(app) {
    const raw = typeof app.icon_src === 'string' ? app.icon_src.trim() : '';
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      return raw;
    }
    if (app._dir) {
      return `/apps/${app._dir}/${raw}`;
    }
    return raw;
  }

  function resolveIconText(app) {
    const emoji = typeof app.icon_emoji === 'string' ? app.icon_emoji.trim() : '';
    if (emoji) return emoji;
    const text = typeof app.icon_text === 'string' ? app.icon_text.trim() : '';
    if (text) return text;
    return '';
  }

  function render() {
    if (state.loading) {
      grid.innerHTML = `<p class="apps-empty">Loading apps…</p>`;
      return;
    }
    if (!state.apps || state.apps.length === 0) {
      grid.innerHTML = `<p class="apps-empty">No apps found.</p>`;
      return;
    }

    grid.innerHTML = '';
    state.apps.forEach(app => {
      const card = document.createElement('div');
      card.className = 'app-card';
      card.title = app.description || app.name || app.id;

      const icon = document.createElement('div');
      icon.className = 'app-icon';
      const iconSrc = resolveIconSrc(app);
      if (iconSrc) {
        const img = document.createElement('img');
        img.className = 'app-icon-img';
        img.alt = `${app.name || app.id || 'app'} icon`;
        img.src = iconSrc;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        icon.appendChild(img);
      } else {
        const iconText = resolveIconText(app);
        if (iconText) {
          icon.textContent = iconText;
        }
      }

      const title = document.createElement('div');
      title.className = 'app-title';
      title.textContent = app.name || app.id;

      card.appendChild(icon);
      card.appendChild(title);

      card.addEventListener('click', async () => {
        try {
          if (!app.id) throw new Error('App missing id');
          
          window.teUI?.toast?.(`Starting ${app.name || app.id}...`);

          await window.teFetch(`/api/apps/${app.id}/start`, { method: 'POST' });

          // Navigate to the full-screen app shell route
          window.location.href = `/app/${app.id}`;
        } catch (e) {
          console.error(e);
          window.teUI?.toast?.(`Failed to open app: ${e.message || e}`);
        }
      });

      grid.appendChild(card);
    });
  }

  async function loadApps() {
    try {
      state.loading = true;
      render();
      const apps = await window.teFetch('/api/apps/catalog');
      // Expecting an array
      state.apps = Array.isArray(apps) ? apps : (apps?.data || []);
    } catch (e) {
      console.error('Failed to load apps:', e);
      state.apps = [];
      window.teUI?.toast?.(`Error loading apps: ${e.message || e}`);
    } finally {
      state.loading = false;
      render();
    }
  }

  refreshBtn?.addEventListener('click', async () => {
    try {
      await window.teFetch('/api/apps/reload', { method: 'POST' });
      await loadApps();
      window.teUI?.toast?.('App list refreshed');
    } catch (e) {
      console.error('Failed to refresh app manifests:', e);
      window.teUI?.toast?.(`Refresh failed: ${e.message || e}`);
    }
  });

  // Initial fetch
  loadApps();
}
