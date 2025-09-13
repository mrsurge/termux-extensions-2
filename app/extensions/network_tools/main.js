// Extension Script: Network Tools

export default function initialize(extensionContainer, api) {
  // --- Utilities ---
  const TERMUX_PREFIX = '/data/data/com.termux/files/usr';
  const shQuote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'"; // robust single-quote escaping
  const $ = (sel, root = extensionContainer) => root.querySelector(sel);
  const $$ = (sel, root = extensionContainer) => Array.from(root.querySelectorAll(sel));

  // --- State ---
  let lastXml = '';
  let parsedHosts = [];
  let nodes = [];
  let edges = [];
  let visLoaded = false;
  let networkInstance = null;

  // --- Tab wiring ---
  function switchProfile(profile) {
    $$("[data-profile]").forEach(panel => {
      panel.style.display = panel.getAttribute('data-profile') === profile ? '' : 'none';
    });
    $$(".nt-tab").forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === profile));
    if (profile === 'zenmap') switchSubtab('zenmap', 'scan');
  }

  function switchSubtab(profile, sub) {
    const scope = $(`[data-profile="${profile}"]`);
    if (!scope) return;
    $$(`[data-subtab]`, scope).forEach(panel => {
      panel.style.display = panel.getAttribute('data-subtab') === sub ? 'block' : 'none';
    });
    $$(`.nt-vtab`, scope).forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-vtab') === sub));
    if (profile === 'zenmap' && sub === 'topology') ensureVisAndRender();
  }

  $$(".nt-tab").forEach(btn => btn.addEventListener('click', () => switchProfile(btn.getAttribute('data-tab'))));
  $$("[data-profile='zenmap'] .nt-vtab").forEach(btn => btn.addEventListener('click', () => switchSubtab('zenmap', btn.getAttribute('data-vtab'))));
  switchProfile('zenmap');

  // --- API helpers ---
  async function runCommand(command) {
    const data = await window.teFetch('/api/run_command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command })
    });
    return data.stdout || '';
  }

  async function runCommandRaw(command) {
    try {
      const res = await fetch('/api/run_command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body && body.ok) return { ok: true, stdout: body.data?.stdout || '' };
      return { ok: false, error: body?.error || `${res.status}`, stderr: body?.stderr };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // --- Zenmap ---
  const targetEl = $('#z-target');
  const flagsEl = $('#z-flags');
  const scanBtn = $('#z-scan-btn');
  const pickTargetBtn = $('#z-pick-target-btn');
  const pickerEl = $('#z-target-picker');
  const statusEl = $('#z-status');
  const clearBtn = $('#z-clear-btn');

  function setScanBusy(v, msg = '') {
    if (scanBtn) scanBtn.disabled = !!v;
    if (statusEl) statusEl.textContent = msg || (v ? 'Running scan…' : '');
  }

  function adjustFlagsForUnprivileged(flags) {
    const toks = (flags || '').trim().length ? (flags || '').trim().split(/\s+/) : [];
    const out = [];
    const notes = [];
    let hasUnpriv = false;
    for (const t of toks) {
      if (t === '-sS') { out.push('-sT'); notes.push('replaced -sS with -sT'); continue; }
      if (t === '--unprivileged') hasUnpriv = true;
      out.push(t);
    }
    if (!hasUnpriv) { out.unshift('--unprivileged'); notes.push('added --unprivileged'); }
    return { flags: out.join(' ').trim(), note: notes.join('; ') };
  }

  function parseNmapXml(xmlText) {
    parsedHosts = []; nodes = []; edges = [];
    if (!xmlText || !xmlText.trim()) return;
    let xml;
    try {
      xml = new DOMParser().parseFromString(xmlText, 'application/xml');
      const parsererr = xml.querySelector('parsererror');
      if (parsererr) throw new Error(parsererr.textContent || 'XML parse error');
    } catch (_) { return; }

    const hostNodes = Array.from(xml.querySelectorAll('host'));
    hostNodes.forEach(h => {
      const status = h.querySelector('status')?.getAttribute('state') || '';
      if (status && status !== 'up') return;
      const addrEl = h.querySelector('address[addrtype="ipv4"]') || h.querySelector('address');
      const ip = addrEl?.getAttribute('addr') || 'unknown';
      const hnEl = h.querySelector('hostnames hostname');
      const hostname = hnEl?.getAttribute('name') || '';
      const ports = [];
      h.querySelectorAll('ports > port').forEach(p => {
        const portid = p.getAttribute('portid');
        const proto = p.getAttribute('protocol') || '';
        const state = p.querySelector('state')?.getAttribute('state') || '';
        const service = p.querySelector('service')?.getAttribute('name') || '';
        if (state === 'open') ports.push({ portid, proto, service, state });
      });
      parsedHosts.push({ id: ip, ip, hostname, ports, rawNode: h });
    });

    // Basic star topology from a virtual center node
    const centerId = '__scan__';
    nodes.push({ id: centerId, label: 'Scan', shape: 'hexagon', color: { background: '#3b82f6', border: '#60a5fa' }, font: { color: '#fff' } });
    parsedHosts.forEach(h => {
      const label = h.hostname ? `${h.hostname}\n${h.ip}` : h.ip;
      nodes.push({ id: h.id, label, shape: 'dot' });
      edges.push({ from: centerId, to: h.id });
    });
  }

  function renderDetails(hostId) {
    const panel = $('#z-details');
    if (!panel) return;
    const host = parsedHosts.find(h => h.id === hostId);
    if (!host) { panel.innerHTML = '<div class="nt-muted">Select a node to view details.</div>'; return; }
    const portsHtml = host.ports.length
      ? host.ports.map(p => `<div class="port-row"><span class="mono">${p.proto}/${p.portid}</span> <span class="muted">${p.service || ''}</span></div>`).join('')
      : '<div class="nt-muted">No open ports found.</div>';
    panel.innerHTML = `
      <div class="detail-title">${host.hostname || host.ip}</div>
      <div class="detail-sub mono">${host.ip}</div>
      <div class="detail-section">
        <div class="detail-heading">Open Ports</div>
        ${portsHtml}
      </div>
    `;
  }

  async function loadVis() {
    if (visLoaded) return;
    await new Promise((resolve, reject) => {
      if (window.vis && window.vis.Network) return resolve();
      const s = document.createElement('script');
      s.src = `/extensions/network_tools/vis-network.min.js`;
      s.async = true;
      s.onload = () => (window.vis && window.vis.Network) ? resolve() : reject(new Error('vis not available after load'));
      s.onerror = () => {
        const cdn = document.createElement('script');
        cdn.src = 'https://unpkg.com/vis-network/standalone/umd/vis-network.min.js';
        cdn.async = true;
        cdn.onload = () => (window.vis && window.vis.Network) ? resolve() : reject(new Error('vis not available from CDN'));
        cdn.onerror = () => reject(new Error('Failed to load vis-network'));
        document.head.appendChild(cdn);
      };
      document.head.appendChild(s);
    });
    visLoaded = true;
  }

  async function ensureVisAndRender() {
    const container = $('#z-topology');
    if (!container) return;
    try { await loadVis(); } catch (e) { container.innerHTML = `<div class="nt-error">${e.message}</div>`; return; }

    const graphEl = $('#z-graph');
    if (!nodes.length) { graphEl.innerHTML = '<div class="nt-muted">Run a scan to view topology.</div>'; return; }
    try { if (networkInstance && networkInstance.destroy) networkInstance.destroy(); } catch (_) {}
    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    const options = { autoResize: true, height: '320px', nodes: { shape: 'dot', size: 12, font: { color: '#e5e7eb' }, color: { border: '#334155', background: '#1f2937' } }, edges: { color: { color: '#64748b' } }, physics: { stabilization: true, solver: 'forceAtlas2Based' }, interaction: { hover: true } };
    networkInstance = new vis.Network(graphEl, data, options);
    networkInstance.on('selectNode', params => { const id = params?.nodes?.[0]; if (id && id !== '__scan__') renderDetails(id); });
  }

  if (clearBtn) clearBtn.addEventListener('click', () => { const el = extensionContainer.querySelector('#z-raw-output'); if (el) el.textContent = ''; if (statusEl) statusEl.textContent = ''; });
  if (scanBtn) {
    [targetEl, flagsEl].forEach(inp => inp && inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); scanBtn.click(); } }));
    scanBtn.addEventListener('click', async () => {
      const target = (targetEl?.value || '').trim();
      const flags = (flagsEl?.value || '').trim();
      if (!target) { window.teUI?.toast?.('Please enter a target to scan'); return; }
      setScanBusy(true, 'Running scan…'); const rawEl = extensionContainer.querySelector('#z-raw-output'); if (rawEl) rawEl.textContent = '';
      
      try {
        // Ensure nmap exists
        const check = await runCommandRaw("command -v nmap >/dev/null 2>&1 && echo OK || echo MISSING");
        if (!check.ok) { statusEl.textContent = 'Preflight check failed'; if (rawEl) rawEl.textContent = check.stderr || check.error || 'Unknown error'; return; }
        if (!/\bOK\b/.test(check.stdout)) { statusEl.textContent = 'Nmap is not installed'; if (rawEl) rawEl.textContent = 'Install with:\n  pkg install nmap'; return; }

        // Synchronous run: capture XML on stdout
        const baseCore = `nmap ${flags || ''} -oX - ${target}`.trim().replace(/\s+/g, ' ');
        const envPref = `env PATH=${TERMUX_PREFIX}/bin:${TERMUX_PREFIX}/sbin:$PATH `;
        const nmapExplicit = `${TERMUX_PREFIX}/bin/nmap ${flags || ''} -oX - ${target}`.trim().replace(/\s+/g, ' ');
        const attempts = [
          { m: 'sudo-env', c: `sudo ${envPref}${baseCore}` },
          { m: 'sudo',     c: `sudo ${baseCore}` },
          { m: 'su-env',   c: `su -c ${shQuote(envPref + baseCore)}` },
          { m: 'su-explicit', c: `su -c ${shQuote(nmapExplicit)}` },
        ];
        let attempt = null;
        for (const a of attempts) {
          const res = await runCommandRaw(a.c);
          if (res.ok && /\<nmaprun[\s>]/.test(res.stdout || '')) { attempt = { ...res, method: a.m }; break; }
        }
        if (!attempt) {
          const adj = adjustFlagsForUnprivileged(flags);
          const nonRootCmd = `nmap ${adj.flags} -oX - ${target}`.trim().replace(/\s+/g, ' ');
          const fb = await runCommandRaw(nonRootCmd);
          if (!fb.ok) {
            // Final fallback: try plain sudo without -T in case -T unsupported
            const sudoPlain = await runCommandRaw(`sudo ${nonRootCmd}`);
            if (!sudoPlain.ok) {
              statusEl.textContent = 'Scan failed'; if (rawEl) rawEl.textContent = fb.stderr || fb.error || sudoPlain.error || 'Unknown error'; return;
            }
            attempt = sudoPlain;
            statusEl.textContent = 'Ran with sudo (non-root flags)';
          } else {
            statusEl.textContent = 'Ran without root (adjusted flags)' + (adj.note ? ` — ${adj.note}` : '');
            attempt = fb;
          }
        }

        const out = attempt.stdout || '';
        lastXml = out; if (rawEl) rawEl.textContent = out;
        if (/\<nmaprun[\s>]/.test(out)) {
          parseNmapXml(out);
          const topoVisible = $('[data-profile=\"zenmap\"] [data-subtab=\"topology\"]').style.display !== 'none';
          if (topoVisible) await ensureVisAndRender();
          renderDetails(null);
          if (attempt.method) statusEl.textContent = `Scan completed with root via ${attempt.method}`;
        } else {
          statusEl.textContent = 'Output is not XML. Check flags or permissions.';
        }



      } catch (e) {
        statusEl.textContent = 'Scan failed'; const rawEl2 = extensionContainer.querySelector('#z-raw-output'); if (rawEl2) rawEl2.textContent = String(e?.message || e);
      } finally { setScanBusy(false); }
    });
  }

  // Target Picker from Ifconfig map
  async function getNetMap() {
    // Compute fresh map to avoid stale entries; fallback to saved
    try {
      if (typeof collectIfaces === 'function') {
        const list = await collectIfaces();
        if (Array.isArray(list)) {
          const map = buildVarMap(list);
          window.teNetMap = map;
          return map;
        }
      }
    } catch (_) {}
    try {
      const saved = localStorage.getItem('te.net.map');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return { ip: {}, ips: {}, mac: {}, meta: {} };
  }

  function sanitizeCidr(cidr) {
    // Ensure form like a.b.c.d/nn or IPv6/prefix; strip brackets
    if (!cidr) return '';
    return String(cidr).replace(/^\[|\]$/g, '').trim();
  }

  function ipv4ToInt(ip) {
    const p = ip.split('.').map(x => parseInt(x, 10));
    if (p.length !== 4 || p.some(n => isNaN(n) || n < 0 || n > 255)) return null;
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  }

  function intToIpv4(n) {
    return [ (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255 ].join('.');
  }

  function toNetworkCidr(cidr) {
    cidr = sanitizeCidr(cidr);
    if (!cidr) return '';
    // IPv4 CIDR
    if (/^\d+\.\d+\.\d+\.\d+(?:\/\d+)?$/.test(cidr)) {
      const [ip, pfxStr] = cidr.split('/')
      const pfx = pfxStr ? parseInt(pfxStr, 10) : 32;
      const ipn = ipv4ToInt(ip);
      if (ipn == null || isNaN(pfx) || pfx < 0 || pfx > 32) return cidr;
      const mask = pfx === 0 ? 0 : (0xFFFFFFFF << (32 - pfx)) >>> 0;
      const net = ipn & mask;
      return `${intToIpv4(net)}/${pfx}`;
    }
    // For IPv6 or other formats, return as-is (already with prefix)
    return cidr;
  }

  function renderTargetPicker(map) {
    if (!pickerEl) return;
    const labels = JSON.parse(localStorage.getItem('te.net.labels') || '{}');
    const entries = Object.keys(map.ip).sort();
    const html = entries.map(label => {
      const v4 = map.ip[label]?.v4 || null;
      const v6 = map.ip[label]?.v6 || null;
      const addrs = [v4, v6].filter(Boolean);
      if (!addrs.length) return '';
      const title = label;
      const blocks = addrs.map(addr => {
        const s = sanitizeCidr(addr);
        // Host forms
        const host = /^\d+\.\d+\.\d+\.\d+(?:\/\d+)?$/.test(s)
          ? s.split('/')[0] + '/32'
          : (s.includes('/') ? s.split('/')[0] + '/128' : s);
        // Network (IPv4 computed; IPv6 left as-is)
        const net = toNetworkCidr(s);
        const lines = [];
        lines.push(`
          <div class="zp-item" data-fill="${host}">
            <span class="zp-chip">Host</span>
            <span class="zp-ip">${host}</span>
          </div>`);
        if (net && net !== host) {
          lines.push(`
          <div class="zp-item" data-fill="${net}">
            <span class="zp-chip">Network</span>
            <span class="zp-ip">${net}</span>
          </div>`);
        }
        return lines.join('');
      }).join('');
      return `<div class="zp-group"><div class="zp-title">${title}</div>${blocks}</div>`;
    }).join('') || '<div class="nt-muted" style="padding:6px;">No addresses found</div>';
    pickerEl.innerHTML = html;
    pickerEl.querySelectorAll('.zp-item').forEach(item => {
      item.addEventListener('click', () => {
        const fill = item.getAttribute('data-fill');
        if (targetEl && fill) targetEl.value = fill;
        pickerEl.style.display = 'none';
      });
    });
  }

  async function toggleTargetPicker() {
    if (!pickerEl) return;
    if (pickerEl.style.display === 'none' || !pickerEl.style.display) {
      try {
        const list = await collectIfaces();
        const map = buildVarMap(list);
        try { localStorage.setItem('te.net.map', JSON.stringify(map)); } catch(_){}
        window.teNetMap = map;
        renderIfcfg(list);
        updateVarPreview(list);
        renderTargetPicker(map);
      } catch (e) {
        const map = await getNetMap();
        renderTargetPicker(map);
      }
      pickerEl.style.display = 'block';
    } else {
      pickerEl.style.display = 'none';
    }
  }

  if (pickTargetBtn) pickTargetBtn.addEventListener('click', toggleTargetPicker);

  // --- Net Tools ---
  const ntTargetEl = $('#nt-target');
  const ntToolEl = $('#nt-tool');
  const ntRunBtn = $('#nt-run-btn');
  const ntOutEl = $('#nt-output');
  if (ntRunBtn) {
    ntRunBtn.addEventListener('click', async () => {
      const tool = ntToolEl?.value || 'ping';
      const target = (ntTargetEl?.value || '').trim();
      if (!target) { window.teUI?.toast?.('Enter a target'); return; }
      ntRunBtn.disabled = true; ntOutEl.textContent = '';
      try {
        let cmd = '';
        if (tool === 'ping') cmd = `ping -c 4 ${target} 2>&1 || busybox ping -c 4 ${target} 2>&1`;
        else cmd = `traceroute -n ${target} 2>&1 || busybox traceroute -n ${target} 2>&1`;
        const out = await runCommand(cmd);
        ntOutEl.textContent = out;
      } catch (e) { ntOutEl.textContent = String(e?.message || e); }
      finally { ntRunBtn.disabled = false; }
    });
  }

  // --- Ifconfig ---
  const ifListEl = $('#ifcfg-list');
  const ifRefreshBtn = $('#ifcfg-refresh-btn');
  const ifSaveBtn = $('#ifcfg-save-btn');
  const ifVarPreviewEl = $('#ifcfg-var-preview');
  const ifVarWrapEl = $('#ifcfg-var-wrap');
  const ifPreviewToggleBtn = $('#ifcfg-preview-toggle');

  async function collectIfaces() {
    const norm = (n) => (n || '').replace(/:$/, '').replace(/@.*$/, '');
    // Try `ip` first
    const data = { ifaces: {} };
    try {
      const v4 = await runCommand('ip -o -4 addr show 2>/dev/null || busybox ip -o -4 addr show 2>/dev/null || true');
      v4.split('\n').forEach(line => {
        line = line.trim(); if (!line) return;
        // 2: wlan0    inet 192.168.1.10/24 brd 192.168.1.255 scope global wlan0
        const m = line.match(/^\d+:\s*([^\s]+)\s+inet\s+([^\s]+)/);
        if (m) {
          const iface = norm(m[1]);
          const cidr = m[2];
          const arr = (data.ifaces[iface] ||= { name: iface, v4: [], v6: [], mac: null, mtu: null, state: null });
          arr.v4.push(cidr);
        }
      });
    } catch (_) {}
    try {
      const v6 = await runCommand('ip -o -6 addr show 2>/dev/null || busybox ip -o -6 addr show 2>/dev/null || true');
      v6.split('\n').forEach(line => {
        line = line.trim(); if (!line) return;
        // 2: wlan0    inet6 fe80::1234/64 scope link 
        const m = line.match(/^\d+:\s*([^\s]+)\s+inet6\s+([^\s]+)/);
        if (m) {
          const iface = norm(m[1]);
          const cidr = m[2];
          const arr = (data.ifaces[iface] ||= { name: iface, v4: [], v6: [], mac: null, mtu: null, state: null });
          arr.v6.push(cidr);
        }
      });
    } catch (_) {}
    try {
      const link = await runCommand('ip -o link show 2>/dev/null || busybox ip -o link show 2>/dev/null || true');
      link.split('\n').forEach(line => {
        line = line.trim(); if (!line) return;
        // 2: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DORMANT ... link/ether 00:11:22:33:44:55
        const m = line.match(/^\d+:\s*([^:]+):\s*<([^>]+)>.*?mtu\s+(\d+).*?state\s+(\S+)/);
        const n = line.match(/\blink\/(?:ether|loopback)\s+([0-9a-f:]{17})/i);
        if (m) {
          const iface = norm(m[1].trim());
          const flags = m[2];
          const mtu = parseInt(m[3], 10);
          const state = (m[4] || '').toUpperCase();
          const arr = (data.ifaces[iface] ||= { name: iface, v4: [], v6: [], mac: null, mtu: null, state: null });
          arr.mtu = mtu; arr.state = /UP/.test(state) || /\bUP\b/.test(flags);
          if (n) arr.mac = n[1].toLowerCase();
        }
      });
    } catch (_) {}

    // Fallback: parse ifconfig
    try {
      const raw = await runCommand('ifconfig 2>/dev/null || busybox ifconfig 2>/dev/null || true');
      let cur = null;
      const masks = {};
      raw.split('\n').forEach(line => {
        if (/^\S/.test(line)) { cur = norm(line.split(/\s+/)[0]); (data.ifaces[cur] ||= { name: cur, v4: [], v6: [], mac: null, mtu: null, state: null }); }
        if (!cur) return;
        const arr = data.ifaces[cur];
        let m;
        m = line.match(/\binet\s+([0-9.]+)\/?(\d+)?/); if (!m) m = line.match(/inet addr:([0-9.]+)/);
        if (m) arr.v4.push(m[2] ? `${m[1]}/${m[2]}` : m[1]);
        m = line.match(/\binet6\s+([0-9a-f:]+)\/?(\d+)?/i); if (!m) m = line.match(/inet6 addr:([0-9a-f:]+)/i);
        if (m) arr.v6.push(m[2] ? `${m[1]}/${m[2]}` : m[1]);
        m = line.match(/\bether\s+([0-9a-f:]{17})/i) || line.match(/HWaddr\s+([0-9a-f:]{17})/i);
        if (m) arr.mac = m[1].toLowerCase();
        m = line.match(/mtu\s+(\d+)/i); if (m) arr.mtu = parseInt(m[1], 10);
        m = line.match(/\bnetmask\s+([0-9.]+)/i) || line.match(/Mask:([0-9.]+)/);
        if (m) masks[cur] = m[1];
        if (/\bUP\b/.test(line)) arr.state = true;
      });
      // Apply netmask to v4 entries missing prefix
      const maskToPrefix = (maskStr) => {
        // hex form like 0xffffff00 or dotted
        if (/^0x[0-9a-f]+$/i.test(maskStr)) {
          const bits = parseInt(maskStr, 16) >>> 0;
          return bits.toString(2).replace(/0/g,'').length;
        }
        const parts = maskStr.split('.').map(x=>parseInt(x,10));
        if (parts.length !== 4 || parts.some(n=>isNaN(n))) return null;
        const bits = ((parts[0]<<24)>>>0) + (parts[1]<<16) + (parts[2]<<8) + parts[3];
        return bits.toString(2).replace(/0/g,'').length;
      };
      Object.keys(data.ifaces).forEach(ifn => {
        const arr = data.ifaces[ifn];
        if (!arr || !arr.v4) return;
        const pfx = masks[ifn] ? maskToPrefix(masks[ifn]) : null;
        if (!pfx) return;
        arr.v4 = arr.v4.map(a => a.includes('/') ? a : `${a}/${pfx}`);
      });
    } catch (_) {}

    // Normalize to array
    const list = Object.values(data.ifaces).sort((a,b)=> a.name.localeCompare(b.name));
    return list;
  }

  function ifaceKeyName(iface) {
    const labels = JSON.parse(localStorage.getItem('te.net.labels') || '{}');
    return (labels[iface.name] || iface.name);
  }

  function buildVarMap(list) {
    const out = { ip: {}, ips: {}, mac: {}, meta: {} };
    list.forEach(iface => {
      const key = ifaceKeyName(iface);
      out.ip[key] = { v4: iface.v4[0] || null, v6: iface.v6[0] || null };
      out.ips[key] = { v4: iface.v4, v6: iface.v6 };
      out.mac[key] = iface.mac || null;
      out.meta[key] = { mtu: iface.mtu || null, up: !!iface.state };
    });
    return out;
  }

  function renderIfcfg(list) {
    if (!ifListEl) return;
    const labels = JSON.parse(localStorage.getItem('te.net.labels') || '{}');
    ifListEl.innerHTML = list.map(iface => {
      const key = labels[iface.name] || '';
      const up = !!iface.state;
      // Show host assignments; network CIDR is only for Zenmap picker
      const v4chips = (iface.v4 || []).map(a=>`<span class="chip">${a}</span>`).join(' ');
      const v6chips = (iface.v6 || []).map(a=>`<span class="chip">${a}</span>`).join(' ');
      return `
        <div class="ifcfg-card" data-if="${iface.name}">
          <div class="ifcfg-header">
            <span class="ifcfg-status ${up ? 'ifcfg-up' : 'ifcfg-down'}"></span>
            <span class="ifcfg-name">${iface.name}</span>
            <span class="mono" style="color: var(--muted-foreground);">${iface.mac || ''}</span>
          </div>
          <div class="ifcfg-body" style="display:none;">
            <div class="ifcfg-row" style="margin:6px 0;">
              <label>Label <input class="ifcfg-label-input" type="text" value="${key}" placeholder="e.g. wifi, usb, eth" /></label>
            </div>
            <div class="kv">
              <div class="k">MTU</div><div>${iface.mtu ?? '—'}</div>
              <div class="k">Up</div><div>${up ? 'Yes' : 'No'}</div>
              <div class="k">IPv4</div><div>${v4chips || '—'}</div>
              <div class="k">IPv6</div><div>${v6chips || '—'}</div>
            </div>
          </div>
        </div>`;
    }).join('');

    // Attach expand/collapse and label handlers
    ifListEl.querySelectorAll('.ifcfg-card').forEach(card => {
      const header = card.querySelector('.ifcfg-header');
      const body = card.querySelector('.ifcfg-body');
      header.addEventListener('click', () => {
        body.style.display = (body.style.display === 'none') ? 'block' : 'none';
      });
      const input = card.querySelector('.ifcfg-label-input');
      input.addEventListener('change', () => {
        const name = card.getAttribute('data-if');
        const labels = JSON.parse(localStorage.getItem('te.net.labels') || '{}');
        const val = (input.value || '').trim();
        if (val) labels[name] = val; else delete labels[name];
        localStorage.setItem('te.net.labels', JSON.stringify(labels));
        updateVarPreview(list);
      });
    });
  }

  function updateVarPreview(list) {
    if (!ifVarPreviewEl) return;
    const map = buildVarMap(list);
    ifVarPreviewEl.textContent = JSON.stringify(map, null, 2);
  }

  async function refreshIfcfg() {
    if (!ifListEl) return;
    try {
      const list = await collectIfaces();
      renderIfcfg(list);
      updateVarPreview(list);
      // publish mapping for other consumers (best-effort, avoids core changes)
      window.teNetMap = buildVarMap(list);
    } catch (e) {
      ifListEl.innerHTML = `<div class="nt-error">${(e && e.message) || e}</div>`;
    }
  }

  if (ifRefreshBtn) ifRefreshBtn.addEventListener('click', refreshIfcfg);
  if (ifSaveBtn) ifSaveBtn.addEventListener('click', async () => {
    try {
      const list = await collectIfaces();
      const map = buildVarMap(list);
      localStorage.setItem('te.net.map', JSON.stringify(map));
      window.teNetMap = map;
      window.teUI?.toast?.('Saved network variables');
      renderIfcfg(list);
      updateVarPreview(list);
    } catch (e) { window.teUI?.toast?.('Failed to save variables'); }
  });
  if (ifPreviewToggleBtn) ifPreviewToggleBtn.addEventListener('click', () => {
    if (!ifVarWrapEl) return;
    const shown = ifVarWrapEl.style.display !== 'none';
    ifVarWrapEl.style.display = shown ? 'none' : 'block';
    ifPreviewToggleBtn.textContent = shown ? 'Show Preview' : 'Hide Preview';
  });

  // Auto-load on first show of ifcfg tab
  // Hook into profile switch: if currently visible and empty, load
  const origSwitchProfile = switchProfile;
  switchProfile = function(profile) {
    origSwitchProfile(profile);
    if (profile === 'ifcfg' && ifListEl && !ifListEl.hasChildNodes()) {
      refreshIfcfg();
    }
  }
}
