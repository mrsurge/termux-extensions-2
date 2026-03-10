export default function(container) {
  const grid = container.querySelector('#apps-grid');
  const refreshBtn = container.querySelector('#apps-refresh-btn');

  const state = { apps: [], loading: false };
  let appsWs = null;
  let reconnectTimer = null;
  let reconnectBackoffMs = 600;
  
  function resolveIconSrc(app) {
    const raw = typeof app.icon_src === 'string' ? app.icon_src.trim() : '';
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      return raw;
    }
    const assetBaseUrl = typeof app.asset_base_url === 'string' ? app.asset_base_url.trim() : '';
    if (assetBaseUrl) {
      return `${assetBaseUrl.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`;
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
      if (app.running) card.classList.add('is-running');
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

      let longPressTimer = null;
      let suppressClickUntil = 0;
      let pointerId = null;
      let startX = 0;
      let startY = 0;

      async function quitApp(ev) {
        if (!app.running) return;
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        try {
          window.teUI?.toast?.(`Stopping ${app.name || app.id}...`);
          await window.teFetch(`/api/apps/${app.id}/quit`, { method: 'POST' });
          applyRunningDelta(app.id, false);
        } catch (e) {
          console.error(e);
          window.teUI?.toast?.(`Failed to stop app: ${e.message || e}`);
        }
      }

      card.addEventListener('contextmenu', (ev) => {
        void quitApp(ev);
      });

      card.addEventListener('pointerdown', (ev) => {
        if (!app.running) return;
        if (ev.pointerType !== 'touch') return;
        pointerId = ev.pointerId;
        startX = ev.clientX;
        startY = ev.clientY;
        longPressTimer = setTimeout(() => {
          suppressClickUntil = Date.now() + 900;
          void quitApp(ev);
        }, 520);
      });

      card.addEventListener('pointermove', (ev) => {
        if (ev.pointerId !== pointerId || !longPressTimer) return;
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (dx > 8 || dy > 8) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });

      const clearLongPress = (ev) => {
        if (pointerId !== null && ev.pointerId !== pointerId) return;
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        pointerId = null;
      };

      card.addEventListener('pointerup', clearLongPress);
      card.addEventListener('pointercancel', clearLongPress);

      card.addEventListener('click', async () => {
        if (Date.now() < suppressClickUntil) {
          suppressClickUntil = 0;
          return;
        }
        try {
          if (!app.id) throw new Error('App missing id');
          
          window.teUI?.toast?.(`Starting ${app.name || app.id}...`);

          await window.teFetch(`/api/apps/${app.id}/start`, { method: 'POST' });
          applyRunningDelta(app.id, true);

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

  function applySnapshot(payload) {
    const catalog = Array.isArray(payload?.catalog) ? payload.catalog.slice() : [];
    const runningIds = new Set(
      Array.isArray(payload?.running_ids)
        ? payload.running_ids.map((id) => String(id || '').trim()).filter(Boolean)
        : []
    );
    state.apps = catalog.map((app) => ({
      ...app,
      running: runningIds.has(String(app?.id || '').trim()) || !!app?.running,
    }));
    state.loading = false;
    render();
  }

  function applyRunningDelta(appId, running) {
    const target = String(appId || '').trim();
    if (!target) return;
    let changed = false;
    state.apps = state.apps.map((app) => {
      if (String(app?.id || '').trim() !== target) return app;
      if (!!app.running === !!running) return app;
      changed = true;
      return { ...app, running: !!running };
    });
    if (changed) render();
  }

  function appsWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/apps`;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const waitMs = reconnectBackoffMs;
    reconnectBackoffMs = Math.min(15000, Math.floor(reconnectBackoffMs * 1.8));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectAppsEvents();
    }, waitMs);
  }

  function connectAppsEvents() {
    try {
      appsWs = new WebSocket(appsWsUrl());
    } catch (e) {
      console.warn('Failed to connect apps websocket:', e);
      scheduleReconnect();
      return;
    }

    appsWs.addEventListener('open', () => {
      reconnectBackoffMs = 600;
    });

    appsWs.addEventListener('message', (ev) => {
      let message = null;
      try {
        message = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'apps_snapshot' || message.type === 'catalog_snapshot') {
        applySnapshot(message.payload || {});
        return;
      }
      if (message.type === 'app_running_changed') {
        applyRunningDelta(message?.payload?.app_id, !!message?.payload?.running);
      }
    });

    appsWs.addEventListener('error', () => {
      try { appsWs.close(); } catch (_) {}
    });

    appsWs.addEventListener('close', () => {
      appsWs = null;
      scheduleReconnect();
    });
  }

  refreshBtn?.addEventListener('click', async () => {
    try {
      await window.teFetch('/api/apps/reload', { method: 'POST' });
      window.teUI?.toast?.('App list refreshed');
    } catch (e) {
      console.error('Failed to refresh app manifests:', e);
      window.teUI?.toast?.(`Refresh failed: ${e.message || e}`);
    }
  });

  connectAppsEvents();
  state.loading = true;
  render();
}
