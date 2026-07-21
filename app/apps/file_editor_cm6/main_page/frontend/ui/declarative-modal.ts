import {
  createJsonTextmateField,
  type JsonTextmateFieldHandle,
} from "./cm6-json-textmate-field.ts";
import { createModalFrame } from "./modal-kit/modal-frame.tsx";

export type DeclarativeFieldKind =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "number"
  | "json"
  | "jsonTextmate"
  | "stringList";

export interface DeclarativeFieldOption {
  value: unknown;
  label?: string;
}

export interface DeclarativeFieldVisibility {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
}

export interface DeclarativeFieldContract {
  key: string;
  label: string;
  kind: DeclarativeFieldKind;
  description?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  options?: DeclarativeFieldOption[];
  defaultValue?: unknown;
  visibleWhen?: DeclarativeFieldVisibility;
}

export interface DeclarativeFormContract {
  fields: DeclarativeFieldContract[];
}

export interface DeclarativeModalContract extends DeclarativeFormContract {
  id: string;
  surfaceId?: string;
  title: string;
  width?: string;
  maxHeight?: string;
  ownerDocument?: Document;
}

export interface DeclarativeFormHandle {
  getValues: () => Record<string, unknown>;
  setValues: (values: Record<string, unknown>) => void;
  destroy: () => void;
}

export interface DeclarativeModalShell {
  root: HTMLElement;
  bodyEl: HTMLElement;
  footerEl: HTMLElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
}

interface FieldControlHandle {
  element: HTMLElement;
  destroy?: () => void;
}

interface SelectPopupState {
  menu: HTMLElement;
  cleanup: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValues(values: Record<string, unknown>): Record<string, unknown> {
  return { ...values };
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return String(left) === String(right);
  }
}

function lineListToValue(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function valueToLineList(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? ""))
      .filter((item) => item.trim())
      .join("\n");
  }
  if (typeof value === "string") return value;
  return "";
}

function fieldValue(
  field: DeclarativeFieldContract,
  values: Record<string, unknown>,
): unknown {
  return Object.prototype.hasOwnProperty.call(values, field.key)
    ? values[field.key]
    : field.defaultValue;
}

function matchesVisibility(
  rule: DeclarativeFieldVisibility | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!rule) return true;
  const current = values[rule.field];
  if (
    Object.prototype.hasOwnProperty.call(rule, "equals") &&
    !sameValue(current, rule.equals)
  )
    return false;
  if (
    Object.prototype.hasOwnProperty.call(rule, "notEquals") &&
    sameValue(current, rule.notEquals)
  )
    return false;
  if (
    Array.isArray(rule.in) &&
    !rule.in.some((item) => sameValue(item, current))
  )
    return false;
  return true;
}

function applyInvalidState(el: HTMLElement, invalid: boolean): void {
  el.classList.toggle("declarative-field-invalid", invalid);
}

function selectedOptionLabel(
  options: DeclarativeFieldOption[],
  value: unknown,
): string {
  const selected = options.find((item) => sameValue(item.value, value));
  const item = selected || options[0];
  return item ? item.label || formatValue(item.value) : "";
}

function positionSelectMenu(button: HTMLElement, menu: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  const targetWindow = button.ownerDocument.defaultView || window;
  menu.style.minWidth = `${rect.width}px`;
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.maxHeight = `${Math.max(160, targetWindow.innerHeight - rect.bottom - 16)}px`;
}

