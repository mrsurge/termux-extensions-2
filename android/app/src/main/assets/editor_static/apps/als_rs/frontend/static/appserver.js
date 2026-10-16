(() => {
  const statusEl = document.getElementById('appserver-status');
  const wsStatusEl = document.getElementById('ws-status');
  const timelineEl = document.getElementById('timeline');
  const startBtn = document.getElementById('appserver-start');
  const stopBtn = document.getElementById('appserver-stop');
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('turn-send');

  let socket = null;
  let initialized = false;
  let rpcId = 1;

  function setPill(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = `pill ${cls || ''}`.trim();
  }

  function appendTimeline(text, kind = 'info') {
    if (!timelineEl) return;
    const div = document.createElement('div');
    div.textContent = text;
    div.className = `timeline-item ${kind}`;
    timelineEl.appendChild(div);
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }

  function nextRpcId() {
    const id = rpcId;
    rpcId += 1;
    return id;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  async function fetchStatus() {
    try {
      const data = await sioCall('get_status');
      if (data?.running) {
        setPill(statusEl, 'running', 'ok');
      } else {
        setPill(statusEl, 'disconnected', 'warn');
      }
    } catch {
      setPill(statusEl, 'error', 'err');
    }
  }

  async function fetchConfig() {
    try {
      const data = await sioCall('get_config');
      return (data && typeof data === 'object') ? data : {};
    } catch {
      return {};
    }
  }

  async function ensureInitialized() {
    if (initialized) return;
    try {
      const result = await sioCall('app_initialize');
      if (result?.ok === false) {
        throw new Error(result.error || 'initialize failed');
      }
    } catch {
      // ignore init failures; app-server may already be initialized
    }
    initialized = true;
  }

  async function ensureThreadId() {
    const cfg = await fetchConfig();
    if (cfg.thread_id) return cfg.thread_id;
    const result = await sioCall('rpc', {
      id: nextRpcId(),
      method: 'thread/start',
      params: {},
    });
    if (result?.ok === false) {
      throw new Error(result.error || 'thread/start failed');
    }
    for (let i = 0; i < 20; i += 1) {
      await sleep(200);
      const nextCfg = await fetchConfig();
      if (nextCfg.thread_id) return nextCfg.thread_id;
    }
    return null;
  }

  async function sendPrompt() {
    const text = promptEl?.value?.trim();
    if (!text) return;
    promptEl.value = '';
    try {
      const startResult = await sioCall('app_start');
      if (startResult?.ok === false) {
        throw new Error(startResult.error || 'start failed');
      }
      await ensureInitialized();
      const threadId = await ensureThreadId();
      if (!threadId) {
        appendTimeline('Unable to obtain thread id', 'error');
        return;
      }
      const result = await sioCall('rpc', {
        id: nextRpcId(),
        method: 'turn/start',
        params: {
          threadId,
          input: [{ type: 'text', text }],
        },
      });
      if (result?.ok === false) {
        throw new Error(result.error || 'turn/start failed');
      }
    } catch (err) {
      appendTimeline(`Send failed: ${err}`, 'error');
    }
  }

  function bindSocket() {
    const socketOptions = window.agentLogSocketIoOptions || ((options) => options);
    socket = io('/appserver', socketOptions({
      transports: ['websocket'],
    }));
    setPill(wsStatusEl, 'connecting', 'warn');

    socket.on('connect', () => {
      setPill(wsStatusEl, 'connected', 'ok');
      void fetchStatus();
    });

    socket.on('disconnect', () => {
      setPill(wsStatusEl, 'closed', 'err');
      setPill(statusEl, 'disconnected', 'warn');
    });

    socket.on('connect_error', () => {
      setPill(wsStatusEl, 'error', 'err');
    });

    socket.on('appserver_event', (msg) => {
      try {
        appendTimeline(`[${msg?.method || msg?.type || 'event'}] ${JSON.stringify(msg?.params || msg)}`);
      } catch {
        appendTimeline(String(msg));
      }
    });
  }

  bindSocket();
  setPill(statusEl, 'disconnected', 'warn');

  startBtn?.addEventListener('click', async () => {
    try {
      const result = await sioCall('app_start');
      if (result?.ok === false) {
        throw new Error(result.error || 'start failed');
      }
      await fetchStatus();
    } catch (err) {
      appendTimeline(`Start failed: ${err}`, 'error');
    }
  });

  stopBtn?.addEventListener('click', async () => {
    try {
      const result = await sioCall('app_stop');
      if (result?.ok === false) {
        throw new Error(result.error || 'stop failed');
      }
      await fetchStatus();
    } catch (err) {
      appendTimeline(`Stop failed: ${err}`, 'error');
    }
  });

  sendBtn?.addEventListener('click', async () => {
    await sendPrompt();
  });

  promptEl?.addEventListener('keydown', async (evt) => {
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      await sendPrompt();
    }
  });
})();
