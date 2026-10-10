import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const appRoot = new URL('../', import.meta.url).pathname;
const load = async path => {
  const result = await build({entryPoints:[appRoot + path],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
};
const { gzipRpcWireCodec: codec, frameRpcRequest, inspectRpcFrame, RPC_FRAME_LIMIT } = await load('src/rpc/gzip-codec.ts');
const { messagePackRpcWireCodec: msgpack } = await load('src/rpc/codec.ts');
const { createOrderedRpcReceiver } = await load('src/rpc/ordered-receiver.ts');
const { createEditorRpcTransport } = await load('monaco_editor/editor_rpc_transport.ts');
function compressed(value) {
  const raw = msgpack.encode(value);
  const frame = Buffer.from(frameRpcRequest(raw).subarray(0,12)); frame[5]=1;
  return Buffer.concat([frame,gzipSync(raw)]);
}
const tick = () => new Promise(resolve=>setTimeout(resolve,0));

test('raw requests and compressed responses preserve MessagePack values', async () => {
  const value={jsonrpc:'2.0',id:'test',result:{text:'λ'.repeat(4096),binary:new Uint8Array([0,255])}};
  assert.deepEqual(msgpack.decode(codec.encode(value).subarray(12)),value);
  assert.deepEqual(await codec.decode(compressed(value)),value);
  assert.deepEqual(codec.decode(codec.encode(value)),value);
});

test('strict frame admission and bounded stream reject corruption/expansion', async () => {
  const frame=compressed({result:'x'.repeat(65536)});
  const bad=[new Uint8Array(3),frame.subarray(0,frame.length-2),msgpack.encode({result:'raw'})];
  for(const [offset,value] of [[0,0],[4,2],[5,2],[6,1]]){const b=Buffer.from(frame);b[offset]=value;bad.push(b);}
  for(const length of [0,RPC_FRAME_LIMIT,10]){const b=Buffer.from(frame);b.writeUInt32BE(length,8);bad.push(b);}
  const corrupt=Buffer.from(frame);corrupt[corrupt.length-8]^=1;bad.push(corrupt);
  for(const value of bad)await assert.rejects(async()=>codec.decode(value));
});

test('ordered receiver holds later raw packets behind compressed work', async () => {
  let release;const events=[];
  const receiver=createOrderedRpcReceiver({size:()=>10,
    decode: value=>value===1?new Promise(resolve=>{release=resolve;}):value,
    deliver:value=>events.push(value),onError:error=>{throw error;}});
  receiver.receive(1);receiver.receive(2);assert.deepEqual(events,[]);
  release(1);await tick();assert.deepEqual(events,[1,2]);
});

test('disconnect invalidates old decoding without blocking the new generation', async () => {
  let release;let signal;const events=[];
  const receiver=createOrderedRpcReceiver({size:()=>10,
    decode:(value,s)=>{if(value===1){signal=s;return new Promise(resolve=>{release=resolve;});}return value;},
    deliver:value=>events.push(value),onError:error=>{throw error;}});
  receiver.receive(1);receiver.receive(2);receiver.reset();assert.equal(signal.aborted,true);
  receiver.receive(3);release(1);await tick();assert.deepEqual(events,[3]);
});

test('queue limits cancel active work and report one failure', () => {
  let signal;const errors=[];
  const receiver=createOrderedRpcReceiver({size:()=>5*1024*1024,
    decode:(_,s)=>{signal=s;return new Promise(()=>{});},deliver:()=>assert.fail(),onError:e=>errors.push(e)});
  receiver.receive(1);receiver.receive(2);assert.equal(signal.aborted,true);
  assert.equal(errors.length,1);assert.match(errors[0].message,/queue limit/);
});

test('async decode timeout aborts work and discards later completion', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let release;let signal;const events=[];const errors=[];
  const receiver=createOrderedRpcReceiver({size:()=>10,
    decode:(_,s)=>{signal=s;return new Promise(resolve=>{release=resolve;});},
    deliver:value=>events.push(value),onError:error=>errors.push(error)});
  receiver.receive(1);t.mock.timers.tick(10000);
  assert.equal(signal.aborted,true);assert.match(errors[0].message,/timeout/);
  release(1);await Promise.resolve();assert.deepEqual(events,[]);
});

test('real editor transport sends framed requests and receives ordered responses', async () => {
  const handlers=new Map();const emits=[];const notifications=[];
  const socket={connected:true,sendBuffer:[],on:(event,handler)=>handlers.set(event,handler),
    emit:(event,payload)=>emits.push({event,payload}),volatile:{emit:()=>{}},disconnect:()=>{socket.connected=false;handlers.get('disconnect')?.();}};
  const transport=createEditorRpcTransport({getSocket:()=>socket,codec,setTimeoutFn:setTimeout,clearTimeoutFn:clearTimeout});
  transport.attachSocket(socket);transport.onNotification('editor.file.opened',p=>notifications.push(p));
  const pending=transport.call('editor.agentEdits.documentState.get',{});
  const request=msgpack.decode(emits[0].payload.subarray(12));
  handlers.get('rpc')(compressed({jsonrpc:'2.0',method:'editor.file.opened',params:{content:'x'.repeat(4096)}}));
  handlers.get('rpc')(codec.encode({jsonrpc:'2.0',id:request.id,result:{ok:true}}));
  assert.deepEqual(await pending,{ok:true});assert.equal(notifications.length,1);
});

test('optional Rust-generated fixture decodes in the browser codec', async t => {
  if(!process.env.TE2_RPC_GZIP_FIXTURE){t.skip('run with the Rust-generated fixture');return;}
  const result=await codec.decode(readFileSync(process.env.TE2_RPC_GZIP_FIXTURE));
  assert.equal(result.text,'λabc'.repeat(4096));assert.deepEqual(result.binary,new Uint8Array([0,255]));
});
