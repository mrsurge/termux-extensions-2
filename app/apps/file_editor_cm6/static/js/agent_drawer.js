// app/apps/file_editor_cm6/static/js/agent_drawer.js
// Agent drawer with shared shell architecture - ONE MCP server for all sessions

import ReconnectingWebSocket from './reconnecting_websocket.js';

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
  
  // Session config modal elements
  const sessionModal = document.getElementById('agent-session-modal');
  const sessionModalClose = document.getElementById('agent-session-modal-close');
  const sessionNameInput = document.getElementById('agent-session-name');
  const sessionTypeSelect = document.getElementById('agent-session-type');
  const sessionAutoCheck = document.getElementById('agent-session-auto');
  const sessionFullCheck = document.getElementById('agent-session-full');
  const sessionCancelBtn = document.getElementById('agent-session-cancel');
  const sessionCreateBtn = document.getElementById('agent-session-create');

  if (!drawer || !toggle) {
    return { open: () => {}, close: () => {} };
  }

  let isOpen = false;
  let isFullscreen = false;
  let messageIdCounter = 0;
  let currentAssistantBubble = null;
  let currentPlanningSection = null;
  let sessions = {}; // ui-session-id -> { name, conversationId, messages[], createdAt, cwd, auto, fullAccess }
  let activeSessionId = null;
  let isCreatingSession = false;
  
  // SHARED SHELL STATE - ONE shell for all Codex sessions
  let sharedShell = {
    shell_id: null,
    session_id: null,  // Backend session ID for send_raw endpoint
    ws: null,
    agent: 'codex',
    status: 'Disconnected'  // 'Disconnected' | 'Connecting' | 'Connected' | 'Error'
  };

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openDrawer() {
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
    
    // Load sessions on first open (UI only - no auto-connection)
    if (Object.keys(sessions).length === 0) {
      loadSessions();
    }
  }

  function closeDrawer() {
    if (!isOpen) return;
    drawer.classList.remove('open');
    drawer.classList.remove('agent-drawer--fullscreen');
    isOpen = false;
    isFullscreen = false;
    updateAria();
    
    // Keep shell and sessions alive - don't disconnect
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
  
  async function getProjectRoot() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/state');
      const data = await resp.json();
      if (data.ok && data.data?.activeProjectExists) {
        return data.data.activeProject;
      }
    } catch (e) {
      console.error('Failed to get project root:', e);
    }
    return null;
  }

  function showSessionModal() {
    // Reset modal fields
    if (sessionNameInput) sessionNameInput.value = '';
    if (sessionTypeSelect) sessionTypeSelect.value = 'codex';
    if (sessionAutoCheck) sessionAutoCheck.checked = false;
    if (sessionFullCheck) {
      sessionFullCheck.checked = false;
      sessionFullCheck.disabled = true;
    }
    
    // Show modal
    if (sessionModal) {
      sessionModal.setAttribute('aria-hidden', 'false');
      sessionModal.style.display = 'flex';
    }
  }
  
  function hideSessionModal() {
    if (sessionModal) {
      sessionModal.setAttribute('aria-hidden', 'true');
      sessionModal.style.display = 'none';
    }
  }

  async function createSessionFromModal() {
    // Prevent simultaneous session creation
    if (isCreatingSession) {
      console.warn('Session creation already in progress');
      return;
    }
    
    isCreatingSession = true;
    hideSessionModal();
    
    try {
      // Get values from modal
      const sessionName = sessionNameInput?.value?.trim() || null;
      const agent = sessionTypeSelect?.value || 'codex';
      const auto = sessionAutoCheck?.checked || false;
      const fullAccess = sessionFullCheck?.checked || false;
      
      // Ensure shared shell is connected (will spawn if needed)
      if (sharedShell.status !== 'Connected') {
        await connectSharedShell();
      }
      
      const sessionId = generateSessionId();
      const projectRoot = await getProjectRoot();
      
      // Create UI session with approval settings
      const session = {
        id: sessionId,
        name: sessionName,  // Custom name
        conversationId: null,  // Will be set by Codex "conversation_started" event
        messages: [],
        createdAt: Date.now(),
        cwd: projectRoot,
        agent: agent,
        auto: auto,  // Store per-session
        fullAccess: fullAccess  // Store per-session
      };
      
      sessions[sessionId] = session;
      addSessionToList(session);
      switchToSession(sessionId);
      saveSessionsToDisk();
      
      const settingsDesc = auto ? (fullAccess ? ' (auto, full access)' : ' (auto)') : '';
      notify(`Created new ${agent} session${settingsDesc}` + (projectRoot ? ` in ${projectRoot.split('/').pop()}` : ''));
    } finally {
      isCreatingSession = false;
    }
  }

  function addSessionToList(session) {
    // Remove empty placeholder
    const empty = sessionList?.querySelector('.agent-session-list__item--empty');
    if (empty) empty.remove();
    
    const li = document.createElement('li');
    li.className = 'agent-session-list__item';
    li.dataset.sessionId = session.id;
    
    const timestamp = session.createdAt ? new Date(session.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString();
    const displayName = session.name || `${session.agent || 'codex'} - ${timestamp}`;
    
    li.innerHTML = `
      <span>${displayName}</span>
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
    
    // NOTE: Don't terminate shared shell - it's used by all sessions
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
    
    // Update target selector
    if (targetSelect) {
      targetSelect.value = session.agent || 'codex';
    }
    
    // Update stats display
    updateStats({
      status: sharedShell.status,
      agent: session.agent || 'codex',
      conversationId: session.conversationId
    });
  }

  async function connectSharedShell() {
    if (sharedShell.status === 'Connected' || sharedShell.status === 'Connecting') {
      console.log('Already connected or connecting');
      return;
    }
    
    sharedShell.status = 'Connecting';
    updateShellStatus();
    notify('Connecting to Codex MCP server...');
    
    try {
      const projectRoot = await getProjectRoot();
      
      // Build WebSocket URL (no session param - backend manages shared shell)
      const wsUrl = new URL('/ws/app/file_editor_cm6/agent', window.location.href);
      wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
      wsUrl.searchParams.set('agent', sharedShell.agent);
      if (projectRoot) wsUrl.searchParams.set('cwd', projectRoot);
      
      sharedShell.ws = new ReconnectingWebSocket(wsUrl.toString(), {
        maxRetries: 10,
        reconnectInterval: 2000,
        maxReconnectInterval: 30000,
        debug: true
      });
      
      sharedShell.ws.onopen = () => {
        sharedShell.status = 'Connected';
        updateShellStatus();
        notify('Codex MCP server connected');
      };
      
      sharedShell.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        // Store shell metadata from backend
        if (msg.event === 'connected') {
          if (msg.shell_id) {
            sharedShell.shell_id = msg.shell_id;
          }
          if (msg.session_id) {
            sharedShell.session_id = msg.session_id;  // For send_raw endpoint
          }
          saveShellState();
        }
        
        // Route message to active session
        if (activeSessionId) {
          handleAgentMessage(activeSessionId, msg);
        }
      };
      
      sharedShell.ws.onerror = (error) => {
        sharedShell.status = 'Error';
        updateShellStatus();
        notify('Agent connection error');
        console.error('Agent WS error:', error);
      };
      
      sharedShell.ws.onclose = () => {
        sharedShell.status = 'Disconnected';
        sharedShell.ws = null;
        updateShellStatus();
        notify('Agent disconnected');
      };

      sharedShell.ws.onreconnect = (attempt, delay) => {
        console.log(`[Agent] Reconnecting in ${delay}ms...`);
        notify(`Reconnecting to agent (attempt ${attempt})...`);
        sharedShell.status = 'Reconnecting';
        updateShellStatus();
      };
      
    } catch (e) {
      sharedShell.status = 'Error';
      updateShellStatus();
      notify('Failed to connect to agent');
      console.error('Connection error:', e);
      throw e;
    }
  }
  
  async function disconnectShell() {
    if (!sharedShell.shell_id) {
      notify('No active shell to disconnect');
      return;
    }
    
    // Close WebSocket
    if (sharedShell.ws) {
      sharedShell.ws.close();
      sharedShell.ws = null;
    }
    
    // Terminate framework shell
    try {
      await fetch(`/api/framework_shells/${sharedShell.shell_id}`, {
        method: 'DELETE',
        body: JSON.stringify({ force: 1 }),
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error('Failed to terminate shell:', e);
    }
    
    sharedShell.shell_id = null;
    sharedShell.status = 'Disconnected';
    updateShellStatus();
    saveShellState();
    
    notify('Codex MCP server stopped');
  }
  
  function updateShellStatus() {
    // Update stats display with shell status
    updateStats({
      status: sharedShell.status,
      agent: sharedShell.agent,
      shell_id: sharedShell.shell_id
    });
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
        // Shared shell connected - already handled in connectSharedShell
        break;
        
      case 'conversation_started':
        // Store Codex conversation ID for this UI session
        if (msg.conversationId) {
          session.conversationId = msg.conversationId;
          saveSessionsToDisk();
          if (isActive) {
            notify(`Conversation started: ${msg.conversationId.substring(0, 8)}...`);
          }
        }
        break;
        
      default:
        // Ignore unknown events
        break;
    }
  }

  async function sendMessage(text) {
    if (!activeSessionId) {
      notify('No active session. Create a new session first.');
      return;
    }
    
    const session = sessions[activeSessionId];
    if (!session) return;
    
    // Auto-spawn shared shell if not connected (deterministic user action)
    if (sharedShell.status !== 'Connected') {
      notify('Starting agent server...');
      try {
        await connectSharedShell();
      } catch (e) {
        notify('Failed to start agent server');
        console.error('Failed to connect shell:', e);
        return;
      }
    }
    
    const message = {
      id: String(++messageIdCounter),
      action: 'chat',
      text: text,
      target: session.agent || 'codex',
      conversationId: session.conversationId,  // null for first message, UUID for replies
      cwd: session.cwd,
      session: session.id
    };
    
    // Add approval settings for first message (new conversation)
    if (!session.conversationId && (session.auto || session.fullAccess)) {
      message.context = message.context || {};
      
      // Approval policy - 'never' means auto-approve all operations (YOLO mode)
      if (session.auto || session.fullAccess) {
        message.context.approval_policy = 'never';
      }
      
      // Sandbox mode - controls what Codex can access
      if (session.fullAccess) {
        message.context.sandbox = 'danger-full-access';  // Full system access
      } else if (session.auto) {
        message.context.sandbox = 'workspace-write';  // Workspace only
      }
    }
    
    // Attach file context if enabled
    if (attachFileCheck?.checked && window.currentPath) {
      message.file = window.currentPath;
    }
    
    // Store user message
    session.messages.push({ type: 'user', text });
    
    // Send via shared WebSocket
    sharedShell.ws.send(JSON.stringify(message));
    
    // Show in transcript
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
    bubble.textContent = text;
    transcript?.appendChild(bubble);
    composer.value = '';
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
    
    saveSessionsToDisk();
  }

  function renderMessages(messages) {
    clearTranscript();
    
    if (!messages || messages.length === 0) {
      return;
    }
    
    let assistantBubble = null;
    let systemBuffer = '';  // Accumulate consecutive system messages
    
    const flushSystemBuffer = () => {
      if (systemBuffer) {
        const sysBubble = document.createElement('div');
        sysBubble.className = 'agent-transcript__planning';
        const textSpan = document.createElement('span');
        textSpan.className = 'agent-transcript__planning-text';
        textSpan.textContent = systemBuffer;  // Use textContent to avoid HTML parsing
        sysBubble.innerHTML = '<span class="agent-transcript__planning-label">⚙</span>';
        sysBubble.appendChild(textSpan);
        transcript?.appendChild(sysBubble);
        systemBuffer = '';
      }
    };
    
    messages.forEach(msg => {
      switch (msg.type) {
        case 'user':
          flushSystemBuffer();
          assistantBubble = null;
          const userBubble = document.createElement('div');
          userBubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
          userBubble.textContent = msg.text;
          transcript?.appendChild(userBubble);
          break;
          
        case 'token':
          flushSystemBuffer();
          if (!assistantBubble) {
            assistantBubble = document.createElement('div');
            assistantBubble.className = 'agent-transcript__bubble agent-transcript__bubble--assistant';
            assistantBubble.textContent = '';
            transcript?.appendChild(assistantBubble);
          }
          assistantBubble.textContent += msg.text;
          break;
          
        case 'planning':
          flushSystemBuffer();
          assistantBubble = null;
          const planBubble = document.createElement('div');
          planBubble.className = 'agent-transcript__bubble agent-transcript__bubble--system';
          planBubble.textContent = `Planning: ${msg.summary}`;
          transcript?.appendChild(planBubble);
          break;
          
        case 'system':
          // Accumulate consecutive system messages
          assistantBubble = null;
          systemBuffer += msg.text;
          break;
          
        case 'approval':
          flushSystemBuffer();
          assistantBubble = null;
          showApprovalRequest(msg);
          break;
          
        case 'tool_call':
          flushSystemBuffer();
          assistantBubble = null;
          const toolBubble = document.createElement('div');
          toolBubble.className = 'agent-transcript__bubble agent-transcript__bubble--system';
          toolBubble.textContent = `Tool: ${msg.tool}`;
          transcript?.appendChild(toolBubble);
          break;
          
        case 'diff':
          flushSystemBuffer();
          assistantBubble = null;
          addDiffMessage(msg.path, msg.patch);
          break;
          
        case 'error':
          flushSystemBuffer();
          assistantBubble = null;
          addErrorMessage(msg.error);
          break;
          
        case 'final':
          flushSystemBuffer();
          assistantBubble = null;
          break;
      }
    });
    
    // Flush any remaining system messages
    flushSystemBuffer();
    
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
    
    // Check if shared shell is connected
    if (!sharedShell.session_id) {
      notify('Cannot send approval - not connected to agent');
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
    
    // Send via shared session using send_raw endpoint
    fetch('/api/app/file_editor_cm6/agent/send_raw', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        session_id: sharedShell.session_id,  // Use shared shell's session_id
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
    const statusDot = document.getElementById('agent-status-dot');
    const statusText = document.getElementById('agent-status-text');
    const agentTypeText = document.getElementById('agent-type-text');
    
    if (!statusDot || !statusText || !agentTypeText) return;
    
    // Update status dot and text
    const status = stats.status || 'Disconnected';
    statusText.textContent = status;
    
    if (status === 'Connected') {
      statusDot.classList.add('connected');
    } else {
      statusDot.classList.remove('connected');
    }
    
    // Update agent type
    agentTypeText.textContent = stats.agent || '—';
  }

  async function loadSessions() {
    try {
      // Load shared shell state (both shell_id and session_id)
      const shellResp = await fetch('/api/app/file_editor_cm6/preferences/get?key=codex_shell_state');
      const shellJson = await shellResp.json();
      
      if (shellJson.ok && shellJson.data) {
        const savedState = JSON.parse(shellJson.data);
        
        // Check if framework shell is still alive
        if (savedState.shell_id) {
          try {
            const checkResp = await fetch(`/api/framework_shells/${savedState.shell_id}`);
            const checkData = await checkResp.json();
            
            if (checkData.ok && checkData.data?.alive) {
              sharedShell.shell_id = savedState.shell_id;
              sharedShell.session_id = savedState.session_id;
              sharedShell.status = 'Disconnected';  // Can reconnect, but not auto-connecting
            }
          } catch (e) {
            console.error('Failed to check shell status:', e);
          }
        }
      }
      
      // Load UI sessions from disk
      const sessResp = await fetch('/api/app/file_editor_cm6/preferences/get?key=agent_sessions');
      const sessJson = await sessResp.json();
      
      if (sessJson.ok && sessJson.data) {
        const savedSessions = JSON.parse(sessJson.data);
        
        // Restore sessions (UI only - no auto-connection)
        for (const [sessionId, sessionData] of Object.entries(savedSessions)) {
          sessions[sessionId] = {
            id: sessionData.id,
            name: sessionData.name,
            conversationId: sessionData.conversationId,  // Codex conversation ID
            messages: sessionData.messages || [],
            createdAt: sessionData.createdAt,
            cwd: sessionData.cwd,
            agent: sessionData.agent || 'codex',
            auto: sessionData.auto || false,
            fullAccess: sessionData.fullAccess || false
          };
          
          addSessionToList(sessions[sessionId]);
        }
        
        // Switch to first session (UI only - no connection)
        const sessionIds = Object.keys(sessions);
        if (sessionIds.length > 0) {
          switchToSession(sessionIds[0]);
        }
      }
      
      updateShellStatus();
      
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  function saveSessionsToDisk() {
    // Save sessions to backend preferences (conversationId is the key!)
    const toSave = {};
    for (const [id, session] of Object.entries(sessions)) {
      toSave[id] = {
        id: session.id,
        name: session.name,
        conversationId: session.conversationId,  // Codex conversation ID
        messages: session.messages,
        createdAt: session.createdAt,
        cwd: session.cwd,
        agent: session.agent || 'codex',
        auto: session.auto || false,
        fullAccess: session.fullAccess || false
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
  
  function saveShellState() {
    // Save shared shell state (both shell_id and session_id)
    if (sharedShell.shell_id) {
      fetch('/api/app/file_editor_cm6/preferences/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          key: 'codex_shell_state',
          value: JSON.stringify({
            shell_id: sharedShell.shell_id,
            session_id: sharedShell.session_id
          })
        })
      }).catch(e => console.error('Failed to save shell state:', e));
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
    showSessionModal();
  });

  // Refresh button now triggers manual reconnection
  refreshBtn?.addEventListener('click', async () => {
    if (sharedShell.status === 'Connected') {
      notify('Already connected');
    } else {
      await connectSharedShell();
    }
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
  
  // Session modal handlers
  sessionModalClose?.addEventListener('click', hideSessionModal);
  sessionCancelBtn?.addEventListener('click', hideSessionModal);
  sessionCreateBtn?.addEventListener('click', createSessionFromModal);
  
  sessionAutoCheck?.addEventListener('change', () => {
    if (sessionFullCheck) {
      sessionFullCheck.disabled = !sessionAutoCheck.checked;
      if (!sessionAutoCheck.checked) {
        sessionFullCheck.checked = false;
      }
    }
  });

  // Initialize
  loadSessions();

  return {
    open: openDrawer,
    close: closeDrawer,
  };
}
