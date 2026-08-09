export class VSBuffer {
  readonly buffer: Uint8Array;
  readonly byteLength: number;
  readonly length: number;
  constructor(buffer: Uint8Array);
  static alloc(byteLength: number): VSBuffer;
  static wrap(buffer: Uint8Array): VSBuffer;
  static fromString(source: string): VSBuffer;
  static concat(buffers: readonly VSBuffer[], totalLength?: number): VSBuffer;
  static isNativeBuffer(value: unknown): value is Uint8Array;
  toString(): string;
}
