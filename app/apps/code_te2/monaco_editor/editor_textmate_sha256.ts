import { sha256 } from '@noble/hashes/sha2.js';

// Content identity only, not authentication of an unencrypted HTTP peer.
// Both implementations consume exactly the same UTF-8 bytes and return the
// existing lowercase SHA-256 format; no cache migration or weaker checks.
export async function grammarSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  let digest: Uint8Array;
  if (subtle) {
    digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  } else {
    const hash = sha256.create();
    try {
      // Large bodies must yield so cache deadlines/disconnect fences can run.
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        hash.update(bytes.subarray(offset, offset + chunkSize));
        if (offset + chunkSize < bytes.length) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
      digest = hash.digest();
    } finally {
      hash.destroy();
    }
  }
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