function createSelectControl(
  field: DeclarativeFieldContract,
  current: unknown,
  onValue: (key: string, value: unknown) => void,
  document: Document,
): FieldControlHandle {
  const targetWindow = document.defaultView || window;
  const root = document.createElement("div");
  root.className = "declarative-select";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "declarative-input declarative-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  root.appendChild(button);

  const options = Array.isArray(field.options) ? field.options : [];
  let selectedValue = current;
  let popup: SelectPopupState | null = null;

  function updateButton(): void {
    button.textContent = selectedOptionLabel(options, selectedValue);
  }

  function closeMenu(): void {
    if (!popup) return;
    popup.cleanup();
    popup.menu.remove();
    popup = null;
    button.setAttribute("aria-expanded", "false");
  }

  function openMenu(): void {
    if (popup || !options.length) return;
    const menu = document.createElement("div");
    menu.className = "declarative-select-menu";
    menu.setAttribute("role", "listbox");

    options.forEach((item, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "declarative-select-option";
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        sameValue(item.value, selectedValue) ? "true" : "false",
      );
      option.textContent = item.label || formatValue(item.value);
      option.addEventListener("click", () => {
        selectedValue = item.value;
        updateButton();
        closeMenu();
        onValue(field.key, item.value);
      });
      menu.appendChild(option);
      if (sameValue(item.value, selectedValue)) {
        targetWindow.setTimeout(() => option.focus(), 0);
      } else if (index === 0 && selectedValue == null) {
        targetWindow.setTimeout(() => option.focus(), 0);
      }
    });

    positionSelectMenu(button, menu);
    document.body.appendChild(menu);
    button.setAttribute("aria-expanded", "true");

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof targetWindow.Node &&
        (root.contains(target) || menu.contains(target))
      ) {
        return;
      }
      closeMenu();
    };
    const closeOnWindowChange = () => closeMenu();
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        button.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown, true);
    targetWindow.addEventListener("resize", closeOnWindowChange, true);
    targetWindow.addEventListener("scroll", closeOnWindowChange, true);

    popup = {
      menu,
      cleanup: () => {
        document.removeEventListener("pointerdown", closeOnPointerDown, true);
        document.removeEventListener("keydown", closeOnKeyDown, true);
        targetWindow.removeEventListener("resize", closeOnWindowChange, true);
        targetWindow.removeEventListener("scroll", closeOnWindowChange, true);
      },
    };
  }

  button.addEventListener("click", () => {
    if (popup) closeMenu();
    else openMenu();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    }
  });
  updateButton();

  return {
    element: root,
    destroy: closeMenu,
  };
}

function createFieldLabel(
  field: DeclarativeFieldContract,
  document: Document,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "declarative-field-label";
  label.textContent = field.required ? `${field.label} *` : field.label;
  return label;
}

function createFieldDescription(
  field: DeclarativeFieldContract,
  document: Document,
): HTMLElement | null {
  if (!field.description) return null;
  const desc = document.createElement("div");
  desc.className = "declarative-field-description";
  desc.textContent = field.description;
  return desc;
}

function createFieldControl(
  field: DeclarativeFieldContract,
  values: Record<string, unknown>,
  onValue: (key: string, value: unknown) => void,
  document: Document,
): FieldControlHandle {
  const current = fieldValue(field, values);

  if (field.kind === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(current);
    input.addEventListener("change", () => onValue(field.key, input.checked));
    return { element: input };
  }

  if (field.kind === "select") {
    return createSelectControl(field, current, onValue, document);
  }

  if (field.kind === "jsonTextmate") {
    let control: JsonTextmateFieldHandle | null = null;
    control = createJsonTextmateField({
      value: formatValue(current),
      rows: field.rows || 8,
      placeholder: field.placeholder || "",
      className: "declarative-json-textmate",
      validateJson: true,
      onJsonChange(value) {
        onValue(field.key, value);
      },
      onValidityChange(valid) {
        if (control) applyInvalidState(control.element, !valid);
      },
    });
    return {
      element: control.element,
      destroy: () => control?.destroy(),
    };
  }

  if (
    field.kind === "textarea" ||
    field.kind === "json" ||
    field.kind === "stringList"
  ) {
    const textarea = document.createElement("textarea");
    textarea.className = "declarative-input declarative-textarea";
    textarea.rows = field.rows || (field.kind === "json" ? 8 : 4);
    textarea.spellcheck = false;
    textarea.placeholder = field.placeholder || "";
    textarea.value =
      field.kind === "stringList"
        ? valueToLineList(current)
        : field.kind === "json"
          ? formatValue(current)
          : String(current ?? "");
    if (field.kind === "json") {
      textarea.classList.add("declarative-monospace");
      textarea.addEventListener("input", () => {
        const raw = textarea.value.trim();
        if (!raw) {
          applyInvalidState(textarea, false);
          onValue(field.key, null);
          return;
        }
        try {
          const parsed = JSON.parse(raw) as unknown;
          applyInvalidState(textarea, false);
          onValue(field.key, parsed);
        } catch (_) {
          applyInvalidState(textarea, true);
        }
      });
    } else if (field.kind === "stringList") {
      textarea.addEventListener("input", () =>
        onValue(field.key, lineListToValue(textarea.value)),
      );
    } else {
      textarea.addEventListener("input", () =>
        onValue(field.key, textarea.value),
      );
    }
    return { element: textarea };
  }

  const input = document.createElement("input");
  input.className = "declarative-input";
  input.type = field.kind === "number" ? "number" : "text";
  input.placeholder = field.placeholder || "";
  input.value = current == null ? "" : String(current);
  input.addEventListener("input", () => {
    if (field.kind === "number") {
      onValue(field.key, input.value === "" ? null : Number(input.value));
      return;
    }
    onValue(field.key, input.value);
  });
  return { element: input };
}

