import { decode as decodeMessagePack, encode as encodeMessagePack } from '@msgpack/msgpack';

export const RPC_CODEC_MSGPACK_V1 = 'msgpack-v1' as const;

export interface RpcWireCodec {
  readonly id: string;
  encode(payload: unknown): unknown;
  decode(payload: unknown): unknown;
}

export const identityRpcWireCodec: RpcWireCodec = {
  id: 'identity-json-object',
  encode(payload: unknown): unknown {
    return payload;
  },
  decode(payload: unknown): unknown {
    return payload;
  },
};

// The wire codec is the only frontend layer that handles binary frames.
// Feature clients continue to exchange typed request and notification objects.
export const messagePackRpcWireCodec: RpcWireCodec = {
  id: RPC_CODEC_MSGPACK_V1,
  encode(payload: unknown): Uint8Array {
    // Match JSON semantics during the wire migration: omit undefined object
    // fields while preserving undefined array slots as null.
    return encodeMessagePack(payload, { ignoreUndefined: true });
  },
  decode(payload: unknown): unknown {
    return decodeMessagePack(normalizeBinaryPayload(payload));
  },
};

function normalizeBinaryPayload(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new Error('Expected a binary RPC payload');
}
