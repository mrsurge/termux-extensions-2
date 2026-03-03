import { serializeConsoleArg } from './editor_console_serialize_arg_utils.js';

export function handleConsoleEval(sock, workerId, msg) {
  if (!msg || !msg.reqId || !msg.code) return;
  try {
    var result = (0, eval)(msg.code);
    Promise.resolve(result).then(function(value) {
      sock.emit('console:evalResult', {
        workerId: workerId, reqId: msg.reqId, ok: true,
        value: serializeConsoleArg(value),
      });
    });
  } catch(err) {
    sock.emit('console:evalResult', {
      workerId: workerId, reqId: msg.reqId, ok: false,
      error: serializeConsoleArg(err),
    });
  }
}
