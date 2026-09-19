import { encode as encodeMessagePack } from "@msgpack/msgpack";
import { Unpackr } from "msgpackr/unpack";

export const MAX_PIPE_FRAME_BYTES = 32 * 1024 * 1024;

// Process pipes concatenate standard MessagePack values. Track complete frame
// boundaries separately from read chunks and reject truncated EOF, never resync.
export class PipeMessagePackDecoder {
  private pending: Uint8Array = new Uint8Array();
  private pendingLength = 0;
  private readonly decoder = new Unpackr({ useRecords: false, mapsAsObjects: true });

  constructor(private readonly limit = MAX_PIPE_FRAME_BYTES) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid pipe frame limit");
  }

  feed(chunk: Uint8Array, receive: (value: unknown) => void): void {
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      const part = chunk.subarray(offset, offset + 65536);
      // Complete chunks need no copy. Fragmented frames grow geometrically rather
      // than copying their entire prefix on every pipe read (Node and Bun alike).
      let input = part;
      if (this.pendingLength) {
        const length = this.pendingLength + part.length;
        if (length > this.pending.length) {
          const capacity = Math.min(this.limit + 65536, Math.max(length, this.pending.length * 2));
          const buffer = new Uint8Array(capacity);
          buffer.set(this.pending.subarray(0, this.pendingLength));
          this.pending = buffer;
        }
        this.pending.set(part, this.pendingLength);
        input = this.pending.subarray(0, length);
      }
      let consumed = 0;
      try {
        this.decoder.unpackMultiple(input, (value: unknown, start?: number, end?: number) => {
          if (start === undefined || end === undefined || end - start > this.limit) {
            throw new Error("MessagePack pipe frame exceeds limit");
          }
          const marker = input[start];
          if (marker === undefined || !((marker >= 0x80 && marker <= 0x8f) || marker === 0xde || marker === 0xdf)) {
            throw new Error("MessagePack pipe record must be a map");
          }
          consumed = end;
          receive(value);
        });
      } catch (error: unknown) {
        if (!(error instanceof Error) || !("incomplete" in error) || error.incomplete !== true) throw error;
      }
      this.pendingLength = input.length - consumed;
      if (this.pendingLength > this.limit) throw new Error("MessagePack pipe frame exceeds limit");
      // Never overwrite decoded binary views retained by the receiver, or retain
      // a caller-owned input buffer after feed returns. Only an unconsumed owned
      // accumulation buffer may be reused on the next append.
      if (consumed || input.buffer !== this.pending.buffer) {
        this.pending = input.slice(consumed);
      }
    }
  }

  finish(): void {
    if (this.pendingLength) throw new Error("Truncated MessagePack pipe frame");
  }
}

export function encodePipeMessage(payload: unknown): Uint8Array {
  const frame = encodeMessagePack(payload, { ignoreUndefined: true });
  if (frame.length > MAX_PIPE_FRAME_BYTES) throw new Error("MessagePack pipe frame exceeds limit");
  return frame;
}
