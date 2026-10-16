/* UI with Socket.IO for realtime updates */
const whoEl = document.getElementById('who');
const msgEl = document.getElementById('msg');
const chatEl = document.getElementById('chat');
const statusEl = document.getElementById('status');
const sendBtn = document.getElementById('send');
const refreshBtn = document.getElementById('refresh');
const quitBtn = document.getElementById('quit');

const STORAGE_KEY = 'agent_log_who';
let socket = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'red' : '';
}

function loadWho() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) whoEl.value = saved;
  if (!whoEl.value) whoEl.value = 'agent';
}

function saveWho() {
  localStorage.setItem(STORAGE_KEY, whoEl.value.trim());
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function addMessage(m, append = true) {
  const div = document.createElement('div');
  div.className = 'msg';
  const ts = escapeHtml(m.ts || '');
  const who = escapeHtml(m.who || '');
  const msg = escapeHtml(m.message || '');
  const msgNum = Number.isInteger(m.msg_num) ? `#${escapeHtml(m.msg_num)}` : '';
  const msgNumHtml = msgNum ? `<span class="msg-num">${msgNum}</span> ` : '';
  div.innerHTML = `<div class="meta">${msgNumHtml}<span class="ts">${ts}</span> <span class="who">${who}</span></div><div class="body">${msg}</div>`;

  if (append) {
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  } else {
    chatEl.prepend(div);
  }
}

async function sioCall(event, payload = {}, timeoutMs = 10000) {
  if (!socket || !socket.connected) {
    throw new Error('Socket.IO not connected');
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Socket.IO timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack && ack.__error) {
        reject(new Error(String(ack.__error)));
        return;
      }
      resolve(ack);
    });
  });
}

async function fetchHistory() {
  try {
    setStatus('loading history…');
    const data = await sioCall('get_log_messages', { limit: 100 });
    chatEl.innerHTML = '';
    (Array.isArray(data) ? data : []).forEach((m) => addMessage(m));
    setStatus('connected');
  } catch (e) {
    setStatus(String(e), true);
  }
}

function connectSocket() {
  const socketOptions = window.agentLogSocketIoOptions || ((options) => options);
  socket = io('/appserver', socketOptions({
    transports: ['websocket'],
  }));

  socket.on('connect', () => {
    setStatus('connected');
    void fetchHistory();
  });

  socket.on('agent_log_message', (data) => {
    addMessage(data);
  });

  socket.on('disconnect', () => {
    setStatus('disconnected (retrying...)', true);
  });

  socket.on('connect_error', (err) => {
    setStatus(String(err), true);
  });
}

async function postMessage() {
  const who = whoEl.value.trim();
  const message = msgEl.value.trim();
  if (!who || !message) return;
  saveWho();

  try {
    const result = await sioCall('post_log_message', { who, message });
    if (result?.ok === false) {
      throw new Error(result.error || 'Post failed');
    }
    msgEl.value = '';
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function quitServer() {
  if (!confirm('Shutdown server?')) return;
  try {
    setStatus('shutting down…');
    await sioCall('shutdown_request', {});
  } catch {
    setStatus('shutdown requested');
  }
}

sendBtn.addEventListener('click', postMessage);
refreshBtn.addEventListener('click', fetchHistory);
if (quitBtn) quitBtn.addEventListener('click', quitServer);

msgEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    postMessage();
  }
});

whoEl.addEventListener('change', saveWho);

loadWho();
connectSocket();
