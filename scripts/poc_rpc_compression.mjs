// Offline experiment, NOT a production codec or negotiated transport contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const CODEC = 'msgpack-gzip-poc-v1';
const HEADER = 12;
const LIMIT = 8 * 1024 * 1024;
const MAGIC = Buffer.from('TE2C');

export function pack(payload, capability) {
  if (capability !== CODEC) throw new Error('Codec not negotiated');
  if (!payload.length || payload.length > LIMIT - HEADER) throw new Error('Payload limit');
  let body = payload;
  let compressed = false;
  if (payload.length >= 1024) {
    const candidate = gzipSync(payload);
    if (candidate.length < payload.length) { body = candidate; compressed = true; }
  }
  const header = Buffer.alloc(HEADER);
  MAGIC.copy(header);
  header[4] = 1;
  header[5] = compressed ? 1 : 0;
  header.writeUInt32BE(payload.length, 8);
  return Buffer.concat([header, body]);
}

function inspect(frame, capability) {
  if (capability !== CODEC) throw new Error('Codec not negotiated');
  if (frame.length < HEADER || frame.length > LIMIT) throw new Error('Frame limit');
  if (!frame.subarray(0, 4).equals(MAGIC) || frame[4] !== 1 || frame[5] > 1 ||
      frame.readUInt16BE(6) !== 0) throw new Error('Invalid envelope');
  const length = frame.readUInt32BE(8);
  if (!length || length > LIMIT - HEADER) throw new Error('Declared payload limit');
  return { length, compressed: frame[5] === 1, body: frame.subarray(HEADER) };
}

export function unpack(frame, capability) {
  const { length, compressed, body } = inspect(frame, capability);
  const result = compressed ? gunzipSync(body, { maxOutputLength: length }) : body;
  if (result.length !== length) throw new Error('Payload length mismatch');
  return result;
}

// Browser-equivalent native streaming API. Cap admitted output before collecting
// it; browser codec-internal allocation is NOT a measured peak-memory guarantee.
export async function unpackWeb(frame, capability) {
  const { length, compressed, body } = inspect(frame, capability);
  if (!compressed) {
    if (body.length !== length) throw new Error('Payload length mismatch');
    return body;
  }
  const reader = new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > length) throw new Error('Decompressed payload limit');
      chunks.push(value);
    }
    if (size !== length) throw new Error('Payload length mismatch');
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function selfTest() {
  const raw = Buffer.from([0x81, 0xa1, 0x78, 0x01]);
  const large = Buffer.alloc(65536, 97);
  for (const input of [raw, large]) {
    const frame = pack(input, CODEC);
    assert.deepEqual(unpack(frame, CODEC), input);
    assert.deepEqual(await unpackWeb(frame, CODEC), input);
  }
  assert.equal(pack(raw, CODEC)[5], 0);
  assert.equal(pack(large, CODEC)[5], 1);
  const noise = Buffer.alloc(1024);
  let seed = 123456789;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    noise[i] = seed & 255;
  }
  assert.equal(pack(noise, CODEC)[5], 0); // Compression must actually save bytes.
  assert.deepEqual(await unpackWeb(pack(noise, CODEC), CODEC), noise);
  assert.throws(() => pack(raw, 'msgpack-v1'));
  assert.throws(() => unpack(pack(raw, CODEC), 'msgpack-v1'));
  assert.throws(() => pack(Buffer.alloc(LIMIT), CODEC));
  const good = pack(large, CODEC);
  const malformed = [Buffer.alloc(3), good.subarray(0, good.length - 3)];
  const corrupt = Buffer.from(good); corrupt[corrupt.length - 8] ^= 1;
  malformed.push(corrupt);
  malformed.push(Buffer.concat([good, gzipSync(raw)]));
  for (const [offset, value] of [[0, 0], [4, 2], [5, 2], [6, 1]]) {
    const changed = Buffer.from(good); changed[offset] = value; malformed.push(changed);
  }
  for (const length of [0, LIMIT, 64, large.length + 1]) {
    const changed = Buffer.from(good); changed.writeUInt32BE(length, 8); malformed.push(changed);
  }
  const rawMismatch = pack(raw, CODEC); rawMismatch.writeUInt32BE(raw.length + 1, 8);
  malformed.push(rawMismatch);
  for (const frame of malformed) {
    assert.throws(() => unpack(frame, CODEC));
    await assert.rejects(() => unpackWeb(frame, CODEC));
  }
  return { validRoundTrips: 5, malformedCases: malformed.length, capabilityGuards: true,
    incompressibleBypass: true };
}

export async function benchmark(samples) {
  if (!Array.isArray(samples) || samples.length > 16) throw new Error('Corpus limit');
  let total = 0;
  const rows = [];
  for (const [index, sample] of samples.entries()) {
    const payload = Buffer.from(sample.base64, 'base64');
    total += payload.length;
    if (total > 512 * 1024) throw new Error('Corpus byte limit');
    const frame = pack(payload, CODEC);
    assert.deepEqual(unpack(frame, CODEC), payload);
    assert.deepEqual(await unpackWeb(frame, CODEC), payload);
    let start = performance.now();
    for (let n = 0; n < 32; n++) pack(payload, CODEC);
    const encodeMeanMs = (performance.now() - start) / 32;
    start = performance.now();
    for (let n = 0; n < 16; n++) await unpackWeb(frame, CODEC);
    rows.push({ index, namespace: sample.namespace, direction: sample.direction,
      inputBytes: payload.length, framedBytes: frame.length, compressed: frame[5] === 1,
      encodeMeanMs, webApiDecodeMeanMs: (performance.now() - start) / 16 });
  }
  return { node: process.version, platform: process.platform, arch: process.arch,
    inputBytes: total, framedBytes: rows.reduce((sum, row) => sum + row.framedBytes, 0), rows,
    limitations: 'Node Web API decoder, not installed Chromium; no live transport, RTT, ordering, Rust encoder or peak-memory measurement.' };
}

if (!process.argv[1] || process.argv[1] === '-' || import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ selfTest: await selfTest() }));
  const corpus = process.argv.indexOf('--corpus');
  if (corpus >= 0) console.log(JSON.stringify(await benchmark(JSON.parse(readFileSync(process.argv[corpus + 1], 'utf8')))));
}
