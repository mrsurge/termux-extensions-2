// Extension Script: Process Manager

export default function initialize(extensionContainer, api) {
    const container = extensionContainer.querySelector('#process-list-container');
    const refreshBtn = extensionContainer.querySelector('#pm-refresh-btn');
    const suBtn = extensionContainer.querySelector('#pm-su-toggle-btn');
    const expandBtn = extensionContainer.querySelector('#pm-expand-btn');

    let processes = [];
    let sortKey = 'cpu'; // default sort by CPU when available
    let sortDir = 'desc';
    let commandsExpanded = false; // toggle for full-width command display

    async function runCommand(command) {
        const data = await window.teFetch('/api/run_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        return data.stdout;
    }

    function buildSuCommand(cmd) {
        // Wrap command for su -c with safe single-quote escaping
        const escaped = String(cmd).replace(/'/g, "'\\''");
        return `su -c '${escaped}'`;
    }

    async function fetchProcesses() {
        // Try the preferred format first: includes %CPU and %MEM (procps)
        const attempts = [
            {
                cmd: 'ps -eo pid=,user=,%cpu=,%mem=,comm=',
                parse: (out) => parsePsFixed(out, ['pid', 'user', 'cpu', 'mem', 'command'])
            },
            {
                cmd: 'ps -A -o pid=,user=,name=',
                parse: (out) => parsePsFixed(out, ['pid', 'user', 'command'])
            },
            {
                // Fallback: default toybox ps output (USER PID ... NAME)
                cmd: 'ps',
                parse: (out) => parsePsDefault(out)
            }
        ];

        let lastError = null;
        for (const attempt of attempts) {
            try {
                const baseCmd = attempt.cmd;
                const cmd = suActive() ? buildSuCommand(baseCmd) : baseCmd;
                const stdout = await runCommand(cmd);
                const parsed = attempt.parse(stdout);
                if (parsed && parsed.length) return parsed;
            } catch (e) {
                lastError = e;
                // Graceful fallback: if su fails, try without it to still display something
                if (suActive()) {
                    try {
                        const stdout2 = await runCommand(attempt.cmd);
                        const parsed2 = attempt.parse(stdout2);
                        if (parsed2 && parsed2.length) return parsed2;
                    } catch (_) { /* ignore */ }
                }
            }
        }
        if (lastError) throw lastError;
        return [];
    }

    function parsePsFixed(stdout, fields) {
        return stdout
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(line => {
                const parts = line.split(/\s+/);
                const obj = {};
                for (let i = 0; i < fields.length; i++) {
                    const key = fields[i];
                    if (i === fields.length - 1) {
                        // Join remaining tokens just in case
                        obj[key] = parts.slice(i).join(' ');
                        break;
                    } else {
                        obj[key] = parts[i] ?? '';
                    }
                }
                obj.pid = parseInt(obj.pid, 10);
                if ('cpu' in obj) obj.cpu = safeFloat(obj.cpu);
                if ('mem' in obj) obj.mem = safeFloat(obj.mem);
                return obj;
            })
            .filter(p => Number.isInteger(p.pid));
    }

    function parsePsDefault(stdout) {
        const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return [];
        const dataLines = /^user\b|^uid\b|^USER\b|^UID\b/.test(lines[0]) ? lines.slice(1) : lines;
        return dataLines.map(line => {
            const parts = line.split(/\s+/);
            // Default toybox ps: USER PID PPID VSIZE RSS WCHAN ADDR S NAME
            const user = parts[0];
            const pid = parseInt(parts[1], 10);
            const command = parts.slice(8).join(' ') || parts[parts.length - 1];
            return { pid, user, command };
        }).filter(p => Number.isInteger(p.pid));
    }

    function safeFloat(v) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    function sortData(data) {
        const dir = sortDir === 'asc' ? 1 : -1;
        const key = sortKey;
        return [...data].sort((a, b) => {
            const va = a[key];
            const vb = b[key];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            if (key === 'pid') return (parseInt(va, 10) - parseInt(vb, 10)) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
    }

    function render() {
        if (!container) return;

        const hasCpu = processes.some(p => typeof p.cpu === 'number');
        const hasMem = processes.some(p => typeof p.mem === 'number');
        if ((sortKey === 'cpu' && !hasCpu) || (sortKey === 'mem' && !hasMem)) {
            sortKey = 'pid';
            sortDir = 'asc';
        }
        const sorted = sortData(processes);

        const cols = [
            { key: 'pid', label: 'PID' },
            { key: 'user', label: 'User' },
            ...(hasCpu ? [{ key: 'cpu', label: '%CPU' }] : []),
            ...(hasMem ? [{ key: 'mem', label: '%MEM' }] : []),
            { key: 'command', label: 'Command' },
            { key: '__actions', label: 'Actions' }
        ];

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.innerHTML = `
            <thead>
                <tr>
                    ${cols.map(c => `<th data-key="${c.key}" style="text-align:left; border-bottom:1px solid var(--border); padding:6px; cursor:${c.key.startsWith('__') ? 'default' : 'pointer'}; color: var(--muted-foreground); font-weight: 600;">${c.label}${!c.key.startsWith('__') && sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${sorted.map(p => `
                    <tr>
                        ${cols.map(c => renderCell(c, p)).join('')}
                    </tr>
                `).join('')}
            </tbody>
        `;

        // Header sort handlers
        table.querySelectorAll('th[data-key]').forEach(th => {
            const key = th.getAttribute('data-key');
            if (key && !key.startsWith('__')) {
                th.addEventListener('click', () => {
                    if (sortKey === key) {
                        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortKey = key;
                        sortDir = key === 'pid' ? 'asc' : 'desc';
                    }
                    render();
                });
            }
        });

        container.innerHTML = '';
        container.appendChild(table);
        attachRowActions();
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderCell(col, p) {
        if (col.key === '__actions') {
            return `<td style="padding:6px; white-space:nowrap;">
                <button class="pm-term-btn" data-pid="${p.pid}" style="margin-right:6px;">TERM</button>
                <button class="pm-kill-btn" data-pid="${p.pid}">KILL</button>
            </td>`;
        }
        const val = p[col.key];
        const display = (col.key === 'cpu' || col.key === 'mem') && typeof val === 'number' ? val.toFixed(1) : (val ?? '');
        if (col.key === 'command') {
            const full = escapeHtml(display);
            const styleCollapsed = "padding:6px; border-bottom:1px solid var(--border); font-family: 'JetBrains Mono', monospace; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
            const styleExpanded = "padding:6px; border-bottom:1px solid var(--border); font-family: 'JetBrains Mono', monospace; white-space: nowrap;";
            const style = commandsExpanded ? styleExpanded : styleCollapsed;
            return `<td style="${style}" title="${full}">${full}</td>`;
        }
        return `<td style="padding:6px; border-bottom:1px solid var(--border); font-family: 'JetBrains Mono', monospace;">${escapeHtml(display)}</td>`;
    }

    function suActive() {
        return suBtn && suBtn.getAttribute('data-active') === '1';
    }

    async function sendSignal(pid, signal) {
        try {
            if (suActive()) {
                try {
                    await runCommand(buildSuCommand(`kill -${signal} ${pid}`));
                    window.teUI && window.teUI.toast && window.teUI.toast(`Sent ${signal} to ${pid} via su`);
                } catch (suErr) {
                    // Fallback to normal kill if su fails
                    await runCommand(`kill -${signal} ${pid}`);
                    window.teUI && window.teUI.toast && window.teUI.toast(`su failed; sent ${signal} to ${pid}`);
                }
            } else {
                await runCommand(`kill -${signal} ${pid}`);
                window.teUI && window.teUI.toast && window.teUI.toast(`Sent ${signal} to ${pid}`);
            }
            setTimeout(load, 400);
        } catch (e) {
            const msg = e && e.message ? e.message : 'Failed to send signal';
            window.teUI && window.teUI.toast && window.teUI.toast(msg);
        }
    }

    function attachRowActions() {
        container.querySelectorAll('.pm-term-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pid = parseInt(btn.getAttribute('data-pid'), 10);
                if (Number.isInteger(pid)) sendSignal(pid, 'TERM');
            });
        });
        container.querySelectorAll('.pm-kill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pid = parseInt(btn.getAttribute('data-pid'), 10);
                if (!Number.isInteger(pid)) return;
                if (confirm(`Send KILL to PID ${pid}?`)) sendSignal(pid, 'KILL');
            });
        });
    }

    async function load() {
        container.innerHTML = '<p>Loading processes...</p>';
        try {
            processes = await fetchProcesses();
            render();
        } catch (e) {
            console.error('Failed to load processes:', e);
            container.innerHTML = `<p style="color: var(--destructive);">Error loading processes.</p><pre style="white-space: pre-wrap; color: var(--muted-foreground); font-size: 0.85em;">${e && e.message ? e.message : e}</pre>`;
        }
    }

    if (refreshBtn) refreshBtn.addEventListener('click', load);
    if (suBtn) {
        suBtn.addEventListener('click', () => {
            const active = suBtn.getAttribute('data-active') === '1';
            suBtn.setAttribute('data-active', active ? '0' : '1');
            suBtn.style.backgroundColor = active ? '' : 'var(--secondary)';
            suBtn.style.color = active ? '' : 'var(--foreground)';
            if (window.teUI && window.teUI.toast) {
                window.teUI.toast(`System (su) ${active ? 'disabled' : 'enabled'}`);
            }
            load();
        });
    }
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            commandsExpanded = !commandsExpanded;
            expandBtn.textContent = commandsExpanded ? 'Collapse Cmds' : 'Expand Cmds';
            render();
        });
    }

    // Initial load
    load();
}
