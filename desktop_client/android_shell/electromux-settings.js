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
    </div>`;
  parent.appendChild(section);
  const control = section.querySelector('#android-persistent-network');
  const status = section.querySelector('#android-power-status');
  const permission = section.querySelector('#android-permission-status');
  const locks = section.querySelector('#android-lock-status');
  let disposed = false, dirty = false, saving = false, pending = null, confirmed = false;
  const showError = error => { if (!disposed) { status.textContent = error?.message || 'Android settings unavailable'; status.dataset.state = 'error'; } };
  const refresh = () => {
    if (disposed || saving || doc.visibilityState === 'hidden') return Promise.resolve();
    if (pending) return pending;
    pending = platform.request('get_android_settings').then(settings => {
      if (disposed) return;
      confirmed = settings.persistentNetworkNotification === true;
      if (!dirty) control.checked = confirmed;
      const runtime = settings.runtime || {};
      status.textContent = runtime.batteryOptimizationExempt ? 'Battery optimization exemption enabled' : 'Android may suspend activity during idle';
      status.dataset.state = runtime.batteryOptimizationExempt ? 'online' : 'offline';
      permission.textContent = runtime.notificationPermissionGranted ? 'Notification permission enabled' : 'Notification permission disabled';
      locks.textContent = `CPU lock: ${runtime.cpuLockHeld ? 'held' : 'inactive'} · Wi-Fi lock: ${runtime.wifiLockHeld ? 'held' : 'inactive'}`;
    }).catch(showError).finally(() => { pending = null; });
    return pending;
  };
  control.addEventListener('change', async () => {
    if (saving || disposed) return;
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
