// Run under stock Electron on a disposable display and clipboard.
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { app, BrowserWindow, clipboard, Menu } = require("electron");
const { buildSync } = require("esbuild");
const profile = mkdtempSync(join(tmpdir(), "te2-edit-menu-"));
app.setPath("userData", profile);
const modulePath = join(profile, "menu.cjs");
buildSync({
  entryPoints: [join(__dirname, "../src/main/text-context-menu.ts")],
  outfile: modulePath, bundle: true, platform: "node", external: ["electron"],
});
const { installTextContextMenu, textEditItems } = require(modulePath);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error("Menu test timed out"); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 600, height: 400 });
  const contents = window.webContents;
  installTextContextMenu(contents, () => window);
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
    '<body style="margin:0"><textarea id="a" style="width:580px;height:120px;font:22px monospace">café Mango</textarea>' +
    '<p id="p">readonly Kiwi</p><div id="r" contenteditable="true" style="height:60px">Text</div></body>'
  ));
  window.focus();
  assert.deepEqual(textEditItems(contents, { editFlags: {}, isEditable: false, selectionText: "" }), []);
  let captured;
  const popup = Menu.prototype.popup;
  Menu.prototype.popup = function (options) {
    captured = this;
    return popup.call(this, options);
  };
  const js = expression => contents.executeJavaScript(expression);
  async function show(x, y) {
    captured = null;
    for (const type of ["mouseDown", "mouseUp"]) {
      contents.sendInputEvent({ type, button: "right", x, y, clickCount: 1 });
    }
    for (let i = 0; i < 80 && !captured; i++) await pause(25);
    assert.ok(captured, "Electron menu opened");
    return captured;
  }
  async function choose(label, x = 18, y = 20) {
    const menu = await show(x, y);
    const item = menu.items.find(entry => entry.label === label);
    assert.ok(item?.enabled, label + " enabled");
    menu.closePopup(window);
    await pause(60);
    item.click({}, window, contents);
    await pause(80);
  }

  const select = () => js("a.focus();a.select();true");
  await select();
  const menu = await show(18, 20);
  assert.deepEqual(menu.items.filter(i => i.type !== "separator").map(i => i.label),
    ["Undo", "Redo", "Cut", "Copy", "Paste", "Paste Without Formatting", "Delete", "Select All"]);
  menu.closePopup(window);
  await pause(80);
  await select();
  await choose("Copy");
  assert.equal(clipboard.readText(), "café Mango");
  await select();
  await choose("Cut");
  assert.equal(await js("a.value"), "");
  await choose("Undo");
  assert.equal(await js("a.value"), "café Mango");
  await choose("Redo");
  assert.equal(await js("a.value"), "");
  await choose("Paste");
  assert.equal(await js("a.value"), "café Mango");
  await choose("Select All");
  assert.equal(await js("a.selectionEnd-a.selectionStart"), 10);
  await choose("Delete");
  assert.equal(await js("a.value"), "");
  await js("r.focus();getSelection().selectAllChildren(r);true");
  clipboard.write({ text: "Plain", html: "<b>Plain</b>" });
  const [x, y] = await js("(()=>{const b=r.getBoundingClientRect();return [b.x+12,b.y+8]})()");
  await choose("Paste Without Formatting", x, y);
  assert.equal(await js("r.textContent"), "Plain");
  assert.equal(await js('!!r.querySelector("b,strong")'), false);
  await js("getSelection().selectAllChildren(p);true");
  const readonly = await show(16, Math.floor(await js("p.getBoundingClientRect().y+8")));
  assert.deepEqual(readonly.items.map(i => i.label), ["Copy", "Select All"]);
  readonly.closePopup(window);
  clearTimeout(timeout);
  console.log("PASS: editable commands and read-only menu on Electron " + process.versions.electron);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
