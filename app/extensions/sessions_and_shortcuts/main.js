// Sessions & Shortcuts Extension

const STATE = {
    visibleSessions: [],
    frameworkShells: [],
    shellTrees: [],  // Hierarchical shell trees (app-workers with children)
    containers: [],
    sessionNames: {},
    currentSessionId: null,
    exitedShellsExpanded: false,
    frameworkUiByAppId: {},
};

let liveSocket = null;
let reconnectTimer = null;

let extensionRoot;
let apiClient;

let elements = {
    visibleList: null,
    frameworkList: null,
    tabVisible: null,
    tabFramework: null,
};

const storageKeys = {
    sessionNames: 'sessions_and_shortcuts.sessionNames',
};

// No localStorage/cookies - state is in-memory only
// Session names could be backend-persisted in future if needed
const persisted = {
    sessionNames: {},
};

const SHORTCUTS_DIR = '/data/data/com.termux/files/home/.shortcuts';

async function preloadPersistentState() {
    // No-op: no localStorage usage
}

async function frameworkFetch(url, options = {}) {
    // No auth token needed - auth is disabled when TE_FRAMEWORK_SHELL_TOKEN not set
    const response = await fetch(url, options);
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

function isShellLive(shell) {
    if (!shell) return false;
    if (shell.status !== 'running') return false;
    if (!shell.pid) return false;
    if (shell.stats && shell.stats.alive === false) return false;
    return true;
}

function getSubgroups(shell) {
    return Array.isArray(shell?.subgroups) ? shell.subgroups.filter(Boolean).map(String) : [];
}

function resolveSubgroupStyle(appUi, subgroup) {
    if (!appUi || typeof appUi !== 'object') return null;
    const raw = appUi.subgroup_styles || appUi.subgroupStyles || null;
    if (!raw || typeof raw !== 'object') return null;

    const name = String(subgroup || '');
    if (!name) return null;

    const normalize = (value) => {
        if (!value) return null;
        if (typeof value === 'string') {
            const bg = value.trim();
            return bg ? { bg } : null;
        }
        if (typeof value === 'object') {
            const bg = (value.bg || value.background || '').toString().trim();
            const border = (value.border || '').toString().trim();
            const color = (value.color || '').toString().trim();
            const out = {};
            if (bg) out.bg = bg;
            if (border) out.border = border;
            if (color) out.color = color;
            return Object.keys(out).length ? out : null;
        }
        return null;
    };

    // Exact match first.
    if (Object.prototype.hasOwnProperty.call(raw, name)) {
        return normalize(raw[name]);
    }

    // Prefix matches next (choose most specific/longest).
    let bestKey = null;
    let bestLen = -1;
    for (const key of Object.keys(raw)) {
        if (!key) continue;
        let prefix = null;
        if (key.endsWith('*')) prefix = key.slice(0, -1);
        else if (key.endsWith(':')) prefix = key;
        if (!prefix) continue;
        if (name.startsWith(prefix) && prefix.length > bestLen) {
            bestKey = key;
            bestLen = prefix.length;
        }
    }
    if (bestKey) {
        return normalize(raw[bestKey]);
    }

    return null;
}

function loadSessionNames() {
    STATE.sessionNames = { ...(persisted.sessionNames || {}) };
}

function saveSessionNames() {
    // In-memory only - no localStorage
    persisted.sessionNames = { ...STATE.sessionNames };
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

    const shells = Array.isArray(STATE.frameworkShells) ? STATE.frameworkShells : [];
    if (!shells.length) {
        const placeholder = document.createElement('p');
        placeholder.className = 'session-empty';
        placeholder.textContent = 'No framework shells running.';
        list.appendChild(placeholder);
        return;
    }

    const containerByShell = containerLabelByShell();

    // Optional: app-worker → child processes (from websocket shell tree snapshot).
    // We intentionally exclude children that already have a framework shell record,
    // so those shells show up in the main list (and can be grouped by subgroups).
    const childrenByAppWorkerId = new Map();
    if (Array.isArray(STATE.shellTrees)) {
        STATE.shellTrees.forEach((tree) => {
            if (!tree || !tree.is_app_worker) return;
            const root = tree.shell;
            if (!root || !root.id) return;
            const children = Array.isArray(tree.children) ? tree.children : [];
            const filtered = children.filter((child) => !(child && child.shell));
            childrenByAppWorkerId.set(root.id, filtered);
        });
    }

    const trees = shells.map((shell) => {
        const isAppWorker = (shell?.label || '').startsWith('app-worker:');
        const children = isAppWorker ? (childrenByAppWorkerId.get(shell.id) || []) : [];
        return { shell, children, is_app_worker: isAppWorker };
    });

    function renderFrameworkTreeCard(tree) {
        const shell = tree.shell;
        const children = tree.children || [];
        const isAppWorker = tree.is_app_worker;

        const card = document.createElement('div');
        card.className = 'session framework' + (isAppWorker ? ' app-worker-card' : '');
        if (isAppWorker) {
            try {
                card.dataset.appId = extractAppName(shell.label);
            } catch (_) { }
        }

        const stats = shell.stats || {};
        const containerLabel = containerByShell[shell.id]
            || (isAppWorker ? extractAppName(shell.label) : (shell.label || 'Service'));
        const uptime = stats.uptime != null ? `uptime: ${Math.max(0, Math.round(stats.uptime))}s` : '';
        const cpu = stats.cpu_percent != null ? `cpu: ${stats.cpu_percent.toFixed(1)}%` : '';
        const mem = stats.memory_rss != null ? `mem: ${(stats.memory_rss / (1024 * 1024)).toFixed(1)} MB` : '';
        const statLine = [uptime, cpu, mem].filter(Boolean).join(' · ');

        let childrenHTML = '';
        if (children.length > 0) {
            childrenHTML = `
                <div class="shell-children">
                    <div class="children-header">Child Processes (${children.length})</div>
                    ${children.map(child => renderChildProcess(child)).join('')}
                </div>
            `;
        }

        card.innerHTML = `
            <div class="session-header">
                <div class="session-title">
                    ${isAppWorker ? '<span class="app-worker-badge" title="Open app">App Worker</span>' : ''}
                    ${escapeHTML(containerLabel)}
                </div>
                <div class="shell-actions">
                    <button class="framework-log" data-shell="${shell.id}" title="View Logs">📋</button>
                    <button class="framework-kill ${isAppWorker ? 'kill-with-children' : ''}" 
                            data-shell="${shell.id}" 
                            data-pid="${shell.pid}"
                            data-has-children="${isAppWorker ? 'true' : (children.length > 0)}"
                            title="${isAppWorker ? 'Kill App + Children' : 'Stop'}">✕</button>
                </div>
            </div>
            <div class="session-cwd">PID: ${shell.pid} · ID: ${shell.id}</div>
            <div class="session-cwd">Command: ${escapeHTML((shell.command || []).join(' '))}</div>
            ${statLine ? `<div class="session-cwd">${escapeHTML(statLine)}</div>` : ''}
            ${childrenHTML}
        `;
        return card;
    }

    function renderNestedShellCard(tree) {
        const shell = tree.shell;
        const isAppWorker = tree.is_app_worker;
        const card = document.createElement('div');
        card.className = 'session framework nested-shell';

        const stats = shell.stats || {};
        const containerLabel = containerByShell[shell.id] || (shell.label || 'Shell');
        const uptime = stats.uptime != null ? `uptime: ${Math.max(0, Math.round(stats.uptime))}s` : '';
        const cpu = stats.cpu_percent != null ? `cpu: ${stats.cpu_percent.toFixed(1)}%` : '';
        const mem = stats.memory_rss != null ? `mem: ${(stats.memory_rss / (1024 * 1024)).toFixed(1)} MB` : '';
        const statLine = [uptime, cpu, mem].filter(Boolean).join(' · ');

        card.innerHTML = `
            <div class="session-header">
                <div class="session-title">${escapeHTML(containerLabel)}</div>
                <div class="shell-actions">
                    <button class="framework-log" data-shell="${shell.id}" title="View Logs">📋</button>
                    <button class="framework-kill ${isAppWorker ? 'kill-with-children' : ''}"
                            data-shell="${shell.id}"
                            data-pid="${shell.pid}"
                            data-has-children="${isAppWorker ? 'true' : 'false'}"
                            title="${isAppWorker ? 'Kill App + Children' : 'Stop'}">✕</button>
                </div>
            </div>
            <div class="session-cwd">PID: ${shell.pid} · ID: ${shell.id}</div>
            ${statLine ? `<div class="session-cwd">${escapeHTML(statLine)}</div>` : ''}
        `;
        return card;
    }

    const runningTrees = [];
    const exitedTrees = [];
    trees.forEach((tree) => {
        const shell = tree.shell;
        if (isShellLive(shell)) runningTrees.push(tree);
        else exitedTrees.push(tree);
    });

    const consumedShellIds = new Set();
    const appWorkers = [];
    runningTrees.forEach((tree) => {
        if (tree.is_app_worker) appWorkers.push(tree);
    });

    const appWorkerByAppId = new Map();
    appWorkers.forEach((tree) => {
        const label = tree.shell?.label || '';
        const m = label.match(/^app-worker:(.+)$/);
        const appId = m ? m[1] : null;
        if (appId) appWorkerByAppId.set(appId, tree);
    });

    // Build umbrella→subgroup→trees, and bucket those that should be enveloped inside app-worker cards.
    const groupedOutside = new Map(); // umbrella -> Map(subgroup -> trees)
    const groupedInApp = new Map(); // appId -> Map(subgroup -> trees)

    runningTrees.forEach((tree) => {
        if (tree.is_app_worker) return;
        const shell = tree.shell || {};
        const groups = getSubgroups(shell);
        if (groups.length < 2) return;
        const umbrella = groups[0] || 'Other';
        const subgroup = groups[1] || '';
        if (appWorkerByAppId.has(umbrella)) {
            if (!groupedInApp.has(umbrella)) groupedInApp.set(umbrella, new Map());
            const subMap = groupedInApp.get(umbrella);
            if (!subMap.has(subgroup)) subMap.set(subgroup, []);
            subMap.get(subgroup).push(tree);
            consumedShellIds.add(shell.id);
            return;
        }
        if (!groupedOutside.has(umbrella)) groupedOutside.set(umbrella, new Map());
        const subMap = groupedOutside.get(umbrella);
        if (!subMap.has(subgroup)) subMap.set(subgroup, []);
        subMap.get(subgroup).push(tree);
    });

    // Render app-worker cards first, enveloping any grouped shells for that app ID.
    appWorkers.forEach((tree) => {
        const label = tree.shell?.label || '';
        const m = label.match(/^app-worker:(.+)$/);
        const appId = m ? m[1] : null;
        const subMap = appId ? groupedInApp.get(appId) : null;
        if (!appId || !subMap || subMap.size === 0) {
            list.appendChild(renderFrameworkTreeCard(tree));
            return;
        }

        const appUi =
            (appId && STATE.frameworkUiByAppId && STATE.frameworkUiByAppId[appId])
            || ((tree.shell && typeof tree.shell.ui === 'object') ? tree.shell.ui : null);
        const card = renderFrameworkTreeCard(tree);
        const shellGroups = document.createElement('div');
        shellGroups.className = 'shell-children shell-related';
        shellGroups.innerHTML = `<div class="children-header">Shell Groups</div>`;

        subMap.forEach((treesForSub, subgroup) => {
            const headerRow = document.createElement('div');
            headerRow.className = 'shell-subgroup-row';
            headerRow.innerHTML = `
                <div class="shell-subgroup-header">${escapeHTML(subgroup || 'group')}</div>
                <button class="framework-group-kill" data-umbrella="${escapeHTML(appId)}" data-subgroup="${escapeHTML(subgroup)}" title="Stop this group">✕</button>
            `;
            const subgroupStyle = resolveSubgroupStyle(appUi, subgroup);
            if (subgroupStyle && subgroupStyle.bg) {
                headerRow.style.setProperty('--subgroup-bg', subgroupStyle.bg);
            }
            if (subgroupStyle && subgroupStyle.border) {
                headerRow.style.setProperty('--subgroup-border', subgroupStyle.border);
            }
            if (subgroupStyle && subgroupStyle.color) {
                headerRow.style.setProperty('--subgroup-color', subgroupStyle.color);
            }
            shellGroups.appendChild(headerRow);

            const wrap = document.createElement('div');
            wrap.className = 'shell-subgroup-shells';
            if (subgroupStyle && subgroupStyle.bg) {
                wrap.style.setProperty('--subgroup-bg', subgroupStyle.bg);
            }
            if (subgroupStyle && subgroupStyle.border) {
                wrap.style.setProperty('--subgroup-border', subgroupStyle.border);
            }
            if (subgroupStyle && subgroupStyle.color) {
                wrap.style.setProperty('--subgroup-color', subgroupStyle.color);
            }
            treesForSub.forEach((t) => {
                wrap.appendChild(renderNestedShellCard(t));
            });
            shellGroups.appendChild(wrap);
        });

        card.appendChild(shellGroups);
        list.appendChild(card);
    });

    // Render remaining uncategorized shells (excluding app-workers and shells already enveloped).
    runningTrees.forEach((tree) => {
        const shell = tree.shell || {};
        if (tree.is_app_worker) return;
        if (consumedShellIds.has(shell.id)) return;
        const groups = getSubgroups(shell);
        if (groups.length >= 2) return; // will be rendered in groupedOutside
        list.appendChild(renderFrameworkTreeCard(tree));
    });

    // Render grouped shells that are not under an app-worker card.
    groupedOutside.forEach((subMap, umbrella) => {
        const appUi = (STATE.frameworkUiByAppId && STATE.frameworkUiByAppId[umbrella]) || null;
        const h = document.createElement('div');
        h.className = 'shell-group-header';
        h.innerHTML = `
            <span class="shell-group-title">${escapeHTML(umbrella)}</span>
            <button class="framework-group-kill" data-umbrella="${escapeHTML(umbrella)}" title="Stop all in group">✕</button>
        `;
        list.appendChild(h);

        subMap.forEach((treesForSub, subgroup) => {
            if (subgroup) {
                const sh = document.createElement('div');
                sh.className = 'shell-subgroup-row';
                sh.innerHTML = `
                    <div class="shell-subgroup-header">${escapeHTML(subgroup)}</div>
                    <button class="framework-group-kill" data-umbrella="${escapeHTML(umbrella)}" data-subgroup="${escapeHTML(subgroup)}" title="Stop this group">✕</button>
                `;
                const subgroupStyle = resolveSubgroupStyle(appUi, subgroup);
                if (subgroupStyle && subgroupStyle.bg) {
                    sh.style.setProperty('--subgroup-bg', subgroupStyle.bg);
                }
                if (subgroupStyle && subgroupStyle.border) {
                    sh.style.setProperty('--subgroup-border', subgroupStyle.border);
                }
                if (subgroupStyle && subgroupStyle.color) {
                    sh.style.setProperty('--subgroup-color', subgroupStyle.color);
                }
                list.appendChild(sh);
            }
            treesForSub.forEach((tree) => {
                list.appendChild(renderFrameworkTreeCard(tree));
            });
        });
    });

    if (exitedTrees.length > 0) {
        const card = document.createElement('div');
        card.className = 'session framework exited-shells-card';

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'exited-shells-header';
        header.dataset.action = 'toggle-exited-shells';
        header.innerHTML = `
            <span class="exited-shells-title">Exited shells (${exitedTrees.length})</span>
            <span class="exited-shells-chevron">${STATE.exitedShellsExpanded ? '▾' : '▸'}</span>
        `;

        const wrap = document.createElement('div');
        wrap.className = 'exited-shells-list';
        wrap.style.display = STATE.exitedShellsExpanded ? 'block' : 'none';

        exitedTrees.forEach((tree) => {
            const shell = tree.shell || {};
            const title = shell.label || shell.id || 'Shell';
            const status = shell.status || 'exited';
            const exitCode = (shell.exit_code !== undefined && shell.exit_code !== null) ? `exit: ${shell.exit_code}` : '';
            const line = [status, exitCode].filter(Boolean).join(' · ');

            const card = document.createElement('div');
            card.className = 'session framework exited-shell';
            card.innerHTML = `
                <div class="session-header">
                    <div class="session-title">${escapeHTML(title)}</div>
                    <div class="shell-actions">
                        <button class="framework-log" data-shell="${shell.id}" title="View Logs">📋</button>
                        <button class="framework-purge" data-shell="${shell.id}" title="Purge metadata/logs">🗑</button>
                    </div>
                </div>
                <div class="session-cwd">ID: ${shell.id}</div>
                ${line ? `<div class="session-cwd">${escapeHTML(line)}</div>` : ''}
            `;
            wrap.appendChild(card);
        });

        card.appendChild(header);
        card.appendChild(wrap);
        list.appendChild(card);
    }
}

function extractAppName(label) {
    // Extract app name from label like "app-worker:file_editor_cm6"
    if (!label) return 'Unknown';
    const match = label.match(/^app-worker:(.+)$/);
    return match ? match[1] : label;
}

function renderChildProcess(child) {
    const proc = child.process;
    const shell = child.shell;  // May be null if no matching framework shell

    const label = proc.label || proc.metadata?.label || 'Process';
    const pid = proc.pid;
    const type = proc.type || 'process';
    const cmdPreview = proc.metadata?.command || '';

    // Determine if we have a shell record for richer info
    const hasShell = !!shell;
    const shellId = shell?.id;

    return `
        <div class="child-process" data-pid="${pid}">
            <div class="child-header">
                <span class="child-label">${escapeHTML(label)}</span>
                <span class="child-type">${escapeHTML(type)}</span>
                <div class="child-actions">
                    ${hasShell ? `<button class="child-log" data-shell="${shellId}" title="View Logs">📋</button>` : ''}
                    <button class="child-kill" data-pid="${pid}" title="Kill Process">✕</button>
                </div>
            </div>
            <div class="child-info">PID: ${pid}${cmdPreview ? ` · ${escapeHTML(cmdPreview.slice(0, 50))}${cmdPreview.length > 50 ? '...' : ''}` : ''}</div>
        </div>
    `;
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
        // DISABLED: distro app not available in ASGI migration
        // const data = await window.teFetch('/api/app/distro/containers');
        const data = { ok: true, data: [] }; // Return empty list instead
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('Failed to load containers', err);
        return [];
    }
}

