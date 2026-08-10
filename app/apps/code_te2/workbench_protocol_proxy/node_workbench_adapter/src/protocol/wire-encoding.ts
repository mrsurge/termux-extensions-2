type JsonCompatible = null | boolean | number | string | JsonCompatible[] | { [key: string]: JsonCompatible };
type JsonInput = JsonCompatible | unknown;

export type ExtReplyType = 7 | 8 | 9 | 10 | 11 | 12;

export interface ExtRequestEncodeInput {
  req: number;
  rpcId: number;
  method: string;
  args?: readonly unknown[] | null;
  cancellable?: boolean;
}

export interface SerializableBuffersArgument {
  readonly __te2SerializableBuffers: true;
  readonly value: unknown;
  readonly buffers: readonly Uint8Array[];
}

export function serializableBuffersArgument(
  value: unknown,
  buffers: readonly Uint8Array[],
): SerializableBuffersArgument {
  return {
    __te2SerializableBuffers: true,
    value,
    buffers,
  };
}

function isSerializableBuffersArgument(
  value: unknown,
): value is SerializableBuffersArgument {
  return !!value && typeof value === "object"
    && (value as { __te2SerializableBuffers?: unknown }).__te2SerializableBuffers === true
    && Array.isArray((value as { buffers?: unknown }).buffers);
}

export interface DecodedExtHostRpc {
  kind: "ext";
  type?: number;
  req?: number;
  rpcId?: number;
  method?: string;
  args?: unknown[];
  argsRawLen?: number;
  argsMeta?: Record<string, unknown>;
  cancellable?: boolean;
  skippedArgsParse?: boolean;
  skippedResultParse?: boolean;
  skippedErrorParse?: boolean;
  skipReason?: string;
  resultRawLen?: number;
  errorRawLen?: number;
  buffer?: Uint8Array;
  result?: unknown;
  mixedArgs?: unknown[];
  buffers?: unknown[];
  error?: unknown;
}

