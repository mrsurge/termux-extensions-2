import { serializeConsoleArg } from './editor_console_serialize_arg_utils.js';

export function emitConsoleLog(sock, workerId, level, rawArgs) {
  if (!sock || !sock.connected) return;
  sock.emit('console:log', {
    workerId: workerId,
    level: level,
    ts: Date.now(),
    args: rawArgs.map(serializeConsoleArg),
  });
}
