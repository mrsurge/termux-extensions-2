import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

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

class FakeDocument {
  constructor() {
    this.activeElement = null;
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

function createEditorFixture(userAgent) {
  installDomGlobals();
  const win = new EventTarget();
  win.document = new FakeDocument();
  win.navigator = { userAgent };
  win.CustomEvent = FakeCustomEvent;

  const appRoot = win.document.createElement("div");
  appRoot.className = "fe-root layout-mobile";
  const terminalContainer = win.document.createElement("div");
  terminalContainer.id = "terminal-container";
  const terminalInput = win.document.createElement("textarea");
  terminalContainer.append(terminalInput);
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
  appRoot.append(host, terminalContainer);
  win.document.body.append(appRoot);

  return {
    win,
    appRoot,
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
    },
  };
}

function pointerDown(win, target) {
  target.dispatchEvent(new Event("pointerdown", {
    bubbles: true,
    cancelable: true,
  }));
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
  let ctrlReleased = false;
  fixture.win.__androidTerminalSetCtrl = (active) => {
    ctrlReleased = active === false;
  };

  fixture.win.term.input("\u0013");

  assert.deepEqual(intercepted, []);
  assert.deepEqual(delivered, [
    { type: "keydown", key: "s", code: "KeyS", ctrlKey: true },
    { type: "keyup", key: "s", code: "KeyS", ctrlKey: true },
  ]);
  assert.equal(ctrlReleased, true);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  clearVendoredCtrlHelper(fixture.editor);
  delete globalThis.window;
  delete globalThis.document;
});

test("keeps modifiers sticky until one dock key consumes them", async () => {
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
  const keyEvents = [];
  const terminalKeyEvents = [];
  let contextRequests = 0;
  fixture.input.addEventListener("keydown", (event) => {
    keyEvents.push({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
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
  const trigger = fixture.host.querySelector(
    ".te2-mobile-special-key-trigger",
  );
  const saveTrigger = fixture.host.querySelector(
    ".te2-mobile-special-key-save-trigger",
  );
  const panel = fixture.appRoot.querySelector(".te2-mobile-special-key-panel");
  const buttons = [...panel.querySelectorAll(".te2-mobile-special-key")];
  const [ctrl, alt, context, left] = buttons;

  pointerDown(fixture.win, trigger);
  assert.equal(panel.hidden, false);
  assert.equal(saveTrigger.hidden, false);
  assert.equal(panel.parentElement, fixture.appRoot);
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
  assert.equal(ctrl.classList.contains("toggle"), true);
  assert.equal(alt.classList.contains("toggle"), true);

  pointerDown(fixture.win, left);
  assert.deepEqual(keyEvents.at(-1), {
    key: "ArrowLeft",
    ctrlKey: true,
    altKey: true,
  });
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(alt.classList.contains("toggle"), false);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  pointerDown(fixture.win, context);
  assert.equal(contextRequests, 1);
  assert.equal(fixture.win.document.activeElement, fixture.input);

  pointerDown(fixture.win, ctrl);
  pointerDown(fixture.win, alt);
  fixture.terminalInput.focus();
  publishTerminalSpecialKeyFocus(fixture.win, true);
  assert.equal(context.textContent, "Tab");
  assert.equal(context.title, "Tab");
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(alt.classList.contains("toggle"), false);

  pointerDown(fixture.win, ctrl);
  pointerDown(fixture.win, left);
  assert.deepEqual(terminalKeyEvents.at(-1), {
    key: "ArrowLeft",
    ctrlKey: true,
    altKey: false,
  });
  assert.equal(ctrl.classList.contains("toggle"), false);
  assert.equal(fixture.win.document.activeElement, fixture.terminalInput);
  assert.equal(keyEvents.length, 1);

  pointerDown(fixture.win, context);
  assert.deepEqual(terminalKeyEvents.at(-1), {
    key: "Tab",
    ctrlKey: false,
    altKey: false,
  });
  assert.equal(fixture.win.document.activeElement, fixture.terminalInput);
  assert.equal(contextRequests, 1);

  fixture.input.focus();
  publishTerminalSpecialKeyFocus(fixture.win, false);
  assert.equal(context.textContent, "Ctx");
  assert.equal(context.title, "Context menu");
  pointerDown(fixture.win, context);
  assert.equal(contextRequests, 2);

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
    fixture.host.querySelector(".te2-mobile-special-key-trigger"),
    null,
  );
});
