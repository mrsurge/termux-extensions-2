import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { PipeMessagePackDecoder, encodePipeMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';
import { encodePush, encodeRpcReply, encodeStartupBeacon } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/stdio-protocol.mjs';

test('pipe kinds survive bytewise fragmentation and concatenation', () => {
  const stream = Buffer.concat([encodeStartupBeacon({type:'adapter/start'}), encodeRpcReply({id:1,result:'a\nb'}), encodePush({method:'event',params:{text:'λ'}})]);
  for (const step of [1, 3, stream.length]) {
    const decoder = new PipeMessagePackDecoder();
    const values = [];
    for(let offset=0;offset<stream.length;offset+=step) decoder.feed(stream.subarray(offset,offset+step), value => values.push(value));
    decoder.finish();
    assert.deepEqual(values.map(v=>v.kind), ['startup','reply','push']);
    assert.equal(values[1].payload.result, 'a\nb');
  }
});
test('strict EOF, malformed input, and per-frame bounds', () => {
  const decoder=new PipeMessagePackDecoder();
  decoder.feed(Uint8Array.of(0x81), ()=>{});
  assert.throws(()=>decoder.finish(), /Truncated/);
  assert.throws(()=>new PipeMessagePackDecoder().feed(Uint8Array.of(0xc1), ()=>{}));
  assert.throws(()=>new PipeMessagePackDecoder(10).feed(encodePipeMessage({value:'abcdefghijklmnop'}), ()=>{}), /limit/);
  const bounded=new PipeMessagePackDecoder(10);
  let count=0;
  bounded.feed(Buffer.concat(Array.from({length:100},()=>encodePipeMessage({a:1}))), ()=>count++);
  bounded.finish();
  assert.equal(count,100);
});
test('Python and Node exchange standard maps including large binary content', () => {
  const payload={jsonrpc:'2.0',id:7,method:'document/change',params:{text:'z'.repeat(2*1024*1024),binary:Uint8Array.of(0,10,255)}};
  const reply=spawnSync('python',['-c','import sys,msgspec; v=msgspec.msgpack.decode(sys.stdin.buffer.read()); sys.stdout.buffer.write(msgspec.msgpack.encode({"kind":"reply","payload":v}))'], {input:encodePipeMessage(payload),maxBuffer:4*1024*1024});
  assert.equal(reply.status,0,reply.stderr.toString());
  const decoder=new PipeMessagePackDecoder();
  const values=[];
  decoder.feed(reply.stdout,v=>values.push(v));
  decoder.finish();
  assert.equal(values[0].payload.params.text,payload.params.text);
  assert.deepEqual([...values[0].payload.params.binary],[0,10,255]);
});
