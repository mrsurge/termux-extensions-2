import { createSurfacePortalPresenter } from "./te_modal_surface_portal.mjs";

const SCHEMA_VERSION = 1;
const DIALOG_KINDS = new Set(["alert", "confirm", "prompt", "form", "surface"]);
const FIELD_KINDS = new Set([
  "text",
  "password",
  "textarea",
  "number",
  "checkbox",
  "select",
  "stringList",
  "json",
  "readonly",
]);
const RESULT_STATUSES = new Set(["accepted", "cancelled", "closed", "replaced"]);
const SURFACE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

let nextRequestNumber = 0;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clonePortable(value, label) {
  if (value === undefined) return undefined;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    throw new TypeError(`${label} must contain only portable data`);
  }
}

function stringValue(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function normalizeAction(action, index) {
  if (!isRecord(action)) throw new TypeError(`Dialog action ${index} must be an object`);
  const id = stringValue(action.id).trim();
  if (!id) throw new TypeError(`Dialog action ${index} requires an id`);
  return {
    id,
    label: stringValue(action.label, id),
    role: ["accept", "cancel", "close", "destructive"].includes(action.role)
      ? action.role
      : "accept",
    primary: Boolean(action.primary),
    validate: action.validate !== false,
  };
}

function normalizeField(field, index) {
  if (!isRecord(field)) throw new TypeError(`Dialog field ${index} must be an object`);
  const key = stringValue(field.key).trim();
  if (!key) throw new TypeError(`Dialog field ${index} requires a key`);
  const kind = stringValue(field.kind, "text");
  if (!FIELD_KINDS.has(kind)) throw new TypeError(`Unsupported dialog field kind: ${kind}`);
  const options = Array.isArray(field.options)
    ? field.options.map((option) => {
        if (isRecord(option)) {
          return {
            value: clonePortable(option.value, `Dialog field ${key} option`),
            label: stringValue(option.label, option.value == null ? "" : option.value),
          };
        }
        return { value: clonePortable(option, `Dialog field ${key} option`), label: stringValue(option) };
      })
    : [];
  return {
    key,
    kind,
    label: stringValue(field.label, key),
    description: stringValue(field.description),
    placeholder: stringValue(field.placeholder),
    required: Boolean(field.required),
    rows: Math.max(2, Math.min(24, Number(field.rows) || 4)),
    value: clonePortable(field.value ?? field.defaultValue, `Dialog field ${key}`),
    options,
  };
}

function defaultActions(kind, input = {}) {
  if (kind === "alert") {
    return [{
      id: "ok",
      label: stringValue(input.confirmLabel, "OK"),
      role: "accept",
      primary: true,
      validate: false,
    }];
  }
  return [
    {
      id: "cancel",
      label: stringValue(input.cancelLabel, "Cancel"),
      role: "cancel",
      primary: false,
      validate: false,
    },
    {
      id: "accept",
      label: stringValue(input.confirmLabel, "OK"),
      role: "accept",
      primary: true,
      validate: true,
    },
  ];
}

function defaultFields(kind, input) {
  if (kind !== "prompt") return [];
  return [{
    key: "value",
    kind: input.password ? "password" : "text",
    label: stringValue(input.label),
    description: "",
    placeholder: stringValue(input.placeholder),
    required: Boolean(input.required),
    rows: 4,
    value: stringValue(input.initialValue),
    options: [],
  }];
}

export function normalizeDialogRequest(input) {
  if (!isRecord(input)) throw new TypeError("Dialog request must be an object");
  if (input.schemaVersion != null && Number(input.schemaVersion) !== SCHEMA_VERSION) {
    throw new TypeError(`Unsupported dialog schema version: ${input.schemaVersion}`);
  }
  if (Object.prototype.hasOwnProperty.call(input, "html")) {
    throw new TypeError("Dialog requests must not contain raw HTML");
  }
  const kind = stringValue(input.kind, "alert");
  if (!DIALOG_KINDS.has(kind)) throw new TypeError(`Unsupported dialog kind: ${kind}`);
  const requestId = stringValue(input.requestId).trim() ||
    `te-dialog-${Date.now()}-${++nextRequestNumber}`;
  const fields = Array.isArray(input.fields)
    ? input.fields.map(normalizeField)
    : defaultFields(kind, input);
  const actions = (Array.isArray(input.actions) && input.actions.length
    ? input.actions.map(normalizeAction)
    : defaultActions(kind, input));
  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.id)) throw new TypeError(`Duplicate dialog action: ${action.id}`);
    actionIds.add(action.id);
  }
  const defaultAction = stringValue(input.defaultAction).trim() ||
    actions.find((action) => action.primary)?.id ||
    actions.find((action) => action.role === "accept")?.id ||
    actions[0]?.id || "";
  const cancelAction = stringValue(input.cancelAction).trim() ||
    actions.find((action) => action.role === "cancel" || action.role === "close")?.id ||
    "";
  if (defaultAction && !actionIds.has(defaultAction)) {
    throw new TypeError(`Unknown default dialog action: ${defaultAction}`);
  }
  if (cancelAction && !actionIds.has(cancelAction)) {
    throw new TypeError(`Unknown cancel dialog action: ${cancelAction}`);
  }
  const surface = clonePortable(input.surface, "Dialog surface");
  if (surface !== undefined && !isRecord(surface)) {
    throw new TypeError("Dialog surface must be an object");
  }
  if (surface?.id != null && !SURFACE_ID_PATTERN.test(stringValue(surface.id))) {
    throw new TypeError(`Invalid dialog surface id: ${surface.id}`);
  }
  if (kind === "surface" && !stringValue(surface?.id).trim()) {
    throw new TypeError("Surface dialogs require a stable surface.id");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId,
    kind,
    title: stringValue(
      input.title,
      kind === "alert" ? "Notice" : kind === "prompt" ? "Input" : "Confirm",
    ),
    message: stringValue(input.message),
    detail: stringValue(input.detail),
    severity: ["info", "warning", "error", "danger"].includes(input.severity)
      ? input.severity
      : "info",
    fields,
    actions,
    initialFocus: stringValue(input.initialFocus).trim(),
    defaultAction,
    cancelAction,
    width: ["small", "medium", "large"].includes(input.width) ? input.width : "small",
    dismissible: input.dismissible !== false,
    surface,
  };
}

