import { encode, decode } from '../terminal/node_modules/@msgpack/msgpack';

export function packObject(value: object): Uint8Array {
  return encode(value, { ignoreUndefined: true });
}
export function unpackObject(value: unknown): Record<string, unknown> {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || !bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024) throw new Error('Invalid MessagePack frame');
  const object: unknown = decode(bytes);
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null)) throw new Error('Expected MessagePack object');
  return object as Record<string, unknown>;
}
