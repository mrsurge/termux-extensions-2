import { messagePackRpcWireCodec, type RpcWireCodec } from './codec.ts';

export const RPC_CODEC_MSGPACK_GZIP_V1 = 'msgpack-gzip-v1' as const;
export const RPC_FRAME_LIMIT = 8 * 1024 * 1024;
const HEADER = 12;

function binary(payload: unknown): Uint8Array {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  throw new Error('Expected binary RPC frame');
}

export function inspectRpcFrame(payload: unknown): { body: Uint8Array; length: number; compressed: boolean } {
  const bytes = binary(payload);
  if (bytes.length < HEADER || bytes.length > RPC_FRAME_LIMIT ||
      bytes[0] !== 84 || bytes[1] !== 69 || bytes[2] !== 50 || bytes[3] !== 67 ||
      bytes[4] !== 1 || bytes[5] > 1 || bytes[6] !== 0 || bytes[7] !== 0) {
    throw new Error('Invalid RPC compression frame');
  }
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  if (!length || length > RPC_FRAME_LIMIT - HEADER) throw new Error('RPC output limit');
  const body = bytes.subarray(HEADER);
  if (!bytes[5] && body.length !== length) throw new Error('RPC length mismatch');
  return { body, length, compressed: bytes[5] === 1 };
}

export function frameRpcRequest(bytes: Uint8Array): Uint8Array {
  if (!bytes.length || bytes.length > RPC_FRAME_LIMIT - HEADER) throw new Error('RPC payload limit');
  const frame = new Uint8Array(HEADER + bytes.length);
  frame.set([84, 69, 50, 67, 1, 0, 0, 0]);
  new DataView(frame.buffer).setUint32(8, bytes.length);
  frame.set(bytes, HEADER);
  return frame;
}

async function inflate(body: Uint8Array, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new Error('RPC gzip decoder unavailable');
  const reader = new Blob([Uint8Array.from(body).buffer]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('RPC decode cancelled');
    for (;;) {
      const next = await reader.read();
      if (signal?.aborted) throw new Error('RPC decode cancelled');
      if (next.done) break;
      total += next.value.length;
      if (total > length) throw new Error('RPC decompressed output limit');
      chunks.push(next.value);
    }
    if (total !== length) throw new Error('RPC decompressed length mismatch');
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export const gzipRpcWireCodec: RpcWireCodec = {
  id: RPC_CODEC_MSGPACK_GZIP_V1,
  encode(payload: unknown): Uint8Array {
    return frameRpcRequest(messagePackRpcWireCodec.encode(payload) as Uint8Array);
  },
  decode(payload: unknown, signal?: AbortSignal): unknown {
    const { body, length, compressed } = inspectRpcFrame(payload);
    if (!compressed) return messagePackRpcWireCodec.decode(body);
    return inflate(body, length, signal).then(bytes => messagePackRpcWireCodec.decode(bytes));
  },
};
