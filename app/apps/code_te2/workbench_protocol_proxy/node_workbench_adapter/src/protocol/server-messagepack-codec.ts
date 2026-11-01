import { Packr, Unpackr, isNativeAccelerationEnabled } from "msgpackr";
import { normalizeBinaryPayload } from "./binary-payload.ts";

// Narrow the dependency's permissive declarations at the owned codec boundary.
// No records, string bundling, structured cloning or custom JS wire extensions.
export interface ServerMessagePackDecoder {
  unpack(bytes: Uint8Array): unknown;
  unpackMultiple(bytes: Uint8Array, receive: (
    value: unknown, start?: number, end?: number,
  ) => void): void;
}
interface ServerMessagePackEncoder {
  pack(value: unknown): Uint8Array;
}
const options = {
  useRecords: false,
  mapsAsObjects: true,
  moreTypes: false,
  structuredClone: false,
  bundleStrings: false,
  encodeUndefinedAsNil: true,
  int64AsType: "number" as const,
  skipValues: [undefined],
};
const encoder: ServerMessagePackEncoder = new Packr(options);
const decoder: ServerMessagePackDecoder = new Unpackr(options);

export function createServerMessagePackDecoder(): ServerMessagePackDecoder {
  return new Unpackr(options);
}
export function encodeWbaRpcMessage(payload: unknown): Uint8Array {
  return encoder.pack(payload);
}
export function decodeWbaRpcMessage(payload: unknown): unknown {
  return decoder.unpack(normalizeBinaryPayload(payload));
}
export function serverCodecStatus(): {
  implementation: "msgpackr";
  nativeAcceleration: boolean;
} {
  return { implementation: "msgpackr", nativeAcceleration: isNativeAccelerationEnabled };
}
