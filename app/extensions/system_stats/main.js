// Extension Script: System Stats

export default function initialize(extensionContainer, api) {
    const cpuValue = extensionContainer.querySelector('#stat-cpu-value');
    const memValue = extensionContainer.querySelector('#stat-mem-value');
    const cpuFill = extensionContainer.querySelector('#progress-cpu-fill');
    const memFill = extensionContainer.querySelector('#progress-mem-fill');
    const ipCard = extensionContainer.querySelector('#ip-card');
    const ipDeviceEl = extensionContainer.querySelector('#stat-ip-device');
    const ipValueEl = extensionContainer.querySelector('#stat-ip-value');
    const rootValueEl = extensionContainer.querySelector('#stat-root-value');
    const rootDotEl = extensionContainer.querySelector('#root-status-dot');

    let suRootAvailable = false; // whether we can exec via `su -c`
    let rootDetectionDone = false;

    async function runCommand(command) {
        const data = await window.teFetch('/api/run_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        return data.stdout;
    }

    function parseCpuUsage(raw) {
        const lines = raw.split('\n');
        const line = lines.find(l => /(CPU:|%Cpu\(s\)|%Cpu\(s\):)/i.test(l)) || raw;
        const idleMatch = line.match(/(\d+(?:\.\d+)?)\s*%\s*(?:idle|id)\b/i);
        if (idleMatch) {
            const idle = parseFloat(idleMatch[1]);
            if (!isNaN(idle)) return Math.max(0, Math.min(100, 100 - idle));
        }
        const firstPct = line.match(/(\d+(?:\.\d+)?)\s*%/);
        return firstPct ? parseFloat(firstPct[1]) : NaN;
    }

    function parseMemUsage(raw) {
        const lines = raw.split('\n');
        const memLine = lines.find(l => /^\s*Mem:/i.test(l)) || raw;
        const parts = memLine.trim().split(/\s+/);
        if (parts.length >= 3) {
            const total = parseInt(parts[1], 10);
            const used = parseInt(parts[2], 10);
            if (total > 0 && !isNaN(used)) return (used / total) * 100;
        }
        return NaN;
    }

    async function detectRootAndSu() {
        try {
            const uid = (await runCommand('id -u')).trim();
            // Attempt to use su. If it returns uid 0, we can escalate.
            const suUid = (await runCommand("command -v su >/dev/null 2>&1 && su -c id -u 2>/dev/null || echo ''")).trim();
            suRootAvailable = suUid === '0';

            if (rootValueEl) {
                if (uid === '0') {
                    rootValueEl.textContent = 'Yes (uid 0)';
                    if (rootDotEl) {
                        rootDotEl.classList.remove('dot-green', 'dot-red', 'dot-yellow');
                        rootDotEl.classList.add('dot-green');
                    }
                } else if (suRootAvailable) {
                    rootValueEl.textContent = 'Available via su';
                    if (rootDotEl) {
                        rootDotEl.classList.remove('dot-green', 'dot-red', 'dot-yellow');
                        rootDotEl.classList.add('dot-green');
                    }
                } else {
                    rootValueEl.textContent = 'No';
                    if (rootDotEl) {
                        rootDotEl.classList.remove('dot-green', 'dot-red', 'dot-yellow');
                        rootDotEl.classList.add('dot-red');
                    }
                }
            }
        } catch (e) {
            if (rootValueEl) rootValueEl.textContent = 'Error';
        } finally {
            rootDetectionDone = true;
        }
    }

    let ipEntries = []; // [{iface, ip}]
    let ipIndex = 0;

    function renderIpEntry() {
        if (!ipDeviceEl || !ipValueEl) return;
        if (!ipEntries.length) {
            ipDeviceEl.textContent = '--';
            ipValueEl.textContent = '--';
            return;
        }
        const entry = ipEntries[Math.max(0, Math.min(ipEntries.length - 1, ipIndex))];
        ipDeviceEl.textContent = entry.iface;
        ipValueEl.textContent = entry.ip;
    }

    let ipHandlersAttached = false;
    function attachIpTileHandlers() {
        if (ipHandlersAttached) return;
        const tile = extensionContainer.querySelector('#ip-tile');
        if (!tile) return;

        // Tap to cycle
        tile.addEventListener('click', () => {
            if (!ipEntries.length) return;
            ipIndex = (ipIndex + 1) % ipEntries.length;
            renderIpEntry();
        });

        // Long press to copy the IP only
        let pressTimer = null;
        const start = () => {
            if (pressTimer) return;
            pressTimer = setTimeout(async () => {
                try {
                    const entry = ipEntries[ipIndex];
                    if (entry && navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(entry.ip);
                        tile.setAttribute('data-copied', '1');
                        tile.style.opacity = '0.6';
                        setTimeout(() => { tile.style.opacity = ''; tile.removeAttribute('data-copied'); }, 600);
                    }
                } catch (_) {}
            }, 600); // 600ms long press
        };
        const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

        tile.addEventListener('mousedown', start);
        tile.addEventListener('touchstart', start, { passive: true });
        ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev => tile.addEventListener(ev, cancel));
        ipHandlersAttached = true;
    }

    async function refreshSystemStats() {
        if (!rootDetectionDone) {
            await detectRootAndSu();
        }
        // CPU
        try {
            let topOutput;
            if (suRootAvailable) {
                topOutput = await runCommand("su -c \"top -bn1 2>/dev/null | head -n 5 || top -n 1 | head -n 5\"");
            } else {
                topOutput = await runCommand("top -bn1 2>/dev/null | head -n 5 || top -n 1 | head -n 5");
            }
            let cpuUsage = parseCpuUsage(topOutput);
            if (isNaN(cpuUsage)) {
                if (suRootAvailable) {
                    topOutput = await runCommand("su -c \"top -n 1 | grep -E 'CPU:|%Cpu' -m1 || top -bn1 | grep -E '%Cpu' -m1\"");
                } else {
                    topOutput = await runCommand("top -n 1 | grep -E 'CPU:|%Cpu' -m1 || top -bn1 | grep -E '%Cpu' -m1");
                }
                cpuUsage = parseCpuUsage(topOutput);
            }
            if (!isNaN(cpuUsage)) {
                if (cpuValue) cpuValue.textContent = `${cpuUsage.toFixed(0)}%`;
                if (cpuFill) cpuFill.style.width = `${Math.max(0, Math.min(100, cpuUsage))}%`;
            } else {
                if (cpuValue) cpuValue.textContent = '--%';
            }
        } catch (e) {
            if (cpuValue) cpuValue.textContent = 'Error';
        }

        // Memory
        try {
            const freeOutput = await runCommand("free 2>/dev/null || busybox free");
            const memUsage = parseMemUsage(freeOutput);
            if (!isNaN(memUsage)) {
                if (memValue) memValue.textContent = `${memUsage.toFixed(0)}%`;
                if (memFill) memFill.style.width = `${Math.max(0, Math.min(100, memUsage))}%`;
            } else {
                if (memValue) memValue.textContent = '--%';
            }
        } catch (e) {
            if (memValue) memValue.textContent = 'Error';
        }

        // IP list (collect all, display one; cycle on tap)
        try {
            const parsed = [];
            // Prefer JS-side parsing to avoid fragile quoting in JS strings
            // 1) ip -o -4
            try {
                const raw1 = await runCommand('ip -o -4 addr show 2>/dev/null || busybox ip -o -4 addr show 2>/dev/null || true');
                raw1.split('\n').forEach(line => {
                    line = line.trim();
                    const m = line.match(/^\d+:\s*([^\s]+)\s+inet\s+([0-9.]+)\//);
                    if (m) {
                        const iface = m[1].replace(/:$/, '');
                        const ip = m[2];
                        if (ip !== '127.0.0.1' && !/^lo$/.test(iface) && !/^docker|^veth/.test(iface)) parsed.push({ iface, ip });
                    }
                });
            } catch (_) {}
            // 2) ifconfig
            try {
                const raw2 = await runCommand('ifconfig 2>/dev/null || busybox ifconfig 2>/dev/null || true');
                let cur = null;
                raw2.split('\n').forEach(line => {
                    if (/^\S/.test(line)) cur = line.split(/\s+/)[0].replace(/:$/, '');
                    const m = line.match(/\binet\s+([0-9.]+)/) || line.match(/inet addr:([0-9.]+)/);
                    if (cur && m) {
                        const ip = m[1];
                        const iface = cur;
                        if (ip !== '127.0.0.1' && !/^lo$/.test(iface) && !/^docker|^veth/.test(iface)) parsed.push({ iface, ip });
                    }
                });
            } catch (_) {}
            // 3) hostname -I
            try {
                const raw3 = await runCommand('hostname -I 2>/dev/null || busybox hostname -I 2>/dev/null || true');
                raw3.split(/\s+/).forEach(tok => {
                    const ip = (tok || '').trim();
                    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && ip !== '127.0.0.1') parsed.push({ iface: 'ip', ip });
                });
            } catch (_) {}
            // 4) fallback via routing
            if (!parsed.length) {
                try {
                    const r = await runCommand('ip route get 1 2>/dev/null || busybox ip route get 1 2>/dev/null || ip -4 route show default 2>/dev/null || busybox ip -4 route show default 2>/dev/null || true');
                    const m = r.match(/dev\s+(\S+).*?src\s+([0-9.]+)/);
                    if (m) {
                        const iface = m[1];
                        const ip = m[2];
                        if (ip && ip !== '127.0.0.1') parsed.push({ iface, ip });
                    }
                } catch (_) {}
            }
            // Deduplicate by iface+ip
            const seen = new Set();
            ipEntries = parsed.filter(e => {
                const key = `${e.iface}|${e.ip}`;
                if (seen.has(key)) return false;
                seen.add(key); return true;
            });
            ipIndex = Math.min(ipIndex, Math.max(0, ipEntries.length - 1));
            renderIpEntry();
            attachIpTileHandlers();
        } catch (e) {
            if (ipDeviceEl) ipDeviceEl.textContent = 'Error';
            if (ipValueEl) ipValueEl.textContent = '';
        }

        // Root status is handled in detectRootAndSu()
    }

    // Initial load and periodic refresh
    refreshSystemStats();
    setInterval(refreshSystemStats, 5000);
}
