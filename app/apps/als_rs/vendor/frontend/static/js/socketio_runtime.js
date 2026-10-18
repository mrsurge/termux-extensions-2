(function () {
  function serializerMode() {
    return String(window.AGENT_LOG_SOCKETIO_SERIALIZER || 'msgpack').trim().toLowerCase();
  }

  function msgpackParser() {
    if (serializerMode() !== 'msgpack') return null;
    const parser = window.SocketIoMsgpackParser;
    if (parser && typeof parser.Encoder === 'function' && typeof parser.Decoder === 'function') {
      return parser;
    }
    console.warn('[socketio] msgpack requested but SocketIoMsgpackParser is unavailable');
    return null;
  }

  window.agentLogSocketIoOptions = function agentLogSocketIoOptions(options) {
    const next = Object.assign({}, options || {});
    if (!next.path) {
      const pathname = window.location && window.location.pathname ? window.location.pathname : '/';
      const proxiedMatch = pathname.match(/^\/api\/app\/[^/]+\/proxy\b/);
      next.path = proxiedMatch ? `${proxiedMatch[0]}/socket.io` : '/socket.io';
    }
    const parser = msgpackParser();
    if (parser) next.parser = parser;
    return next;
  };
})();
