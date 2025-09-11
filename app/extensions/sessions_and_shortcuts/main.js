// Extension Script: Sessions & Shortcuts

// This function will be called by the main app to initialize the extension
export default function initialize(extensionContainer, api) {
    let currentSessionId = null;

    const sessionsList = extensionContainer.querySelector('#sessions-list');
    
    const renderSessions = (sessions) => {
        sessionsList.innerHTML = '';
        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p style="color: var(--muted-foreground);">No interactive sessions found.</p>';
            return;
        }
        sessions.forEach(session => {
            const sessionEl = document.createElement('div');
            sessionEl.className = 'session';
            sessionEl.innerHTML = `
                <div class="session-header">
                    <div class="session-title">SID: ${session.sid}</div>
                    <button class="menu-btn" data-sid="${session.sid}">&#8942;</button>
                </div>
                <div class="session-cwd">${session.cwd}</div>
                <div class="menu" id="menu-${session.sid}">
                    <div class="menu-item" data-action="run-shortcut">Run Shortcut...</div>
                    <div class="menu-item" data-action="run-command">Run Command...</div>
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
            .then(() => closeModal('shortcut-modal'))
            .catch(err => alert('Failed to run shortcut.'));
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
            }
        }
    });

    extensionContainer.querySelector('#run-command-btn').addEventListener('click', () => {
        const command = extensionContainer.querySelector('#command-input').value;
        if (command && currentSessionId) {
            api.post(`sessions/${currentSessionId}/command`, { command })
                .then(() => {
                    closeModal('command-modal');
                    extensionContainer.querySelector('#command-input').value = '';
                })
                .catch(err => alert('Failed to run command.'));
        }
    });

    extensionContainer.querySelector('#refresh-btn').addEventListener('click', refreshSessions);

    refreshSessions();
}
