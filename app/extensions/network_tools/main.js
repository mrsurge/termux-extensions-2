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
      panel.style.display = panel.getAttribute('data-profile') === profile ? 'flex' : 'none';
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
  const statusEl = $('#z-status');
  const rawOutEl = $('#z-raw-output');
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

  if (clearBtn) clearBtn.addEventListener('click', () => { rawOutEl.textContent = ''; statusEl.textContent = ''; });
  if (scanBtn) {
    [targetEl, flagsEl].forEach(inp => inp && inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); scanBtn.click(); } }));
    scanBtn.addEventListener('click', async () => {
      const target = (targetEl?.value || '').trim();
      const flags = (flagsEl?.value || '').trim();
      if (!target) { window.teUI?.toast?.('Please enter a target to scan'); return; }
      setScanBusy(true, 'Running scan…'); rawOutEl.textContent = '';
      try {
        // Ensure nmap exists
        const check = await runCommandRaw("command -v nmap >/dev/null 2>&1 && echo OK || echo MISSING");
        if (!check.ok) { statusEl.textContent = 'Preflight check failed'; rawOutEl.textContent = check.stderr || check.error || 'Unknown error'; return; }
        if (!/\bOK\b/.test(check.stdout)) { statusEl.textContent = 'Nmap is not installed'; rawOutEl.textContent = 'Install with:\n  pkg install nmap'; return; }

        const baseCmd = `nmap ${flags || ''} -oX - ${target}`.trim().replace(/\s+/g, ' ');
        const envPref = `env PATH=${TERMUX_PREFIX}/bin:${TERMUX_PREFIX}/sbin:$PATH `;
        const explicitCmd = baseCmd.replace(/^nmap\b/, `${TERMUX_PREFIX}/bin/nmap`);
        const attempts = [
          { m: 'tsu', c: `tsu -c ${shQuote(envPref + baseCmd)}` },
          { m: 'su-env', c: `su -c ${shQuote(envPref + baseCmd)}` },
          { m: 'su-explicit', c: `su -c ${shQuote(explicitCmd)}` },
          { m: 'su', c: `su -c ${shQuote(baseCmd)}` },
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
          if (!fb.ok) { statusEl.textContent = 'Scan failed'; rawOutEl.textContent = fb.stderr || fb.error || 'Unknown error'; return; }
          statusEl.textContent = 'Ran without root (adjusted flags)' + (adj.note ? ` — ${adj.note}` : '');
          attempt = fb;
        }

        const out = attempt.stdout || '';
        lastXml = out; rawOutEl.textContent = out;
        if (/\<nmaprun[\s>]/.test(out)) {
          parseNmapXml(out);
          const topoVisible = $('[data-profile="zenmap"] [data-subtab="topology"]').style.display !== 'none';
          if (topoVisible) await ensureVisAndRender();
          renderDetails(null);
          if (attempt.method) statusEl.textContent = `Scan completed with root via ${attempt.method}`;
        } else {
          statusEl.textContent = 'Output is not XML. Check flags or permissions.';
        }
      } catch (e) {
        statusEl.textContent = 'Scan failed'; rawOutEl.textContent = String(e?.message || e);
      } finally { setScanBusy(false); }
    });
  }

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
}
