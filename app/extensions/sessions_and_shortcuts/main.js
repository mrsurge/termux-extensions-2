// Extension Script: Sessions & Shortcuts

// This function will be called by the main app to initialize the extension
export default function initialize(extensionContainer, api) {
    let currentSessionId = null;
    let sessionNames = {};
    let autoRefreshTimer = null;
    try {
        sessionNames = JSON.parse(localStorage.getItem('sessionNames') || '{}') || {};
    } catch (_) { sessionNames = {}; }

    const sessionsList = extensionContainer.querySelector('#sessions-list');
    
    const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));

    const renderSessions = (sessions) => {
        sessionsList.innerHTML = '';
        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p style="color: var(--muted-foreground);">No interactive sessions found.</p>';
            return;
        }
        sessions.forEach(session => {
            const sessionEl = document.createElement('div');
            sessionEl.className = 'session';
            const name = sessionNames[session.sid];
            const isIdle = !session.busy;
            const statusDot = `<span class="status-dot ${isIdle ? 'dot-green' : ''}" style="${isIdle ? '' : 'background-color: var(--destructive);'}; display:inline-block; margin-right:8px;"></span>`;
            const displayCmd = session.fg_cmdline || session.fg_comm || 'process';
            const statusText = session.busy ? `Running: ${escapeHTML(displayCmd)}` : 'bash';
            sessionEl.innerHTML = `
                <div class="session-header">
                    <div class="session-title">${statusDot}${name ? escapeHTML(name) + ' • ' : ''}SID: ${session.sid}</div>
                    <button class="menu-btn" data-sid="${session.sid}">&#8942;</button>
                </div>
                <div class="session-cwd">${session.cwd}</div>
                ${statusText ? `<div class="session-cwd">${statusText}</div>` : ''}
                <div class="menu" id="menu-${session.sid}">
                    <div class="menu-item" data-action="run-shortcut">Run Shortcut...</div>
                    <div class="menu-item" data-action="run-command">Run Command...</div>
                    <div class="menu-item" data-action="rename">Rename Session...</div>
                    <div class="menu-item destructive" data-action="kill">Kill Session</div>
                </div>
            `;
            sessionsList.appendChild(sessionEl);
        });
    };

    const renderShortcuts = (shortcuts) => {
        const shortcutList = extensionContainer.querySelector('#shortcut-list');
        shortcutList.innerHTML = '';
        if (shortcuts.length === 0) {
            shortcutList.innerHTML = '<p style="color: var(--muted-foreground);">No shortcuts found in ~/.shortcuts</p>';
            return;
        }
        shortcuts.forEach(shortcut => {
            const shortcutEl = document.createElement('div');
            shortcutEl.className = 'menu-item';
            shortcutEl.textContent = shortcut.name;
            shortcutEl.onclick = () => runShortcut(shortcut.path);
            shortcutList.appendChild(shortcutEl);
        });
    };

    const refreshSessions = () => {
        api.get('sessions').then(data => {
            renderSessions(data);
        }).catch(err => {
            sessionsList.innerHTML = '<p style="color: var(--destructive);">Error loading sessions.</p>';
            console.error(err);
        });
    };

    const openMenu = (sid, button) => {
        closeAllMenus();
        const menu = extensionContainer.querySelector(`#menu-${sid}`);
        menu.style.display = 'block';
        const rect = button.getBoundingClientRect();
        menu.style.top = rect.bottom + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
    };

    const closeAllMenus = () => {
        extensionContainer.querySelectorAll('.menu').forEach(m => m.style.display = 'none');
    };

    // Modal helpers (local functions). Keep closeModal exposed for template buttons.
    const openModal = (modalId, sid) => {
        if (sid !== undefined && sid !== null) {
            currentSessionId = sid;
        }
        const el = document.getElementById(modalId);
        if (el) el.style.display = 'block';
    };

    const closeModal = (modalId) => {
        const el = document.getElementById(modalId);
        if (el) el.style.display = 'none';
    };

    // Expose for inline HTML onclick compatibility without changing UI.
    window.closeModal = closeModal;
    window.openModal = openModal;

    const runShortcut = (path) => {
        if (!currentSessionId) {
            alert("Please select a session from the list first.");
            return;
        }
        api.post(`sessions/${currentSessionId}/shortcut`, { path })
            .then(() => {
                closeModal('shortcut-modal');
                setTimeout(refreshSessions, 250);
            })
            .catch(err => alert('Failed to run shortcut.'));
    };

    const shellQuote = (s) => "'" + String(s).replace(/'/g, `'"'"'`) + "'";

    const renameSession = () => {
        if (!currentSessionId) return;
        const input = extensionContainer.querySelector('#rename-input');
        const newName = (input.value || '').trim();
        if (!newName) { alert('Please enter a name.'); return; }
        const cmd = `printf '\\033]2;%s\\007' -- ${shellQuote(newName)}`;
        api.post(`sessions/${currentSessionId}/command`, { command: cmd })
            .then(() => {
                sessionNames[currentSessionId] = newName;
                try { localStorage.setItem('sessionNames', JSON.stringify(sessionNames)); } catch (_) {}
                input.value = '';
                closeModal('rename-modal');
                refreshSessions();
            })
            .catch(() => alert('Failed to rename session.'));
    };

    extensionContainer.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('menu-btn')) {
            openMenu(target.dataset.sid, target);
            e.stopPropagation();
            return;
        }
        const menuItem = target.closest('.menu-item');
        if (menuItem) {
            const menu = menuItem.closest('.menu');
            const sid = menu.id.replace('menu-', '');
            const action = menuItem.dataset.action;
            closeAllMenus();

            if (action === 'kill') {
                if (confirm(`Are you sure you want to kill session ${sid}?`)) {
                    api.delete(`sessions/${sid}`).then(refreshSessions);
                }
            } else if (action === 'run-command') {
                openModal('command-modal', sid);
            } else if (action === 'run-shortcut') {
                api.get('shortcuts').then(data => {
                    renderShortcuts(data);
                });
                openModal('shortcut-modal', sid);
            } else if (action === 'rename') {
                const inp = extensionContainer.querySelector('#rename-input');
                if (inp) { inp.value = sessionNames[sid] || ''; setTimeout(() => inp.focus(), 0); }
                openModal('rename-modal', sid);
            }
            return;
        }
        // Clicked somewhere inside the extension but not on a menu item or button: close menus for easier dismissal
        if (!target.closest('.menu') && !target.classList.contains('menu-btn')) {
            closeAllMenus();
        }
    });

    extensionContainer.querySelector('#run-command-btn').addEventListener('click', () => {
        const command = extensionContainer.querySelector('#command-input').value;
        if (command && currentSessionId) {
            api.post(`sessions/${currentSessionId}/command`, { command })
                .then(() => {
                    closeModal('command-modal');
                    extensionContainer.querySelector('#command-input').value = '';
                    setTimeout(refreshSessions, 250);
                })
                .catch(err => alert('Failed to run command.'));
        }
    });

    const renameBtn = extensionContainer.querySelector('#rename-save-btn');
    if (renameBtn) renameBtn.addEventListener('click', renameSession);

    extensionContainer.querySelector('#refresh-btn').addEventListener('click', refreshSessions);

    // --- Auto Refresh Control ---
    const autoRefreshSelect = extensionContainer.querySelector('#auto-refresh-select');
    const storageKey = 'sessions_and_shortcuts_auto_refresh_ms';

    const applyAutoRefresh = (ms) => {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        const interval = parseInt(ms, 10) || 0;
        try { localStorage.setItem(storageKey, String(interval)); } catch (_) {}
        if (autoRefreshSelect && autoRefreshSelect.value !== String(interval)) {
            autoRefreshSelect.value = String(interval);
        }
        if (interval > 0) {
            autoRefreshTimer = setInterval(refreshSessions, interval);
        }
    };

    if (autoRefreshSelect) {
        autoRefreshSelect.addEventListener('change', (e) => {
            applyAutoRefresh(e.target.value);
            // Trigger an immediate refresh when changing interval
            refreshSessions();
        });
        let saved = 0;
        try { saved = parseInt(localStorage.getItem(storageKey) || '0', 10) || 0; } catch (_) { saved = 0; }
        autoRefreshSelect.value = String(saved);
        applyAutoRefresh(saved);
    }

    refreshSessions();
}
