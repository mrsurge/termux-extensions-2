// Hidden, isolated Electron windows exercise Chromium native page zoom. This
// validates geometry, not the Android SDK's wiring or physical gesture guards.
const {app, BrowserWindow} = require('electron');
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const {join} = require('node:path');
const {createServer} = require('node:http');
app.commandLine.appendSwitch('disable-gpu');
const source = readFileSync(join(__dirname, '../app/templates/app_shell.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const drawerCss = readFileSync(join(__dirname, '../app/apps/code_te2/main_page/frontend/explorer.css'), 'utf8')
  .replace(/@import[^;]*;/g, '');
const metrics = source.slice(source.indexOf('    function updateAppShellLayoutMetrics()'), source.indexOf('    function scheduleAppShellLayoutMetrics()'));
const html = `<html class="gv-native"><head><style>${css}\n${drawerCss}</style></head><body>
<div class="app-shell"><div id="app-container"><div class="fe-root drawer-open" style="height:var(--te-app-container-height)">
<div class="fe-drawer"></div></div></div><script>
const resolveAppShellMode = () => 'native'; const syncViewportMetaForShellMode = () => {};
${metrics}
window.measure = () => {
 updateAppShellLayoutMetrics();
 const rect = document.querySelector('.app-shell').getBoundingClientRect();
 const drawer = document.querySelector('.fe-drawer').getBoundingClientRect();
 return {width:innerWidth, height:innerHeight, shell:[rect.width,rect.height],
  drawer:[drawer.left,drawer.right,drawer.top,drawer.bottom], zoom:getComputedStyle(document.documentElement).zoom};
};</script></body></html>`;
app.whenReady().then(async () => {
  // Electron's default CLI app otherwise quits between the two hidden windows.
  app.removeAllListeners('window-all-closed');
  app.on('window-all-closed', () => {});
  const server = createServer((_,response) => {response.setHeader('Content-Type','text/html');response.end(html);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let samples = 0;
  for (const [width,height] of [[400,800], [800,400]]) {
    const win = new BrowserWindow({show:false, width,height, useContentSize:true,
      webPreferences:{sandbox:true, partition:`native-scale-${width}-${Date.now()}`}});
    try {
      for (const scale of [.6,.8,1,1.1,1.8,.8,1]) {
        await win.loadURL(url);
        win.webContents.setZoomLevel(Math.log(scale) / Math.log(1.2));
        for (const h of [height, Math.round(height*.65), height]) {
          win.setContentSize(width,h);
          await new Promise(resolve => setTimeout(resolve, 40));
          const v = await win.webContents.executeJavaScript('window.measure()');
          const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<2,
            JSON.stringify({scale,width,height:h,...v}));
          near(v.shell[0],v.width); near(v.shell[1],v.height);
          near(v.drawer[0],0); near(v.drawer[1],v.width);
          near(v.drawer[2],0); near(v.drawer[3],v.height);
          assert.equal(Number(v.zoom),1,'native scaling must not inject CSS zoom');
          samples++;
        }
      }
    } finally { win.destroy(); }
  }
  console.log(`Native Chromium scale/drawer geometry passed: ${samples} portrait/landscape/reload/resize samples`);
  server.close();
  app.exit(0);
}).catch(error => {console.error(error);app.exit(1);});
