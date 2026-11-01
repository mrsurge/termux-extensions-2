import {
  decode as decodeMessagePack,
  encode as encodeMessagePack,
} from "@msgpack/msgpack";
import { normalizeBinaryPayload } from "./binary-payload.ts";

export const WBA_RPC_CODEC_MSGPACK_V1 = "msgpack-v1" as const;

// The WBA socket boundary owns binary conversion; workbench dispatch remains
// transport-agnostic and continues to receive JSON-RPC-shaped objects.
export function encodeWbaRpcMessage(payload: unknown): Uint8Array {
  return encodeMessagePack(payload, { ignoreUndefined: true });
}

export function decodeWbaRpcMessage(payload: unknown): unknown {
  return decodeMessagePack(normalizeBinaryPayload(payload));
}
