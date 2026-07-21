# Native JavaScript Modal Implementation Plan

## Outcome

TE2 will expose one asynchronous dialog API to built-in apps. The same request
contract will render inline in normal browsers and Android wrappers, or in a
styled modal Electron child window when the desktop adapter is present.

```text
app controller
    -> teUI.dialog.open(request)
        -> inline presenter (browser and Android)
        -> Electron adapter -> preload IPC -> main process -> modal child window
    <- Promise<DialogResult>
```

Registered stateful surfaces use a second Electron path:

```text
existing app controller + live modal root
    -> teUI.dialog surface registry
        -> browser/Android: remain inline
        -> Electron: adopt into controlled same-origin blank child
    -> restore the same node to its placeholder on close
```

Electron keeps that blank child in the opener's renderer process. No DOM node,
callback, controller, or application state crosses IPC.

The existing framework shell already loads `app/static/js/te_ui.js` and
`app/static/js/file_picker.js` for every app. `te_ui.js` is therefore the common
frontend seam; individual apps should not acquire Electron-specific imports.

## Non-goals

- Relocating live DOM elements into another renderer process or sending them
  over IPC. Same-renderer document adoption into the controlled Electron child
  is the stateful-surface implementation.
- Overriding `window.alert`, `window.confirm`, or `window.prompt` globally.
- Sending callbacks, DOM nodes, arbitrary HTML, or executable source over IPC.
- Moving existing filesystem, Git, settings, or app-lifecycle authority into
  the modal layer.
- Floating ordinary menus, listboxes, drawers, toasts, or search overlays.
- Changing Android Kotlin source or publishing Android assets as part of the
  frontend cleanup without separate approval.

## Contract

The first implementation should define equivalent JavaScript/JSDoc and
TypeScript declarations for this versioned shape:

```ts
type DialogKind = "alert" | "confirm" | "prompt" | "form" | "surface";

interface DialogRequest {
  schemaVersion: 1;
  requestId?: string;
  kind: DialogKind;
  title: string;
  message?: string;
  detail?: string;
  severity?: "info" | "warning" | "error" | "danger";
  fields?: DialogField[];
  actions: DialogAction[];
  initialFocus?: string;
  defaultAction?: string;
  cancelAction?: string;
  width?: "small" | "medium" | "large";
  surface?: DialogSurfaceState;
}

interface DialogResult {
  status: "accepted" | "cancelled" | "closed" | "replaced";
  action: string | null;
  values: Record<string, unknown>;
}
```

The service should provide convenience wrappers:

```ts
await teUI.dialog.alert(message, options);
const accepted = await teUI.dialog.confirm(message, options);
const value = await teUI.dialog.prompt(message, initialValue, options);
const result = await teUI.dialog.open(contract);
```

`confirm` returns `Promise<boolean>`. `prompt` returns
`Promise<string | null>`. Callers must be converted to `await`; no compatibility
shim may pretend these remain synchronous.

### Field primitives

The portable field set should begin with the primitives already proven by Code
TE2's declarative modal code:

- text, password, textarea, number, checkbox;
- app-owned select/listbox;
- string list;
- JSON and JSON-with-CodeMirror enhancement;
- read-only text, code, list, and key/value rows;
- action groups and validation messages.

The contract must remain structured-clone-safe. Simple and newly declarative
dialogs use it directly. Existing rich surfaces use a stable surface identifier
for lifecycle ownership and the same-renderer DOM portal; they do not send a
render callback, DOM node, or controller through Electron IPC.

## Dialog lifecycle

The service owns these rules for every presenter:

1. Allocate a unique session and capture the previously focused element.
2. Normalize and validate the request before presentation.
3. Place nested requests on a dialog stack. Only the top request is interactive.
4. Resolve each request exactly once.
5. Restore focus when the stack becomes empty.
6. Cancel the stack when its app document navigates, its Electron app view is
   destroyed, or the desktop window closes.
7. Treat Escape, title-bar close, backdrop dismissal, and explicit Cancel as
   distinct inputs that normalize to a documented result.
8. Keep password values out of logs, diagnostics, persistence, and contract
   snapshots.

The inline presenter must provide a focus trap, `role="dialog"`,
`aria-modal="true"`, labelled title/description relationships, keyboard default
actions, scroll containment, and touch-sized controls. IME composition must not
be interrupted by Enter handling.

## Pass 1: native-dialog cleanup and JavaScript setup

### 1. Establish the shared service

- Split reusable modal styling and rendering from the current app-specific
  overlays, with one canonical source consumed by the app shell.
- Add `teUI.dialog` without changing the existing toast/notification API.
- Add request validation, session stacking, focus management, inline fallback,
  and deterministic close semantics.
- Add a presenter registration hook that Electron can supply later without
  exposing Electron objects to app code.
- Add unit coverage for normalization, resolution-once behavior, nesting,
  fallback, cancellation, validation, and focus restoration.

### 2. Remove blocking browser dialogs

- Convert every inventoried `alert`, `confirm`, and `prompt` call to the async
  wrappers.
- Propagate `async` only as far as necessary through event handlers and helper
  interfaces. Do not fire destructive operations before the promise resolves.
- Replace the shared file picker's New Folder prompt with a portable prompt
  contract while retaining the existing picker itself.
- Add an automated source gate that fails when a built-in source reintroduces
  direct blocking dialog calls.

### 3. Register existing custom modals

