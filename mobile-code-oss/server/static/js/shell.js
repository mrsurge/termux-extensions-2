// Parent-shell controller for the embedded Code-OSS UI.
// Assumes Code-OSS (or code-server UI) is hosted at same-origin under CODE_IFRAME_URL.

const ide = document.getElementById('ide');
const btnHam = document.getElementById('btn-ham');
const btnSearch = document.getElementById('btn-search');
const btnCmd = document.getElementById('btn-cmd');
const btnSettings = document.getElementById('btn-settings');
const tabs = document.getElementById('tabs');
const chatSelect = document.getElementById('chat-provider');

// Bridge: send a command to the iframe (handled by a VS Code web extension)
function sendCommand(cmd, args = {}) {
  const msg = { _mobileShell: true, type: 'command', cmd, args };
  ide.contentWindow?.postMessage(msg, window.location.origin);
}

// Receive state updates from the bridge extension
window.addEventListener('message', (ev) => {
  if (ev.origin !== window.location.origin) return;
  const data = ev.data || {};
  if (!data || !data._mobileBridge) return;
  // Example: { _mobileBridge:true, type:'state', sidebarVisible:true, panelVisible:false }
  if (data.type === 'state') {
    document.body.classList.toggle('dim', !!(data.sidebarVisible || data.panelVisible));
  }
  if (data.type === 'chatProviders') {
    // Populate chat provider list
    chatSelect.innerHTML = '';
    (data.providers || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.label || p.id;
      chatSelect.appendChild(opt);
    });
  }
});

// Top bar controls
btnHam.addEventListener('click', () => sendCommand('toggleSidebar'));
btnSearch.addEventListener('click', () => sendCommand('openSearch'));
btnCmd.addEventListener('click', () => sendCommand('showCommands'));
btnSettings.addEventListener('click', () => sendCommand('openSettingsJSON'));

// Bottom tabs
tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  const tab = btn.getAttribute('data-tab');
  if (tab === 'explorer') sendCommand('focusExplorer');
  if (tab === 'terminal') sendCommand('focusTerminalPanel');
  if (tab === 'problems') sendCommand('focusProblems');
  if (tab === 'output') sendCommand('focusOutput');
});

chatSelect.addEventListener('change', () => {
  const id = chatSelect.value;
  if (id) sendCommand('showView', { viewId: id, inPanel: true });
});

// On load, ask the bridge to report available chat providers and initial state
function ping() {
  ide.contentWindow?.postMessage({ _mobileShell: true, type: 'hello' }, window.location.origin);
}
window.addEventListener('load', () => setTimeout(ping, 500));