export function createDeclarativeForm(
  container: HTMLElement,
  contract: DeclarativeFormContract,
  initialValues: Record<string, unknown>,
  options: { onChange?: (values: Record<string, unknown>) => void } = {},
): DeclarativeFormHandle {
  const document = container.ownerDocument;
  let values = cloneValues(initialValues);
  let rows: Array<{ field: DeclarativeFieldContract; row: HTMLElement }> = [];
  let controlCleanups: Array<() => void> = [];

  function syncVisibility(): void {
    rows.forEach(({ field, row }) => {
      row.style.display = matchesVisibility(field.visibleWhen, values)
        ? ""
        : "none";
    });
  }

  function setValue(key: string, value: unknown): void {
    values[key] = value;
    syncVisibility();
    options.onChange?.(cloneValues(values));
  }

  function render(): void {
    controlCleanups.forEach((cleanup) => cleanup());
    controlCleanups = [];
    container.innerHTML = "";
    rows = [];
    const fields = Array.isArray(contract.fields) ? contract.fields : [];
    fields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "declarative-field-row";
      row.appendChild(createFieldLabel(field, document));
      const desc = createFieldDescription(field, document);
      if (desc) row.appendChild(desc);
      const control = createFieldControl(field, values, setValue, document);
      row.appendChild(control.element);
      if (control.destroy) controlCleanups.push(control.destroy);
      container.appendChild(row);
      rows.push({ field, row });
    });
    syncVisibility();
  }

  render();

  return {
    getValues: () => cloneValues(values),
    setValues: (nextValues: Record<string, unknown>) => {
      values = cloneValues(nextValues);
      render();
      options.onChange?.(cloneValues(values));
    },
    destroy: () => {
      controlCleanups.forEach((cleanup) => cleanup());
      controlCleanups = [];
      container.innerHTML = "";
      rows = [];
    },
  };
}

export function createDeclarativeModalShell(
  contract: DeclarativeModalContract,
): DeclarativeModalShell {
  const document = contract.ownerDocument || globalThis.document;
  function close(): void {
    root.classList.remove("show");
    root.setAttribute("aria-hidden", "true");
  }
  const frame = createModalFrame(document, {
    id: contract.id,
    surfaceId: contract.surfaceId,
    title: contract.title,
    width: contract.width,
    maxHeight: contract.maxHeight,
    onClose: close,
  });
  const root = frame.root;
  const bodyEl = frame.body;
  const footerEl = frame.footer;
  const open = () => {
    bodyEl.scrollTop = 0;
    root.classList.add("show");
    root.setAttribute("aria-hidden", "false");
  };

  document.body.appendChild(root);

  return {
    root,
    bodyEl,
    footerEl,
    open,
    close,
    destroy: () => root.remove(),
  };
}
