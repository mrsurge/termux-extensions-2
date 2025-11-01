# Agent Drawer JavaScript Refactor Guide

## Current State (Phase 3 Complete)
- **Backend**: Fully owns state, persists all messages immediately
- **Frontend**: Still has 1256 lines with heavy state management

## Goal
Transform `agent_drawer.js` into a **display server** (~300-400 lines):
- No persistence logic
- No session state mutations  
- Streaming cache for current assistant message only
- All data fetched from backend on demand

---

## Key Changes Required

### 1. State Variables (Lines 49-78)

**DELETE:**
```javascript
let sessions = {}; // REMOVE - backend is source of truth
let saveDebounceTimer = null; // REMOVE
let messageIdCounter = 0; // REMOVE
let currentAssistantBubble = null; // KEEP but rename
let currentPlanningSection = null; // KEEP but rename
```

**REPLACE WITH:**
```javascript
let activeSessionId = null;
let activeSessionName = 'No Session';
let streamingMessage = null; // Only cache for current assistant reply
let streamingBubble = null; // DOM element ref
let sharedShell = { ... }; // KEEP unchanged
```

---

### 2. Session Creation (Lines 157-192)

**CURRENT:**
```javascript
async function createSessionFromModal() {
  const session = { id, name, messages: [], ... };
  sessions[sessionId] = session; // ❌ Local mutation
  saveSessionsToDisk(); // ❌ JS persistence
  switchToSession(sessionId);
}
```

**REFACTOR TO:**
```javascript
async function createSessionFromModal() {
  const resp = await fetch('/api/app/file_editor_cm6/agent/sessions', {
    method: 'POST',
    body: JSON.stringify({ name, agent, cwd, auto, fullAccess })
  });
  const session = await resp.json();
  activeSessionId = session.data.id;
  activeSessionName = session.data.name;
  await loadSessionTranscript(session.data.id);
}
```

---

### 3. Session Switching (Lines 337-362)

**CURRENT:**
```javascript
function switchToSession(sessionId) {
  const session = sessions[sessionId]; // ❌ Local read
  renderMessages(session.messages); // ❌ From memory
}
```

**REFACTOR TO:**
```javascript
async function switchToSession(sessionId) {
  activeSessionId = sessionId;
  await loadSessionTranscript(sessionId);
}

async function loadSessionTranscript(sessionId) {
  const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`);
  const result = await resp.json();
  const session = result.data;
  activeSessionName = session.name;
  renderMessages(session.messages); // ✅ From backend
  updateCurrentSessionCard(session);
}
```

---

### 4. Sending Messages (Lines 628-696)

**CURRENT:**
```javascript
async function sendMessage(text) {
  const session = sessions[activeSessionId];
  session.messages.push({ type: 'user', text }); // ❌ Local mutation
  saveSessionsToDisk(); // ❌ JS persistence
  
  // Send via WebSocket
  ws.send(JSON.stringify({ text, session: activeSessionId }));
}
```

**REFACTOR TO:**
```javascript
async function sendMessage(text) {
  // Send via WebSocket - backend will persist
  ws.send(JSON.stringify({ 
    text, 
    session: activeSessionId,
    file: attachFileCheck?.checked ? window.currentFile : null
  }));
  
  // Optimistic UI update - show user message immediately
  appendUserMessage(text);
}

function appendUserMessage(text) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble message-bubble--user';
  bubble.textContent = text;
  transcript.appendChild(bubble);
  transcript.scrollTop = transcript.scrollHeight;
}
```

---

### 5. WebSocket Message Handler (Lines 524-627) - THE CRITICAL ONE

**CURRENT:**
```javascript
function handleAgentMessage(sessionId, msg) {
  const session = sessions[sessionId];
  
  switch (msg.event) {
    case 'token':
      session.messages[last].text += msg.text; // ❌ Mutate local
      appendAssistantToken(msg.text);
      break;
    case 'final':
      session.messages.push({ type: 'assistant', text: msg.text }); // ❌
      saveSessionsToDisk(); // ❌
      finishAssistantMessage();
      break;
    case 'system':
      session.messages.push({ type: 'system', text: msg.text }); // ❌
      addSystemMessage(msg.text);
      break;
    case 'conversation_started':
      session.conversationId = msg.conversationId; // ❌
      saveSessionsToDisk(); // ❌
      break;
  }
}
```

**REFACTOR TO:**
```javascript
function handleAgentMessage(sessionId, msg) {
  // Only update UI - backend already persisted
  
  switch (msg.event) {
    case 'token':
      // Build streaming message in memory
      if (!streamingMessage) {
        streamingMessage = { id: msg.id, type: 'assistant', text: '' };
        streamingBubble = createMessageBubble('assistant');
        transcript.appendChild(streamingBubble);
      }
      streamingMessage.text += msg.text;
      streamingBubble.textContent = streamingMessage.text;
      transcript.scrollTop = transcript.scrollHeight;
      break;
      
    case 'final':
      // Backend wrote to disk - finalize UI
      if (streamingMessage && streamingBubble) {
        streamingBubble.textContent = msg.text; // Use authoritative text
        streamingBubble.classList.add('message-bubble--complete');
      }
      streamingMessage = null;
      streamingBubble = null;
      break;
      
    case 'system':
      // Backend wrote - just render
      const systemBubble = createMessageBubble('system');
      systemBubble.textContent = msg.text;
      transcript.appendChild(systemBubble);
      break;
      
    case 'error':
      const errorBubble = createMessageBubble('error');
      errorBubble.textContent = msg.error;
      transcript.appendChild(errorBubble);
      break;
      
    case 'conversation_started':
      // Backend persisted conversationId - just update UI indicator
      updateShellStatus();
      break;
      
    case 'connected':
      sharedShell.shell_id = msg.shell_id;
      sharedShell.status = 'Connected';
      updateShellStatus();
      break;
  }
}
```

---

### 6. Session List/Modal (Lines 236-308)

**CURRENT:**
```javascript
function renderSessionsModal() {
  const sessionsList = Object.values(sessions); // ❌ From memory
  // ... render
}

