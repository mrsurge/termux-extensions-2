import { serializeConsoleArg } from './editor_console_serialize_arg_utils.ts';

interface ConsoleEvalMessage {
  reqId?: string;
  code?: string;
}

export function handleConsoleEval(
  sock: MonacoRuntimeSocketLike | null | undefined,
  workerId: string,
  msg: ConsoleEvalMessage | null | undefined,
): void {
  if (!sock || typeof sock.emit !== 'function' || !msg || !msg.reqId || !msg.code) return;
  try {
    let result: unknown;
    try {
      result = (0, eval)(msg.code);
    } catch (syntaxError) {
      if (syntaxError instanceof SyntaxError) result = (0, eval)('(' + msg.code + ')');
      else throw syntaxError;
    }
    Promise.resolve(result)
      .then((value: unknown) => {
        sock.emit && sock.emit('console:evalResult', {
          workerId,
          reqId: msg.reqId,
          ok: true,
          value: serializeConsoleArg(value),
        });
      })
      .catch((error: unknown) => {
        sock.emit && sock.emit('console:evalResult', {
          workerId,
          reqId: msg.reqId,
          ok: false,
          error: serializeConsoleArg(error),
        });
      });
  } catch (error) {
    sock.emit('console:evalResult', {
      workerId,
      reqId: msg.reqId,
      ok: false,
      error: serializeConsoleArg(error),
    });
  }
}
