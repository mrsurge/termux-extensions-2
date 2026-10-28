// Consumer UI only. Native registration owns authorization and action semantics.
const buttons = [...document.querySelectorAll('[data-action]')];
const errorBox = document.getElementById('chrome-error');
const titleBox = document.getElementById('chrome-title');
const scaleDown = buttons.find(button => button.dataset.action === 'scale-down');
const scaleReset = buttons.find(button => button.dataset.action === 'scale-reset');
const scaleUp = buttons.find(button => button.dataset.action === 'scale-up');
const quitButton = buttons.find(button => button.dataset.action === 'quit');
let quitArmedUntil = 0;
let quitTimer = null;
function disarmQuit() {
  if (quitTimer !== null) clearTimeout(quitTimer);
  quitTimer = null;
  quitArmedUntil = 0;
  quitButton.dataset.armed = 'false';
  quitButton.textContent = 'Quit';
  quitButton.setAttribute('aria-pressed', 'false');
  quitButton.setAttribute('aria-label', 'Quit current app');
  quitButton.setAttribute('title', 'Quit current app');
}
function armQuit() {
  disarmQuit();
  quitArmedUntil = performance.now() + 3000;
  quitButton.dataset.armed = 'true';
  quitButton.textContent = 'Quit?';
  quitButton.setAttribute('aria-pressed', 'true');
  quitButton.setAttribute('aria-label', 'Tap again within three seconds to quit current app');
  quitButton.setAttribute('title', 'Tap again within three seconds to quit current app');
  quitTimer = setTimeout(disarmQuit, 3000);
}
let currentScale = 100;
let currentAppId = null;
let bridge = null;
let disposed = false;
let refresh = null;
function renderScaleLimits() {
  scaleDown.disabled = currentScale <= 60;
  scaleUp.disabled = currentScale >= 180;
}
function renderState(state) {
  if (disposed || !state || typeof state !== 'object') return;
  if (typeof state.appId === 'string' && state.appId !== currentAppId) {
    disarmQuit();
    currentAppId = state.appId;
  }
  const title = typeof state.title === 'string' && state.title.trim() ? state.title : 'TE2 Termux';
  titleBox.textContent = title;
  titleBox.title = title;
  if (Number.isInteger(state.uiScalePercent) && state.uiScalePercent >= 60 && state.uiScalePercent <= 180) {
    currentScale = state.uiScalePercent;
  }
  scaleReset.textContent = `${currentScale}%`;
  renderScaleLimits();
}
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
    bridge.on('chrome-state', renderState);
  }
  if (!refresh) refresh = bridge.request('get_chrome_state').then(state => { renderState(state); errorBox.textContent = ''; })
    .catch(error => { errorBox.textContent = error.message; })
    .finally(() => { refresh = null; });
}
for (const button of buttons) button.addEventListener('click', async () => {
  if (disposed || !bridge || button.disabled) return;
  if (button.dataset.action === 'quit') {
    if (performance.now() >= quitArmedUntil) { armQuit(); return; }
    disarmQuit();
  } else disarmQuit();
  button.disabled = true;
  errorBox.textContent = '';
  try { renderState(await window.te2Desktop.request('view_action', {action: button.dataset.action})); }
  catch (error) { errorBox.textContent = error.message; }
  finally { button.disabled = false; renderScaleLimits(); }
});
window.addEventListener('electromux:page-ready', ready);
window.addEventListener('blur', disarmQuit);
window.addEventListener('pagehide', () => {
  disposed = true;
  disarmQuit();
  window.removeEventListener('electromux:page-ready', ready);
  window.removeEventListener('blur', disarmQuit);
  bridge?.dispose();
  delete window.__electromuxReceiveEvent;
  delete window.te2Desktop;
}, {once: true});
ready();
