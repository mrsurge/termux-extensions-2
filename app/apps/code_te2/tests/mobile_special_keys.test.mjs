import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

test("keeps Cefrium focused Monaco textareas above Chromium's small-input zoom threshold", () => {
  const source = fs.readFileSync(
    path.join(appRoot, "monaco_editor/inline_host.ts"),
    "utf8",
  );

  assert.match(
    source,
    /#editor-frame\[data-te2-native-renderer='cefrium'\] \.monaco-editor textarea\.inputarea\.android-ime-input \{\s*font-size: 16px !important;/,
  );
});

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence++}`;
  return import(url);
}

async function importMobileSpecialKeyRuntime() {
  const result = await build({
    stdin: {
      contents: `
        export * from './monaco_editor/editor_mobile_special_keys_utils.ts';
        export * from './src/mobile-input/editor-special-key-bridge.ts';
      `,
      resolveDir: appRoot,
      sourcefile: "mobile-special-key-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence++}`;
  return import(url);
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  replace(value) {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : force;
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  contains(value) {
    return this.values.has(value);
  }

  toString() {
    return [...this.values].join(" ");
  }
}

function matchesSelector(element, selector) {
  if (selector === "#editor-frame") return element.id === "editor-frame";
  if (selector === "textarea") return element.tagName === "TEXTAREA";
  if (selector === "textarea.inputarea") {
    return element.tagName === "TEXTAREA" &&
      element.classList.contains("inputarea");
  }
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }
  return false;
}

class FakeElement extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.id = "";
    this.tabIndex = 0;
    this.textContent = "";
    this.title = "";
    this.type = "";
  }

  set className(value) {
    this.classList.replace(value);
  }

  get className() {
    return this.classList.toString();
  }

  append(...children) {
    for (const child of children) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(
          (existing) => existing !== child,
        );
      }
      child.parentElement = this;
      this.children.push(child);
    }
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this,
    );
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selectorText) {
    return this.querySelectorAll(selectorText)[0] ?? null;
  }

  querySelectorAll(selectorText) {
    const selectors = selectorText.split(",").map((value) => value.trim());
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (selectors.some((selector) => matchesSelector(child, selector))) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(target) {
    let current = target;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.activeElement = null;
    this.defaultView = null;
    this.hidden = false;
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    const appendToHead = this.head.append.bind(this.head);
    this.head.appendChild = (child) => {
      appendToHead(child);
      if (child.tagName === "SCRIPT") queueMicrotask(() => child.onload?.());
      return child;
    };
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    const visit = (element) => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this.body);
  }
}

class FakeCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class FakeKeyboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    for (const property of [
      "key",
      "code",
      "ctrlKey",
      "altKey",
      "shiftKey",
    ]) {
      Object.defineProperty(this, property, {
        configurable: true,
        value: init[property] ?? (property.endsWith("Key") ? false : ""),
      });
    }
    Object.defineProperty(this, "keyCode", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(this, "which", {
      configurable: true,
      value: 0,
    });
  }
}

function installDomGlobals() {
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.KeyboardEvent = FakeKeyboardEvent;
}

function createEditorFixture(userAgent, role = "primary") {
  installDomGlobals();
  const win = new EventTarget();
  win.document = new FakeDocument();
  win.document.defaultView = win;
  win.navigator = { userAgent };
  win.CustomEvent = FakeCustomEvent;
  win.setTimeout = globalThis.setTimeout.bind(globalThis);
  win.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  win.setInterval = globalThis.setInterval.bind(globalThis);
  win.clearInterval = globalThis.clearInterval.bind(globalThis);
  win.location = new URL(
    role === "secondary"
      ? "http://127.0.0.1/app/code_te2?te2_editor_role=secondary"
      : "http://127.0.0.1/app/code_te2",
  );

  const appRoot = win.document.createElement("div");
  appRoot.className = role === "secondary"
    ? "te2-secondary-editor"
    : "fe-root layout-mobile";
  const terminalContainer = win.document.createElement("div");
  terminalContainer.id = "terminal-container";
  const terminalInput = win.document.createElement("textarea");
  terminalContainer.append(terminalInput);
  const editorContainer = win.document.createElement("div");
  editorContainer.className = role === "secondary"
    ? "te2-secondary-editor-body"
    : "fe-editor-container";
  const host = win.document.createElement("div");
  host.id = "editor-frame";
  const editorRoot = win.document.createElement("div");
  editorRoot.className = "fh-root";
  const monacoHost = win.document.createElement("div");
  monacoHost.id = "fh-monaco";
  const editorDom = win.document.createElement("div");
  const input = win.document.createElement("textarea");
  input.className = "inputarea";
  editorDom.append(input);
  monacoHost.append(editorDom);
  editorRoot.append(monacoHost);
  host.append(editorRoot);
  editorContainer.append(host);
  appRoot.append(editorContainer, terminalContainer);
  win.document.body.append(appRoot);

  const actionRuns = [];

  return {
    win,
    appRoot,
    editorContainer,
    terminalContainer,
    terminalInput,
    host,
    editorRoot,
    monacoHost,
    editorDom,
    input,
    editor: {
      getDomNode: () => editorDom,
      focus: () => input.focus(),
      getAction: (id) => ({
        run: () => {
          actionRuns.push(id);
        },
      }),
    },
    actionRuns,
  };
}

