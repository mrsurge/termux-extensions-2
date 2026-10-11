// Protocol feasibility only: these message types are not accepted by the live
// broker until shell-control coordination and consumer integration are approved.
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePipeFrame, PipeFrameDecoder } from './terminal_stream_protocol.mjs';

test('existing framing keeps directory control separate from terminal output', () => {
  const messages = [
    { type: 'directory.request', request_id: 'navigation-1', path: "/example/quotes'\n$(literal)" },
    { type: 'shell.state', state: 'prompt', generation: 1 },
    { type: 'output', sequence: 5, data: Buffer.from('visible terminal output') },
    { type: 'directory.result', request_id: 'navigation-1', state: 'applied' },
  ];
  const decoder = new PipeFrameDecoder();
  const frames = Buffer.concat(messages.map(encodePipeFrame));
  const decoded = [];
  // Arbitrary transport chunking must not combine terminal/control semantics.
  for (let offset = 0; offset < frames.length; offset += 7) {
    decoded.push(...decoder.push(frames.subarray(offset, offset + 7)));
  }
  assert.deepEqual(decoded.map(message => message.type), messages.map(message => message.type));
  assert.equal(decoded[0].path, messages[0].path);
  assert.equal(Buffer.from(decoded[2].data).toString(), 'visible terminal output');
});
