import { serializeConsoleArg } from './editor_console_serialize_arg_utils.js';

export function handleConsoleEval(sock, workerId, msg) {
  if (!msg || !msg.reqId || !msg.code) return;
  try {
    var result;
    try {
      result = (0, eval)(msg.code);
    } catch (synErr) {
      if (synErr instanceof SyntaxError) result = (0, eval)('(' + msg.code + ')');
      else throw synErr;
    }
    Promise.resolve(result)
      .then(function(value) {
        sock.emit('console:evalResult', {
          workerId: workerId, reqId: msg.reqId, ok: true,
          value: serializeConsoleArg(value),
        });
      })
      .catch(function(err) {
        sock.emit('console:evalResult', {
          workerId: workerId, reqId: msg.reqId, ok: false,
          error: serializeConsoleArg(err),
        });
      });
  } catch(err) {
    sock.emit('console:evalResult', {
      workerId: workerId, reqId: msg.reqId, ok: false,
      error: serializeConsoleArg(err),
    });
  }
}
