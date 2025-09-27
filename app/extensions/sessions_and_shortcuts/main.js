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
    sessionNames: 'sessions_and_shortcuts.sessionNames',
    autoRefresh: 'sessions_and_shortcuts.autoRefreshMs',
    frameworkToken: 'sessions_and_shortcuts.frameworkToken',
};

const teStateStore = window.teState || null;
const persisted = {
    frameworkToken: null,
    sessionNames: {},
    autoRefresh: 0,
};

const SHORTCUTS_DIR = '/data/data/com.termux/files/home/.shortcuts';

async function preloadPersistentState() {
    if (!teStateStore) return;
    try {
        await teStateStore.preload([storageKeys.sessionNames, storageKeys.autoRefresh, storageKeys.frameworkToken]);
        const names = teStateStore.getSync(storageKeys.sessionNames, {});
        if (names && typeof names === 'object') {
            persisted.sessionNames = { ...names };
        }
        const auto = teStateStore.getSync(storageKeys.autoRefresh, 0);
        const autoInt = parseInt(auto, 10);
        persisted.autoRefresh = Number.isNaN(autoInt) ? 0 : autoInt;
        const token = teStateStore.getSync(storageKeys.frameworkToken, null);
        persisted.frameworkToken = typeof token === 'string' && token.trim() ? token : null;
    } catch (err) {
        console.warn('Failed to preload sessions state', err);
    }
}

function loadFrameworkToken() {
    return persisted.frameworkToken;
}

function saveFrameworkToken(token) {
    persisted.frameworkToken = token ? token : null;
    if (!teStateStore) return;
    if (persisted.frameworkToken) {
        teStateStore.set(storageKeys.frameworkToken, persisted.frameworkToken).catch((err) => {
            console.warn('Failed to persist framework token', err);
        });
    } else {
        teStateStore.remove(storageKeys.frameworkToken).catch((err) => {
            console.warn('Failed to clear framework token', err);
        });
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
    STATE.sessionNames = { ...(persisted.sessionNames || {}) };
}

function saveSessionNames() {
    persisted.sessionNames = { ...STATE.sessionNames };
    if (!teStateStore) return;
    teStateStore.set(storageKeys.sessionNames, persisted.sessionNames).catch((err) => {
        console.warn('Failed to persist session names', err);
    });
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
        card.dataset.sid = session.sid;
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
        menu.classList.remove('open');
        menu.style.display = 'none';
        menu.style.top = '';
        menu.style.right = '';
    });
}

function openMenu(sid, button) {
    closeAllMenus();
    const menu = extensionRoot.querySelector(`#menu-${sid}`);
    if (!menu) return;
    const card = button.closest('.session');
    if (!card) return;
    const buttonRect = button.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const top = buttonRect.bottom - cardRect.top + 6;
    menu.style.top = `${top}px`;
    menu.style.right = '12px';
    menu.style.display = 'block';
    menu.classList.add('open');
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
    return Number.isFinite(persisted.autoRefresh) ? persisted.autoRefresh : 0;
}

function saveAutoRefreshSetting(ms) {
    persisted.autoRefresh = Number.isFinite(ms) ? ms : 0;
    if (!teStateStore) return;
    teStateStore.set(storageKeys.autoRefresh, persisted.autoRefresh).catch((err) => {
        console.warn('Failed to persist auto-refresh', err);
    });
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
                STATE.currentSessionId = sid;
                browseShortcutFile();
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

async function browseShortcutFile() {
    if (!STATE.currentSessionId) {
        alert('Please select a session first.');
        return;
    }
    if (!(window.teFilePicker && typeof window.teFilePicker.openFile === 'function')) {
        alert('File picker unavailable');
        return;
    }
    try {
        const result = await window.teFilePicker.openFile({
            startPath: SHORTCUTS_DIR,
            title: 'Select Shortcut File',
            selectLabel: 'Run Shortcut',
        });
        if (result && result.path) {
            runShortcut(result.path);
        }
    } catch (err) {
        console.error('Shortcut picker error', err);
        alert(err.message || 'Failed to open file picker');
    }
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

export default async function initialize(container, apiRef) {
    extensionRoot = container;
    apiClient = apiRef;

    elements.visibleList = container.querySelector('#sessions-visible');
    elements.frameworkList = container.querySelector('#sessions-framework');
    elements.refreshBtn = container.querySelector('#refresh-btn');
    elements.tabVisible = container.querySelector('#sas-tab-visible');
    elements.tabFramework = container.querySelector('#sas-tab-framework');
    elements.autoRefreshSelect = container.querySelector('#auto-refresh-select');

    await preloadPersistentState();
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
