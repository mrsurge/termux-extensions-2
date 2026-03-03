export function handleVscodeApiMessageData(rawData, pendingMap, handlersMap) {
  var msg = null;
  try { msg = JSON.parse(String(rawData || '')); } catch (_) { return; }
  var handleOne = function (m) {
    if (!m) return;
    var id = m.id;
    if (id != null) {
      var pending = pendingMap.get(id);
      if (!pending) return;
      pendingMap.delete(id);
      if (m.error) pending.reject(new Error(m.error.message || 'jsonrpc error'));
      else pending.resolve(m.result);
      return;
    }
    try {
      if (m.method && handlersMap && handlersMap.has(m.method)) {
        handlersMap.get(m.method)(m.params);
      }
    } catch (_) {}
  };
  if (Array.isArray(msg)) msg.forEach(handleOne);
  else handleOne(msg);
}
