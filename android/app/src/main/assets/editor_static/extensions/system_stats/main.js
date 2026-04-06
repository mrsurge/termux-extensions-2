// Extension Script: System Stats (WebSocket)

export default function initialize(extensionContainer, api) {
    const cpuValue = extensionContainer.querySelector('#stat-cpu-value');
    const cpuFill = extensionContainer.querySelector('#progress-cpu-fill');
    
    const memValue = extensionContainer.querySelector('#stat-mem-value');
    const memDetail = extensionContainer.querySelector('#stat-mem-detail');
    const memFill = extensionContainer.querySelector('#progress-mem-fill');
    
    const ipValue = extensionContainer.querySelector('#stat-ip-value');
    const rootValue = extensionContainer.querySelector('#stat-root-value');
    
    const sysNode = extensionContainer.querySelector('#sys-node');
    const sysOs = extensionContainer.querySelector('#sys-os');
    const sysRelease = extensionContainer.querySelector('#sys-release');
    const sysMachine = extensionContainer.querySelector('#sys-machine');
    
    const coresGrid = extensionContainer.querySelector('#cores-grid');
    const coreCountLabel = extensionContainer.querySelector('#core-count');

    let socket = null;
    let reconnectTimer = null;
    let statsDisabled = false;
    let coreBars = [];
    
    // IP cycling state
    let allIps = [];
    let currentIpIndex = 0;
    let longPressTimer = null;

    // Lerp animation state - stores current displayed values and targets
    const lerpState = {
        cpuTotal: { current: 0, target: 0 },
        memPercent: { current: 0, target: 0 },
        cores: [] // Array of { current, target }
    };
    const LERP_FACTOR = 0.001; // How fast to approach target (0-1, lower = lazier)
    let animFrameId = null;

    const lerp = (current, target, factor) => current + (target - current) * factor;

    const animateLoop = () => {
        // CPU total
        lerpState.cpuTotal.current = lerp(lerpState.cpuTotal.current, lerpState.cpuTotal.target, LERP_FACTOR);
        if (cpuFill) cpuFill.style.width = `${lerpState.cpuTotal.current}%`;
        if (cpuValue) cpuValue.textContent = `${Math.round(lerpState.cpuTotal.current)}%`;

        // Memory
        lerpState.memPercent.current = lerp(lerpState.memPercent.current, lerpState.memPercent.target, LERP_FACTOR);
        if (memFill) memFill.style.width = `${lerpState.memPercent.current}%`;
        if (memValue) memValue.textContent = `${Math.round(lerpState.memPercent.current)}%`;

        // Core bars
        lerpState.cores.forEach((core, i) => {
            core.current = lerp(core.current, core.target, LERP_FACTOR);
            if (coreBars[i]) {
                coreBars[i].style.height = `${core.current}%`;
                coreBars[i].classList.remove('high-load', 'med-load');
                if (core.current > 80) coreBars[i].classList.add('high-load');
                else if (core.current > 50) coreBars[i].classList.add('med-load');
            }
        });

        animFrameId = requestAnimationFrame(animateLoop);
    };

    // Start animation loop
    animFrameId = requestAnimationFrame(animateLoop);

    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${window.location.host}/api/ext/system_stats/ws`;

    const cleanup = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        socket = null;
    };

    const disableStats = (reason) => {
        if (statsDisabled) return;
        statsDisabled = true;
        cleanup();
        if (reason) console.warn('[Stats] Disabled:', reason);
        if (cpuValue) cpuValue.textContent = '--';
        if (memValue) memValue.textContent = '--';
        if (ipValue) ipValue.textContent = '--';
    };

    const updateIpDisplay = () => {
        if (!ipValue || allIps.length === 0) return;
        const entry = allIps[currentIpIndex];
        ipValue.textContent = entry ? `${entry.iface}: ${entry.ip}` : '--';
    };

    const cycleIp = () => {
        if (allIps.length <= 1) return;
        currentIpIndex = (currentIpIndex + 1) % allIps.length;
        updateIpDisplay();
    };

    const copyCurrentIp = () => {
        if (allIps.length === 0) return;
        const entry = allIps[currentIpIndex];
        if (entry && navigator.clipboard) {
            navigator.clipboard.writeText(entry.ip).then(() => {
                // Brief visual feedback
                const orig = ipValue.textContent;
                ipValue.textContent = 'Copied!';
                setTimeout(() => updateIpDisplay(), 800);
            }).catch(() => {});
        }
    };

    // Setup tap/long-press on IP element
    if (ipValue) {
        ipValue.style.cursor = 'pointer';
        
        ipValue.addEventListener('pointerdown', (e) => {
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                copyCurrentIp();
            }, 500);
        });
        
        ipValue.addEventListener('pointerup', (e) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                cycleIp();
            }
        });
        
        ipValue.addEventListener('pointerleave', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });
    }

    const handleMessage = (msg) => {
        if (msg.type === 'error') {
            disableStats(msg.message || 'system stats stream failed');
            try { if (socket) socket.close(); } catch (_) {}
            return;
        }
        if (msg.type === 'static') {
            // System info (sent once on connect)
            const info = msg.info || {};
            const root = msg.root || {};
            
            if (sysNode) sysNode.textContent = info.node || 'Unknown';
            if (sysOs) sysOs.textContent = info.system || 'Unknown';
            if (sysRelease) sysRelease.textContent = info.release || '';
            if (sysMachine) sysMachine.textContent = info.machine || '';
            
            if (rootValue) {
                if (root.is_root) {
                    rootValue.textContent = `Yes (${root.method})`;
                    rootValue.style.color = 'var(--success)';
                } else {
                    rootValue.textContent = 'No';
                    rootValue.style.color = 'var(--muted-foreground)';
                }
            }
        } else if (msg.type === 'metrics') {
            // Live metrics (sent every second)
            const cpu = msg.cpu || {};
            const mem = msg.memory || {};
            
            // Set targets for lerp animation (CPU & Memory)
            lerpState.cpuTotal.target = cpu.total || 0;
            lerpState.memPercent.target = mem.percent || 0;
            
            // Memory detail (not animated)
            if (memDetail) memDetail.textContent = `${mem.used || 0} / ${mem.total || 0} GB`;
            
            // IPs - update list, preserve selection if possible
            if (msg.ips && msg.ips.length > 0) {
                const oldIp = allIps[currentIpIndex]?.ip;
                allIps = msg.ips;
                // Try to keep same IP selected
                const newIdx = allIps.findIndex(e => e.ip === oldIp);
                if (newIdx >= 0) currentIpIndex = newIdx;
                else if (currentIpIndex >= allIps.length) currentIpIndex = 0;
                updateIpDisplay();
            } else if (msg.ip) {
                // Fallback to single IP
                allIps = [{iface: 'default', ip: msg.ip}];
                currentIpIndex = 0;
                updateIpDisplay();
            }
            
            // CPU cores
            const cores = cpu.cores || [];
            if (coreCountLabel) coreCountLabel.textContent = `${cores.length} cores`;
            
            // Create core bars if needed
            if (coresGrid && coreBars.length !== cores.length) {
                coresGrid.innerHTML = '';
                coreBars = [];
                lerpState.cores = [];
                for (let i = 0; i < cores.length; i++) {
                    const col = document.createElement('div');
                    col.className = 'core-col';
                    const track = document.createElement('div');
                    track.className = 'core-bar-track';
                    const fill = document.createElement('div');
                    fill.className = 'core-bar-fill';
                    track.appendChild(fill);
                    col.appendChild(track);
                    coresGrid.appendChild(col);
                    coreBars.push(fill);
                    lerpState.cores.push({ current: 0, target: 0 });
                }
            }
            
            // Set core targets for lerp animation
            cores.forEach((pct, i) => {
                if (lerpState.cores[i]) {
                    lerpState.cores[i].target = pct;
                }
            });
        }
    };

    const connectSocket = () => {
        if (statsDisabled) return;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        try {
            socket = new WebSocket(wsUrl);
            socket.onopen = () => {
                console.log('[Stats] WebSocket connected');
            };
            socket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleMessage(msg);
                } catch (err) {
                    console.warn('Bad websocket payload', err);
                }
            };
            socket.onclose = () => {
                console.log('[Stats] WebSocket disconnected');
                cleanup();
                disableStats('websocket closed');
            };
            socket.onerror = (err) => {
                console.error('[Stats] WebSocket error', err);
                try { socket.close(); } catch (_) {}
            };
        } catch (err) {
            disableStats(err instanceof Error ? err.message : 'websocket connection failed');
        }
    };

    connectSocket();

    // Return init result (optional promise)
    return Promise.resolve();
}
