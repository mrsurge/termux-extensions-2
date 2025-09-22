// Sessions & Shortcuts Extension

const STATE = {
    visibleSessions: [],
    frameworkShells: [],
    containers: [],
    sessionNames: {},
    currentSessionId: null,
    autoRefreshTimer: null,
};

let extensionRoot;
let apiClient;

let elements = {
    visibleList: null,
    frameworkList: null,
    refreshBtn: null,
    tabVisible: null,
    tabFramework: null,
    autoRefreshSelect: null,
};

const storageKeys = {
    sessionNames: 'sessionNames',
    autoRefresh: 'sessions_and_shortcuts_auto_refresh_ms',
};

function loadFrameworkToken() {
    try {
        const value = localStorage.getItem('frameworkShellToken');
        return value ? value : null;
    } catch (err) {
        return null;
    }
}

function saveFrameworkToken(token) {
    try {
        if (token) localStorage.setItem('frameworkShellToken', token);
        else localStorage.removeItem('frameworkShellToken');
    } catch (err) {
        console.warn('Failed to persist framework token', err);
    }
}

async function frameworkFetch(url, options = {}, allowPrompt = true) {
    const headers = Object.assign({}, options.headers || {});
    const token = loadFrameworkToken();
    if (token) headers['X-Framework-Key'] = token;
    const response = await fetch(url, Object.assign({}, options, { headers }));
    if (response.status === 403 && allowPrompt) {
        const input = window.prompt('Framework shell token required. Enter token (leave blank to clear):');
        if (input !== null) {
            const trimmed = input.trim();
            saveFrameworkToken(trimmed);
            return frameworkFetch(url, options, false);
        }
    }
    let body = null;
    try {
        body = await response.json();
    } catch (err) {
        body = null;
    }
    if (!response.ok || (body && body.ok === false)) {
        const message = (body && body.error) ? body.error : `HTTP ${response.status} ${response.statusText}`;
        throw new Error(message);
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'data')) {
        return body.data;
    }
    return body;
}

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadSessionNames() {
    try {
        STATE.sessionNames = JSON.parse(localStorage.getItem(storageKeys.sessionNames) || '{}') || {};
    } catch (err) {
        STATE.sessionNames = {};
    }
}

function saveSessionNames() {
    try {
        localStorage.setItem(storageKeys.sessionNames, JSON.stringify(STATE.sessionNames));
    } catch (err) {
        console.warn('Failed to persist session names', err);
    }
}

function containersBySession() {
    const mapping = {};
    STATE.containers.forEach((container) => {
        const attachments = Array.isArray(container.attachments) ? container.attachments : [];
        attachments.forEach((sid) => {
            mapping[sid] = mapping[sid] || [];
            mapping[sid].push(container.label || container.id);
        });
    });
    return mapping;
}

function containerLabelByShell() {
    const mapping = {};
    STATE.containers.forEach((container) => {
        if (container.shell_id) {
            mapping[container.shell_id] = container.label || container.id;
        }
    });
    return mapping;
}

function renderVisibleSessions() {
    const list = elements.visibleList;
    if (!list) return;
    list.innerHTML = '';
    if (!STATE.visibleSessions.length) {
        const placeholder = document.createElement('p');
        placeholder.className = 'session-empty';
        placeholder.textContent = 'No interactive sessions found.';
        list.appendChild(placeholder);
        return;
    }

    const containerMap = containersBySession();

    STATE.visibleSessions.forEach((session) => {
        const card = document.createElement('div');
        card.className = 'session';
        const name = STATE.sessionNames[session.sid];
        const isIdle = !session.busy;
        const statusDot = `<span class="status-dot ${isIdle ? 'dot-green' : ''}" style="${isIdle ? '' : 'background-color: var(--destructive);'}"></span>`;
        const displayCmd = session.fg_cmdline || session.fg_comm || 'process';
        const statusText = session.busy ? `Running: ${escapeHTML(displayCmd)}` : 'bash';
        const attachments = containerMap[session.sid] || [];
        const attachmentText = attachments.length ? `Attached: ${attachments.join(', ')}` : '';

        card.innerHTML = `
            <div class="session-header">
                <div class="session-title">${statusDot}${name ? escapeHTML(name) + ' • ' : ''}SID: ${session.sid}</div>
                <button class="menu-btn" data-sid="${session.sid}">&#8942;</button>
            </div>
            <div class="session-cwd">${escapeHTML(session.cwd || '')}</div>
            <div class="session-cwd">${statusText}</div>
            ${attachmentText ? `<div class="session-cwd">${escapeHTML(attachmentText)}</div>` : ''}
            <div class="menu" id="menu-${session.sid}">
                <div class="menu-item" data-action="run-shortcut">Run Shortcut...</div>
                <div class="menu-item" data-action="run-command">Run Command...</div>
                <div class="menu-item" data-action="rename">Rename Session...</div>
                <div class="menu-item destructive" data-action="kill">Kill Session</div>
            </div>
        `;
        list.appendChild(card);
    });
}

