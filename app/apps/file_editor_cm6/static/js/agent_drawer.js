// app/apps/file_editor_cm6/static/js/agent_drawer.js
// Rough UI scaffolding for the Agent drawer. No backend wiring yet.

function notify(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    console.log(message);
  }
}

export function initAgentDrawer() {
  const drawer = document.getElementById('agent-drawer');
  const toggle = document.getElementById('fe-agent-toggle');
  const closeBtn = document.getElementById('agent-close');
  const collapseBtn = document.getElementById('agent-collapse');
  const fullscreenBtn = document.getElementById('agent-fullscreen');
  const newSessionBtn = document.getElementById('agent-new-session');
  const refreshBtn = document.getElementById('agent-refresh');
  const sendBtn = document.getElementById('agent-send');
  const transcript = document.getElementById('agent-transcript');
  const composer = document.getElementById('agent-input');
  const sessionList = document.getElementById('agent-session-list');

  if (!drawer || !toggle) {
    return { open: () => {}, close: () => {} };
  }

  let isOpen = false;
  let isFullscreen = false;

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openDrawer() {
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
  }

  function closeDrawer() {
    if (!isOpen) return;
    drawer.classList.remove('open');
    drawer.classList.remove('agent-drawer--fullscreen');
    isOpen = false;
    isFullscreen = false;
    updateAria();
  }

  function toggleDrawer() {
    if (isOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  toggle.addEventListener('click', toggleDrawer);
  closeBtn?.addEventListener('click', closeDrawer);
  collapseBtn?.addEventListener('click', () => {
    notify('Agent drawer collapsed');
    closeDrawer();
  });
  fullscreenBtn?.addEventListener('click', () => {
    if (!isOpen) openDrawer();
    isFullscreen = !isFullscreen;
    drawer.classList.toggle('agent-drawer--fullscreen', isFullscreen);
  });

  newSessionBtn?.addEventListener('click', () => {
    notify('New agent session (UI only)');
    const placeholder = document.createElement('li');
    placeholder.className = 'agent-session-list__item';
    placeholder.textContent = `Session ${sessionList.children.length + 1}`;
    const empty = sessionList.querySelector('.agent-session-list__item--empty');
    if (empty) empty.remove();
    sessionList.appendChild(placeholder);
  });

  refreshBtn?.addEventListener('click', () => {
    notify('Refresh sessions (stub)');
  });

  sendBtn?.addEventListener('click', () => {
    const text = composer?.value?.trim();
    if (!text) {
      notify('Enter a prompt to send to the agent.');
      return;
    }
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
    bubble.textContent = text;
    transcript?.appendChild(bubble);
    composer.value = '';
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  });

  return {
    open: openDrawer,
    close: closeDrawer,
  };
}
