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

function formatStatus(host, port) {
  if (!host || !port) return 'Not running';
  return `Listening on ${host}:${port}`;
}

export default function initCodeOSS(container, _api, host) {
  if (!container) return;
  host?.setTitle?.('Code IDE');

  const statusBox = container.querySelector('#code-oss-status');
  const statusDetail = container.querySelector('#code-oss-status-detail');
  const launchBtn = container.querySelector('#code-oss-launch');
  const stopBtn = container.querySelector('#code-oss-stop');
  const copyBtn = container.querySelector('#code-oss-copy-link');

  if (!statusBox || !launchBtn || !stopBtn || !copyBtn) {
    return;
  }

  function setStatus(state, headline, detail) {
    statusBox.dataset.state = state;
    statusBox.querySelector('strong').textContent = headline;
    if (statusDetail) statusDetail.textContent = detail;
  }

  async function refreshStatus() {
    try {
      const data = await apiCall('/api/app/code_oss/status');
      if (data.running) {
        setStatus('running', 'Server is running', formatStatus(data.host, data.port));
        launchBtn.disabled = false;
        stopBtn.disabled = false;
      } else {
        setStatus('idle', 'Server is stopped', 'Launch the IDE to start a fresh session.');
        launchBtn.disabled = false;
        stopBtn.disabled = true;
      }
    } catch (error) {
      setStatus('error', 'Status unavailable', error.message || 'Unknown error');
      launchBtn.disabled = false;
      stopBtn.disabled = false;
    }
  }

  launchBtn?.addEventListener('click', async () => {
    launchBtn.disabled = true;
    setStatus('checking', 'Starting server…', 'Booting the bundled code-server binary.');
    try {
      await apiCall('/api/app/code_oss/start', { method: 'POST' });
      host?.toast?.('Code OSS started');
      window.open('/api/app/code_oss/fullpage', '_blank');
      await refreshStatus();
    } catch (error) {
      launchBtn.disabled = false;
      host?.toast?.(`Start failed: ${error.message}`, { variant: 'error' });
      setStatus('error', 'Failed to start', error.message || 'Unknown error');
    }
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

  ensureWorkerReady().finally(() => {
    refreshStatus();
  });
}