function pointerEvent(type, pointerId = 1) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  return event;
}

function pointerDown(win, target, pointerId = 1) {
  target.dispatchEvent(pointerEvent("pointerdown", pointerId));
}

function pointerTap(win, target, pointerId = 1) {
  pointerDown(win, target, pointerId);
  target.dispatchEvent(pointerEvent("pointerup", pointerId));
}

function findButton(root, title) {
  return [...root.querySelectorAll(".te2-mobile-special-key")].find(
    (button) => button.title === title,
  ) ?? null;
}

test("gates the special-key UI from the mobile user agent", async () => {
  const { isMobileUserAgent, bindMobileEditorSpecialKeys } =
    await importTypeScript(
      "monaco_editor/editor_mobile_special_keys_utils.ts",
    );

  assert.equal(
    isMobileUserAgent({ userAgent: "Mozilla/5.0 (Linux; Android 16) Mobile" }),
    true,
  );
  assert.equal(
    isMobileUserAgent({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }),
    false,
  );
  assert.equal(
    isMobileUserAgent({ userAgentData: { mobile: true }, userAgent: "" }),
    true,
  );

  const fixture = createEditorFixture("Mozilla/5.0 (X11; Linux x86_64)");
  assert.equal(bindMobileEditorSpecialKeys(fixture.editor, fixture.win), null);
  assert.equal(
    fixture.host.querySelector(".te2-mobile-special-key-trigger"),
    null,
  );
});

