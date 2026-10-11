// Evaluate in one exact TE2 terminal/main-page console worker. No input is sent.
// Bounded timing-only records; dispose explicitly or automatically after 3 min.
(() => {
  window.__te2TerminalLatencyProbe?.dispose();
  const records = [], listeners = [], observed = new WeakSet();
  const record = (kind, fields = {}) => {
    records.push({ t: performance.now(), kind, ...fields });
    if (records.length > 2000) records.splice(0, records.length - 2000);
  };
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  };
  listen(document, 'keydown', event => {
    if (event.target?.closest?.('.xterm')) record('key', { repeat: event.repeat, composing: event.isComposing });
  }, true);
  listen(document, 'input', event => {
    if (event.target?.closest?.('.xterm')) record('input', { composing: event.isComposing });
  }, true);
  const send = WebSocket.prototype.send;
  const wrappedSend = function (data) {
    if (/\/terminal(?:\?|\/)|socket\.io/.test(this.url)) {
      if (!observed.has(this)) {
        observed.add(this);
        listen(this, 'message', event => record('receive', { bytes: event.data?.byteLength ?? event.data?.size ?? event.data?.length ?? 0 }));
      }
      record('send', { bytes: data?.byteLength ?? data?.size ?? data?.length ?? 0 });
    }
    return send.call(this, data);
  };
  WebSocket.prototype.send = wrappedSend;
  const proto = window.Terminal?.prototype;
  const write = proto?.write;
  const wrappedWrite = function (data, callback) {
    const at = performance.now();
    record('xterm-write', { bytes: data?.byteLength ?? data?.length ?? 0 });
    return write.call(this, data, () => {
      record('xterm-parsed', { elapsed: performance.now() - at });
      requestAnimationFrame(() => record('paint-opportunity'));
      callback?.();
    });
  };
  if (write) proto.write = wrappedWrite;
  let timer;
  const probe = {
    records,
    summary() {
      return { counts: Object.fromEntries([...new Set(records.map(row => row.kind))].map(kind => [kind, records.filter(row => row.kind === kind).length])), records: records.slice(-250) };
    },
    dispose() {
      clearTimeout(timer);
      for (const remove of listeners.splice(0)) remove();
      if (WebSocket.prototype.send === wrappedSend) WebSocket.prototype.send = send;
      if (write && proto.write === wrappedWrite) proto.write = write;
      record('disposed');
    },
  };
  timer = setTimeout(() => probe.dispose(), 180000);
  window.__te2TerminalLatencyProbe = probe;
  return { installed: true, xtermHook: Boolean(write), expiresSeconds: 180 };
})()