async function fetchFrameworkUi() {
    try {
        const data = await apiClient.get('framework_ui');
        return (data && typeof data === 'object') ? data : {};
    } catch (err) {
        console.warn('Failed to load framework UI hints', err);
        return {};
    }
}

async function refreshAll() {
    try {
        const [sessions, frameworks, containers, frameworkUi] = await Promise.all([
            apiClient.get('sessions'),
            fetchFrameworkShells(),
            fetchContainers(),
            fetchFrameworkUi(),
        ]);
        STATE.visibleSessions = Array.isArray(sessions) ? sessions : [];
        STATE.frameworkShells = frameworks;
        STATE.containers = containers;
        STATE.frameworkUiByAppId = frameworkUi;
        render();
    } catch (err) {
        console.error('Failed to refresh sessions', err);
        const list = elements.visibleList;
        if (list) {
            list.innerHTML = '<p class="session-empty" style="color: var(--destructive);">Error loading sessions.</p>';
        }
    }
}

function applyLiveSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.sessions)) STATE.visibleSessions = payload.sessions;
    if (Array.isArray(payload.frameworks)) STATE.frameworkShells = payload.frameworks;
    if (Array.isArray(payload.shell_trees)) STATE.shellTrees = payload.shell_trees;
    if (Array.isArray(payload.containers)) STATE.containers = payload.containers;
    if (payload.framework_ui && typeof payload.framework_ui === 'object') {
        STATE.frameworkUiByAppId = payload.framework_ui;
    }
    render();
}