test("repeats a captured pointer hold and cancels it deterministically", async () => {
  const {
    bindPointerHoldRepeat,
    POINTER_HOLD_REPEAT_DELAY_MS,
    POINTER_HOLD_REPEAT_INTERVAL_MS,
  } = await importTypeScript("src/mobile-input/pointer-hold-repeat.ts");
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.defaultView = win;
  doc.hidden = false;
  const button = new EventTarget();
  button.ownerDocument = doc;
  let capturedPointer = null;
  button.setPointerCapture = (pointerId) => { capturedPointer = pointerId; };
  button.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
  button.releasePointerCapture = (pointerId) => {
    if (capturedPointer === pointerId) capturedPointer = null;
  };
  let nextHandle = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const clock = {
    setTimeout(callback, delayMs) {
      const handle = ++nextHandle;
      timeouts.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeout(handle) { timeouts.delete(handle); },
    setInterval(callback, intervalMs) {
      const handle = ++nextHandle;
      intervals.set(handle, { callback, intervalMs });
      return handle;
    },
    clearInterval(handle) { intervals.delete(handle); },
  };
  const calls = [];
  const dispose = bindPointerHoldRepeat(button, {
    start: () => calls.push("start"),
    repeat: () => calls.push("repeat"),
    finish: () => calls.push("finish"),
  }, { window: win, clock });

  button.dispatchEvent(pointerEvent("pointerdown", 7));
  assert.deepEqual(calls, ["start"]);
  assert.equal([...timeouts.values()][0].delayMs, POINTER_HOLD_REPEAT_DELAY_MS);
  [...timeouts.values()][0].callback();
  assert.deepEqual(calls, ["start", "repeat"]);
  assert.equal([...intervals.values()][0].intervalMs, POINTER_HOLD_REPEAT_INTERVAL_MS);
  [...intervals.values()][0].callback();
  assert.deepEqual(calls, ["start", "repeat", "repeat"]);

  win.dispatchEvent(pointerEvent("pointerup", 8));
  assert.equal(calls.at(-1), "repeat");
  button.dispatchEvent(pointerEvent("pointerup", 7));
  assert.equal(calls.at(-1), "finish");
  assert.equal(intervals.size, 0);
  dispose();
});

test("dispatches editor keys without moving focus", async () => {
  const { dispatchMobileEditorKey } = await importTypeScript(
    "monaco_editor/editor_mobile_special_keys_utils.ts",
  );
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Gecko/144 Firefox/144",
  );
  const events = [];
  fixture.input.addEventListener("keydown", (event) => {
    events.push({
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
    event.preventDefault();
  });
  fixture.input.focus();

  assert.equal(dispatchMobileEditorKey(fixture.editor, {
    key: "Tab",
    code: "Tab",
    keyCode: 9,
    shiftKey: true,
  }, fixture.win), true);

  assert.deepEqual(events, [{
    key: "Tab",
    code: "Tab",
    keyCode: 9,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }]);
  assert.equal(fixture.win.document.activeElement, fixture.input);
});

test("moves the translucent controls and key target into the focused secondary editor", async () => {
  const {
    bindMobileEditorSpecialKeys,
    currentMobileEditorModifiers,
    publishMobileEditorFocus,
    publishMobileEditorModifierState,
    publishMobileEditorPanelState,
    requestMobileEditorSpecialKey,
    setMobileEditorOwner,
  } = await importMobileSpecialKeyRuntime();
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Chrome/151 Mobile",
    "secondary",
  );
  const keyEvents = [];
  const ctrlStates = [];
  let saveRequests = 0;
  let panelToggleRequests = 0;
  let modifierConsumptions = 0;
  fixture.win.__androidTerminalSetCtrl = (active) => ctrlStates.push(active);
  fixture.input.addEventListener("keydown", (event) => {
    keyEvents.push({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
  });
  fixture.win.addEventListener("te2:mobile-editor-panel-toggle", (event) => {
    panelToggleRequests += 1;
    event.detail.handled = true;
  });
  fixture.win.addEventListener("te2:mobile-editor-modifiers-consumed", () => {
    modifierConsumptions += 1;
  });

  const binding = bindMobileEditorSpecialKeys(
    fixture.editor,
    fixture.win,
    () => { saveRequests += 1; },
  );
  assert.ok(binding);
  const overlay = fixture.editorContainer.querySelector(
    ".te2-mobile-editor-overlay",
  );
  const trigger = findButton(overlay, "Toggle editor special keys");
  const save = findButton(overlay, "Save current file");
  assert.ok(overlay);
  assert.equal(overlay.parentElement, fixture.editorContainer);
  assert.equal(fixture.appRoot.querySelector(".te2-mobile-special-key-panel"), null);
  assert.equal(overlay.hidden, true);

  publishMobileEditorFocus(fixture.win, "secondary");
  assert.equal(overlay.hidden, false);
  publishMobileEditorPanelState(fixture.win, false);
  assert.equal(save.hidden, true);
  publishMobileEditorPanelState(fixture.win, true);
  assert.equal(save.hidden, false);

  publishMobileEditorModifierState(fixture.win, {
    ctrl: true,
    ctrlLocked: false,
    alt: true,
    shift: true,
  });
  assert.deepEqual(ctrlStates, [true]);
  assert.equal(requestMobileEditorSpecialKey(
    fixture.win,
    "secondary",
    { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    { ctrl: true, alt: true, shift: true },
  ), true);
  assert.deepEqual(keyEvents, [{
    key: "ArrowLeft",
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  }]);
  fixture.win.dispatchEvent(new FakeCustomEvent(
    "android-terminalapp-ctrl-state",
    { detail: { active: false } },
  ));
  assert.equal(currentMobileEditorModifiers(fixture.win).ctrl, false);
  assert.equal(modifierConsumptions, 1);

  pointerDown(fixture.win, save);
  assert.equal(saveRequests, 1);
  pointerDown(fixture.win, trigger);
  assert.equal(panelToggleRequests, 1);

  setMobileEditorOwner(fixture.win, "primary");
  assert.equal(overlay.hidden, true);
  binding.dispose();
});

test("replays vendored Gboard control bytes into Monaco without recursion", async () => {
  const { rebindVendoredCtrlHelper, clearVendoredCtrlHelper } =
    await importTypeScript(
      "monaco_editor/editor_mobile_ctrl_helper_utils.ts",
    );
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Gecko/144 Firefox/144 Mobile",
  );
  globalThis.window = fixture.win;
  globalThis.document = fixture.win.document;
  fixture.input.focus();

  await rebindVendoredCtrlHelper(fixture.editor, {});
  const intercepted = [];
  const delivered = [];
  fixture.win.term.attachCustomKeyEventHandler((event) => {
    intercepted.push(event.type);
    return false;
  });
  fixture.input.addEventListener("keydown", (event) => {
    delivered.push({
      type: event.type,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
    });
  });
  fixture.input.addEventListener("keyup", (event) => {
    delivered.push({
      type: event.type,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
    });
  });
  const ctrlStates = [];
  fixture.win.__androidTerminalSetCtrl = (active) => {
    ctrlStates.push(active);
  };

  fixture.win.term.input("\u0013");

  assert.deepEqual(intercepted, []);
  assert.deepEqual(delivered, [
    { type: "keydown", key: "s", code: "KeyS", ctrlKey: true },
    { type: "keyup", key: "s", code: "KeyS", ctrlKey: true },
  ]);
  assert.deepEqual(ctrlStates, [false]);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  clearVendoredCtrlHelper(fixture.editor);
  delete globalThis.window;
  delete globalThis.document;
});

test("converts Gboard find, undo, and copy keycode-229 input through the vendored helper", () => {
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Gecko/144 Firefox/144 Mobile",
  );
  const source = fs.readFileSync(
    path.join(
      appRoot,
      "vendor/android-terminalapp-assets-js/ctrl_key_handler.js",
    ),
    "utf8",
  );
  const controlBytes = [];
  let keyHandler = null;
  fixture.win.term = {
    textarea: fixture.input,
    attachCustomKeyEventHandler(handler) {
      keyHandler = handler;
    },
    input(value) {
      controlBytes.push(value);
      fixture.win.__androidTerminalSetCtrl(false);
    },
  };
  vm.runInNewContext(source, {
    window: fixture.win,
    CustomEvent: FakeCustomEvent,
    HTMLTextAreaElement: FakeElement,
  });
  assert.equal(typeof keyHandler, "function");

  for (const key of ["f", "z", "c"]) {
    fixture.input.value = key;
    fixture.input.selectionStart = 1;
    fixture.win.__androidTerminalSetCtrl(true);
    assert.equal(keyHandler({
      type: "keyup",
      keyCode: 229,
      target: fixture.input,
    }), false);
    assert.equal(fixture.win.ctrl, false);
  }

  assert.deepEqual(
    controlBytes.map((value) => value.charCodeAt(0)),
    [6, 26, 3],
  );

  fixture.win.__androidTerminalCtrlCleanup?.();
});

test("converts guarded Gboard beforeinput through xterm's source input hook exactly once", () => {
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Chrome/151 Mobile",
  );
  const source = fs.readFileSync(
    path.join(
      appRoot,
      "vendor/android-terminalapp-assets-js/ctrl_key_handler.js",
    ),
    "utf8",
  );
  const controlBytes = [];
  let keyHandler = null;
  let inputHandler = null;
  let inputDisposed = false;
  fixture.win.term = {
    textarea: fixture.input,
    attachCustomKeyEventHandler(handler) {
      keyHandler = handler;
    },
    attachCustomInputEventHandler(handler) {
      inputHandler = handler;
      return {
        dispose() {
          inputDisposed = true;
        },
      };
    },
    input(value) {
      controlBytes.push(value);
    },
  };
  vm.runInNewContext(source, {
    window: fixture.win,
    CustomEvent: FakeCustomEvent,
    HTMLTextAreaElement: FakeElement,
  });
  assert.equal(typeof keyHandler, "function");
  assert.equal(typeof inputHandler, "function");

  const cases = [
    ["f", "insertText"],
    ["z", "insertCompositionText"],
    ["c", "insertText"],
  ];
  for (const [key, inputType] of cases) {
    fixture.input.value = "\u21dd\n\n";
    fixture.input.selectionStart = 1;
    fixture.win.__androidTerminalSetCtrl(true);
    assert.equal(keyHandler({
      type: "keydown",
      key: "Unidentified",
      keyCode: 229,
      target: fixture.input,
    }), true);
    assert.equal(inputHandler({
      type: "beforeinput",
      data: key,
      inputType,
      target: fixture.input,
    }), false);
    assert.equal(inputHandler({
      type: "input",
      data: key,
      inputType,
      target: fixture.input,
    }), false);
    assert.equal(keyHandler({
      type: "keyup",
      key: "Unidentified",
      keyCode: 229,
      target: fixture.input,
    }), false);
    assert.equal(fixture.win.ctrl, false);
  }

  assert.deepEqual(
    controlBytes.map((value) => value.charCodeAt(0)),
    [6, 26, 3],
  );

  fixture.win.__androidTerminalSetCtrl(true);
  assert.equal(keyHandler({
    type: "keydown",
    key: "f",
    keyCode: 70,
    target: fixture.input,
  }), false);
  assert.equal(inputHandler({
    type: "beforeinput",
    data: "f",
    inputType: "insertText",
    target: fixture.input,
  }), true);
  assert.equal(keyHandler({
    type: "keyup",
    key: "f",
    keyCode: 70,
    target: fixture.input,
  }), false);
  assert.deepEqual(
    controlBytes.map((value) => value.charCodeAt(0)),
    [6, 26, 3, 6],
  );

  fixture.win.__androidTerminalCtrlCleanup?.();
  assert.equal(inputDisposed, true);
});

test("provides two-row navigation, persistent selection, and Ctrl lock", async () => {
  const { bindMobileEditorSpecialKeys } = await importTypeScript(
    "monaco_editor/editor_mobile_special_keys_utils.ts",
  );
  const {
    bindTerminalSpecialKeyTarget,
    publishTerminalSpecialKeyFocus,
  } = await importTypeScript(
    "src/mobile-input/terminal-special-key-bridge.ts",
  );
  const fixture = createEditorFixture(
    "Mozilla/5.0 (Linux; Android 16) Gecko/144 Firefox/144 Mobile",
  );
  const keyboardRecovery = fixture.win.document.createElement("button");
  keyboardRecovery.className = "te2-android-keyboard-recovery";
  fixture.host.append(keyboardRecovery);
  const keyEvents = [];
  const terminalKeyEvents = [];
  let contextRequests = 0;
  fixture.input.addEventListener("keydown", (event) => {
    keyEvents.push({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
    event.preventDefault();
  });
  fixture.editorDom.addEventListener(
    "monaco-touch-selection:open-menu",
    (event) => {
      contextRequests += 1;
      assert.equal(event.detail.touchMode, true);
    },
  );
  fixture.terminalInput.addEventListener("keydown", (event) => {
    terminalKeyEvents.push({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
    event.preventDefault();
  });
  fixture.input.focus();

  const disposeTerminalTarget = bindTerminalSpecialKeyTarget(
    fixture.win,
    () => fixture.terminalInput,
  );
  let saveRequests = 0;
  const binding = bindMobileEditorSpecialKeys(
    fixture.editor,
    fixture.win,
    () => {
      saveRequests += 1;
    },
  );
  assert.ok(binding);
  const trigger = fixture.editorContainer.querySelector(
    ".te2-mobile-special-key-trigger",
  );
  const saveTrigger = fixture.editorContainer.querySelector(
    ".te2-mobile-special-key-save-trigger",
  );
  const overlay = fixture.editorContainer.querySelector(
    ".te2-mobile-editor-overlay",
  );
  const panel = fixture.appRoot.querySelector(".te2-mobile-special-key-panel");
  const rows = panel.querySelectorAll(".te2-mobile-special-key-row");
  const ctrl = findButton(panel, "Control");
  const alt = findButton(panel, "Alt");
  const select = findButton(panel, "Toggle selection (Shift)");
  const left = findButton(panel, "Left");
  const tab = findButton(panel, "Tab");
  const home = findButton(panel, "Home");
  const end = findButton(panel, "End");
  const pageUp = findButton(panel, "Page up");
  const pageDown = findButton(panel, "Page down");
  const context = findButton(overlay, "Context menu");
  const hover = findButton(overlay, "Show hover");
  const cut = findButton(overlay, "Cut selection");
  const copy = findButton(overlay, "Copy selection");
  const paste = findButton(overlay, "Paste");

  assert.equal(panel.hidden, false);
  assert.equal(saveTrigger.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(panel.parentElement, fixture.appRoot);
  assert.equal(overlay.parentElement, fixture.editorContainer);
  assert.equal(
    overlay.classList.contains(
      "te2-mobile-editor-overlay-with-keyboard-recovery",
    ),
    true,
  );
  assert.equal(findButton(overlay, "Toggle selection (Shift)"), null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.length, 7);
  assert.equal(rows[1].children.length, 5);
  assert.equal(
    fixture.appRoot.classList.contains("te2-mobile-special-keys-open"),
    true,
  );
  assert.equal(fixture.win.document.activeElement, fixture.input);

  pointerDown(fixture.win, saveTrigger);
  assert.equal(saveRequests, 1);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  pointerDown(fixture.win, ctrl);
  pointerDown(fixture.win, alt);
  pointerDown(fixture.win, select);
  assert.equal(ctrl.classList.contains("toggle"), true);
  assert.equal(alt.classList.contains("toggle"), true);
  assert.equal(select.classList.contains("toggle"), true);

  pointerTap(fixture.win, left);
  assert.deepEqual(keyEvents.at(-1), {
    key: "ArrowLeft",
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(alt.classList.contains("toggle"), false);
  assert.equal(select.classList.contains("toggle"), true);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  pointerDown(fixture.win, ctrl);
  pointerDown(fixture.win, ctrl);
  assert.equal(ctrl.classList.contains("locked"), true);
  fixture.win.ctrl = false;
  fixture.win.dispatchEvent(new FakeCustomEvent(
    "android-terminalapp-ctrl-state",
    { detail: { active: false } },
  ));
  assert.equal(fixture.win.ctrl, true);
  assert.equal(ctrl.classList.contains("locked"), true);
  pointerTap(fixture.win, left);
  pointerTap(fixture.win, left);
  assert.equal(keyEvents.at(-1).ctrlKey, true);
  assert.equal(keyEvents.at(-1).shiftKey, true);
  assert.equal(ctrl.classList.contains("locked"), true);
  pointerDown(fixture.win, ctrl);
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(fixture.win.__te2MobileCtrlLocked, false);

  pointerDown(fixture.win, select);
  assert.equal(select.classList.contains("toggle"), false);
  for (const button of [tab, home, end, pageUp, pageDown]) {
    pointerDown(fixture.win, button);
  }
  assert.deepEqual(keyEvents.slice(-5).map((event) => event.key), [
    "Tab",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]);

  pointerDown(fixture.win, hover);
  pointerDown(fixture.win, cut);
  pointerDown(fixture.win, copy);
  pointerDown(fixture.win, paste);
  assert.deepEqual(fixture.actionRuns.slice(-4), [
    "editor.action.showHover",
    "editor.action.clipboardCutAction",
    "editor.action.clipboardCopyAction",
    "editor.action.clipboardPasteAction",
  ]);

  pointerDown(fixture.win, context);
  assert.equal(contextRequests, 1);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  fixture.terminalInput.focus();
  publishTerminalSpecialKeyFocus(fixture.win, true);
  pointerDown(fixture.win, select);
  pointerDown(fixture.win, ctrl);
  pointerDown(fixture.win, tab);
  assert.deepEqual(terminalKeyEvents.at(-1), {
    key: "Tab",
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
  });
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(select.classList.contains("toggle"), true);
  assert.equal(fixture.win.document.activeElement, fixture.terminalInput);

  fixture.input.focus();
  publishTerminalSpecialKeyFocus(fixture.win, false);

  pointerDown(fixture.win, trigger);
  assert.equal(panel.hidden, true);
  assert.equal(saveTrigger.hidden, true);
  assert.equal(
    fixture.appRoot.classList.contains("te2-mobile-special-keys-open"),
    false,
  );

  binding.dispose();
  disposeTerminalTarget();
  assert.equal(
    fixture.editorContainer.querySelector(".te2-mobile-special-key-trigger"),
    null,
  );
});