export interface DecodeExtHostRpcOptions {
  shouldParseArgsForMethod?: (method: string) => boolean;
  maxJsonBytes?: number;
  log?: (message: string) => void;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function byte(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function bytesFromString(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function stringFromBytes(value: Uint8Array): string {
  return textDecoder.decode(value);
}

function jsonBytes(value: JsonInput): Uint8Array {
  const raw = JSON.stringify(value);
  return bytesFromString(raw === undefined ? "null" : raw);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

function readU32be(payload: Uint8Array, offset: number): number {
  return new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false) >>> 0;
}

export function writeVqlUnsigned(value: number): Uint8Array {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  while (true) {
    let next = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) next |= 0x80;
    bytes.push(next);
    if (remaining === 0) break;
  }
  return new Uint8Array(bytes);
}

export function encodeMgmtValue(value: unknown): Uint8Array {
  // VS Code IPC value subset used by the adapter:
  // 0 undefined/null, 1 string, 4 array, 5 JSON object, 6 int.
  if (value === undefined || value === null) return byte(0);
  if (typeof value === "string") {
    const raw = bytesFromString(value);
    return concatBytes([byte(1), writeVqlUnsigned(raw.length), raw]);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return concatBytes([byte(6), writeVqlUnsigned(value | 0)]);
  }
  if (Array.isArray(value)) {
    const parts: Uint8Array[] = [byte(4), writeVqlUnsigned(value.length)];
    for (const item of value) parts.push(encodeMgmtValue(item));
    return concatBytes(parts);
  }
  const raw = jsonBytes(value);
  return concatBytes([byte(5), writeVqlUnsigned(raw.length), raw]);
}

export function encodeMgmtMessage(header: unknown, body: unknown): Uint8Array {
  return concatBytes([encodeMgmtValue(header), encodeMgmtValue(body)]);
}

export function encodeExtRequestJsonArgs(input: ExtRequestEncodeInput): Uint8Array {
  const type = input.cancellable ? 2 : 1;
  const methodBytes = bytesFromString(input.method);
  const argsBytes = jsonBytes(input.args ?? []);
  if (methodBytes.length > 255) throw new Error("method too long");
  return concatBytes([
    byte(type),
    u32be(input.req),
    byte(input.rpcId),
    byte(methodBytes.length),
    methodBytes,
    u32be(argsBytes.length),
    argsBytes,
  ]);
}

export function encodeExtRequestMixedArgs(input: ExtRequestEncodeInput): Uint8Array {
  const type = input.cancellable ? 4 : 3;
  const methodBytes = bytesFromString(input.method);
  if (methodBytes.length > 255) throw new Error("method too long");
  const args = Array.isArray(input.args) ? input.args : [];
  const parts: Uint8Array[] = [
    byte(type),
    u32be(input.req),
    byte(input.rpcId),
    byte(methodBytes.length),
    methodBytes,
    byte(args.length),
  ];
  for (const value of args) {
    if (value === null || value === undefined) {
      parts.push(byte(4));
      continue;
    }
    if (value instanceof Uint8Array) {
      parts.push(byte(2), u32be(value.length), value);
      continue;
    }
    if (isSerializableBuffersArgument(value)) {
      const raw = jsonBytes(value.value);
      parts.push(byte(3), u32be(value.buffers.length), u32be(raw.length), raw);
      for (const buffer of value.buffers) {
        parts.push(u32be(buffer.length), buffer);
      }
      continue;
    }
    const raw = jsonBytes(value);
    parts.push(byte(1), u32be(raw.length), raw);
  }
  return concatBytes(parts);
}

export function encodeExtAck(req: number): Uint8Array {
  return concatBytes([byte(5), u32be(req)]);
}

export function encodeExtReplyOkEmpty(req: number): Uint8Array {
  return concatBytes([byte(7), u32be(req)]);
}

export function encodeExtReplyOkJson(req: number, result: unknown): Uint8Array {
  const raw = jsonBytes(result ?? null);
  return concatBytes([byte(9), u32be(req), u32be(raw.length), raw]);
}

export function encodeExtReplyOkVSBuffer(req: number, buffer: Uint8Array): Uint8Array {
  return concatBytes([byte(8), u32be(req), u32be(buffer.length), buffer]);
}

export function encodeExtReplyError(req: number, error: unknown): Uint8Array {
  const raw = jsonBytes(error ?? null);
  return concatBytes([byte(11), u32be(req), u32be(raw.length), raw]);
}

export function isTerminalExtReply(value: unknown): value is { type: ExtReplyType } {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === 7 || type === 8 || type === 9 || type === 10 || type === 11 || type === 12;
}

export function decodeExtHostRpc(payload: Uint8Array, options: DecodeExtHostRpcOptions = {}): DecodedExtHostRpc {
  if (!payload || payload.length < 5) return { kind: "ext", error: "short" };
  const msgType = payload[0] ?? 0;
  const req = readU32be(payload, 1);
  let offset = 5;
  const maxJsonBytes = Number(options.maxJsonBytes ?? 8 * 1024 * 1024);
  const shouldParseArgsForMethod = options.shouldParseArgsForMethod ?? (() => true);
  const log = options.log ?? (() => undefined);

  const readU8 = (): number => {
    const value = payload[offset];
    offset += 1;
    return value ?? 0;
  };
  const readU32 = (): number => {
    const value = readU32be(payload, offset);
    offset += 4;
    return value;
  };
  const readBytes = (length: number): Uint8Array => {
    const out = payload.subarray(offset, offset + length);
    offset += length;
    return out;
  };
  const readShortString = (): string => {
    const length = readU8();
    return stringFromBytes(readBytes(length));
  };
  const readLongString = (): string => {
    const length = readU32();
    if (length > 10000000) {
      log(`[ipc_decode] WARNING readLongString len=${length} off=${offset} payloadLen=${payload.length}`);
    }
    return stringFromBytes(readBytes(length));
  };
  const skipLongString = (): number => {
    const length = readU32();
    readBytes(length);
    return length >>> 0;
  };
  const readMixedArray = (): unknown[] => {
    const count = readU8();
    if (count > 250) {
      log(`[ipc_decode] WARNING readMixedArray count=${count} off=${offset} payloadLen=${payload.length}`);
      return [{ __mixed_array_too_large__: true, count }];
    }
    const out: unknown[] = [];
    for (let i = 0; i < count; i += 1) {
      const argType = readU8();
      if (argType === 1) {
        const raw = readLongString();
        try {
          out.push(JSON.parse(raw));
        } catch {
          out.push(raw);
        }
      } else if (argType === 2) {
        const bufferLength = readU32();
        out.push(readBytes(bufferLength));
      } else if (argType === 3) {
        const bufferCount = readU32();
        const raw = readLongString();
        for (let j = 0; j < bufferCount; j += 1) {
          const bufferLength = readU32();
          readBytes(bufferLength);
        }
        try {
          out.push(JSON.parse(raw || "null"));
        } catch {
          out.push({ __json_with_buffers_parse_error__: true, buffers: bufferCount });
        }
      } else if (argType === 4) {
        out.push(null);
      } else {
        out.push({ __unknown_arg_type__: argType });
      }
    }
    return out;
  };
  const skipMixedArray = (): Record<string, unknown> => {
    const count = readU8();
    if (count > 250) {
      log(`[ipc_decode] WARNING skipMixedArray count=${count} (bailing) off=${offset} payloadLen=${payload.length}`);
      return { count, totalJsonBytes: 0, totalStringBytes: 0, totalBuffers: 0, skipped: true };
    }
    let totalJsonBytes = 0;
    let totalStringBytes = 0;
    let totalBuffers = 0;
    for (let i = 0; i < count; i += 1) {
      const argType = readU8();
      if (argType === 1) {
        const length = readU32();
        readBytes(length);
        totalStringBytes += length;
        continue;
      }
      if (argType === 2) {
        const length = readU32();
        readBytes(length);
        totalJsonBytes += length;
        continue;
      }
      if (argType === 3) {
        const bufferCount = readU32();
        const length = readU32();
        readBytes(length);
        totalJsonBytes += length;
        for (let j = 0; j < bufferCount; j += 1) {
          const bufferLength = readU32();
          readBytes(bufferLength);
          totalBuffers += 1;
        }
        continue;
      }
    }
    return { count, totalJsonBytes, totalStringBytes, totalBuffers };
  };

  try {
    if (msgType === 1 || msgType === 2) {
      const rpcId = readU8();
      const method = readShortString();
      if (!shouldParseArgsForMethod(method)) {
        const argsRawLen = skipLongString();
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          argsRawLen,
          cancellable: msgType === 2,
          skippedArgsParse: true,
        };
      }
      const argsRawLen = readU32();
      if (maxJsonBytes > 0 && argsRawLen > maxJsonBytes) {
        readBytes(argsRawLen);
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          argsRawLen,
          cancellable: msgType === 2,
          skippedArgsParse: true,
          skipReason: "too_large",
        };
      }
      const argsRaw = stringFromBytes(readBytes(argsRawLen));
      const args = argsRaw ? JSON.parse(argsRaw) : [];
      return { kind: "ext", type: msgType, req, rpcId, method, args, argsRawLen, cancellable: msgType === 2 };
    }

    if (msgType === 3 || msgType === 4) {
      const rpcId = readU8();
      const method = readShortString();
      if (!shouldParseArgsForMethod(method)) {
        const meta = skipMixedArray();
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          cancellable: msgType === 4,
          skippedArgsParse: true,
          argsMeta: { encoding: "mixed", ...meta },
        };
      }
      const args = readMixedArray();
      return { kind: "ext", type: msgType, req, rpcId, method, args, cancellable: msgType === 4 };
    }

