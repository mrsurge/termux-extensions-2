// Packaged only by the TE2 Termux consumer. Existing Electron/Android entrypoints
// stay unchanged. Native serving owns this page and the existing gateway.
import {createRemoteElectromuxPlatform} from './electromux-platform.js';

const origin = window.location.origin;
if (window.location.hostname !== '127.0.0.1' || window.location.protocol !== 'http:')
  throw new Error('TE2 Termux launcher requires its native loopback relay');

globalThis.__te2ShellPlatform = createRemoteElectromuxPlatform({
  getBrowserOrigin: () => origin,
  navigate: url => window.location.assign(url),
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

// Keep the real settings controls present, but make unsupported interim features
// visibly inert. The later local-launch slice replaces this capability boundary.
function disableUnavailableControls() {
  for (const section of document.querySelectorAll('.settings-section')) {
    if (!section.querySelector('#autostart-local-framework, #local-framework-command, #update-assets')) continue;
    for (const control of section.querySelectorAll('input, button, select')) control.disabled = true;
    section.dataset.capability = 'unavailable';
    section.title = 'Not enabled in this remote-only checkpoint; local launch parity is planned';
  }
}
disableUnavailableControls();
// Settings initialization may re-enable controls after async rendering. Observe
// only these capability sections, not the editor or the rest of the document.
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes' && record.target.disabled) continue;
    const section = record.target.closest?.('[data-capability="unavailable"]');
    if (section) for (const control of section.querySelectorAll('input, button, select'))
      if (!control.disabled) control.disabled = true;
  }
});
for (const section of document.querySelectorAll('[data-capability="unavailable"]'))
  observer.observe(section, {subtree: true, childList: true, attributes: true, attributeFilter: ['disabled']});
window.addEventListener('pagehide', () => observer.disconnect(), {once: true});

const settings = window.location.pathname.endsWith('/settings.html');
await import(settings ? './settings.js' : './launcher.js');
