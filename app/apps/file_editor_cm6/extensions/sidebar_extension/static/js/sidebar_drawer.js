// app/apps/file_editor_cm6/extensions/sidebar_extension/static/js/sidebar_drawer.js
// Legacy sidebar drawer with shared shell architecture

function notify(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    console.log(message);
  }
}

export function initSidebarDrawer() {
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
  const currentSessionCard = document.getElementById('agent-current-session-card');
  const targetSelect = document.getElementById('agent-target');
  const statsEl = document.getElementById('agent-stats');
  
  // Sessions list modal elements
  const sessionsModal = document.getElementById('agent-sessions-modal');
  const sessionsModalClose = document.getElementById('agent-sessions-modal-close');
  const sessionsModalList = document.getElementById('agent-sessions-modal-list');
  
  // Files toggle button (mobile only)
  const filesToggleBtn = document.getElementById('agent-files-toggle');
  
  // Session config modal elements
  const sessionModal = document.getElementById('agent-session-modal');
  const sessionModalClose = document.getElementById('agent-session-modal-close');
  const sessionNameInput = document.getElementById('agent-session-name');
  const sessionTypeSelect = document.getElementById('agent-session-type');
  const sessionAutoCheck = document.getElementById('agent-session-auto');
  const sessionFullCheck = document.getElementById('agent-session-full');
  const sessionCancelBtn = document.getElementById('agent-session-cancel');
  const sessionCreateBtn = document.getElementById('agent-session-create');
  const sessionBackdrop = sessionsModal?.querySelector('.agent-modal__backdrop') || null;
  const drawerHeader = drawer?.querySelector('.agent-drawer__header') || null;

  if (!drawer || !toggle) {
    return { open: () => {}, close: () => {}, destroy: () => {} };
  }

  // If we are switching from iframe mode, restore native drawer chrome.
  drawer.classList.remove('agent-drawer--iframe');
  if (drawerHeader) {
    drawerHeader.style.display = '';
  }

  const listenerCleanup = [];
  function on(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler, options);
    listenerCleanup.push(() => {
      try {
        target.removeEventListener(eventName, handler, options);
      } catch (_) {}
    });
  }

  let isOpen = false;
  let isFullscreen = false;
  let activeSessionId = null;
  let activeSessionName = 'No Session';
  let isCreatingSession = false;
  
  // STREAMING MESSAGE CACHE - only holds the current assistant message being built
  let streamingMessage = null;
  let pendingTaskStartCount = 0;
  
  // DOM references for streaming bubbles
  let currentAssistantBubble = null;
  let currentPlanningSection = null;
  
  // IPC configuration cache (used for Socket.IO test hook)
  let ipcConfigPromise = null;

  async function fetchIpcConfig() {
    if (!ipcConfigPromise) {
      ipcConfigPromise = fetch('/api/framework/ipc', { cache: 'no-store' })
        .then(resp => resp.json())
        .then(body => {
          if (!body.ok || !body.data) {
            throw new Error(body.error || 'IPC config unavailable');
          }
          return body.data;
        })
        .catch(err => {
          ipcConfigPromise = null;
          throw err;
        });
    }
    return ipcConfigPromise;
  }

  let socketIoLoader = null;
  function ensureSocketIoClient() {
    if (window.io) {
      return Promise.resolve(window.io);
    }
    if (!socketIoLoader) {
      socketIoLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
      script.src = '/static/vendor/socket.io.min.js';
        script.async = true;
        script.onload = () => resolve(window.io);
        script.onerror = () => {
          socketIoLoader = null;
          const errorMsg = 'Socket.IO client download failed. Agent features will be unavailable. Please check your network connection and ad-blocker settings.';
          console.error(`[Agent Drawer] ${errorMsg}`);
          notify(errorMsg);
          reject(new Error('Failed to load Socket.IO client from CDN.'));
        };
        document.head.appendChild(script);
      });
    }
    return socketIoLoader;
  }

  window.__cm6TestSocketIO = async function cm6TestSocketIO() {
    try {
      const io = await ensureSocketIoClient();
      const config = await fetchIpcConfig();
      const url = `http://${config.host}:${config.port}/agent`;
      console.log('[Agent Drawer] Testing Socket.IO connection to', url);
      const socket = io(url, {
        transports: ['websocket'],
        timeout: 5000,
      });
      socket.on('connect', () => {
        console.log('[Agent Drawer] Socket.IO connected (test sid)', socket.id);
      });
      socket.on('agent_connected', (payload) => {
        console.log('[Agent Drawer] Socket.IO agent_connected payload', payload);
        socket.disconnect();
      });
      socket.io.on('error', (err) => {
        console.error('[Agent Drawer] Socket.IO manager error', err);
      });
      socket.on('connect_error', (err) => {
        console.error('[Agent Drawer] Socket.IO connect error', err);
      });
      socket.on('disconnect', (reason) => {
        console.log('[Agent Drawer] Socket.IO disconnected (test)', reason);
      });
    } catch (err) {
      console.error('[Agent Drawer] __cm6TestSocketIO failed', err);
    }
  };

  // SHARED SHELL STATE - ONE shell for all Codex sessions
  let sharedShell = {
    shell_id: null,
    session_id: null,  // Backend session ID for send_raw endpoint
    socket: null,
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
    
    // Check for existing shell on drawer open
    checkExistingShell();
  }
  
  async function checkExistingShell() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/agent/shell/status');
      const result = await resp.json();
      
      if (result.ok && result.data) {
        // Shell exists and is alive
        const shellInfo = result.data;
        sharedShell.shell_id = shellInfo.shell_id;
        sharedShell.status = 'Available';  // Shell running, not connected yet
        
        updateStats({
          status: 'Available',
          agent: 'codex'
        });
      } else {
        // No active shell
        sharedShell.status = 'Disconnected';
        updateStats({
          status: 'Disconnected',
          agent: '—'
        });
      }
    } catch (e) {
      console.error('[Agent Drawer] Failed to check shell status:', e);
    }
    
    // Try to restore last active session
    try {
      const prefResp = await fetch('/api/app/file_editor_cm6/preferences/get?key=last_active_session_id');
      const prefResult = await prefResp.json();
      
      if (prefResult.ok && prefResult.data) {
        const lastSessionId = prefResult.data;
        
        // Try to load that session
        try {
          await switchToSession(lastSessionId);
        } catch (e) {
          // Session no longer exists - clear preference
          console.log('[Agent Drawer] Last session no longer exists, clearing preference');
          await fetch('/api/app/file_editor_cm6/preferences/set', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              key: 'last_active_session_id',
              value: null
            })
          });
        }
      }
    } catch (e) {
      console.error('[Agent Drawer] Failed to restore last session:', e);
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
      const sessionName = sessionNameInput?.value?.trim() || 'New Session';
      const agent = sessionTypeSelect?.value || 'codex';
      const auto = sessionAutoCheck?.checked || false;
      const fullAccess = sessionFullCheck?.checked || false;
      const projectRoot = await getProjectRoot();
      
      // Create session via backend API
      let session;
      try {
        const resp = await fetch('/api/app/file_editor_cm6/agent/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sessionName,
            agent: agent,
            cwd: projectRoot,
            auto: auto,
            fullAccess: fullAccess
          })
        });
        const result = await resp.json();
        if (!result.ok) {
          notify(`Failed to create session: ${result.error}`);
          return;
        }
        session = result.data;
      } catch (e) {
        console.error('Failed to create session:', e);
        notify('Error creating session');
        return;
      }
      
      // Ensure shared shell is connected (will spawn if needed)
      if (sharedShell.status !== 'Connected') {
        await connectSharedShell();
      }
      
      // Switch to new session
      await switchToSession(session.id);
      
      const settingsDesc = auto ? (fullAccess ? ' (auto, full access)' : ' (auto)') : '';
      notify(`Created ${session.name}${settingsDesc}`);
    } finally {
      isCreatingSession = false;
    }
  }

  function addSessionToList(session) {
    // This is now deprecated - sessions are only shown in the modal
    // Kept for backward compatibility during refactor
  }

  function updateCurrentSessionCard() {
    if (!activeSessionId) {
      currentSessionCard.innerHTML = '<div class="agent-current-session-card__placeholder">No active session</div>';
      return;
    }
    
    // Use cached name from switchToSession
    const displayName = activeSessionName || 'Session';
    
    currentSessionCard.innerHTML = `
      <div class="agent-current-session-card__name">
        <span class="agent-current-session-card__status"></span>
        ${displayName}
      </div>
      <div class="agent-current-session-card__meta">
        Active session
      </div>
    `;
  }

  function showSessionsModal() {
    renderSessionsModal();
    sessionsModal.style.display = 'flex';
  }

  function hideSessionsModal() {
    sessionsModal.style.display = 'none';
  }

  async function renderSessionsModal() {
    sessionsModalList.innerHTML = '<li class="agent-sessions-modal-list__empty">Loading...</li>';
    
    // Fetch sessions from backend
    let sessionsList;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/agent/sessions');
      const result = await resp.json();
      if (!result.ok) {
        sessionsModalList.innerHTML = '<li class="agent-sessions-modal-list__empty">Failed to load sessions</li>';
        return;
      }
      sessionsList = result.data;
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
      sessionsModalList.innerHTML = '<li class="agent-sessions-modal-list__empty">Error loading sessions</li>';
      return;
    }
    
    sessionsModalList.innerHTML = '';
    
    if (sessionsList.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'agent-sessions-modal-list__empty';
      empty.textContent = 'No sessions yet';
      sessionsModalList.appendChild(empty);
      return;
    }
    
    sessionsList.forEach(session => {
      const timestamp = session.createdAt ? new Date(session.createdAt * 1000).toLocaleTimeString() : '';
      const displayName = session.name || `${session.agent || 'codex'} - ${timestamp}`;
      const messageCount = session.messageCount || 0;
      const agentName = session.agent || 'codex';
      const isActive = session.id === activeSessionId;
      
      const li = document.createElement('li');
      li.className = 'agent-sessions-modal-list__item';
      if (isActive) {
        li.classList.add('agent-sessions-modal-list__item--active');
      }
      li.dataset.sessionId = session.id;
      
      li.innerHTML = `
        <div class="agent-sessions-modal-list__info">
          <div class="agent-sessions-modal-list__name">
            ${isActive ? '<span class="agent-current-session-card__status"></span>' : ''}
            ${displayName}
          </div>
          <div class="agent-sessions-modal-list__meta">
            ${messageCount} message${messageCount !== 1 ? 's' : ''} • ${agentName}
          </div>
        </div>
        <button class="agent-sessions-modal-list__delete" data-session-id="${session.id}">✕</button>
      `;
      
      // Click session to switch
      li.addEventListener('click', (e) => {
        if (!e.target.classList.contains('agent-sessions-modal-list__delete')) {
          switchToSession(session.id);
          hideSessionsModal();
        }
      });
      
      // Click X to delete
      const deleteBtn = li.querySelector('.agent-sessions-modal-list__delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.id);
      });
      
      sessionsModalList.appendChild(li);
    });
  }

  function addSessionToList(session) {
    // Deprecated - keeping for backward compatibility
  }

  async function deleteSession(sessionId) {
    if (!confirm('Delete this session?')) return;
    
    try {
      const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`, {
        method: 'DELETE'
      });
      const result = await resp.json();
      if (!result.ok) {
        notify('Failed to delete session');
        return;
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
      notify('Error deleting session');
      return;
    }
    
    // If this was the active session, clear UI and preference
    if (sessionId === activeSessionId) {
      activeSessionId = null;
      activeSessionName = 'No Session';
      clearTranscript();
      updateCurrentSessionCard();
      
      // Clear saved preference
      try {
        await fetch('/api/app/file_editor_cm6/preferences/set', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            key: 'last_active_session_id',
            value: null
          })
        });
      } catch (e) {
        console.error('Failed to clear session preference:', e);
      }
    }
    
    // Re-render modal if open
    if (sessionsModal.style.display === 'flex') {
      await renderSessionsModal();
    }
    
    notify('Session deleted');
    
    // NOTE: Don't terminate shared shell - it's used by all sessions
  }

  async function switchToSession(sessionId) {
    // Fetch full session transcript from backend
    let session;
    try {
      const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`);
      const result = await resp.json();
      if (!result.ok) {
        notify('Failed to load session');
        return;
      }
      session = result.data;
    } catch (e) {
      console.error('Failed to fetch session:', e);
      notify('Error loading session');
      return;
    }
    
    // Update active session
    activeSessionId = session.id;
    activeSessionName = session.name || 'Unnamed Session';
    
    // Save as last active session for persistence across page refreshes
    try {
      await fetch('/api/app/file_editor_cm6/preferences/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          key: 'last_active_session_id',
          value: session.id
        })
      });
    } catch (e) {
      console.error('Failed to save active session preference:', e);
    }
    
    // Update current session card
    updateCurrentSessionCard();
    
    // Render messages from backend
    renderMessages(session.messages || []);
    
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
    if (sharedShell.socket && sharedShell.socket.connected && sharedShell.shell_id) {
      return sharedShell.connectPromise || Promise.resolve();
    }

    if (sharedShell.connectPromise) {
      return sharedShell.connectPromise;
    }

    sharedShell.connectPromise = (async () => {
      const io = await ensureSocketIoClient();
      const config = await fetchIpcConfig();
      const projectRoot = await getProjectRoot();
      const url = `http://${config.host}:${config.port}/agent`;

      sharedShell.status = 'Connecting';
      updateShellStatus();
      notify('Connecting to Codex MCP server...');

      return await new Promise((resolve, reject) => {
        const socket = io(url, {
          transports: ['websocket'],
          query: {
            agent: sharedShell.agent,
            cwd: projectRoot || '',
            session: sharedShell.session_id || ''
          },
          reconnectionAttempts: Infinity,
          reconnectionDelay: 2000,
          reconnectionDelayMax: 10000
        });
        sharedShell.socket = socket;

        let handshakeComplete = false;

        socket.on('connect', () => {
          sharedShell.status = 'Connected';
          updateShellStatus();
        });

        socket.on('agent_connected', (payload) => {
          sharedShell.status = 'Connected';
          sharedShell.shell_id = payload.shell_id;
          sharedShell.session_id = payload.session_id;
          updateShellStatus();
          notify('Codex MCP server connected');
          if (!handshakeComplete) {
            handshakeComplete = true;
            resolve();
          }
        });

        socket.on('agent_event', (payload) => {
          const targetSessionId = payload.session || activeSessionId;
          if (targetSessionId) {
            handleAgentMessage(targetSessionId, payload);
          }
        });

        socket.on('agent_error', (err) => {
          notify(`Agent error: ${err?.message || 'Unknown error'}`);
          if (!handshakeComplete) {
            handshakeComplete = true;
            reject(new Error(err?.message || 'Agent error'));
          }
        });

        socket.on('disconnect', (reason) => {
          sharedShell.status = 'Disconnected';
          sharedShell.socket = null;
          updateShellStatus();
          if (!handshakeComplete) {
            handshakeComplete = true;
            reject(new Error(`Disconnected: ${reason}`));
          } else {
            notify('Agent disconnected');
          }
        });

        socket.on('connect_error', (err) => {
          sharedShell.status = 'Error';
          updateShellStatus();
          notify('Agent connection error');
          if (!handshakeComplete) {
            handshakeComplete = true;
            reject(err);
          }
        });

        socket.io.on('reconnect_attempt', (attempt) => {
          sharedShell.status = 'Reconnecting';
          updateShellStatus();
          notify(`Reconnecting to agent (attempt ${attempt})...`);
        });
      });
    })()
      .catch((err) => {
        console.error('[Agent Drawer] Failed to connect Socket.IO agent', err);
        throw err;
      })
      .finally(() => {
        sharedShell.connectPromise = null;
      });

    return sharedShell.connectPromise;
  }
  
  async function disconnectShell() {
    if (!sharedShell.shell_id) {
      notify('No active shell to disconnect');
      return;
    }
    
    if (sharedShell.socket) {
      try {
        sharedShell.socket.disconnect();
      } catch (e) {
        console.error('Failed to disconnect socket:', e);
      }
      sharedShell.socket = null;
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
    // Backend already persisted - just update UI
    // Only render if this is the active session
    const isActive = sessionId === activeSessionId;
    if (!isActive) return;
    
    switch (msg.event) {
      case 'token': {
        // Build streaming message in memory (fast, no disk)
        const chunk = msg.text || '';
        if (!streamingMessage) {
          // Start new streaming assistant message
          streamingMessage = {
            id: msg.id,
            type: 'assistant',
            text: ''
          };
          appendAssistantToken(''); // Create initial bubble
        }
        streamingMessage.text += chunk;
        appendAssistantToken(chunk);
        break;
      }
        
      case 'system': {
        const text = msg.text || '';
        const trimmed = text.trim();
        const reasoning = Boolean(msg.reasoning);
        const complete = Boolean(msg.complete);

        if (reasoning) {
          if (complete) {
            finalizeSystemReasoning(text);
          } else {
            appendSystemToken(text);
          }
          break;
        }

        if (trimmed === '[Task started]') {
          if (pendingTaskStartCount > 0) {
            pendingTaskStartCount = Math.max(0, pendingTaskStartCount - 1);
            break;
          }
        }

        appendSystemToken(text);
        break;
      }
        
      case 'planning':
        appendPlanningToken(msg.summary);
        break;
        
      case 'tool_call':
        addSystemMessage(`Tool: ${msg.tool}`);
        break;
        
      case 'diff':
        addDiffMessage(msg.path, msg.patch);
        break;
        
      case 'elicitation':
      case 'approval_request':
        showApprovalRequest(msg);
        break;
        
      case 'final':
        // Backend wrote complete message - finalize UI
        if (streamingMessage) {
          // Use authoritative text from backend
          streamingMessage.text = msg.text || msg.output || streamingMessage.text;
        }
        finishAssistantMessage();
        streamingMessage = null; // Clear cache
        pendingTaskStartCount = 0;
        notify('Agent completed');
        break;
        
      case 'error':
        addErrorMessage(msg.error);
        streamingMessage = null; // Clear cache on error
        pendingTaskStartCount = 0;
        break;
        
      case 'connected':
        // Shared shell connected - already handled in connectSharedShell
        break;
        
      case 'conversation_started':
        // Backend persisted conversation ID
        if (msg.conversationId && isActive) {
          notify(`Conversation started: ${msg.conversationId.substring(0, 8)}...`);
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
    
    // Fetch session from backend to get current metadata
    let session;
    try {
      const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${activeSessionId}`);
      const result = await resp.json();
      if (!result.ok) {
        notify('Failed to load session');
        return;
      }
      session = result.data;
    } catch (e) {
      notify('Failed to load session');
      console.error('Failed to fetch session:', e);
      return;
    }
    
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
    
    const normalizedConversationId = (typeof session.conversationId === 'string')
      ? session.conversationId.trim()
      : null;
    const hasConversation = normalizedConversationId && normalizedConversationId.toLowerCase() !== 'null' && normalizedConversationId.toLowerCase() !== 'undefined';

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      action: 'chat',
      text: text,
      target: session.agent || 'codex',
      cwd: session.cwd,
      session: session.id
    };
    if (hasConversation) {
      message.conversationId = normalizedConversationId;
    }
    
    // Add approval settings for first message (new conversation)
    if (!hasConversation && (session.auto || session.fullAccess)) {
      message.context = message.context || {};
      
      if (session.auto || session.fullAccess) {
        message.context.approval_policy = 'never';
      }
      
      if (session.fullAccess) {
        message.context.sandbox = 'danger-full-access';
      } else if (session.auto) {
        message.context.sandbox = 'workspace-write';
      }
    }
    
    // Backend will persist user message - just show in UI optimistically
    const bubble = document.createElement('div');
    bubble.className = 'agent-transcript__bubble agent-transcript__bubble--user';
    bubble.textContent = text;
    transcript?.appendChild(bubble);
    
    if (!sharedShell.socket) {
      notify('Agent socket unavailable');
      return;
    }
    sharedShell.socket.emit('agent_user_message', message);
    if ((session.agent || 'codex') === 'codex') {
      insertTaskStartedIndicator();
    }
    
    composer.value = '';
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function renderMessages(messages) {
    if (!transcript) {
      console.error('[Agent Drawer] transcript element not found');
      return;
    }
    
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
    
    messages.forEach((msg) => {
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

        case 'assistant':
        case 'assistant_pending':
          flushSystemBuffer();
          assistantBubble = null;
          if (typeof msg.text === 'string' && msg.text.length > 0) {
            const assistantStatic = document.createElement('div');
            assistantStatic.className = 'agent-transcript__bubble agent-transcript__bubble--assistant';
            assistantStatic.textContent = msg.text;
            transcript?.appendChild(assistantStatic);
          }
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
      transcript.innerHTML = '';
    }
    currentAssistantBubble = null;
    pendingTaskStartCount = 0;
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

  function finalizeSystemReasoning(text) {
    if (!currentPlanningSection) {
      appendSystemToken(text);
      return;
    }
    const textSpan = currentPlanningSection.querySelector('.agent-transcript__planning-text');
    if (textSpan) {
      const existing = textSpan.textContent || '';
      const prefix = existing.startsWith('[Task started]\n') ? '[Task started]\n' : '';
      textSpan.textContent = prefix ? `${prefix}${text || ''}` : (text || '');
    }
  }

  function finishAssistantMessage() {
    currentAssistantBubble = null;
    currentPlanningSection = null;
  }

  function insertTaskStartedIndicator() {
    appendSystemToken('[Task started]\n');
    pendingTaskStartCount += 1;
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
    if (!activeSessionId) {
      notify('Cannot send approval - no active session');
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
    
    const isActive = status === 'Connected' || status === 'Available';
    
    if (isActive) {
      statusDot.classList.add('connected');
    } else {
      statusDot.classList.remove('connected');
    }
    
    // Update agent type
    agentTypeText.textContent = stats.agent || '—';
  }

  // DELETED: loadSessions() - sessions fetched on-demand from backend API

  // DELETED: sanitizeMessages() - backend handles message format
  // DELETED: saveSessionsToDisk() - backend auto-persists
  // DELETED: saveShellState() - backend tracks shell_id
  
  // Event listeners
  on(toggle, 'click', toggleDrawer);
  on(closeBtn, 'click', closeDrawer);

  on(collapseBtn, 'click', () => {
    closeDrawer();
  });

  on(fullscreenBtn, 'click', () => {
    if (!isOpen) openDrawer();
    isFullscreen = !isFullscreen;
    drawer.classList.toggle('agent-drawer--fullscreen', isFullscreen);
  });

  on(newSessionBtn, 'click', () => {
    showSessionModal();
  });

  // Current session card - click to show sessions modal
  on(currentSessionCard, 'click', () => {
    showSessionsModal();
  });

  // Sessions modal handlers
  on(sessionsModalClose, 'click', hideSessionsModal);
  on(sessionBackdrop, 'click', hideSessionsModal);

  // Files toggle handler
  on(filesToggleBtn, 'click', () => {
    const drawerOpenBtn = document.getElementById('fe-drawer-open');
    drawerOpenBtn?.click();
  });

  // Refresh button now triggers manual reconnection
  on(refreshBtn, 'click', async () => {
    if (sharedShell.status === 'Connected') {
      notify('Already connected');
    } else {
      await connectSharedShell();
    }
  });

  on(sendBtn, 'click', () => {
    const text = composer?.value?.trim();
    if (!text) {
      notify('Enter a prompt to send to the agent.');
      return;
    }
    sendMessage(text);
  });

  on(composer, 'keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn?.click();
    }
  });

  // Session config modal handlers
  on(sessionModalClose, 'click', hideSessionModal);
  on(sessionCancelBtn, 'click', hideSessionModal);
  on(sessionCreateBtn, 'click', createSessionFromModal);

  on(sessionAutoCheck, 'change', () => {
    if (sessionFullCheck) {
      sessionFullCheck.disabled = !sessionAutoCheck.checked;
      if (!sessionAutoCheck.checked) {
        sessionFullCheck.checked = false;
      }
    }
  });

  // Initialize - sessions loaded on-demand when drawer opens

  function destroy() {
    try {
      closeDrawer();
    } catch (_) {}
    hideSessionModal();
    hideSessionsModal();
    try {
      drawer.classList.remove('agent-drawer--fullscreen');
    } catch (_) {}
    if (sharedShell.socket) {
      try {
        sharedShell.socket.disconnect();
      } catch (_) {}
      sharedShell.socket = null;
    }
    while (listenerCleanup.length) {
      const off = listenerCleanup.pop();
      try {
        off && off();
      } catch (_) {}
    }
  }

  return {
    open: openDrawer,
    close: closeDrawer,
    destroy,
  };
}