    if (msgType === 8) {
      const bufferLength = readU32();
      return { kind: "ext", type: msgType, req, buffer: readBytes(bufferLength) };
    }

    if (msgType === 9) {
      const resultLength = readU32();
      if (maxJsonBytes > 0 && resultLength > maxJsonBytes) {
        readBytes(resultLength);
        return { kind: "ext", type: msgType, req, skippedResultParse: true, resultRawLen: resultLength, skipReason: "too_large" };
      }
      const raw = stringFromBytes(readBytes(resultLength));
      return { kind: "ext", type: msgType, req, result: raw ? JSON.parse(raw) : null };
    }

    if (msgType === 10) {
      const mixedArgs = readMixedArray();
      const jsonPart = mixedArgs.length > 0 ? mixedArgs[0] : null;
      const buffers = mixedArgs.filter((item) => !!item && typeof item === "object" && "__json_with_buffers__" in item);
      return { kind: "ext", type: msgType, req, result: jsonPart, mixedArgs, buffers };
    }

    if (msgType === 11) {
      const errorLength = readU32();
      if (maxJsonBytes > 0 && errorLength > maxJsonBytes) {
        readBytes(errorLength);
        return { kind: "ext", type: msgType, req, skippedErrorParse: true, errorRawLen: errorLength, skipReason: "too_large" };
      }
      const raw = stringFromBytes(readBytes(errorLength));
      return { kind: "ext", type: msgType, req, error: raw ? JSON.parse(raw) : null };
    }

    return { kind: "ext", type: msgType, req };
  } catch (error) {
    return { kind: "ext", type: msgType, req, error: `decode_fail:${error instanceof Error ? error.message : String(error)}` };
  }
}