function applyShellEvent(payload) {
    if (!payload || !payload.event) return;

    const event = payload.event;
    const shellId = event.shell_id;
    const eventType = event.type;
    const shellData = payload.shell;

    // Update the shell in STATE.frameworkShells
    const idx = STATE.frameworkShells.findIndex(s => s.id === shellId);

    if (eventType === 'shell.removed') {
        // Remove shell from list
        if (idx !== -1) {
            STATE.frameworkShells.splice(idx, 1);
        }
    } else if (shellData) {
        if (idx !== -1) {
            // Update existing shell
            STATE.frameworkShells[idx] = shellData;
        } else {
            // Add new shell
            STATE.frameworkShells.push(shellData);
        }
    }

    // Re-render framework shells section
    renderFrameworkShells();
}

function requestSnapshot() {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        try {
            liveSocket.send(JSON.stringify({ type: 'refresh' }));
        } catch (err) {
            console.warn('Failed to request snapshot over WS', err);
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
            setTimeout(requestSnapshot, 250);
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
            requestSnapshot();
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

        const appWorkerBadge = target.closest?.('.app-worker-badge');
        if (appWorkerBadge) {
            const card = appWorkerBadge.closest('.session.framework.app-worker-card');
            const appId = card?.dataset?.appId;
            if (appId) {
                window.location.href = `/app/${encodeURIComponent(appId)}`;
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const groupKill = target.closest?.('.framework-group-kill');
        if (groupKill) {
            const umbrella = groupKill.dataset.umbrella || '';
            const subgroup = groupKill.dataset.subgroup || '';
            const scope = subgroup ? `${umbrella} → ${subgroup}` : umbrella;
            if (umbrella && confirm(`Stop group ${scope}?`)) {
                stopFrameworkShellGroup(umbrella, subgroup || null);
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const actionBtn = target.closest?.('[data-action]');
        if (actionBtn && actionBtn.dataset.action === 'toggle-exited-shells') {
            STATE.exitedShellsExpanded = !STATE.exitedShellsExpanded;
            renderFrameworkShells();
            e.preventDefault();
            e.stopPropagation();
            return;
        }

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
                    apiClient.delete(`sessions/${sid}`).then(requestSnapshot);
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

        if (target.classList.contains('framework-log') || target.classList.contains('child-log')) {
            const shellId = target.dataset.shell;
            if (shellId) {
                window.location.href = `/shell-logs/${shellId}`;
            }
            return;
        }

        if (target.classList.contains('framework-purge')) {
            const shellId = target.dataset.shell;
            if (shellId) {
                if (confirm(`Purge metadata/logs for ${shellId}?`)) {
                    purgeFrameworkShell(shellId);
                }
            }
            return;
        }

        if (target.classList.contains('framework-kill')) {
            const shellId = target.dataset.shell;
            const pid = target.dataset.pid;
            const hasChildren = target.dataset.hasChildren === 'true';

            if (shellId) {
                const msg = hasChildren
                    ? `Kill this app worker and all its child processes?`
                    : `Stop framework shell ${shellId}?`;
                if (confirm(msg)) {
                    killFrameworkShellWithChildren(shellId, pid, hasChildren);
                }
            }
            return;
        }

        if (target.classList.contains('child-kill')) {
            const pid = target.dataset.pid;
            if (pid && confirm(`Kill child process ${pid}?`)) {
                killProcessByPid(pid);
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
                        setTimeout(requestSnapshot, 250);
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
            body: JSON.stringify({ action: 'terminate' }),
        });
        requestSnapshot();
    } catch (err) {
        alert(err.message || 'Failed to stop shell');
    }
}

async function stopFrameworkShellGroup(umbrella, subgroup) {
    const shells = Array.isArray(STATE.frameworkShells) ? STATE.frameworkShells : [];
    const ids = shells
        .filter((shell) => isShellLive(shell))
        .filter((shell) => {
            const groups = getSubgroups(shell);
            if (!groups.length) return false;
            if (groups[0] !== umbrella) return false;
            if (subgroup) return groups[1] === subgroup;
            return true;
        })
        .map((shell) => shell.id)
        .filter(Boolean);

    if (!ids.length) return;

    try {
        for (const id of ids) {
            await frameworkFetch(`/api/framework_shells/${id}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'terminate', force: true }),
            });
        }
        requestSnapshot();
    } catch (err) {
        alert(err.message || 'Failed to stop group');
    }
}

async function purgeFrameworkShell(shellId) {
    try {
        await frameworkFetch(`/api/framework_shells/${shellId}`, {
            method: 'DELETE',
        });
        requestSnapshot();
    } catch (err) {
        alert(err.message || 'Failed to purge shell');
    }
}

async function killFrameworkShellWithChildren(shellId, pid, killChildren) {
    try {
        if (killChildren && pid) {
            // Use the new endpoint that kills parent + children
            await apiClient.delete(`process/${pid}?kill_children=true`);
        } else {
            // Just stop the shell itself (preserve metadata/logs for Exited section)
            await frameworkFetch(`/api/framework_shells/${shellId}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'terminate', force: true }),
            });
        }
        requestSnapshot();
    } catch (err) {
        alert(err.message || 'Failed to stop shell');
    }
}

async function killProcessByPid(pid) {
    try {
        await apiClient.delete(`process/${pid}`);
        requestSnapshot();
    } catch (err) {
        alert(err.message || 'Failed to kill process');
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
    elements.tabVisible = container.querySelector('#sas-tab-visible');
    elements.tabFramework = container.querySelector('#sas-tab-framework');

    await preloadPersistentState();
    loadSessionNames();

    if (elements.tabVisible) elements.tabVisible.addEventListener('click', () => selectTab('visible'));
    if (elements.tabFramework) elements.tabFramework.addEventListener('click', () => selectTab('framework'));
    attachEventListeners();

    // Default to framework tab on load
    selectTab('framework');

    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${window.location.host}/api/ext/sessions_and_shortcuts/ws`;

    const connectSocket = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        try {
            liveSocket = new WebSocket(wsUrl);
            liveSocket.onopen = () => {
                try { liveSocket.send(JSON.stringify({ type: 'hello' })); } catch (_) { }
            };
            liveSocket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'snapshot' || payload.type === 'update') {
                        // Full state update
                        applyLiveSnapshot(payload);
                    } else if (payload.type === 'shell_event') {
                        // Incremental shell update
                        applyShellEvent(payload);
                    } else if (payload.type === 'sessions_update') {
                        // Session-only update (non-framework shells)
                        if (Array.isArray(payload.sessions)) {
                            STATE.visibleSessions = payload.sessions;
                            renderVisibleSessions();
                        }
                    }
                } catch (err) {
                    console.warn('Bad websocket payload', err);
                }
            };
            liveSocket.onclose = () => {
                reconnectTimer = setTimeout(connectSocket, 1500);
            };
            liveSocket.onerror = () => {
                try { liveSocket.close(); } catch (_) { }
            };
        } catch (err) {
            reconnectTimer = setTimeout(connectSocket, 2000);
        }
    };

    connectSocket();
}
