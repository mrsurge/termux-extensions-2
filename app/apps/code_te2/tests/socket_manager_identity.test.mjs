import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Use the shipped client itself: an option-recording fake cannot reproduce its
// origin/path manager cache or the namespace boot-order failure.
const io = createRequire(import.meta.url)(new URL('../../../../app/static/vendor/socket.io.min.js', import.meta.url).pathname);
const result = await build({stdin:{contents:`
  export * from './src/rpc/socketio-topology.ts';
  export * from './main_page/frontend/connections/ui-ipc-rpc.ts';
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const ids = {primary:{clientInstanceId:'client_aaaaaaaaaaaa',clientRole:'primary'},
  secondary:{clientInstanceId:'client_bbbbbbbbbbbb',mainPageClientInstanceId:'client_aaaaaaaaaaaa',clientRole:'secondary'}};
const query = role => api.codeTe2SocketQuery(api.normalizeCodeTe2SocketIdentity(ids[role]));
let sequence=0;
const path=()=>`/identity-regression-${++sequence}/socket.io`;

test('shipped Socket.IO reproduces query inheritance when namespaces multiplex by origin/path',()=>{
  const sharedPath=path();
  const primary=io('http://localhost/ui_ipc',{path:sharedPath,query:query('primary'),autoConnect:false});
  const secondary=io('http://localhost/rpc/editor',{path:sharedPath,query:query('secondary'),autoConnect:false});
  try {
    assert.equal(primary.io,secondary.io);
    assert.equal(secondary.io.opts.query.client_instance_id,ids.primary.clientInstanceId,
      'the secondary namespace inherits primary handshake identity despite its own query option');
  } finally {primary.disconnect();secondary.disconnect();}
});

test('renderer editor/WBA options retain distinct foreground selection in either cold-boot order',()=>{
  for(const order of [['primary','secondary'],['secondary','primary']]) {
    const sharedPath=path(), sockets=[];
    const cached=io('http://localhost/ui_ipc',{path:sharedPath,query:query(order[0]),autoConnect:false});
    const foregrounds=new Map([[ids.primary.clientInstanceId,'/project/primary.ts'],[ids.secondary.clientInstanceId,'/project/secondary.ts']]);
    try {
      for(const role of order) {
        const socket=io('http://localhost/rpc/editor',{
          ...api.RENDERER_SOCKET_IO_OPTIONS,path:sharedPath,query:query(role),autoConnect:false});
        sockets.push(socket);
        assert.notEqual(socket.io,cached.io);
        const actual=socket.io.opts.query.client_instance_id;
        assert.equal(actual,ids[role].clientInstanceId);
        assert.equal(foregrounds.get(actual),`/project/${role}.ts`);
      }
      assert.notEqual(sockets[0].io,sockets[1].io);
    }finally{cached.disconnect();sockets.forEach(socket=>socket.disconnect());}
  }
});

test('real secondary UI connection factory does not inherit a cached editor manager',async()=>{
  for(const order of [['primary','secondary'],['secondary','primary']]) {
    const cached=io('http://localhost/rpc/editor',{path:api.SOCKET_IO_PATHS.uiIpc,query:query(order[0]),autoConnect:false});
    const sockets=[],clients=[];
    try {
      for(const role of order) {
        const client=api.createUiIpcRpcConnection({query:query(role),onNotification(){},
          ensureSocketIoLoaded:async()=>(namespace,options)=>{
            const socket=io(`http://localhost${namespace}`,{...options,autoConnect:false});
            sockets.push(socket);return socket;
          }});
        clients.push(client);await client.connect();
        assert.equal(sockets.at(-1).io.opts.query.client_instance_id,ids[role].clientInstanceId);
        assert.notEqual(sockets.at(-1).io,cached.io);
      }
      assert.notEqual(sockets[0].io,sockets[1].io);
    }finally{clients.forEach(client=>client.dispose());cached.disconnect();}
  }
});

test('working runtime applies isolated manager ownership to both raw namespace constructors',async()=>{
  const source=await readFile(new URL('../monaco_editor/m_editor_app.ts',import.meta.url),'utf8');
  for(const namespace of ['editorRpc','wba']) {
    assert.match(source,new RegExp(`window\\.io\\(SOCKET_IO_NAMESPACES\\.${namespace}, \\{\\s*\\.\\.\\.RENDERER_SOCKET_IO_OPTIONS`));
  }
});
