import { encode as encodeMessagePack } from "@msgpack/msgpack";
import { Unpackr } from "msgpackr/unpack";

export const MAX_PIPE_FRAME_BYTES = 32 * 1024 * 1024;

// Process pipes concatenate standard MessagePack values. Track complete frame
// boundaries separately from read chunks and reject truncated EOF, never resync.
export class PipeMessagePackDecoder {
  private pending: Uint8Array = new Uint8Array();
  private readonly decoder = new Unpackr({ useRecords: false, mapsAsObjects: true });

  constructor(private readonly limit = MAX_PIPE_FRAME_BYTES) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid pipe frame limit");
  }

  feed(chunk: Uint8Array, receive: (value: unknown) => void): void {
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      const part = chunk.subarray(offset, offset + 65536);
      const input = new Uint8Array(this.pending.length + part.length);
      input.set(this.pending);
      input.set(part, this.pending.length);
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
      this.pending = input.slice(consumed);
      if (this.pending.length > this.limit) throw new Error("MessagePack pipe frame exceeds limit");
    }
  }

  finish(): void {
    if (this.pending.length) throw new Error("Truncated MessagePack pipe frame");
  }
}

export function encodePipeMessage(payload: unknown): Uint8Array {
  const frame = encodeMessagePack(payload, { ignoreUndefined: true });
  if (frame.length > MAX_PIPE_FRAME_BYTES) throw new Error("MessagePack pipe frame exceeds limit");
  return frame;
}
