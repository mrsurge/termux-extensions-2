import { serializeConsoleArg } from './editor_console_serialize_arg_utils.ts';

export function emitConsoleLog(
  sock: MonacoRuntimeSocketLike | null | undefined,
  workerId: string,
  level: string,
  rawArgs: unknown[],
): void {
  if (!sock || !sock.connected || typeof sock.emit !== 'function') return;
  sock.emit('console:log', {
    workerId,
    level,
    ts: Date.now(),
    args: rawArgs.map(serializeConsoleArg),
  });
}
