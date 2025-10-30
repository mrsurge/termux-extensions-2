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

  let isOpen = false;
  let isFullscreen = false;
  let ws = null;
  let messageIdCounter = 0;
  let currentAssistantBubble = null;
  let currentPlanningSection = null; // Track planning section
  let sessions = {}; // sessionId -> { id, agent, messages, ws, stats }
  let activeSessionId = null;
  let isCreatingSession = false;  // Prevent simultaneous session creation

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openDrawer() {
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
    
    // Load sessions on first open
    if (Object.keys(sessions).length === 0) {
      loadSessions();
    }
    
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

  async function createSession(agent = 'codex') {
    // Prevent simultaneous session creation
    if (isCreatingSession) {
      console.warn('Session creation already in progress');
      return;
    }
    
    isCreatingSession = true;
    
    try {
      const sessionId = generateSessionId();
      
      // Get project root from state
      let projectRoot = null;
      try {
        const resp = await fetch('/api/app/file_editor_cm6/state');
        const data = await resp.json();
        if (data.ok && data.data?.activeProjectExists) {
          projectRoot = data.data.activeProject;
        }
      } catch (e) {
        console.error('Failed to get project root:', e);
      }
      
      const session = {
        id: sessionId,
        agent: agent,
        messages: [],
        ws: null,
        stats: { status: 'Created', agent },
        createdAt: Date.now(),
        cwd: projectRoot
      };
      
      sessions[sessionId] = session;
      addSessionToList(session);
      switchToSession(sessionId);
      connectSession(sessionId);
      saveSessionsToDisk();
      
      notify(`Created new ${agent} session` + (projectRoot ? ` in ${projectRoot.split('/').pop()}` : ''));
    } finally {
      isCreatingSession = false;
    }
  }

  function addSessionToList(session, isStale = false) {
    // Remove empty placeholder
    const empty = sessionList?.querySelector('.agent-session-list__item--empty');
    if (empty) empty.remove();
    
    const li = document.createElement('li');
    li.className = 'agent-session-list__item';
    if (isStale) li.classList.add('agent-session-list__item--stale');
    li.dataset.sessionId = session.id;
    
    const timestamp = session.createdAt ? new Date(session.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString();
    const staleIndicator = isStale ? ' <span class="agent-session-stale-badge">⚠ Stale</span>' : '';
    
    li.innerHTML = `
      <span>${session.agent} - ${timestamp}${staleIndicator}</span>
      <button class="agent-session-delete" data-session-id="${session.id}">×</button>
    `;
    
    li.addEventListener('click', (e) => {
      if (!e.target.classList.contains('agent-session-delete') && !isStale) {
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
    
    // Terminate framework shell properly
    if (session.shell_id) {
      fetch(`/api/framework_shells/${session.shell_id}`, {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ force: 1 })  // Force terminate
      }).catch(e => console.error('Failed to terminate shell:', e));
    }
    
    // Close WebSocket
    if (session.ws) {
      session.ws.close();
    }
    
    // Remove from DOM
    const li = sessionList?.querySelector(`[data-session-id="${sessionId}"]`);
    if (li) li.remove();
    
    // Remove from state
    delete sessions[sessionId];
    saveSessionsToDisk();
    
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

  async function switchToSession(sessionId) {
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
    
    // Check if shell is still alive before reconnecting
    if (session.shell_id) {
      try {
        const resp = await fetch(`/api/framework_shells/${session.shell_id}`);
        const data = await resp.json();
        
        if (data.ok && data.data?.alive) {
          // Shell is alive - reconnect WebSocket if needed
          if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
            connectSession(sessionId);
          }
        } else {
          // Shell is dead - mark as stale
          session.stats.status = 'Stale';
          updateStats(session.stats);
          const li = sessionList?.querySelector(`[data-session-id="${sessionId}"]`);
          if (li) {
            li.classList.add('agent-session-list__item--stale');
            const staleIndicator = ' <span class="agent-session-stale-badge">⚠ Stale</span>';
            const span = li.querySelector('span');
            if (span && !span.innerHTML.includes('Stale')) {
              span.innerHTML += staleIndicator;
            }
          }
          notify('Session shell is no longer running');
        }
      } catch (e) {
        console.error('Failed to check shell status:', e);
        // On error, try to reconnect anyway
        if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
          connectSession(sessionId);
        }
      }
    } else {
      // No shell_id yet - reconnect to create one
      if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        connectSession(sessionId);
      }
    }
  }

  async function connectSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;
    
    // Close existing connection
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }
    
    // Get project root from state if not stored
    let projectRoot = session.cwd;
    if (!projectRoot) {
      try {
        const resp = await fetch('/api/app/file_editor_cm6/state');
        const data = await resp.json();
        if (data.ok && data.data?.activeProjectExists) {
          projectRoot = data.data.activeProject;
          session.cwd = projectRoot;  // Store it
          saveSessionsToDisk();
        }
      } catch (e) {
        console.error('Failed to get project root:', e);
      }
    }
    
    // Get current file context
    const currentFile = window.currentPath || null;
    
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
        
      case 'system':
        session.messages.push({ type: 'system', text: msg.text });
        if (isActive) appendSystemToken(msg.text);
        break;
        
      case 'planning':
        session.messages.push({ type: 'planning', summary: msg.summary });
        if (isActive) appendPlanningToken(msg.summary);
        break;
        
      case 'tool_call':
        session.messages.push({ type: 'tool_call', tool: msg.tool, args: msg.args });
        if (isActive) addSystemMessage(`Tool: ${msg.tool}`);
        break;
        
      case 'diff':
        session.messages.push({ type: 'diff', path: msg.path, patch: msg.patch });
        if (isActive) addDiffMessage(msg.path, msg.patch);
        break;
        
      case 'elicitation':
      case 'approval_request':
        session.messages.push({ type: 'approval', ...msg });
        if (isActive) showApprovalRequest(msg);
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
        
      case 'connected':
        // Store shell_id for proper termination
        if (msg.shell_id) {
          session.shell_id = msg.shell_id;
          session.stats.status = 'Connected';
          saveSessionsToDisk();
          updateStats(session.stats);
        }
        break;
        
      case 'conversation_started':
        // Store conversation ID for continuing the conversation
        if (msg.conversationId) {
          session.conversationId = msg.conversationId;
          saveSessionsToDisk();
        }
        break;
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
      target: session.agent,
      session: activeSessionId,
      conversationId: session.conversationId  // Pass conversationId to backend
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
          
        case 'system':
          // System messages (reasoning, etc) - render in terminal style
          assistantBubble = null;
          const sysBubble = document.createElement('div');
          sysBubble.className = 'agent-transcript__planning';
          sysBubble.innerHTML = '<span class="agent-transcript__planning-label">⚙</span><span class="agent-transcript__planning-text">' + msg.text + '</span>';
          transcript?.appendChild(sysBubble);
          break;
          
        case 'approval':
          // Approval requests - recreate the UI
          assistantBubble = null;
          showApprovalRequest(msg);
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
    
    // Finish planning section if active
    if (currentPlanningSection) {
      currentPlanningSection = null;
    }
    
    if (!currentAssistantBubble) {
      currentAssistantBubble = document.createElement('div');
      currentAssistantBubble.className = 'agent-transcript__bubble agent-transcript__bubble--assistant';
      currentAssistantBubble.textContent = '';
      transcript?.appendChild(currentAssistantBubble);
    }
    currentAssistantBubble.textContent += text;
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function appendSystemToken(text) {
    // Remove placeholder
    const placeholder = transcript?.querySelector('.agent-transcript__placeholder');
    if (placeholder) placeholder.remove();
    
    // Create or reuse system section
    if (!currentPlanningSection) {
      currentPlanningSection = document.createElement('div');
      currentPlanningSection.className = 'agent-transcript__planning';
      currentPlanningSection.innerHTML = '<span class="agent-transcript__planning-label">⚙</span><span class="agent-transcript__planning-text"></span>';
      transcript?.appendChild(currentPlanningSection);
    }
    
    // Append to system text
    const textSpan = currentPlanningSection.querySelector('.agent-transcript__planning-text');
    if (textSpan) {
      textSpan.textContent += text;
    }
    
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function appendPlanningToken(text) {
    // Alias to appendSystemToken for backwards compatibility
    appendSystemToken(text);
  }

  function finishAssistantMessage() {
    currentAssistantBubble = null;
    currentPlanningSection = null;
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

  function showApprovalRequest(msg) {
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--approval';
    bubble.dataset.elicitationId = msg.elicitation_id || msg.call_id;
    
    const commandStr = Array.isArray(msg.command) ? msg.command.join(' ') : msg.command;
    const reason = msg.reason || msg.message || 'Command requires approval';
    
    bubble.innerHTML = `
      <div class="agent-approval-header">
        <strong>⚠ Approval Required</strong>
      </div>
      <div class="agent-approval-reason">${reason}</div>
      <div class="agent-approval-command">
        <strong>Command:</strong>
        <code>${commandStr}</code>
      </div>
      <div class="agent-approval-cwd">
        <strong>Directory:</strong> <code>${msg.cwd || 'unknown'}</code>
      </div>
      <div class="agent-approval-actions">
        <button class="fe-btn agent-approval-btn agent-approval-btn--approve">✓ Approve</button>
        <button class="fe-btn agent-approval-btn agent-approval-btn--deny">✗ Deny</button>
      </div>
    `;
    
    // Add event listeners
    const approveBtn = bubble.querySelector('.agent-approval-btn--approve');
    const denyBtn = bubble.querySelector('.agent-approval-btn--deny');
    
    approveBtn?.addEventListener('click', () => {
      sendApprovalResponse(msg.elicitation_id, true, msg);
      bubble.classList.add('agent-transcript__bubble--approval-approved');
      approveBtn.disabled = true;
      denyBtn.disabled = true;
      approveBtn.textContent = '✓ Approved';
    });
    
    denyBtn?.addEventListener('click', () => {
      sendApprovalResponse(msg.elicitation_id, false, msg);
      bubble.classList.add('agent-transcript__bubble--approval-denied');
      approveBtn.disabled = true;
      denyBtn.disabled = true;
      denyBtn.textContent = '✗ Denied';
    });
    
    transcript?.appendChild(bubble);
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function sendApprovalResponse(elicitationId, approved, originalMsg) {
    if (!activeSessionId) return;
    
    const session = sessions[activeSessionId];
    if (!session) {
      notify('Cannot send approval - session not found');
      return;
    }
    
    // Send JSON-RPC response with decision field
    // Codex expects: {"decision": "approved"} or {"decision": "denied"}
    const response = {
      jsonrpc: '2.0',
      id: elicitationId,
      result: {
        decision: approved ? 'approved' : 'denied'
      }
    };
    
    // Send as raw message to agent (bypassing normal adapter)
    fetch('/api/app/file_editor_cm6/agent/send_raw', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        session_id: activeSessionId,
        message: JSON.stringify(response)
      })
    }).then(r => r.json()).then(j => {
      if (!j.ok) {
        notify('Failed to send approval: ' + (j.error || 'Unknown error'));
      }
    }).catch(e => {
      notify('Failed to send approval: ' + e.message);
    });
    
    notify(approved ? 'Command approved' : 'Command denied');
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
      // Load from backend preferences
      const resp = await fetch('/api/app/file_editor_cm6/preferences/get?key=agent_sessions');
      const json = await resp.json();
      
      if (json.ok && json.data) {
        const savedSessions = JSON.parse(json.data);
        
        // Restore sessions - assume alive until proven otherwise
        for (const [sessionId, sessionData] of Object.entries(savedSessions)) {
          // Restore session object
          sessions[sessionId] = {
            ...sessionData,
            ws: null,  // WebSocket will reconnect on use
            stats: { status: 'Restored', agent: sessionData.agent }
          };
          
          // Add to UI (not stale)
          addSessionToList(sessions[sessionId], false);
        }
        
        // If we have sessions, switch to first one
        const sessionIds = Object.keys(sessions);
        if (sessionIds.length > 0) {
          switchToSession(sessionIds[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  function saveSessionsToDisk() {
    // Save sessions to backend preferences (without ws and heavy objects)
    const toSave = {};
    for (const [id, session] of Object.entries(sessions)) {
      toSave[id] = {
        id: session.id,
        agent: session.agent,
        messages: session.messages,
        createdAt: session.createdAt,
        conversationId: session.conversationId,
        cwd: session.cwd,
        shell_id: session.shell_id  // Save shell_id!
      };
    }
    
    fetch('/api/app/file_editor_cm6/preferences/set', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: 'agent_sessions',
        value: JSON.stringify(toSave)
      })
    }).catch(e => console.error('Failed to save sessions:', e));
  }

  function cleanupStaleSessions() {
    const staleItems = sessionList?.querySelectorAll('.agent-session-list__item--stale');
    staleItems?.forEach(item => {
      const sessionId = item.dataset.sessionId;
      if (sessionId && sessions[sessionId]) {
        delete sessions[sessionId];
        item.remove();
      }
    });
    
    saveSessionsToDisk();
    notify('Stale sessions cleaned up');
    
    // Show empty if no sessions left
    if (Object.keys(sessions).length === 0) {
      const empty = document.createElement('li');
      empty.className = 'agent-session-list__item agent-session-list__item--empty';
      empty.textContent = 'No sessions yet';
      sessionList?.appendChild(empty);
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
    cleanupStaleSessions();
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
