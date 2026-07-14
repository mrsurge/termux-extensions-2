import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodePipeFrame,
  PipeFrameDecoder,
} from './terminal_stream_protocol.mjs';


test('framed MessagePack preserves binary terminal data across fragmented reads', () => {
  const expected = {
    type: 'output',
    sequence: 17,
    data: new Uint8Array([0, 10, 27, 128, 255]),
  };
  const frame = encodePipeFrame(expected);
  const decoder = new PipeFrameDecoder();
  const decoded = [];
  for (const byte of frame) {
    decoded.push(...decoder.push(Uint8Array.of(byte)));
  }

  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].type, expected.type);
  assert.equal(decoded[0].sequence, expected.sequence);
  assert.deepEqual(Array.from(decoded[0].data), Array.from(expected.data));
});


test('framed MessagePack decoder separates coalesced messages', () => {
  const first = encodePipeFrame({ type: 'ping', request_id: 'one' });
  const second = encodePipeFrame({ type: 'resize', cols: 120, rows: 40 });
  const decoder = new PipeFrameDecoder();

  assert.deepEqual(
    decoder.push(Buffer.concat([first, second])),
    [
      { type: 'ping', request_id: 'one' },
      { type: 'resize', cols: 120, rows: 40 },
    ],
  );
});


test('framed MessagePack decoder rejects invalid lengths and non-object payloads', () => {
  const zeroLength = Buffer.alloc(4);
  assert.throws(() => new PipeFrameDecoder().push(zeroLength), /invalid terminal frame length/);

  const scalarFrame = Buffer.from([0x00, 0x00, 0x00, 0x01, 0xc3]);
  assert.throws(() => new PipeFrameDecoder().push(scalarFrame), /object/);
});
