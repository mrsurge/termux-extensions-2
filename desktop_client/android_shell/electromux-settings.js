// TE2 Termux consumer settings. Desktop never imports this module.
export function mountAndroidSettings(platform, doc = document, win = window) {
  const parent = doc.querySelector('.settings-page');
  if (!parent) return () => {};
  const section = doc.createElement('section');
  section.className = 'settings-section';
  section.innerHTML = `
    <header class="section-header"><h2>Android keep-alive</h2></header>
    <label class="toggle-row" for="android-persistent-network">
      <span><strong>Keep active app connections alive</strong>
      <small>Use a foreground notification and CPU/Wi-Fi locks for active app sessions. Android power policy still applies.</small></span>
      <input id="android-persistent-network" type="checkbox">
    </label>
    <div id="android-power-status" class="status-line" role="status"></div>
    <div id="android-permission-status" class="status-line"></div>
    <div id="android-lock-status" class="status-line"></div>
    <div class="section-actions">
      <button id="android-notification-settings" class="secondary-button" type="button">Notification permission</button>
      <button id="android-battery-settings" class="secondary-button" type="button">Battery settings</button>
    </div>
    <header class="section-header"><h2>Android input and diagnostics</h2></header>
    <label class="toggle-row" for="android-ime-workaround">
      <span><strong>Android IME composition workaround</strong>
      <small>Use Code TE2 focus notifications to suppress stale Gboard composition in native Android clients.</small></span>
      <input id="android-ime-workaround" type="checkbox">
    </label>
    <label class="toggle-row" for="android-devtools-run-profiles">
      <span><strong>Dev tools run profiles</strong>
      <small>Expose Run Profile pages with dev tools enabled as dedicated native Inspector targets.</small></span>
      <input id="android-devtools-run-profiles" type="checkbox">
    </label>
    <label class="toggle-row" for="android-devtools-debug">
      <span><strong>Dev tools debug</strong>
      <small>Expose Code TE2 and other native browser pages as diagnostic Inspector targets.</small></span>
      <input id="android-devtools-debug" type="checkbox">
    </label>`;
  parent.appendChild(section);
  const control = section.querySelector('#android-persistent-network');
  const status = section.querySelector('#android-power-status');
  const permission = section.querySelector('#android-permission-status');
  const locks = section.querySelector('#android-lock-status');
  const extraToggles = [
    ['#android-ime-workaround', 'imeContextSwitchingEnabled'],
    ['#android-devtools-run-profiles', 'devToolsRunProfilesEnabled'],
    ['#android-devtools-debug', 'devToolsDebugEnabled'],
  ].map(([id, key]) => ({control: section.querySelector(id), key, confirmed: false, dirty: false}));
  let disposed = false, dirty = false, saving = false, pending = null, confirmed = false;
  const showError = error => { if (!disposed) { status.textContent = error?.message || 'Android settings unavailable'; status.dataset.state = 'error'; } };
  const refresh = () => {
    if (disposed || saving || doc.visibilityState === 'hidden') return Promise.resolve();
    if (pending) return pending;
    pending = platform.request('get_android_settings').then(settings => {
      if (disposed) return;
      confirmed = settings.persistentNetworkNotification === true;
      if (!dirty) control.checked = confirmed;
      for (const toggle of extraToggles) {
        toggle.confirmed = settings[toggle.key] === true;
        if (!toggle.dirty) toggle.control.checked = toggle.confirmed;
      }
      const runtime = settings.runtime || {};
      status.textContent = runtime.batteryOptimizationExempt ? 'Battery optimization exemption enabled' : 'Android may suspend activity during idle';
      status.dataset.state = runtime.batteryOptimizationExempt ? 'online' : 'offline';
      permission.textContent = runtime.notificationPermissionGranted ? 'Notification permission enabled' : 'Notification permission disabled';
      locks.textContent = `CPU lock: ${runtime.cpuLockHeld ? 'held' : 'inactive'} · Wi-Fi lock: ${runtime.wifiLockHeld ? 'held' : 'inactive'}`;
    }).catch(showError).finally(() => { pending = null; });
    return pending;
  };
  control.addEventListener('change', async () => {
    if (saving || disposed) { control.checked = confirmed; return; }
    const requested = control.checked;
    dirty = true; saving = true; control.disabled = true;
    let saved = false;
    try {
      await pending;
      await platform.request('save_android_settings', {persistentNetworkNotification: requested});
      confirmed = requested;
      dirty = false; saved = true;
    } catch (error) {
      dirty = false;
      if (!disposed) control.checked = confirmed;
      showError(error);
    }
    finally {
      saving = false;
      if (!disposed) { control.disabled = false; if (saved) void refresh(); }
    }
  });
  for (const toggle of extraToggles) toggle.control.addEventListener('change', async () => {
    if (saving || disposed) { toggle.control.checked = toggle.confirmed; return; }
    const requested = toggle.control.checked;
    toggle.dirty = true; saving = true; toggle.control.disabled = true;
    let saved = false;
    try {
      await pending;
      await platform.request('save_android_settings', {[toggle.key]: requested});
      toggle.confirmed = requested; saved = true;
    } catch (error) {
      if (!disposed) toggle.control.checked = toggle.confirmed;
      showError(error);
    } finally {
      toggle.dirty = false; saving = false;
      if (!disposed) { toggle.control.disabled = false; if (saved) void refresh(); }
    }
  });
  for (const [id, method] of [['android-notification-settings', 'open_notification_settings'], ['android-battery-settings', 'open_power_settings']]) {
    section.querySelector(`#${id}`).addEventListener('click', () => {
      void platform.request(method).catch(showError);
    });
  }
  const onActivate = () => { void refresh(); };
  win.addEventListener('focus', onActivate);
  win.addEventListener('pageshow', onActivate);
  doc.addEventListener('visibilitychange', onActivate);
  const dispose = () => {
    disposed = true;
    win.removeEventListener('focus', onActivate);
    win.removeEventListener('pageshow', onActivate);
    doc.removeEventListener('visibilitychange', onActivate);
  };
  win.addEventListener('pagehide', dispose, {once: true});
  void refresh();
  return dispose;
}
