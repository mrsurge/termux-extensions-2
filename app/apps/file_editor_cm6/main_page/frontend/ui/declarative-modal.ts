import {
  createJsonTextmateField,
  type JsonTextmateFieldHandle,
} from "./cm6-json-textmate-field.ts";

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
  title: string;
  width?: string;
  maxHeight?: string;
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

function createFieldLabel(field: DeclarativeFieldContract): HTMLElement {
  const label = document.createElement("label");
  label.className = "declarative-field-label";
  label.textContent = field.required ? `${field.label} *` : field.label;
  return label;
}

function createFieldDescription(
  field: DeclarativeFieldContract,
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
    const select = document.createElement("select");
    select.className = "declarative-input";
    const options = Array.isArray(field.options) ? field.options : [];
    options.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = item.label || formatValue(item.value);
      option.selected = sameValue(item.value, current);
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      const selected = options[Number(select.value)];
      onValue(field.key, selected ? selected.value : "");
    });
    return { element: select };
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
      row.appendChild(createFieldLabel(field));
      const desc = createFieldDescription(field);
      if (desc) row.appendChild(desc);
      const control = createFieldControl(field, values, setValue);
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
  const root = document.createElement("div");
  root.id = contract.id;
  root.className = "fe-modal declarative-modal";
  root.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.className = "fe-modal-card declarative-modal-card";
  if (contract.width) card.style.width = contract.width;
  if (contract.maxHeight) card.style.maxHeight = contract.maxHeight;

  const header = document.createElement("div");
  header.className = "fe-modal-header declarative-modal-header";

  const title = document.createElement("strong");
  title.textContent = contract.title;
  header.appendChild(title);

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  header.appendChild(spacer);

  const closeBtn = document.createElement("button");
  closeBtn.className = "fe-btn";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  header.appendChild(closeBtn);

  const bodyEl = document.createElement("div");
  bodyEl.className = "fe-modal-body declarative-modal-body";

  const footerEl = document.createElement("div");
  footerEl.className = "declarative-modal-footer";

  card.appendChild(header);
  card.appendChild(bodyEl);
  card.appendChild(footerEl);
  root.appendChild(card);

  const close = () => {
    root.classList.remove("show");
    root.setAttribute("aria-hidden", "true");
  };
  const open = () => {
    root.classList.add("show");
    root.setAttribute("aria-hidden", "false");
  };

  closeBtn.addEventListener("click", close);
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

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
