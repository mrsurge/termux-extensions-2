import { VSBuffer } from "../../../common/buffer.mjs";
import { Emitter } from "../../../common/event.mjs";

const RequestType = Object.freeze({
  Promise: 100,
  EventListen: 102,
  EventDispose: 103,
});

const ResponseType = Object.freeze({
  Initialize: 200,
  PromiseSuccess: 201,
  PromiseError: 202,
  PromiseErrorObj: 203,
  EventFire: 204,
});

class BufferReader {
  constructor(buffer) {
    this._buffer = buffer;
    this._pos = 0;
  }
  read(bytes) {
    const result = this._buffer.slice(this._pos, this._pos + bytes);
    this._pos += result.byteLength;
    return result;
  }
}

class BufferWriter {
  constructor() {
    this._buffers = [];
  }
  get buffer() {
    return VSBuffer.concat(this._buffers);
  }
  write(buffer) {
    this._buffers.push(buffer);
  }
}

function createOneByteBuffer(value) {
  const result = VSBuffer.alloc(1);
  result.writeUInt8(value, 0);
  return result;
}

const DataType = Object.freeze({
  Undefined: 0,
  String: 1,
  Buffer: 2,
  VSBuffer: 3,
  Array: 4,
  Object: 5,
  Int: 6,
});

const BufferPresets = Object.freeze({
  Undefined: createOneByteBuffer(DataType.Undefined),
  String: createOneByteBuffer(DataType.String),
  Buffer: createOneByteBuffer(DataType.Buffer),
  VSBuffer: createOneByteBuffer(DataType.VSBuffer),
  Array: createOneByteBuffer(DataType.Array),
  Object: createOneByteBuffer(DataType.Object),
  Uint: createOneByteBuffer(DataType.Int),
});

const vqlZero = createOneByteBuffer(0);

function readIntVQL(reader) {
  let value = 0;
  for (let n = 0; ; n += 7) {
    const next = reader.read(1);
    value |= (next.buffer[0] & 0b01111111) << n;
    if (!(next.buffer[0] & 0b10000000)) return value;
  }
}

function writeInt32VQL(writer, value) {
  if (value === 0) {
    writer.write(vqlZero);
    return;
  }
  let len = 0;
  for (let v2 = value; v2 !== 0; v2 = v2 >>> 7) len++;
  const scratch = VSBuffer.alloc(len);
  for (let i = 0; value !== 0; i++) {
    scratch.buffer[i] = value & 0b01111111;
    value = value >>> 7;
    if (value > 0) scratch.buffer[i] |= 0b10000000;
  }
  writer.write(scratch);
}

function isNativeBuffer(data) {
  return Buffer.isBuffer(data) || data instanceof Uint8Array;
}

export function serialize(writer, data) {
  if (typeof data === "undefined") {
    writer.write(BufferPresets.Undefined);
  } else if (typeof data === "string") {
    const buffer = VSBuffer.fromString(data);
    writer.write(BufferPresets.String);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  } else if (isNativeBuffer(data)) {
    const buffer = VSBuffer.wrap(data);
    writer.write(BufferPresets.Buffer);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  } else if (data instanceof VSBuffer) {
    writer.write(BufferPresets.VSBuffer);
    writeInt32VQL(writer, data.byteLength);
    writer.write(data);
  } else if (Array.isArray(data)) {
    writer.write(BufferPresets.Array);
    writeInt32VQL(writer, data.length);
    for (const el of data) serialize(writer, el);
  } else if (typeof data === "number" && (data | 0) === data) {
    writer.write(BufferPresets.Uint);
    writeInt32VQL(writer, data);
  } else {
    const buffer = VSBuffer.fromString(JSON.stringify(data));
    writer.write(BufferPresets.Object);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  }
}

export function deserialize(reader) {
  const type = reader.read(1).readUInt8(0);
  switch (type) {
    case DataType.Undefined:
      return undefined;
    case DataType.String:
      return reader.read(readIntVQL(reader)).toString();
    case DataType.Buffer:
      return reader.read(readIntVQL(reader)).buffer;
    case DataType.VSBuffer:
      return reader.read(readIntVQL(reader));
    case DataType.Array: {
      const length = readIntVQL(reader);
      const result = [];
      for (let i = 0; i < length; i++) result.push(deserialize(reader));
      return result;
    }
    case DataType.Object:
      return JSON.parse(reader.read(readIntVQL(reader)).toString());
    case DataType.Int:
      return readIntVQL(reader);
    default:
      return undefined;
  }
}