export function normalizeDialogResult(request, input) {
  const result = isRecord(input) ? input : {};
  const status = RESULT_STATUSES.has(result.status) ? result.status : "closed";
  const action = result.action == null ? null : stringValue(result.action);
  if (action && !request.actions.some((item) => item.id === action)) {
    throw new TypeError(`Unknown dialog result action: ${action}`);
  }
  return {
    status,
    action,
    values: isRecord(result.values)
      ? clonePortable(result.values, "Dialog result values")
      : {},
  };
}

export function createSettlement(resolve) {
  let settled = false;
  return {
    get settled() { return settled; },
    settle(value) {
      if (settled) return false;
      settled = true;
      resolve(value);
      return true;
    },
  };
}

const INLINE_STYLE = `
.te-dialog-layer,.te-dialog-layer *,.te-dialog-layer *::before,.te-dialog-layer *::after{box-sizing:border-box}
.te-dialog-layer{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.58);backdrop-filter:blur(3px)}
.te-dialog-layer[aria-hidden="true"]{visibility:hidden;pointer-events:none}
.te-dialog-card{width:min(460px,94vw);max-height:min(86vh,900px);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border,#343b44);border-radius:2px;background:var(--card,#111820);color:var(--card-foreground,var(--foreground,#edf2f7));box-shadow:0 22px 58px rgba(0,0,0,.55);font:13px system-ui,sans-serif}
.te-dialog-card[data-width="medium"]{width:min(700px,94vw)}.te-dialog-card[data-width="large"]{width:min(940px,96vw)}
.te-dialog-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border,#343b44)}
.te-dialog-title{min-width:0;flex:1;font-size:1rem;font-weight:650}.te-dialog-close{width:32px;height:30px;border:0;border-radius:2px;background:transparent;color:inherit;font-size:18px;cursor:pointer}.te-dialog-close:hover{background:rgba(148,163,184,.14)}
.te-dialog-body{min-width:0;min-height:0;display:flex;flex:1 1 auto;flex-direction:column;gap:12px;padding:16px 18px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}.te-dialog-message,.te-dialog-detail{margin:0;white-space:pre-wrap;line-height:1.5}.te-dialog-detail{opacity:.78;font-size:.9em}
.te-dialog-card[data-severity="warning"]{border-color:var(--warning,#d97706)}.te-dialog-card[data-severity="error"],.te-dialog-card[data-severity="danger"]{border-color:var(--destructive,#b91c1c)}
.te-dialog-field{min-width:0;display:flex;flex-direction:column;gap:6px}.te-dialog-field-label{font-weight:600}.te-dialog-field-description{opacity:.74;font-size:.88em;line-height:1.4}
.te-dialog-input,.te-dialog-textarea,.te-dialog-select-button{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--border,#3b4652);border-radius:2px;background:var(--input,var(--secondary,#0e141b));color:inherit;font:inherit;line-height:1.35}.te-dialog-textarea{resize:vertical;overflow:auto}.te-dialog-input:focus,.te-dialog-textarea:focus,.te-dialog-select-button:focus{outline:2px solid var(--primary,#5b8dff);outline-offset:1px}
.te-dialog-checkbox-row{display:flex;align-items:center;gap:9px;min-height:38px}.te-dialog-checkbox-row input{width:18px;height:18px;accent-color:var(--primary,#5b8dff)}
.te-dialog-select{position:relative;min-width:0}.te-dialog-select-button{text-align:left;cursor:pointer}.te-dialog-select-menu{position:fixed;z-index:10001;max-height:220px;overflow:auto;padding:5px;border:1px solid var(--border,#3b4652);border-radius:2px;background:var(--card,#111820);color:var(--card-foreground,var(--foreground,#edf2f7));box-shadow:0 14px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif}.te-dialog-select-menu[hidden]{display:none}.te-dialog-select-option{display:block;width:100%;padding:8px 10px;border:0;border-radius:2px;background:transparent;color:inherit;text-align:left;cursor:pointer}.te-dialog-select-option:hover,.te-dialog-select-option[aria-selected="true"]{background:rgba(91,141,255,.18)}
.te-dialog-error{min-height:1.2em;color:var(--destructive,#ef4444);font-size:.88em}.te-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:11px 14px;border-top:1px solid var(--border,#343b44)}.te-dialog-action{min-height:36px;padding:7px 14px;border:1px solid var(--border,#3b4652);border-radius:2px;background:var(--secondary,#1b2530);color:inherit;font:inherit;cursor:pointer}.te-dialog-action:hover{filter:brightness(1.12)}.te-dialog-action[data-primary="true"]{border-color:var(--primary,#5b8dff);background:var(--primary,#5b8dff);color:var(--primary-foreground,#fff)}.te-dialog-action[data-role="destructive"]{border-color:var(--destructive,#b91c1c);background:var(--destructive,#b91c1c);color:#fff}
@media(max-width:560px){.te-dialog-layer{align-items:flex-end;padding:10px}.te-dialog-card,.te-dialog-card[data-width]{width:100%;max-height:88vh}.te-dialog-action{min-height:44px}.te-dialog-input,.te-dialog-textarea,.te-dialog-select-button{min-height:44px}}
`;