function renderFrameworkShells() {
    const list = elements.frameworkList;
    if (!list) return;
    list.innerHTML = '';

    if (!STATE.frameworkShells.length) {
        const placeholder = document.createElement('p');
        placeholder.className = 'session-empty';
        placeholder.textContent = 'No framework shells running.';
        list.appendChild(placeholder);
        return;
    }

    const containerByShell = containerLabelByShell();

    STATE.frameworkShells.forEach((shell) => {
        const card = document.createElement('div');
        card.className = 'session framework';
        const stats = shell.stats || {};
        const containerLabel = containerByShell[shell.id] || 'Unknown container';
        const uptime = stats.uptime != null ? `uptime: ${Math.max(0, Math.round(stats.uptime))}s` : '';
        const cpu = stats.cpu_percent != null ? `cpu: ${stats.cpu_percent.toFixed(1)}%` : '';
        const mem = stats.memory_rss != null ? `mem: ${(stats.memory_rss / (1024 * 1024)).toFixed(1)} MB` : '';
        const statLine = [uptime, cpu, mem].filter(Boolean).join(' · ');

        card.innerHTML = `
            <div class="session-header">
                <div class="session-title">Framework Shell • ${escapeHTML(containerLabel)}</div>
                <button class="framework-kill" data-shell="${shell.id}">Kill</button>
            </div>
            <div class="session-cwd">ID: ${shell.id}</div>
            <div class="session-cwd">Command: ${escapeHTML((shell.command || []).join(' '))}</div>
            ${statLine ? `<div class="session-cwd">${escapeHTML(statLine)}</div>` : ''}
        `;
        list.appendChild(card);
    });
}

function render() {
    renderVisibleSessions();
    renderFrameworkShells();
}

function closeAllMenus() {
    extensionRoot.querySelectorAll('.menu').forEach((menu) => {
        menu.style.display = 'none';
    });
}

function openMenu(sid, button) {
    closeAllMenus();
    const menu = extensionRoot.querySelector(`#menu-${sid}`);
    if (!menu) return;
    menu.style.display = 'block';
    const rect = button.getBoundingClientRect();
    menu.style.top = rect.bottom + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
}

function applyAutoRefresh(ms) {
    if (STATE.autoRefreshTimer) {
        clearInterval(STATE.autoRefreshTimer);
        STATE.autoRefreshTimer = null;
    }
    if (ms > 0) {
        STATE.autoRefreshTimer = setInterval(() => refreshAll(), ms);
    }
}

function loadAutoRefreshSetting() {
    try {
        const value = parseInt(localStorage.getItem(storageKeys.autoRefresh) || '0', 10);
        return Number.isNaN(value) ? 0 : value;
    } catch (err) {
        return 0;
    }
}

function saveAutoRefreshSetting(ms) {
    try {
        localStorage.setItem(storageKeys.autoRefresh, String(ms));
    } catch (err) {
        console.warn('Failed to persist auto-refresh', err);
    }
}

async function fetchFrameworkShells() {
    try {
        const data = await window.teFetch('/api/framework_shells');
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('Failed to load framework shells', err);
        return [];
    }
}

async function fetchContainers() {
    try {
        const data = await window.teFetch('/api/app/distro/containers');
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('Failed to load containers', err);
        return [];
    }
}

async function refreshAll() {
    try {
        const [sessions, frameworks, containers] = await Promise.all([
            apiClient.get('sessions'),
            fetchFrameworkShells(),
            fetchContainers(),
        ]);
        STATE.visibleSessions = Array.isArray(sessions) ? sessions : [];
        STATE.frameworkShells = frameworks;
        STATE.containers = containers;
        render();
    } catch (err) {
        console.error('Failed to refresh sessions', err);
        const list = elements.visibleList;
        if (list) {
            list.innerHTML = '<p class="session-empty" style="color: var(--destructive);">Error loading sessions.</p>';
        }
    }
}

function runShortcut(path) {
    if (!STATE.currentSessionId) {
        alert('Please select a session from the list first.');
        return;
    }
    apiClient.post(`sessions/${STATE.currentSessionId}/shortcut`, { path })
        .then(() => {
            closeModal('shortcut-modal');
            setTimeout(refreshAll, 250);
        })
        .catch(() => alert('Failed to run shortcut.'));
}

