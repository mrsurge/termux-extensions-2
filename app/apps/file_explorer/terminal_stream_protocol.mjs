import { Buffer } from 'node:buffer';
import { requireTerminalNodeModule } from './terminal_node_modules.mjs';

const { decode, encode } = requireTerminalNodeModule('@msgpack/msgpack');

export const TERMINAL_STREAM_CODEC = 'msgpack-v1';
export const MAX_TERMINAL_FRAME_BYTES = 32 * 1024 * 1024;

export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return null;
}

export function encodePipeFrame(message) {
  const payload = Buffer.from(encode(message, { ignoreUndefined: true }));
  if (payload.byteLength > MAX_TERMINAL_FRAME_BYTES) {
    throw new RangeError(`terminal frame exceeds ${MAX_TERMINAL_FRAME_BYTES} bytes`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength, 0);
  return Buffer.concat([header, payload]);
}

export class PipeFrameDecoder {
  constructor(maxFrameBytes = MAX_TERMINAL_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const next = Buffer.from(chunk);
    if (next.byteLength === 0) {
      return [];
    }
    this.buffer = this.buffer.byteLength === 0
      ? next
      : Buffer.concat([this.buffer, next]);

    const messages = [];
    while (this.buffer.byteLength >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);
      if (payloadLength === 0 || payloadLength > this.maxFrameBytes) {
        throw new RangeError(`invalid terminal frame length: ${payloadLength}`);
      }
      const frameLength = 4 + payloadLength;
      if (this.buffer.byteLength < frameLength) {
        break;
      }
      const payload = this.buffer.subarray(4, frameLength);
      const decoded = decode(payload);
      if (!isRecord(decoded)) {
        throw new TypeError('terminal frame must decode to an object');
      }
      messages.push(decoded);
      this.buffer = this.buffer.subarray(frameLength);
    }
    return messages;
  }
}
