export default function(container) {
  const grid = container.querySelector('#apps-grid');
  const refreshBtn = container.querySelector('#apps-refresh-btn');

  const state = { apps: [], loading: false };

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
      // Fallback icon: first letter of name or generic emoji
      const label = (app.icon_emoji) ? app.icon_emoji : ((app.name || app.id || '?').trim()[0] || '📦');
      icon.textContent = label;

      const title = document.createElement('div');
      title.className = 'app-title';
      title.textContent = app.name || app.id;

      card.appendChild(icon);
      card.appendChild(title);

      card.addEventListener('click', () => {
        try {
          if (!app.id) throw new Error('App missing id');
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
      const apps = await window.teFetch('/api/apps');
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

  refreshBtn?.addEventListener('click', loadApps);

  // Initial fetch
  loadApps();
}
