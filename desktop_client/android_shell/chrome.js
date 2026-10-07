// Consumer UI only. Native registration owns authorization and action semantics.
const buttons = [...document.querySelectorAll('[data-action]')];
const errorBox = document.getElementById('chrome-error');
let bridge = null;
let disposed = false;
let refresh = null;
const documentId = crypto.randomUUID().replaceAll('-', '');
function ready() {
  if (disposed || typeof window.cefriumQuery !== 'function') return;
  if (!bridge) {
    bridge = window.ElectromuxBridge.create({
      query: options => window.cefriumQuery(options), documentId,
      methods: ['view_action', 'get_chrome_state'], events: ['chrome-state'],
    });
    window.__electromuxReceiveEvent = raw => bridge.receiveEvent(raw);
    // Same request/subscription shape as Electron shell-preload, not app-view-preload.
    window.te2Desktop = Object.freeze({ request: bridge.request,
      onStatus: callback => bridge.on('chrome-state', callback) });
  }
  if (!refresh) refresh = bridge.request('get_chrome_state').then(() => { errorBox.textContent = ''; })
    .catch(error => { errorBox.textContent = error.message; })
    .finally(() => { refresh = null; });
}
for (const button of buttons) button.addEventListener('click', async () => {
  if (!bridge || button.disabled) return;
  button.disabled = true;
  errorBox.textContent = '';
  try { await window.te2Desktop.request('view_action', {action: button.dataset.action}); }
  catch (error) { errorBox.textContent = error.message; }
  finally { button.disabled = false; }
});
window.addEventListener('electromux:page-ready', ready);
window.addEventListener('pagehide', () => {
  disposed = true;
  window.removeEventListener('electromux:page-ready', ready);
  bridge?.dispose();
  delete window.__electromuxReceiveEvent;
  delete window.te2Desktop;
}, {once: true});
ready();
