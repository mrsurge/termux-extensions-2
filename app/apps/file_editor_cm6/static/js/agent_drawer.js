// app/apps/file_editor_cm6/static/js/agent_drawer.js
// Agent drawer with WebSocket backend integration and multi-session support

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
  const targetSelect = document.getElementById('agent-target');
  const attachFileCheck = document.getElementById('agent-attach-file');
  const statsEl = document.getElementById('agent-stats');

  if (!drawer || !toggle) {
    return { open: () => {}, close: () => {} };
  }

  // State management
  let isOpen = false;
  let isFullscreen = false;
  let ws = null;
  let messageIdCounter = 0;
  let currentAssistantBubble = null;
  let sessions = {}; // sessionId -> { id, agent, messages, ws, stats }
  let activeSessionId = null;

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openDrawer() {
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
    
    // Reconnect active session if needed
    if (activeSessionId && sessions[activeSessionId]) {
      const session = sessions[activeSessionId];
      if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        connectSession(activeSessionId);
      }
    }
  }

  function closeDrawer() {
    if (!isOpen) return;
    drawer.classList.remove('open');
    drawer.classList.remove('agent-drawer--fullscreen');
    isOpen = false;
    isFullscreen = false;
    updateAria();
    
    // Keep sessions alive - don't disconnect on close
  }

  function toggleDrawer() {
    if (isOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  function createSession(agent = 'codex') {
    const sessionId = generateSessionId();
    const session = {
      id: sessionId,
      agent: agent,
      messages: [],
      ws: null,
      stats: { status: 'Created', agent }
    };
    
    sessions[sessionId] = session;
    addSessionToList(session);
    switchToSession(sessionId);
    connectSession(sessionId);
    
    notify(`Created new ${agent} session`);
  }

  function addSessionToList(session) {
    // Remove empty placeholder
    const empty = sessionList?.querySelector('.agent-session-list__item--empty');
    if (empty) empty.remove();
    
    const li = document.createElement('li');
    li.className = 'agent-session-list__item';
    li.dataset.sessionId = session.id;
    li.innerHTML = `
      <span>${session.agent} - ${new Date().toLocaleTimeString()}</span>
      <button class="agent-session-delete" data-session-id="${session.id}">×</button>
    `;
    
    li.addEventListener('click', (e) => {
      if (!e.target.classList.contains('agent-session-delete')) {
        switchToSession(session.id);
      }
    });
    
    const deleteBtn = li.querySelector('.agent-session-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(session.id);
    });
    
    sessionList?.appendChild(li);
  }

  function deleteSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;
    
    // Close WebSocket
    if (session.ws) {
      session.ws.close();
    }
    
    // Remove from DOM
    const li = sessionList?.querySelector(`[data-session-id="${sessionId}"]`);
    if (li) li.remove();
    
    // Remove from state
    delete sessions[sessionId];
    
    // Switch to another session or show empty
    const remaining = Object.keys(sessions);
    if (remaining.length > 0) {
      switchToSession(remaining[0]);
    } else {
      activeSessionId = null;
      clearTranscript();
      const empty = document.createElement('li');
      empty.className = 'agent-session-list__item agent-session-list__item--empty';
      empty.textContent = 'No sessions yet';
      sessionList?.appendChild(empty);
    }
    
    notify('Session deleted');
  }

  function switchToSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;
    
    // Update active session
    activeSessionId = sessionId;
    
    // Update UI active state
    sessionList?.querySelectorAll('.agent-session-list__item').forEach(li => {
      li.classList.toggle('agent-session-list__item--active', li.dataset.sessionId === sessionId);
    });
    
    // Render messages
    renderMessages(session.messages);
    
    // Update stats
    updateStats(session.stats);
    
    // Update target selector
    if (targetSelect) {
      targetSelect.value = session.agent;
    }
    
    // Reconnect if needed
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      connectSession(sessionId);
    }
  }

  function connectSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;
    
    // Close existing connection
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }
    
    // Get current file context
    const currentFile = window.currentPath || null;
    const projectRoot = window.currentProjectPath || null;
    
    // Build WebSocket URL
    const wsUrl = new URL('/ws/app/file_editor_cm6/agent', window.location.href);
    wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
    wsUrl.searchParams.set('session', sessionId);
    wsUrl.searchParams.set('agent', session.agent);
    if (currentFile) wsUrl.searchParams.set('file', currentFile);
    if (projectRoot) wsUrl.searchParams.set('cwd', projectRoot);
    
    notify(`Connecting to ${session.agent}...`);
    session.stats.status = 'Connecting';
    updateStats(session.stats);
    
    session.ws = new WebSocket(wsUrl.toString());
    
    session.ws.onopen = () => {
      notify(`Connected to ${session.agent}`);
      session.stats.status = 'Connected';
      updateStats(session.stats);
    };
    
    session.ws.onmessage = (event) => {
      handleAgentMessage(sessionId, JSON.parse(event.data));
    };
    
    session.ws.onerror = (error) => {
      notify('Agent connection error');
      console.error('Agent WS error:', error);
      session.stats.status = 'Error';
      updateStats(session.stats);
    };
    
    session.ws.onclose = () => {
      notify('Agent disconnected');
      session.stats.status = 'Disconnected';
      updateStats(session.stats);
      session.ws = null;
    };
  }

  function handleAgentMessage(sessionId, msg) {
    const session = sessions[sessionId];
    if (!session) return;
    
    // Only process if this is the active session
    const isActive = sessionId === activeSessionId;
    
    switch (msg.event) {
      case 'token':
        session.messages.push({ type: 'token', text: msg.text, agent: msg.agent });
        if (isActive) appendAssistantToken(msg.text);
        break;
        
      case 'planning':
        session.messages.push({ type: 'planning', summary: msg.summary });
        if (isActive) addSystemMessage(`Planning: ${msg.summary}`);
        break;
        
      case 'tool_call':
        session.messages.push({ type: 'tool_call', tool: msg.tool, args: msg.args });
        if (isActive) addSystemMessage(`Tool: ${msg.tool}`);
        break;
        
      case 'diff':
        session.messages.push({ type: 'diff', path: msg.path, patch: msg.patch });
        if (isActive) addDiffMessage(msg.path, msg.patch);
        break;
        
      case 'final':
        session.messages.push({ type: 'final', output: msg.output });
        if (isActive) finishAssistantMessage();
        notify('Agent completed');
        break;
        
      case 'error':
        session.messages.push({ type: 'error', error: msg.error });
        if (isActive) addErrorMessage(msg.error);
        break;
        
      case 'result':
        // Stats or capabilities
        if (msg.result) {
          Object.assign(session.stats, msg.result);
          if (isActive) updateStats(session.stats);
        }
        break;
    }
  }

  function sendMessage(text) {
    if (!activeSessionId) {
      notify('No active session. Create a new session first.');
      return;
    }
    
    const session = sessions[activeSessionId];
    if (!session) return;
    
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      notify('Agent not connected. Reconnecting...');
      connectSession(activeSessionId);
      setTimeout(() => sendMessage(text), 1000);
      return;
    }
    
    const message = {
      id: String(++messageIdCounter),
      action: 'chat',
      text: text,
      target: session.agent
    };
    
    // Attach file context if enabled
    if (attachFileCheck?.checked && window.currentPath) {
      message.file = window.currentPath;
    }
    
    // Store user message
    session.messages.push({ type: 'user', text });
    
    // Send to agent
    session.ws.send(JSON.stringify(message));
    
    // Show in transcript
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
    bubble.textContent = text;
    transcript?.appendChild(bubble);
    composer.value = '';
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function renderMessages(messages) {
    clearTranscript();
    
    if (!messages || messages.length === 0) {
      return;
    }
    
    let assistantBubble = null;
    
    messages.forEach(msg => {
      switch (msg.type) {
        case 'user':
          assistantBubble = null;
          const userBubble = document.createElement('div');
          userBubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
          userBubble.textContent = msg.text;
          transcript?.appendChild(userBubble);
          break;
          
        case 'token':
          if (!assistantBubble) {
            assistantBubble = document.createElement('div');
            assistantBubble.className = 'agent-transcript__bubble agent-transcript__bubble--assistant';
            assistantBubble.textContent = '';
            transcript?.appendChild(assistantBubble);
          }
          assistantBubble.textContent += msg.text;
          break;
          
        case 'planning':
          assistantBubble = null;
          const planBubble = document.createElement('div');
          planBubble.className = 'agent-transcript__bubble agent-transcript__bubble--system';
          planBubble.textContent = `Planning: ${msg.summary}`;
          transcript?.appendChild(planBubble);
          break;
          
        case 'tool_call':
          assistantBubble = null;
          const toolBubble = document.createElement('div');
          toolBubble.className = 'agent-transcript__bubble agent-transcript__bubble--system';
          toolBubble.textContent = `Tool: ${msg.tool}`;
          transcript?.appendChild(toolBubble);
          break;
          
        case 'diff':
          assistantBubble = null;
          addDiffMessage(msg.path, msg.patch);
          break;
          
        case 'error':
          assistantBubble = null;
          addErrorMessage(msg.error);
          break;
          
        case 'final':
          assistantBubble = null;
          break;
      }
    });
    
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'instant' });
  }

  function clearTranscript() {
    if (transcript) {
      transcript.innerHTML = '<div class="agent-transcript__placeholder">Start a session to see the conversation stream here.</div>';
    }
    currentAssistantBubble = null;
  }

  function appendAssistantToken(text) {
    // Remove placeholder
    const placeholder = transcript?.querySelector('.agent-transcript__placeholder');
    if (placeholder) placeholder.remove();
    
    if (!currentAssistantBubble) {
      currentAssistantBubble = document.createElement('div');
      currentAssistantBubble.className = 'agent-transcript__bubble agent-transcript__bubble--assistant';
      currentAssistantBubble.textContent = '';
      transcript?.appendChild(currentAssistantBubble);
    }
    currentAssistantBubble.textContent += text;
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function finishAssistantMessage() {
    currentAssistantBubble = null;
  }

  function addSystemMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--system';
    bubble.textContent = text;
    transcript?.appendChild(bubble);
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function addErrorMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--error';
    bubble.textContent = `Error: ${text}`;
    transcript?.appendChild(bubble);
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function addDiffMessage(path, patch) {
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--diff';
    bubble.innerHTML = `
      <strong>Code Change:</strong> ${path}
      <pre><code>${patch}</code></pre>
      <button class="fe-btn" onclick="alert('Apply diff: ${path}')">Apply</button>
    `;
    transcript?.appendChild(bubble);
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function updateStats(stats) {
    if (!statsEl) return;
    
    statsEl.innerHTML = `
      <div><dt>Status</dt><dd>${stats.status || 'Idle'}</dd></div>
      <div><dt>Agent</dt><dd>${stats.agent || '—'}</dd></div>
      <div><dt>CPU</dt><dd>${stats.cpu_percent ? stats.cpu_percent.toFixed(1) + '%' : '—'}</dd></div>
      <div><dt>Memory</dt><dd>${stats.rss_mb ? stats.rss_mb.toFixed(1) + ' MB' : '—'}</dd></div>
      <div><dt>Uptime</dt><dd>${stats.uptime ? Math.floor(stats.uptime) + 's' : '—'}</dd></div>
    `;
  }

  async function loadSessions() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/agent/list');
      const json = await resp.json();
      if (json.ok && json.data) {
        // Future: restore sessions from backend
        // For now, just start fresh
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  // Event listeners
  toggle.addEventListener('click', toggleDrawer);
  closeBtn?.addEventListener('click', closeDrawer);
  
  collapseBtn?.addEventListener('click', () => {
    closeDrawer();
  });
  
  fullscreenBtn?.addEventListener('click', () => {
    if (!isOpen) openDrawer();
    isFullscreen = !isFullscreen;
    drawer.classList.toggle('agent-drawer--fullscreen', isFullscreen);
  });

  newSessionBtn?.addEventListener('click', () => {
    const agent = targetSelect?.value || 'codex';
    createSession(agent);
  });

  refreshBtn?.addEventListener('click', () => {
    loadSessions();
  });

  sendBtn?.addEventListener('click', () => {
    const text = composer?.value?.trim();
    if (!text) {
      notify('Enter a prompt to send to the agent.');
      return;
    }
    sendMessage(text);
  });

  composer?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn?.click();
    }
  });

  // Initialize
  loadSessions();

  return {
    open: openDrawer,
    close: closeDrawer,
    createSession,
  };
}