function shellQuote(value) {
    return `'` + String(value).replace(/'/g, `'"'"'`) + `'`;
}

function renameSession() {
    if (!STATE.currentSessionId) return;
    const input = extensionRoot.querySelector('#rename-input');
    const newName = (input.value || '').trim();
    if (!newName) {
        alert('Please enter a name.');
        return;
    }
    const cmd = `printf '\\033]2;%s\\007' -- ${shellQuote(newName)}`;
    apiClient.post(`sessions/${STATE.currentSessionId}/command`, { command: cmd })
        .then(() => {
            STATE.sessionNames[STATE.currentSessionId] = newName;
            saveSessionNames();
            input.value = '';
            closeModal('rename-modal');
            refreshAll();
        })
        .catch(() => alert('Failed to rename session.'));
}

function selectTab(target) {
    const visiblePanel = elements.visibleList;
    const frameworkPanel = elements.frameworkList;
    if (!visiblePanel || !frameworkPanel) return;
    if (target === 'visible') {
        elements.tabVisible?.classList.add('active');
        elements.tabFramework?.classList.remove('active');
        visiblePanel.classList.add('active');
        frameworkPanel.classList.remove('active');
    } else {
        elements.tabFramework?.classList.add('active');
        elements.tabVisible?.classList.remove('active');
        frameworkPanel.classList.add('active');
        visiblePanel.classList.remove('active');
    }
}

function attachEventListeners() {
    extensionRoot.addEventListener('click', (e) => {
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
                if (confirm(`Kill session ${sid}?`)) {
                    apiClient.delete(`sessions/${sid}`).then(refreshAll);
                }
            } else if (action === 'run-command') {
                openModal('command-modal', sid);
            } else if (action === 'run-shortcut') {
                apiClient.get('shortcuts').then((data) => renderShortcuts(data));
                openModal('shortcut-modal', sid);
            } else if (action === 'rename') {
                const input = extensionRoot.querySelector('#rename-input');
                if (input) {
                    input.value = STATE.sessionNames[sid] || '';
                    setTimeout(() => input.focus(), 0);
                }
                openModal('rename-modal', sid);
            }
            return;
        }

        if (target.classList.contains('framework-kill')) {
            const shellId = target.dataset.shell;
            if (shellId && confirm(`Kill framework shell ${shellId}?`)) {
                killFrameworkShell(shellId);
            }
            return;
        }

        if (!target.closest('.menu') && !target.classList.contains('menu-btn')) {
            closeAllMenus();
        }
    });

    const runCommandBtn = extensionRoot.querySelector('#run-command-btn');
    if (runCommandBtn) {
        runCommandBtn.addEventListener('click', () => {
            const commandInput = extensionRoot.querySelector('#command-input');
            const command = commandInput.value;
            if (command && STATE.currentSessionId) {
                apiClient.post(`sessions/${STATE.currentSessionId}/command`, { command })
                    .then(() => {
                        closeModal('command-modal');
                        commandInput.value = '';
                        setTimeout(refreshAll, 250);
                    })
                    .catch(() => alert('Failed to run command.'));
            }
        });
    }

    const renameBtn = extensionRoot.querySelector('#rename-save-btn');
    if (renameBtn) renameBtn.addEventListener('click', renameSession);
}

function renderShortcuts(shortcuts) {
    const shortcutList = extensionRoot.querySelector('#shortcut-list');
    if (!shortcutList) return;
    shortcutList.innerHTML = '';
    if (!shortcuts.length) {
        shortcutList.innerHTML = '<p style="color: var(--muted-foreground);">No shortcuts found in ~/.shortcuts</p>';
        return;
    }
    shortcuts.forEach((shortcut) => {
        const button = document.createElement('button');
        button.className = 'menu-item';
        button.textContent = shortcut.name;
        button.addEventListener('click', () => runShortcut(shortcut.path));
        shortcutList.appendChild(button);
    });
}

async function killFrameworkShell(shellId) {
    try {
        await frameworkFetch(`/api/framework_shells/${shellId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'kill' }),
        });
        refreshAll();
    } catch (err) {
        alert(err.message || 'Failed to kill shell');
    }
}

function openModal(modalId, sid) {
    if (sid !== undefined && sid !== null) {
        STATE.currentSessionId = sid;
    }
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'block';
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

window.closeModal = closeModal;
window.openModal = openModal;

export default function initialize(container, apiRef) {
    extensionRoot = container;
    apiClient = apiRef;

    elements.visibleList = container.querySelector('#sessions-visible');
    elements.frameworkList = container.querySelector('#sessions-framework');
    elements.refreshBtn = container.querySelector('#refresh-btn');
    elements.tabVisible = container.querySelector('#sas-tab-visible');
    elements.tabFramework = container.querySelector('#sas-tab-framework');
    elements.autoRefreshSelect = container.querySelector('#auto-refresh-select');

    loadSessionNames();

    if (elements.refreshBtn) elements.refreshBtn.addEventListener('click', () => refreshAll());
    if (elements.tabVisible) elements.tabVisible.addEventListener('click', () => selectTab('visible'));
    if (elements.tabFramework) elements.tabFramework.addEventListener('click', () => selectTab('framework'));

    const savedMs = loadAutoRefreshSetting();
    if (elements.autoRefreshSelect) {
        elements.autoRefreshSelect.value = String(savedMs);
        elements.autoRefreshSelect.addEventListener('change', (event) => {
            const ms = parseInt(event.target.value, 10) || 0;
            saveAutoRefreshSetting(ms);
            applyAutoRefresh(ms);
        });
    }
    applyAutoRefresh(savedMs);

    attachEventListeners();
    refreshAll();
}
