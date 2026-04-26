export const RPC_PREFIX = "<<<RPC>>> ";
export const PUSH_PREFIX = "<<<PUSH>>> ";

export interface JsonRpcErrorReply {
  jsonrpc: "2.0";
  id: unknown;
  error: {
    code: number;
    message: string;
  };
}

export interface ParsedStdioJsonLine {
  ok: boolean;
  value?: unknown;
  errorReply?: JsonRpcErrorReply;
}

export function buildJsonRpcErrorReply(id: unknown, code: number, message: string): JsonRpcErrorReply {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

export function parseStdioJsonLine(line: string): ParsedStdioJsonLine {
  if (!line.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return {
      ok: false,
      errorReply: buildJsonRpcErrorReply(null, -32700, "Parse error"),
    };
  }
}

export function encodeRpcReplyLine(reply: unknown): string {
  return `${RPC_PREFIX}${JSON.stringify(reply)}\n`;
}

export function encodePushLine(payload: unknown): string {
  return `${PUSH_PREFIX}${JSON.stringify(payload)}\n`;
}

export function encodeStartupBeaconLine(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}