- Give every true modal a stable surface identifier and route its open/close
  lifecycle through the shared service.
- Simple modals should immediately move to portable contracts.
- Stateful modals retain their existing inline renderer and register the live
  root. Electron can portal that exact root without changing browser/Android
  behavior.
- Audit template-only modal markup. Remove it when source proves it orphaned;
  otherwise document its owner and fallback requirement.
- Keep non-modal drawers, menus, toasts, and search overlays outside the service.

### 4. Pass 1 completion gate

Pass 1 is complete only when:

- the direct blocking-dialog inventory is zero;
- every true custom modal is registered with a stable owner and lifecycle;
- browser behavior passes keyboard, pointer, touch, focus, and nested-dialog
  checks;
- Code TE2 typecheck/build and proportional tests for every touched app pass;
- Android wrapper behavior is validated without Android native-source changes;
- stateful surface families are explicitly identified for Pass 2.

## Pass 2: Electron presenter and child-window refactor

### 1. Minimal Electron bridge

- Add a dedicated app-view preload exposing only a dialog-open/cancel transport.
- Extend the Electron main process with dialog IPC that accepts requests only
  from the current framework `WebContentsView` and exact relay origin.
- Validate the contract again in the main process, enforce payload/field limits,
  and reject arbitrary HTML, URLs, or executable module names.
- Preserve the current context isolation and disabled renderer Node integration.
  The existing explicitly approved Linux `--no-sandbox` launch policy remains
  unchanged.

### 2. Modal child host

- Create a frameless Electron `BrowserWindow` with `parent: mainWindow` and
  `modal: true`.
- Use shared renderer/CSS source rather than a second visual implementation.
- Keep the window hidden until its local document and first contract are ready.
- Negotiate content size from the child, clamp it to the active display, and
  retain a scrollable body at the clamp.
- Implement title-bar close, Escape, Enter, focus restoration, theme tokens,
  scale/zoom, IME input, and screen-reader labels.
- Reuse one host window and render a modal stack inside it. Nested confirms stay
  above their parent session without opening an uncontrolled chain of OS
  windows.

This validated IPC host owns portable contract dialogs. Stateful registered
surfaces share one separate, strictly named `about:blank` child created through
Electron's `setWindowOpenHandler`. The main process denies other child
navigation and popups.

### 3. Route portable dialogs

- Route alert, confirmation, prompt, and simple form contracts through the
  Electron presenter.
- On adapter failure before presentation, log a bounded diagnostic and use the
  inline fallback. Once the child has shown a request, resolve failure as a
  close/cancel event instead of displaying a duplicate inline dialog.
- Closing or navigating the framework app view must close the modal child and
  settle every pending request.

### 4. Portal stateful modal families without rewriting them

For each registered stateful family:

1. Preserve the working root, controller closure, event listeners, and backend
   lane.
2. Adopt the root into the same-origin Electron child and leave an exact
   placeholder in the app document.
3. Use `ownerDocument` for dynamic DOM, menus, focus, timers, and realm checks
   that must follow the adopted root.
4. Notify embedded CM6 editors of document changes with `EditorView.setRoot()`
   and mirror their runtime token styles.
5. Keep nested portable dialogs inside the active stateful child and stack
   nested stateful roots in that one window.
6. Restore the same node on close, navigation, native child close, controller
   destruction, or app teardown.

The file/folder picker remains authoritative in its current page controller;
its live root and controller move together, so filesystem traffic does not gain
an extra protocol or renderer hop.

New reusable modal UI can use the dependency-free TSX/JSX DOM component layer.
Code TE2's declarative modal frame is the first consumer. Existing complex
controllers should migrate incrementally only when behavior remains intact.

### 5. Pass 2 completion gate

Pass 2 is complete only when:

- every non-emergency modal in the tracker floats in Electron;
- browser and Android continue using the same contract inline;
- nested, destructive, password, picker, and stateful modal cases pass;
- app navigation, Home, app-scoped Quit, target retargeting, and desktop close
  settle all pending sessions;
- Electron typecheck, tests, build, packaged Wayland smoke, and zero-renderer-
  diagnostic checks pass;
- the shared inline presenter remains available when the child host cannot be
  created.

## Validation strategy

### Automated

- Contract normalization and invalid-payload rejection.
- Single-resolution, stack, cancel, fallback, and teardown behavior.
- Inline renderer keyboard and focus behavior in a DOM test harness.
- Source scan prohibiting direct `alert`, `confirm`, and `prompt` in active
  built-in frontend source.
- Existing Code TE2 typecheck and build.
- Syntax/type/tests for every touched built-in app.
- Electron typecheck, unit tests, package build, and production dependency audit.

### Live matrix

| Surface | Required cases |
| --- | --- |
| Desktop browser | alert, confirm, prompt, nested confirm, rich form, picker |
| Android Chromium wrapper | touch, Gboard/IME, back/Escape equivalent, focus return |
| Android Gecko wrapper | touch, keyboard, select/listbox, scroll and focus return |
| Electron Wayland | child ownership, native focus, resize, theme, Copy/Paste, teardown |
| Electron fallback | forced child-open failure renders one inline dialog only |

## Delivery discipline

- Keep Pass 1 behavior as the baseline while enabling Electron routing.
- Land each migration slice with its tracker updates and proportional tests.
- Do not edit generated bundles as source.
- Check free disk space before Electron builds and stop below 3 GB.
- Do not publish Android bundled assets without separate approval.
