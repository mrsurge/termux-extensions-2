async function apiCall(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    const error = body.error || `HTTP ${response.status}`;
    throw new Error(error);
  }
  return body.data || {};
}


async function ensureWorkerReady() {
  try {
    await apiCall('/api/apps/code_oss/start', { method: 'POST' });
  } catch (error) {
    console.warn('Failed to ensure Code OSS worker', error);
  }
}

function resolveHost(host) {
  if (!host || host === '0.0.0.0' || host === '127.0.0.1') {
    return window.location.hostname || '127.0.0.1';
  }
  return host;
}

function formatStatus(host, port, project, bridgeInstalled, bridgeVersion) {
  if (!host || !port) return 'Not running';
  const base = `Listening on ${resolveHost(host)}:${port}`;
  const details = [];
  if (project) details.push(project);
  if (bridgeInstalled) {
    details.push(`Bridge v${bridgeVersion || '?'}`);
  }
  if (!details.length) return base;
  return `${base} • ${details.join(' • ')}`;
}

export default function initCodeOSS(container, _api, host) {
  if (!container) return;
  host?.setTitle?.('Code IDE');

  const statusBox = container.querySelector('#code-oss-status');
  const statusDetail = container.querySelector('#code-oss-status-detail');
  const startBtn = container.querySelector('#code-oss-start');
  const launchBtn = container.querySelector('#code-oss-launch');
  const stopBtn = container.querySelector('#code-oss-stop');
  const copyBtn = container.querySelector('#code-oss-copy-link');
  const bridgeBtn = container.querySelector('#code-oss-install-bridge');
  const bridgeStatus = container.querySelector('#code-oss-bridge-status');

  if (!statusBox || !startBtn || !launchBtn || !stopBtn || !copyBtn) {
    return;
  }

  function setStatus(state, headline, detail) {
    statusBox.dataset.state = state;
    statusBox.querySelector('strong').textContent = headline;
    if (statusDetail) statusDetail.textContent = detail;
  }

  function updateBridgeState(data = {}) {
    const installed = !!data.bridge_installed;
    const version = data.bridge_version;
    if (bridgeStatus) {
      bridgeStatus.dataset.state = installed ? 'installed' : data.error ? 'error' : 'missing';
      if (installed) {
        bridgeStatus.textContent = version
          ? `Bridge extension installed (v${version}).`
          : 'Bridge extension installed.';
      } else if (data.error) {
        bridgeStatus.textContent = `Bridge extension error: ${data.error}`;
      } else {
        bridgeStatus.textContent = 'Bridge extension not installed.';
      }
    }
    if (bridgeBtn) {
      bridgeBtn.textContent = installed ? 'Reinstall Bridge' : 'Install Bridge';
    }
  }

  async function refreshStatus() {
    try {
      const data = await apiCall('/api/app/code_oss/status');
      if (data.running) {
        setStatus('running', 'Server is running', formatStatus(data.host, data.port, data.project_path, data.bridge_installed, data.bridge_version));
        startBtn.disabled = true;
        launchBtn.disabled = false;
        stopBtn.disabled = false;
      } else {
        setStatus('idle', 'Server is stopped', 'Launch the IDE to start a fresh session.');
        startBtn.disabled = false;
        launchBtn.disabled = true;
        stopBtn.disabled = true;
      }
      updateBridgeState(data);
    } catch (error) {
      setStatus('error', 'Status unavailable', error.message || 'Unknown error');
      startBtn.disabled = false;
      launchBtn.disabled = true;
      stopBtn.disabled = false;
      updateBridgeState({ error: error.message });
    }
  }

  startBtn?.addEventListener('click', async () => {
    startBtn.disabled = true;
    setStatus('checking', 'Starting server…', 'Booting the bundled code-server binary.');
    try {
      const data = await apiCall('/api/app/code_oss/start', { method: 'POST' });
      host?.toast?.('Code OSS started');
      updateBridgeState(data);
      await refreshStatus();
    } catch (error) {
      startBtn.disabled = false;
      host?.toast?.(`Start failed: ${error.message}`, { variant: 'error' });
      setStatus('error', 'Failed to start', error.message || 'Unknown error');
    }
  });

  launchBtn?.addEventListener('click', () => {
    window.location.assign('/api/app/code_oss/fullpage');
  });

  stopBtn?.addEventListener('click', async () => {
    stopBtn.disabled = true;
    try {
      await apiCall('/api/app/code_oss/stop', { method: 'POST' });
      host?.toast?.('Code OSS stopped');
      setStatus('idle', 'Server is stopped', 'Launch the IDE to start a fresh session.');
      await refreshStatus();
    } catch (error) {
      host?.toast?.(`Stop failed: ${error.message}`, { variant: 'error' });
    } finally {
      stopBtn.disabled = false;
    }
  });

  copyBtn?.addEventListener('click', async () => {
    const link = `${window.location.origin}/api/app/code_oss/fullpage`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const temp = document.createElement('textarea');
        temp.value = link;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      host?.toast?.('Full-page IDE link copied to clipboard.');
    } catch (error) {
      host?.toast?.(`Unable to copy link: ${error?.message || error}`, { variant: 'error' });
    }
  });

  bridgeBtn?.addEventListener('click', async () => {
    bridgeBtn.disabled = true;
    const previous = bridgeBtn.textContent;
    bridgeBtn.textContent = 'Installing…';
    let succeeded = false;
    let errorMessage = null;
    try {
      const data = await apiCall('/api/app/code_oss/bridge/install', { method: 'POST' });
      updateBridgeState(data);
      host?.toast?.('Bridge extension installed.', { variant: 'success' });
      succeeded = true;
    } catch (error) {
      host?.toast?.(`Bridge install failed: ${error.message}`, { variant: 'error' });
      errorMessage = error.message;
    } finally {
      bridgeBtn.disabled = false;
    }
    if (succeeded) {
      try {
        await refreshStatus();
      } catch (error) {
        updateBridgeState({ error: error.message });
      }
    } else {
      bridgeBtn.textContent = previous;
      updateBridgeState({ error: errorMessage });
    }
  });

  ensureWorkerReady().finally(() => {
    refreshStatus();
  });
}