class ChannelClientLite {
  constructor(protocol) {
    this._protocol = protocol;
    this._state = "uninitialized";
    this._handlers = new Map(); // id -> {resolve,reject}
    this._eventListeners = new Map(); // id -> emitter
    this._lastRequestId = 0;
    this._onDidInitialize = new Emitter();
    this.onDidInitialize = this._onDidInitialize.event;
    this._disposable = this._protocol.onMessage((msg) => this._onBuffer(msg));
  }

  dispose() {
    this._disposable?.dispose?.();
    this._handlers.clear();
    for (const emitter of this._eventListeners.values()) emitter.dispose();
    this._eventListeners.clear();
  }

  whenInitialized(timeoutMs = 15000) {
    if (this._state === "idle") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ipc init timeout")), timeoutMs);
      const d = this.onDidInitialize(() => {
        clearTimeout(t);
        d.dispose?.();
        resolve();
      });
    });
  }

  call(channelName, command, arg) {
    const id = this._lastRequestId++;
    const header = [RequestType.Promise, id, channelName, command];
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, arg);
    this._protocol.send(writer.buffer);

    return new Promise((resolve, reject) => {
      this._handlers.set(id, { resolve, reject });
      setTimeout(() => {
        if (this._handlers.has(id)) {
          this._handlers.delete(id);
          reject(new Error(`ipc call timeout: ${channelName}/${command}`));
        }
      }, 30000);
    });
  }

  listen(channelName, eventName, arg) {
    const id = this._lastRequestId++;
    const header = [RequestType.EventListen, id, channelName, eventName];
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, arg);
    this._protocol.send(writer.buffer);

    const emitter = new Emitter();
    this._eventListeners.set(id, emitter);

    const dispose = () => {
      emitter.dispose();
      this._eventListeners.delete(id);
      // Send EventDispose to server
      const dWriter = new BufferWriter();
      serialize(dWriter, [RequestType.EventDispose, id]);
      serialize(dWriter, undefined);
      try { this._protocol.send(dWriter.buffer); } catch {}
    };

    return { event: emitter.event, dispose };
  }

  _onBuffer(message) {
    const reader = new BufferReader(message);
    const header = deserialize(reader);
    const body = deserialize(reader);
    const type = Array.isArray(header) ? header[0] : undefined;

    if (type === ResponseType.Initialize) {
      this._state = "idle";
      this._onDidInitialize.fire();
      return;
    }

    if (type === ResponseType.EventFire) {
      const id = header[1];
      const emitter = this._eventListeners.get(id);
      console.log(`[ipc] EventFire received: id=${id} hasListener=${!!emitter} body=${JSON.stringify(body)?.slice(0, 300)}`);
      if (emitter) emitter.fire(body);
      return;
    }

    if (type === ResponseType.PromiseSuccess || type === ResponseType.PromiseError || type === ResponseType.PromiseErrorObj) {
      const id = header[1];
      const handler = this._handlers.get(id);
      if (!handler) return;
      this._handlers.delete(id);
      if (type === ResponseType.PromiseSuccess) return handler.resolve(body);
      if (type === ResponseType.PromiseErrorObj) return handler.reject(body);
      // PromiseError
      const err = new Error(body?.message || "ipc error");
      err.name = body?.name || "Error";
      err.stack = Array.isArray(body?.stack) ? body.stack.join("\n") : body?.stack;
      return handler.reject(err);
    }

    // Log unknown message types
    if (type !== undefined) {
      console.log(`[ipc] unhandled message type=${type} header=${JSON.stringify(header)?.slice(0, 200)}`);
    }
  }
}

export class IpcPromiseClient {
  constructor(protocol, ctx) {
    this.protocol = protocol;
    const writer = new BufferWriter();
    serialize(writer, ctx);
    this.protocol.send(writer.buffer);
    // IPCClient in VS Code is both a ChannelClient + ChannelServer; its ChannelServer
    // emits an Initialize message immediately. We don't implement a full ChannelServer
    // yet, but emitting Initialize matches the workbench bootstrap traffic and helps
    // the other side's ChannelClient become ready if it needs to call back.
    const initWriter = new BufferWriter();
    serialize(initWriter, [ResponseType.Initialize]);
    serialize(initWriter, undefined);
    this.protocol.send(initWriter.buffer);
    this.channelClient = new ChannelClientLite(this.protocol);
  }

  dispose() {
    this.channelClient.dispose();
  }

  whenInitialized(timeoutMs) {
    return this.channelClient.whenInitialized(timeoutMs);
  }

  call(channelName, command, arg) {
    return this.channelClient.call(channelName, command, arg);
  }

  listen(channelName, eventName, arg) {
    return this.channelClient.listen(channelName, eventName, arg);
  }
}