function sameValue(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return false; }
}

function formatFieldValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  }
  return String(value);
}

function focusableElements(root) {
  return Array.from(root.querySelectorAll(
    'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && !element.closest('[hidden]'));
}

function trapTabKey(root, event) {
  if (event.key !== "Tab") return false;
  const focusable = focusableElements(root);
  if (!focusable.length) {
    event.preventDefault();
    root.focus?.();
    return true;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  const active = root.ownerDocument.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export function isDeclaredSurfaceOpen(element, targetWindow = globalThis.window) {
  if (!element?.isConnected || element.hidden) return false;
  const ariaHidden = element.getAttribute?.("aria-hidden");
  if (ariaHidden === "true") return false;
  if (ariaHidden === "false") return true;
  if (element.classList?.contains("te-fp-hidden")) return false;
  if (element.style?.display === "none") return false;
  try {
    const elementWindow = element.ownerDocument?.defaultView || targetWindow;
    if (elementWindow?.getComputedStyle?.(element).display === "none") return false;
  } catch (_) {
    // A detached or synthetic test document may not expose computed style.
  }
  return true;
}

export function createSurfaceRegistry(targetWindow, options = {}) {
  const document = targetWindow?.document;
  if (!document) throw new Error("Dialog surface registry requires a document");
  const entries = new Map();
  const byElement = new WeakMap();
  const stack = [];

  function dialogElement(entry) {
    const existing = entry.element.matches?.('[role="dialog"]')
      ? entry.element
      : entry.element.querySelector?.('[role="dialog"]');
    if (existing) return existing;
    const fallback = entry.element.firstElementChild || entry.element;
    fallback.setAttribute?.("role", "dialog");
    fallback.setAttribute?.("aria-modal", "true");
    if (!fallback.hasAttribute?.("aria-label") && !fallback.hasAttribute?.("aria-labelledby")) {
      fallback.setAttribute?.("aria-label", entry.options.label || entry.id);
    }
    return fallback;
  }

  function activateTop() {
    stack.forEach((entry, index) => {
      entry.element.inert = index !== stack.length - 1;
    });
  }

  function opened(entry) {
    if (entry.open) return;
    entry.open = true;
    entry.previousFocus = document.activeElement;
    const existingIndex = stack.indexOf(entry);
    if (existingIndex >= 0) stack.splice(existingIndex, 1);
    stack.push(entry);
    entry.portaled = options.surfacePresenter?.open?.({
      id: entry.id,
      element: entry.element,
      options: entry.options,
      requestClose: () => requestClose(entry),
      onDetached: () => entry.unregister?.(),
    }) === true;
    const dialog = dialogElement(entry);
    dialog.setAttribute?.("aria-modal", "true");
    activateTop();
    const entryWindow = entry.element.ownerDocument?.defaultView || targetWindow;
    entryWindow.setTimeout?.(() => {
      const entryDocument = entry.element.ownerDocument || document;
      if (!entry.open || entry.element.contains(entryDocument.activeElement)) return;
      const focusTarget = focusableElements(dialog)[0] || dialog;
      if (!focusTarget.hasAttribute?.("tabindex") && focusTarget === dialog) {
        focusTarget.setAttribute?.("tabindex", "-1");
      }
      focusTarget.focus?.();
    }, 0);
    entry.element.dispatchEvent?.(new entryWindow.CustomEvent("te-dialog-surface-opened", {
      detail: { id: entry.id },
    }));
  }

  function closed(entry) {
    if (!entry.open) return;
    entry.open = false;
    entry.element.inert = false;
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    if (entry.portaled) options.surfacePresenter?.close?.(entry);
    entry.portaled = false;
    activateTop();
    const restore = entry.previousFocus;
    entry.previousFocus = null;
    if (restore?.isConnected) targetWindow.setTimeout?.(() => restore.focus?.(), 0);
    entry.element.dispatchEvent?.(new targetWindow.CustomEvent("te-dialog-surface-closed", {
      detail: { id: entry.id },
    }));
  }

  function sync(entry) {
    if (isDeclaredSurfaceOpen(entry.element, targetWindow)) opened(entry);
    else closed(entry);
  }

  function requestClose(entry) {
    if (typeof entry.options.requestClose === "function") {
      entry.options.requestClose();
      return true;
    }
    const closeButton = entry.element.querySelector?.(
      '[data-te-dialog-close],[data-action$="close"],[data-action$="cancel"],[id$="-close"],[id$="-cancel"],.te-fp-close,button[aria-label^="Close"]',
    );
    if (closeButton && typeof closeButton.click === "function") {
      closeButton.click();
      return true;
    }
    const closeEvent = new targetWindow.CustomEvent("te-dialog-request-close", {
      bubbles: true,
      cancelable: true,
      detail: { id: entry.id },
    });
    return entry.element.dispatchEvent?.(closeEvent) === false;
  }

  function register(id, element, options = {}) {
    const surfaceId = stringValue(id).trim();
    if (!surfaceId || !SURFACE_ID_PATTERN.test(surfaceId)) {
      throw new TypeError(`Invalid dialog surface id: ${surfaceId || "<empty>"}`);
    }
    if (!element || typeof element.addEventListener !== "function") {
      throw new TypeError(`Dialog surface ${surfaceId} requires an element`);
    }
    const priorForElement = byElement.get(element);
    if (priorForElement) return priorForElement.unregister;
    const prior = entries.get(surfaceId);
    if (prior && !prior.element.isConnected) prior.unregister();
    else if (prior) throw new Error(`Dialog surface already registered: ${surfaceId}`);

    element.dataset.teDialogSurface = surfaceId;
    const entry = {
      id: surfaceId,
      element,
      options,
      open: false,
      previousFocus: null,
      observer: null,
      portaled: false,
      unregister: null,
    };
    const onKeyDown = (event) => {
      if (!entry.open || stack.at(-1) !== entry) return;
      const dialog = dialogElement(entry);
      if (trapTabKey(dialog, event)) return;
      if (event.key === "Escape" && options.closeOnEscape !== false) {
        if (requestClose(entry)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    element.addEventListener("keydown", onKeyDown, true);
    const Observer = targetWindow.MutationObserver;
    if (Observer) {
      entry.observer = new Observer(() => sync(entry));
      entry.observer.observe(element, {
        attributes: true,
        attributeFilter: ["aria-hidden", "class", "hidden", "style"],
      });
    }
    entry.unregister = () => {
      closed(entry);
      entry.observer?.disconnect();
      element.removeEventListener("keydown", onKeyDown, true);
      entries.delete(surfaceId);
      byElement.delete(element);
    };
    entries.set(surfaceId, entry);
    byElement.set(element, entry);
    sync(entry);
    return entry.unregister;
  }

  function scan(root = document) {
    if (root.matches?.("[data-te-dialog-surface]")) {
      register(root.dataset.teDialogSurface, root);
    }
    for (const element of root.querySelectorAll?.("[data-te-dialog-surface]") || []) {
      register(element.dataset.teDialogSurface, element);
    }
  }

  const Observer = targetWindow.MutationObserver;
  const documentObserver = Observer ? new Observer((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) scan(node);
      }
    }
    for (const entry of [...entries.values()]) {
      if (!entry.element.isConnected) entry.unregister();
    }
  }) : null;
  const start = () => {
    scan(document);
    if (documentObserver && document.documentElement) {
      documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  return {
    register,
    scan,
    closeAll() {
      for (const entry of [...stack].reverse()) closed(entry);
    },
    destroy() {
      documentObserver?.disconnect();
      for (const entry of [...entries.values()]) entry.unregister();
    },
    get size() { return entries.size; },
    get openIds() { return stack.map((entry) => entry.id); },
    get(id) { return entries.get(id) || null; },
  };
}

function positionSelectPopup(button, menu) {
  const targetWindow = button.ownerDocument.defaultView || globalThis;
  const viewport = targetWindow.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || targetWindow.innerWidth || 0;
  const viewportHeight = viewport?.height || targetWindow.innerHeight || 0;
  const edge = 8;
  const gap = 4;
  const maxPopupHeight = 220;
  const rect = button.getBoundingClientRect();
  const leftEdge = viewportLeft + edge;
  const rightEdge = viewportLeft + viewportWidth - edge;
  const topEdge = viewportTop + edge;
  const bottomEdge = viewportTop + viewportHeight - edge;
  const width = Math.max(0, Math.min(rect.width, rightEdge - leftEdge));
  const left = Math.max(leftEdge, Math.min(rect.left, rightEdge - width));

  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${maxPopupHeight}px`;

  const naturalHeight = Math.min(
    maxPopupHeight,
    Math.max(menu.scrollHeight, menu.getBoundingClientRect().height),
  );
  const roomBelow = Math.max(0, bottomEdge - rect.bottom - gap);
  const roomAbove = Math.max(0, rect.top - topEdge - gap);
  const opensAbove = naturalHeight > roomBelow && roomAbove > roomBelow;
  const availableHeight = opensAbove ? roomAbove : roomBelow;
  const popupHeight = Math.max(48, Math.min(maxPopupHeight, availableHeight));
  menu.style.maxHeight = `${popupHeight}px`;

  const renderedHeight = Math.min(
    popupHeight,
    Math.max(menu.scrollHeight, menu.getBoundingClientRect().height),
  );
  const top = opensAbove
    ? Math.max(topEdge, rect.top - gap - renderedHeight)
    : Math.min(rect.bottom + gap, bottomEdge - renderedHeight);
  menu.style.top = `${Math.max(topEdge, top)}px`;
}

function createFieldControl(document, field, popupHost) {
  const wrapper = document.createElement("div");
  wrapper.className = "te-dialog-field";
  let focusElement = null;
  let getValue = () => field.value;
  let destroy = () => {};

  if (field.kind === "checkbox") {
    const label = document.createElement("label");
    label.className = "te-dialog-checkbox-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.value);
    input.dataset.dialogField = field.key;
    const text = document.createElement("span");
    text.textContent = field.label;
    label.append(input, text);
    wrapper.appendChild(label);
    focusElement = input;
    getValue = () => input.checked;
  } else {
    if (field.label) {
      const label = document.createElement("label");
      label.className = "te-dialog-field-label";
      label.textContent = field.label;
      wrapper.appendChild(label);
    }
    if (field.description) {
      const description = document.createElement("div");
      description.className = "te-dialog-field-description";
      description.textContent = field.description;
      wrapper.appendChild(description);
    }

    if (field.kind === "textarea" || field.kind === "stringList" || field.kind === "json") {
      const textarea = document.createElement("textarea");
      textarea.className = "te-dialog-textarea";
      textarea.rows = field.rows;
      textarea.placeholder = field.placeholder;
      textarea.value = field.kind === "stringList" && Array.isArray(field.value)
        ? field.value.join("\n")
        : formatFieldValue(field.value);
      textarea.dataset.dialogField = field.key;
      wrapper.appendChild(textarea);
      focusElement = textarea;
      getValue = () => {
        if (field.kind === "stringList") {
          return textarea.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        }
        if (field.kind === "json") {
          const raw = textarea.value.trim();
          return raw ? JSON.parse(raw) : null;
        }
        return textarea.value;
      };
    } else if (field.kind === "select") {
      const targetWindow = document.defaultView || globalThis;
      const root = document.createElement("div");
      root.className = "te-dialog-select";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "te-dialog-select-button";
      button.dataset.dialogField = field.key;
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.className = "te-dialog-select-menu";
      menu.setAttribute("role", "listbox");
      menu.hidden = true;
      let popupOpen = false;
      let selected = field.value ?? field.options[0]?.value;
      const update = () => {
        const option = field.options.find((item) => sameValue(item.value, selected));
        button.textContent = option?.label || "";
      };
      const close = () => {
        if (!popupOpen) return;
        popupOpen = false;
        menu.hidden = true;
        menu.remove();
        button.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", closeOnPointerDown, true);
        document.removeEventListener("keydown", closeOnKeyDown, true);
        targetWindow.removeEventListener?.("resize", closeOnViewportChange, true);
        targetWindow.removeEventListener?.("scroll", closeOnScroll, true);
        targetWindow.visualViewport?.removeEventListener?.("resize", closeOnViewportChange);
        targetWindow.visualViewport?.removeEventListener?.("scroll", closeOnViewportChange);
      };
      const closeOnPointerDown = (event) => {
        const target = event.target;
        if (
          target instanceof targetWindow.Node
          && (root.contains(target) || menu.contains(target))
        ) return;
        close();
      };
      const closeOnKeyDown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
        button.focus();
      };
      const closeOnViewportChange = () => close();
      const closeOnScroll = (event) => {
        if (event.target === menu || menu.contains(event.target)) return;
        close();
      };
      const open = () => {
        if (popupOpen || !field.options.length) return;
        popupOpen = true;
        menu.hidden = false;
        menu.style.visibility = "hidden";
        popupHost.appendChild(menu);
        positionSelectPopup(button, menu);
        menu.style.visibility = "";
        button.setAttribute("aria-expanded", "true");
        document.addEventListener("pointerdown", closeOnPointerDown, true);
        document.addEventListener("keydown", closeOnKeyDown, true);
        targetWindow.addEventListener?.("resize", closeOnViewportChange, true);
        targetWindow.addEventListener?.("scroll", closeOnScroll, true);
        targetWindow.visualViewport?.addEventListener?.("resize", closeOnViewportChange);
        targetWindow.visualViewport?.addEventListener?.("scroll", closeOnViewportChange);
      };
      for (const item of field.options) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "te-dialog-select-option";
        option.setAttribute("role", "option");
        option.textContent = item.label;
        option.addEventListener("click", () => {
          selected = item.value;
          for (const child of menu.children) child.setAttribute("aria-selected", "false");
          option.setAttribute("aria-selected", "true");
          update();
          close();
          button.focus();
        });
        option.setAttribute("aria-selected", sameValue(item.value, selected) ? "true" : "false");
        menu.appendChild(option);
      }
      button.addEventListener("click", () => {
        if (popupOpen) close();
        else open();
      });
      root.appendChild(button);
      wrapper.appendChild(root);
      focusElement = button;
      getValue = () => clonePortable(selected, `Dialog field ${field.key}`);
      destroy = close;
      update();
    } else if (field.kind === "readonly") {
      const value = document.createElement("div");
      value.className = "te-dialog-detail";
      value.textContent = formatFieldValue(field.value);
      wrapper.appendChild(value);
      getValue = () => field.value;
    } else {
      const input = document.createElement("input");
      input.className = "te-dialog-input";
      input.type = field.kind === "password" ? "password" : field.kind === "number" ? "number" : "text";
      input.placeholder = field.placeholder;
      input.value = formatFieldValue(field.value);
      input.dataset.dialogField = field.key;
      wrapper.appendChild(input);
      focusElement = input;
      getValue = () => field.kind === "number"
        ? (input.value === "" ? null : Number(input.value))
        : input.value;
    }
  }
  return { wrapper, focusElement, getValue, destroy };
}

export function createInlineDialogPresenter(targetWindow) {
  const document = targetWindow?.document;
  if (!document) throw new Error("Inline dialog presenter requires a document");
  const stack = [];

  function ensureStyle() {
    if (document.getElementById("te-dialog-style")) return;
    const style = document.createElement("style");
    style.id = "te-dialog-style";
    style.textContent = INLINE_STYLE;
    (document.head || document.documentElement).appendChild(style);
  }

  function activateTop() {
    stack.forEach((entry, index) => {
      const active = index === stack.length - 1;
      entry.layer.setAttribute("aria-hidden", active ? "false" : "true");
      entry.layer.inert = !active;
    });
    const top = stack.at(-1);
    if (top) targetWindow.setTimeout(() => top.focusTarget?.focus(), 0);
  }

  function open(request) {
    ensureStyle();
    const previousFocus = document.activeElement instanceof targetWindow.HTMLElement
      ? document.activeElement
      : null;
    return new Promise((resolve) => {
      const settlement = createSettlement(resolve);
      const layer = document.createElement("div");
      layer.className = "te-dialog-layer";
      layer.setAttribute("role", "presentation");
      const card = document.createElement("section");
      card.className = "te-dialog-card";
      card.dataset.width = request.width;
      card.dataset.severity = request.severity;
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");

      const header = document.createElement("header");
      header.className = "te-dialog-header";
      const title = document.createElement("div");
      title.className = "te-dialog-title";
      title.id = `${request.requestId}-title`;
      title.textContent = request.title;
      card.setAttribute("aria-labelledby", title.id);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "te-dialog-close";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.hidden = !request.dismissible;
      header.append(title, close);

      const body = document.createElement("div");
      body.className = "te-dialog-body";
      if (request.message) {
        const message = document.createElement("p");
        message.className = "te-dialog-message";
        message.id = `${request.requestId}-message`;
        message.textContent = request.message;
        card.setAttribute("aria-describedby", message.id);
        body.appendChild(message);
      }
      if (request.detail) {
        const detail = document.createElement("p");
        detail.className = "te-dialog-detail";
        detail.textContent = request.detail;
        body.appendChild(detail);
      }

      const controls = new Map();
      for (const field of request.fields) {
        const control = createFieldControl(document, field, layer);
        controls.set(field.key, { field, ...control });
        body.appendChild(control.wrapper);
      }
      const error = document.createElement("div");
      error.className = "te-dialog-error";
      error.setAttribute("role", "alert");
      body.appendChild(error);

      const footer = document.createElement("footer");
      footer.className = "te-dialog-actions";
      const actionButtons = new Map();
      const entry = { layer, focusTarget: null, previousFocus, settlement, controls };

      const remove = (result) => {
        if (!settlement.settle(normalizeDialogResult(request, result))) return;
        for (const control of controls.values()) control.destroy();
        const index = stack.indexOf(entry);
        if (index >= 0) stack.splice(index, 1);
        layer.remove();
        activateTop();
        if (!stack.length && previousFocus?.isConnected) {
          targetWindow.setTimeout(() => previousFocus.focus(), 0);
        }
      };

      const collectValues = () => {
        const values = {};
        for (const [key, control] of controls) values[key] = control.getValue();
        return values;
      };
      const runAction = (action) => {
        let values = {};
        try {
          values = collectValues();
          if (action.validate) {
            for (const [key, control] of controls) {
              const value = values[key];
              if (control.field.required && (value == null || value === "" || (Array.isArray(value) && !value.length))) {
                throw new Error(`${control.field.label || key} is required`);
              }
            }
          }
          error.textContent = "";
        } catch (validationError) {
          error.textContent = validationError instanceof Error
            ? validationError.message
            : String(validationError);
          return;
        }
        const status = action.role === "cancel"
          ? "cancelled"
          : action.role === "close"
            ? "closed"
            : "accepted";
        remove({ status, action: action.id, values });
      };

      for (const action of request.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "te-dialog-action";
        button.dataset.role = action.role;
        button.dataset.primary = action.primary ? "true" : "false";
        button.textContent = action.label;
        button.addEventListener("click", () => runAction(action));
        footer.appendChild(button);
        actionButtons.set(action.id, button);
      }
      const cancel = () => {
        const action = request.actions.find((item) => item.id === request.cancelAction);
        if (action) runAction(action);
        else remove({ status: "closed", action: null, values: {} });
      };
      close.addEventListener("click", cancel);
      layer.addEventListener("pointerdown", (event) => {
        if (request.dismissible && event.target === layer) cancel();
      });
      layer.addEventListener("keydown", (event) => {
        if (trapTabKey(card, event)) return;
        if (event.key === "Escape" && request.dismissible) {
          event.preventDefault();
          cancel();
          return;
        }
        if (event.key !== "Enter" || event.isComposing) return;
        const target = event.target;
        if (target instanceof targetWindow.HTMLTextAreaElement || target instanceof targetWindow.HTMLButtonElement) return;
        const action = request.actions.find((item) => item.id === request.defaultAction);
        if (action) {
          event.preventDefault();
          runAction(action);
        }
      });
      card.append(header, body, footer);
      layer.appendChild(card);
      document.body.appendChild(layer);

      entry.focusTarget = request.initialFocus
        ? controls.get(request.initialFocus)?.focusElement || actionButtons.get(request.initialFocus)
        : controls.values().next().value?.focusElement || actionButtons.get(request.defaultAction) || close;
      stack.push(entry);
      activateTop();
    });
  }

  function closeAll(status = "closed") {
    const restore = stack[0]?.previousFocus;
    for (const entry of [...stack].reverse()) {
      entry.settlement.settle({ status, action: null, values: {} });
      for (const control of entry.controls.values()) control.destroy();
      entry.layer.remove();
    }
    stack.length = 0;
    if (restore?.isConnected) targetWindow.setTimeout(() => restore.focus(), 0);
  }

  targetWindow.addEventListener?.("pagehide", () => closeAll("closed"));
  return { open, closeAll, get size() { return stack.length; } };
}

export function createDialogService(targetWindow, options = {}) {
  const inlinePresenter = options.inlinePresenter || createInlineDialogPresenter(targetWindow);
  const surfacePresenter = options.surfacePresenter || createSurfacePortalPresenter(
    targetWindow,
    { createInlinePresenter: createInlineDialogPresenter },
  );
  const surfaceRegistry = options.surfaceRegistry || (
    targetWindow?.document
      ? createSurfaceRegistry(targetWindow, { surfacePresenter })
      : null
  );
  let registeredPresenter = null;

  const externalPresenter = () => registeredPresenter || targetWindow?.te2DesktopDialogs || null;

  targetWindow?.addEventListener?.("pagehide", () => {
    externalPresenter()?.closeAll?.("closed");
    surfacePresenter?.closeAll?.();
    surfaceRegistry?.closeAll();
  });

  async function open(input) {
    const request = normalizeDialogRequest(input);
    const presenter = surfacePresenter?.dialogPresenter || externalPresenter();
    if (presenter && typeof presenter.open === "function") {
      try {
        return normalizeDialogResult(request, await presenter.open(request));
      } catch (error) {
        targetWindow?.console?.warn?.("[teUI.dialog] external presenter failed; using inline fallback", error);
      }
    }
    return normalizeDialogResult(request, await inlinePresenter.open(request));
  }

  return {
    open,
    async alert(message, options = {}) {
      await open({ ...options, kind: "alert", message });
    },
    async confirm(message, options = {}) {
      const result = await open({ ...options, kind: "confirm", message });
      return result.status === "accepted";
    },
    async prompt(message, initialValue = "", options = {}) {
      const result = await open({ ...options, kind: "prompt", message, initialValue });
      return result.status === "accepted" ? stringValue(result.values.value) : null;
    },
    registerPresenter(presenter) {
      if (!presenter || typeof presenter.open !== "function") {
        throw new TypeError("Dialog presenter requires an open(request) method");
      }
      registeredPresenter = presenter;
      return () => {
        if (registeredPresenter === presenter) registeredPresenter = null;
      };
    },
    registerSurface(id, element, surfaceOptions = {}) {
      if (!surfaceRegistry) throw new Error("Dialog surface registry is unavailable");
      return surfaceRegistry.register(id, element, surfaceOptions);
    },
    scanSurfaces(root) {
      surfaceRegistry?.scan(root);
    },
    closeAll(status = "closed") {
      externalPresenter()?.closeAll?.(status);
      inlinePresenter.closeAll?.(status);
      surfacePresenter?.closeAll?.();
      surfaceRegistry?.closeAll();
    },
    get inlinePresenter() { return inlinePresenter; },
    get surfaceRegistry() { return surfaceRegistry; },
    get surfacePresenter() { return surfacePresenter; },
  };
}

export function installTeDialog(targetWindow = globalThis.window) {
  if (!targetWindow) throw new Error("Dialog installation requires a window");
  if (!targetWindow.teUI) targetWindow.teUI = {};
  if (!targetWindow.teUI.dialog) {
    targetWindow.teUI.dialog = createDialogService(targetWindow);
  }
  return targetWindow.teUI.dialog;
}