function deleteSession(sessionId) {
  delete sessions[sessionId]; // ❌ Local mutation
  saveSessionsToDisk(); // ❌
}
```

**REFACTOR TO:**
```javascript
async function renderSessionsModal() {
  const resp = await fetch('/api/app/file_editor_cm6/agent/sessions');
  const result = await resp.json();
  const sessionsList = result.data; // ✅ From backend
  
  sessionsModalList.innerHTML = '';
  sessionsList.forEach(session => {
    const item = createSessionListItem(session);
    sessionsModalList.appendChild(item);
  });
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this session?')) return;
  
  await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`, {
    method: 'DELETE'
  });
  
  if (sessionId === activeSessionId) {
    activeSessionId = null;
    clearTranscript();
  }
  
  await renderSessionsModal(); // Refresh list
}
```

---

### 7. Loading Sessions on Open (Lines 1014-1100)

**CURRENT:**
```javascript
async function loadSessions() {
  const resp = await fetch('/api/app/file_editor_cm6/preferences/get?key=agent_sessions');
  const data = JSON.parse(resp.data); // ❌ Deserialize from prefs
  
  for (const [id, session] of Object.entries(data)) {
    sessions[id] = session; // ❌ Load into memory
  }
}
```

**REFACTOR TO:**
```javascript
async function loadLastActiveSession() {
  // On drawer open, just fetch session list to populate picker
  // Don't load any transcripts until user switches to a session
  
  const resp = await fetch('/api/app/file_editor_cm6/agent/sessions');
  const result = await resp.json();
  
  if (result.ok && result.data.length > 0) {
    // Optionally auto-load most recent
    const mostRecent = result.data[0];
    await switchToSession(mostRecent.id);
  }
}
```

---

### 8. Delete These Functions Entirely

**Lines to DELETE (no backend equivalent needed):**

```javascript
// Line 69-78
function debouncedSave() { ... } // ❌ DELETE

// Line 1101-1137
function sanitizeMessages(messages) { ... } // ❌ DELETE - backend handles

// Line 1138-1165
function saveSessionsToDisk() { ... } // ❌ DELETE - backend auto-saves

// Line 1166-1178
function saveShellState() { ... } // ❌ DELETE - backend tracks shell_id
```

---

## Summary of Deletions

| What | Lines | Reason |
|------|-------|--------|
| `sessions` object | ~54 | Backend is source of truth |
| `saveSessionsToDisk()` | ~1138-1165 | Backend auto-persists |
| `debouncedSave()` | ~69-78 | No client-side saves |
| `loadSessions()` deserialization | ~1014-1100 | Fetch from REST API |
| Local message mutations | Throughout | Backend owns messages |
| `sanitizeMessages()` | ~1101-1137 | Backend handles format |

**Total lines removed: ~400-500**
**New total: ~700-800 lines (still complex but no state management)**

---

## Testing Checklist

After refactor:
- [ ] Open drawer → sessions list fetched from backend
- [ ] Create new session → POST to backend, auto-switch
- [ ] Switch sessions → transcript loaded fresh each time
- [ ] Send message → WebSocket sends, backend persists, UI renders streaming
- [ ] Streaming works → tokens build up in single bubble
- [ ] Final event → swap to authoritative backend text
- [ ] Refresh page → sessions still there, transcripts intact
- [ ] Delete session → removed from backend, UI updates
- [ ] Framework restart → conversations restore correctly (history prepending)

---

## Next Steps

1. **Backup current file** (it works, even if bloated)
2. **Refactor incrementally:**
   - Phase 4A: WebSocket handler (most critical)
   - Phase 4B: Session creation/switching
   - Phase 4C: Delete persistence functions
   - Phase 4D: Clean up dead code
3. **Test after each phase**
4. **Compare line count** before/after

Want me to proceed with implementing these changes, or would you like to tackle it yourself with this guide?
