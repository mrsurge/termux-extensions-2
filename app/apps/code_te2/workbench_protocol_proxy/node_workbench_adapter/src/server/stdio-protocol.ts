import { encodePipeMessage } from "../protocol/pipe-codec.mjs";
export { PipeMessagePackDecoder } from "../protocol/pipe-codec.mjs";

export interface JsonRpcErrorReply {
  jsonrpc: "2.0";
  id: unknown;
  error: { code: number; message: string };
}

export function buildJsonRpcErrorReply(id: unknown, code: number, message: string): JsonRpcErrorReply {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Explicit record kinds replace textual prefixes; stderr is the only log lane.
export function encodeRpcReply(reply: unknown): Uint8Array {
  return encodePipeMessage({ kind: "reply", payload: reply });
}
export function encodePush(payload: unknown): Uint8Array {
  return encodePipeMessage({ kind: "push", payload });
}
export function encodeStartupBeacon(payload: unknown): Uint8Array {
  return encodePipeMessage({ kind: "startup", payload });
}
