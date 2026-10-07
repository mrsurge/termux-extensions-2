// Packaged only by the TE2 Termux consumer. Existing Electron/Android entrypoints
// stay unchanged. Native serving owns this page and the existing gateway.
import {createRemoteElectromuxPlatform} from './electromux-platform.js';

const origin = window.location.origin;
if (window.location.hostname !== '127.0.0.1' || window.location.protocol !== 'http:')
  throw new Error('TE2 Termux launcher requires its native loopback relay');

const localBridge = globalThis.ElectromuxBridge.create({
  query: options => globalThis.cefriumQuery(options),
  methods: ['get_settings', 'save_settings', 'get_local_framework_config', 'save_local_framework_config', 'get_local_framework_state',
    'refresh_local_framework', 'start_local_framework', 'stop_local_framework', 'use_local_framework'],
  events: ['local-framework-state'], documentId: crypto.randomUUID().replaceAll('-', ''),
  timeoutMs: 20000,
});
globalThis.__electromuxReceiveEvent = raw => localBridge.receiveEvent(raw);
window.addEventListener('pagehide', () => {
  localBridge.dispose(); delete globalThis.__electromuxReceiveEvent;
}, {once: true});

globalThis.__te2ShellPlatform = createRemoteElectromuxPlatform({
  getBrowserOrigin: () => origin,
  navigate: url => window.location.assign(url),
  nativeRequest: (method, params) => localBridge.request(method, params),
  on: (name, callback) => localBridge.on(name, callback),
  gatewayRequest: async (path, {method, body}) => {
    const response = await fetch(path, {method, credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const envelope = await response.json();
    if (!response.ok || envelope.ok !== true || !Object.hasOwn(envelope, 'data'))
      throw new Error(envelope.error || `Android gateway returned HTTP ${response.status}`);
    return envelope.data;
  },
});

// Startup settings are native-owned; only asset update remains
// visibly unavailable until their separate parity slices.
function disableUnavailableControls() {
  for (const section of document.querySelectorAll('.settings-section')) {
    if (!section.querySelector('#update-assets')) continue;
    for (const control of section.querySelectorAll('input, button, select')) control.disabled = true;
    section.dataset.capability = 'unavailable';
    section.title = 'Asset updates are not enabled in this consumer shell yet';
  }
}
disableUnavailableControls();
// Settings initialization may re-enable controls after async rendering. Observe
// only these capability sections, not the editor or the rest of the document.
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes' && record.target.disabled) continue;
    const section = record.target.closest?.('[data-capability="unavailable"]');
    if (section?.matches('input, button, select')) section.disabled = true;
    if (section) for (const control of section.querySelectorAll('input, button, select'))
      if (!control.disabled) control.disabled = true;
  }
});
for (const section of document.querySelectorAll('[data-capability="unavailable"]'))
  observer.observe(section, {subtree: true, childList: true, attributes: true, attributeFilter: ['disabled']});
window.addEventListener('pagehide', () => observer.disconnect(), {once: true});

const settings = window.location.pathname.endsWith('/settings.html');
await import(settings ? './settings.js' : './launcher.js');

// Activation reads retained actor state; it never starts/retries a mutation or
// probes HTTP. Coalesce focus/pageshow/visibility events into one request.
const platform = globalThis.__te2ShellPlatform;
const reconcile = () => {
  if (document.visibilityState === 'hidden') return;
  void platform.reconcileLocalState().catch(error => console.warn('Local state reconciliation failed', error));
};
window.addEventListener('pageshow', reconcile);
window.addEventListener('focus', reconcile);
window.addEventListener('electromux:page-ready', reconcile);
document.addEventListener('visibilitychange', reconcile);
window.addEventListener('pagehide', () => {
  window.removeEventListener('pageshow', reconcile);
  window.removeEventListener('focus', reconcile);
  window.removeEventListener('electromux:page-ready', reconcile);
  document.removeEventListener('visibilitychange', reconcile);
  platform.dispose();
}, {once: true});
reconcile();
