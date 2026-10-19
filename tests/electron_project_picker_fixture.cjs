// Isolated Electron reproduction: real shared dialogs/picker, mocked read-only
// filesystem responses, hidden windows, no framework or user-data mutations.
const {app,BrowserWindow} = require('electron');
const {createServer} = require('node:http');
const {readFileSync} = require('node:fs');
const {join,resolve} = require('node:path');
const assert = require('node:assert/strict');
const {build} = require('../app/apps/code_te2/node_modules/esbuild');
const root = resolve(__dirname,'..');
app.commandLine.appendSwitch('disable-gpu');
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
app.whenReady().then(async () => {
  app.removeAllListeners('window-all-closed');
  app.on('window-all-closed',()=>{});
  const bundle = await build({entryPoints:[join(root,'app/apps/code_te2/src/explorer/chrome/new-project-modal.ts')],
    bundle:true,format:'esm',platform:'browser',write:false});
  const css = readFileSync(join(root,'app/apps/code_te2/template.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  const html = `<style>${css}</style><script type="module">
    import {createDialogService} from '/static/js/te_dialog.mjs';
    import {showNewProjectModal} from '/new-project.js';
    window.te2DesktopSurfaceWindows={enabled:true};
    window.teUI={dialog:createDialogService(window),toast:()=>{}};
    await import('/static/js/file_picker.js');
    window.start=()=>{window.finished=false;showNewProjectModal().then(()=>window.teFilePicker.saveFile({title:'Create New Project',filename:'my-project'})).catch(error=>{
      if(String(error?.message||error)!=='cancelled')throw error;
    }).finally(()=>{window.finished=true;});};
    window.ready=true;
  </script>`;
  const server = createServer((request,response)=>{
    const path = new URL(request.url,'http://127.0.0.1').pathname;
    if(path.startsWith('/api/')) {
      response.setHeader('Content-Type','application/json');
      response.end(JSON.stringify({ok:true,data:path==='/api/browse'?{path:'/home/test',entries:[{name:'src',path:'/home/test/src',type:'directory'},{name:'README.md',path:'/home/test/README.md',type:'file'}]}:path==='/api/bookmarks'?[]:{}}));return;
    }
    if(path==='/') {response.setHeader('Content-Type','text/html');response.end(html);return;}
    response.setHeader('Content-Type','text/javascript');
    if(path==='/new-project.js'){response.end(bundle.outputFiles[0].text);return;}
    if(path==='/static/js/file_icons.js'){response.end('export async function getIcon(){return null} export function renderIcon(){}');return;}
    if(['/static/js/te_dialog.mjs','/static/js/te_modal_surface_portal.mjs','/static/js/file_picker.js'].includes(path)){
      response.end(readFileSync(join(root,'app',path)));return;
    }
    response.statusCode=404;response.end('');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const owner = new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,partition:`project-picker-${Date.now()}`}});
  const children = new Set();
  owner.webContents.setWindowOpenHandler(({frameName,url})=>frameName==='te2-modal-surface'&&url==='about:blank'
    ?{action:'allow',overrideBrowserWindowOptions:{show:false,frame:false,width:800,height:600,parent:owner}}:{action:'deny'});
  owner.webContents.on('did-create-window',child=>{
    children.add(child);child.on('closed',()=>children.delete(child));
    child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    child.webContents.on('will-navigate',event=>event.preventDefault());
  });
  const until = async predicate => {for(let n=0;n<100;n++){if(await predicate())return;await wait(20);}throw new Error('Timed out waiting for project/picker handoff');};
  try {
    await owner.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(()=>owner.webContents.executeJavaScript('window.ready===true'));
    for(let cycle=0;cycle<3;cycle++) {
      await owner.webContents.executeJavaScript('window.start();void 0');
      await until(()=>owner.webContents.executeJavaScript("window.teUI.dialog.surfaceRegistry.get('code-te2.new-project')?.open===true"));
      await owner.webContents.executeJavaScript("window.teUI.dialog.surfaceRegistry.get('code-te2.new-project').element.querySelector('.fe-btn-primary').click();void 0");
      await until(()=>owner.webContents.executeJavaScript("window.teUI.dialog.surfaceRegistry.get('framework.file-picker')?.open===true"));
      await wait(200); // Include delayed window teardown/focus-restoration tasks.
      assert.equal(children.size,1,'one populated floating picker, not an orphan window');
      const [child] = children;
      const state = await child.webContents.executeJavaScript(`(()=>{
        const picker=document.querySelector('#te-file-picker-root');
        const dialog=picker?.querySelector('.te-fp-dialog');
        const rect=dialog?.getBoundingClientRect();
        return {text:picker?.textContent,display:picker?getComputedStyle(picker).display:null,width:rect?.width,height:rect?.height};
      })()`);
      assert.match(state.text||'',/README\.md/);
      assert.notEqual(state.display,'none');assert.ok(state.width>300&&state.height>200,JSON.stringify(state));
      await child.webContents.executeJavaScript("document.querySelector('.te-fp-btn-cancel').click();void 0");
      await until(()=>owner.webContents.executeJavaScript('window.finished===true'));
      await until(()=>children.size===0);
    }
    console.log('Electron New Project → populated floating picker passed: 3 cycles');
  } finally {for(const child of children)child.destroy();owner.destroy();server.close();}
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
