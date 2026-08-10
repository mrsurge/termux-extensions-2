export class VSBuffer {
  constructor(buf) {
    this.buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }

  static alloc(byteCount) {
    return new VSBuffer(Buffer.alloc(byteCount));
  }

  static wrap(uint8Array) {
    return new VSBuffer(Buffer.from(uint8Array));
  }

  static fromString(str) {
    return new VSBuffer(Buffer.from(str ?? "", "utf8"));
  }

  static concat(buffers, totalLength) {
    const bufs = buffers.map((b) => (b instanceof VSBuffer ? b.buffer : Buffer.from(b)));
    return new VSBuffer(Buffer.concat(bufs, totalLength));
  }

  get byteLength() {
    return this.buffer.length;
  }

  slice(start, end) {
    return new VSBuffer(this.buffer.subarray(start, end));
  }

  set(other, offset) {
    const b = other instanceof VSBuffer ? other.buffer : Buffer.from(other);
    b.copy(this.buffer, offset);
  }

  indexOf(other) {
    const b = other instanceof VSBuffer ? other.buffer : Buffer.from(other);
    return this.buffer.indexOf(b);
  }

  readUInt8(offset) {
    return this.buffer.readUInt8(offset);
  }

  readUInt32BE(offset) {
    return this.buffer.readUInt32BE(offset);
  }

  writeUInt8(value, offset) {
    this.buffer.writeUInt8(value, offset);
  }

  writeUInt32BE(value, offset) {
    this.buffer.writeUInt32BE(value >>> 0, offset);
  }

  toString() {
    return this.buffer.toString("utf8");
  }
}

export function encodeBase64(vsbuf) {
  const b = vsbuf instanceof VSBuffer ? vsbuf.buffer : Buffer.from(vsbuf);
  return b.toString("base64");
}

