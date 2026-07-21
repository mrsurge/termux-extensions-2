export const DIALOG_SCHEMA_VERSION = 1;
export const MAX_DIALOG_PAYLOAD_BYTES = 512 * 1024;
export const MAX_DIALOG_FIELDS = 64;
export const MAX_DIALOG_ACTIONS = 16;
export const MAX_DIALOG_OPTIONS = 256;

export type PortableValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | PortableValue[]
  | { [key: string]: PortableValue };

export type DialogKind = "alert" | "confirm" | "prompt" | "form" | "surface";
export type DialogFieldKind =
  | "text"
  | "password"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "stringList"
  | "json"
  | "readonly";
export type DialogActionRole = "accept" | "cancel" | "close" | "destructive";
export type DialogResultStatus = "accepted" | "cancelled" | "closed" | "replaced";

export type DialogFieldOption = {
  value: PortableValue;
  label: string;
};

export type DialogField = {
  key: string;
  kind: DialogFieldKind;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  rows: number;
  value: PortableValue;
  options: DialogFieldOption[];
};

export type DialogAction = {
  id: string;
  label: string;
  role: DialogActionRole;
  primary: boolean;
  validate: boolean;
};

export type DialogSurface = {
  id: string;
  state?: PortableValue;
};

export type DialogRequest = {
  schemaVersion: 1;
  requestId: string;
  kind: DialogKind;
  title: string;
  message: string;
  detail: string;
  severity: "info" | "warning" | "error" | "danger";
  fields: DialogField[];
  actions: DialogAction[];
  initialFocus: string;
  defaultAction: string;
  cancelAction: string;
  width: "small" | "medium" | "large";
  dismissible: boolean;
  surface?: DialogSurface;
};

export type DialogResult = {
  status: DialogResultStatus;
  action: string | null;
  values: Record<string, PortableValue>;
};

export type DialogHostOpenMessage = {
  sessionId: string;
  request: DialogRequest;
};

export type DialogOpenResponse =
  | { ok: true; result: DialogResult }
  | { ok: false; error: string };

export type DialogHostCloseMessage = {
  status: DialogResultStatus;
};

export type DialogSize = {
  width: number;
  height: number;
};

export type DesktopDialogPresenter = {
  open(request: DialogRequest): Promise<DialogResult>;
  closeAll(status?: DialogResultStatus): void;
};

export type DialogHostBridge = {
  ready(): void;
  presented(sessionId: string, size: DialogSize): void;
  resized(sessionId: string, size: DialogSize): void;
  resolved(sessionId: string, result: DialogResult): void;
  failed(sessionId: string, message: string): void;
  onOpen(callback: (message: DialogHostOpenMessage) => void): () => void;
  onCloseAll(callback: (message: DialogHostCloseMessage) => void): () => void;
};

const DIALOG_KINDS = new Set<DialogKind>(["alert", "confirm", "prompt", "form", "surface"]);
const FIELD_KINDS = new Set<DialogFieldKind>([
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
const ACTION_ROLES = new Set<DialogActionRole>(["accept", "cancel", "close", "destructive"]);
const RESULT_STATUSES = new Set<DialogResultStatus>([
  "accepted",
  "cancelled",
  "closed",
  "replaced",
]);
const SURFACE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "requestId",
  "kind",
  "title",
  "message",
  "detail",
  "severity",
  "fields",
  "actions",
  "initialFocus",
  "defaultAction",
  "cancelAction",
  "width",
  "dismissible",
  "surface",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains unsupported key: ${unknown}`);
}

function requireString(value: unknown, label: string, maxLength: number, allowEmpty = true): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  if (!allowEmpty && !value) throw new TypeError(`${label} must not be empty`);
  if (value.length > maxLength) throw new TypeError(`${label} is too long`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

type PortableBudget = {
  nodes: number;
  stringBytes: number;
  seen: WeakSet<object>;
};

function copyPortable(
  value: unknown,
  label: string,
  budget: PortableBudget,
  depth = 0,
): PortableValue {
  if (depth > 16) throw new TypeError(`${label} is nested too deeply`);
  budget.nodes += 1;
  if (budget.nodes > 16_384) throw new TypeError(`${label} contains too many values`);

  if (value == null || typeof value === "boolean" || value === undefined) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (typeof value === "string") {
    budget.stringBytes += Buffer.byteLength(value, "utf8");
    if (budget.stringBytes > MAX_DIALOG_PAYLOAD_BYTES) {
      throw new TypeError(`${label} exceeds the dialog payload limit`);
    }
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${label} contains non-portable data`);
  if (budget.seen.has(value)) throw new TypeError(`${label} contains a cycle`);
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => copyPortable(item, `${label}[${index}]`, budget, depth + 1));
    }
    const record = requireRecord(value, label);
    const copy: Record<string, PortableValue> = {};
    for (const [key, item] of Object.entries(record)) {
      requireString(key, `${label} key`, 256, false);
      copy[key] = copyPortable(item, `${label}.${key}`, budget, depth + 1);
    }
    return copy;
  } finally {
    budget.seen.delete(value);
  }
}

function newPortableBudget(): PortableBudget {
  return { nodes: 0, stringBytes: 0, seen: new WeakSet() };
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new TypeError(`Unsupported ${label}: ${String(value)}`);
  }
  return value as T;
}

export function validateDialogRequest(value: unknown): DialogRequest {
  const input = requireRecord(value, "Dialog request");
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, "Dialog request");
  if (input.schemaVersion !== DIALOG_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported dialog schema version: ${String(input.schemaVersion)}`);
  }

  const budget = newPortableBudget();
  const requestId = requireString(input.requestId, "Dialog requestId", 160, false);
  const kind = enumValue(input.kind, DIALOG_KINDS, "dialog kind");
  const title = requireString(input.title, "Dialog title", 512);
  const message = requireString(input.message, "Dialog message", 64 * 1024);
  const detail = requireString(input.detail, "Dialog detail", 128 * 1024);
  budget.stringBytes += Buffer.byteLength(requestId + title + message + detail, "utf8");

  if (!Array.isArray(input.fields) || input.fields.length > MAX_DIALOG_FIELDS) {
    throw new TypeError(`Dialog fields must contain at most ${MAX_DIALOG_FIELDS} items`);
  }
  const fieldKeys = new Set<string>();
  const fields = input.fields.map((rawField, index): DialogField => {
    const field = requireRecord(rawField, `Dialog field ${index}`);
    rejectUnknownKeys(field, new Set([
      "key", "kind", "label", "description", "placeholder", "required", "rows", "value", "options",
    ]), `Dialog field ${index}`);
    const key = requireString(field.key, `Dialog field ${index} key`, 160, false);
    if (fieldKeys.has(key)) throw new TypeError(`Duplicate dialog field: ${key}`);
    fieldKeys.add(key);
    if (!Array.isArray(field.options) || field.options.length > MAX_DIALOG_OPTIONS) {
      throw new TypeError(`Dialog field ${key} options must contain at most ${MAX_DIALOG_OPTIONS} items`);
    }
    const options = field.options.map((rawOption, optionIndex): DialogFieldOption => {
      const option = requireRecord(rawOption, `Dialog field ${key} option ${optionIndex}`);
      rejectUnknownKeys(option, new Set(["value", "label"]), `Dialog field ${key} option ${optionIndex}`);
      return {
        value: copyPortable(option.value, `Dialog field ${key} option ${optionIndex}`, budget),
        label: requireString(option.label, `Dialog field ${key} option ${optionIndex} label`, 1024),
      };
    });
    const rows = Number(field.rows);
    if (!Number.isInteger(rows) || rows < 2 || rows > 24) {
      throw new TypeError(`Dialog field ${key} rows must be an integer between 2 and 24`);
    }
    return {
      key,
      kind: enumValue(field.kind, FIELD_KINDS, "dialog field kind"),
      label: requireString(field.label, `Dialog field ${key} label`, 1024),
      description: requireString(field.description, `Dialog field ${key} description`, 8192),
      placeholder: requireString(field.placeholder, `Dialog field ${key} placeholder`, 4096),
      required: requireBoolean(field.required, `Dialog field ${key} required`),
      rows,
      value: copyPortable(field.value, `Dialog field ${key} value`, budget),
      options,
    };
  });

  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > MAX_DIALOG_ACTIONS) {
    throw new TypeError(`Dialog actions must contain between 1 and ${MAX_DIALOG_ACTIONS} items`);
  }
  const actionIds = new Set<string>();
  const actions = input.actions.map((rawAction, index): DialogAction => {
    const action = requireRecord(rawAction, `Dialog action ${index}`);
    rejectUnknownKeys(
      action,
      new Set(["id", "label", "role", "primary", "validate"]),
      `Dialog action ${index}`,
    );
    const id = requireString(action.id, `Dialog action ${index} id`, 160, false);
    if (actionIds.has(id)) throw new TypeError(`Duplicate dialog action: ${id}`);
    actionIds.add(id);
    return {
      id,
      label: requireString(action.label, `Dialog action ${id} label`, 1024),
      role: enumValue(action.role, ACTION_ROLES, "dialog action role"),
      primary: requireBoolean(action.primary, `Dialog action ${id} primary`),
      validate: requireBoolean(action.validate, `Dialog action ${id} validate`),
    };
  });

  const defaultAction = requireString(input.defaultAction, "Dialog defaultAction", 160);
  const cancelAction = requireString(input.cancelAction, "Dialog cancelAction", 160);
  if (defaultAction && !actionIds.has(defaultAction)) {
    throw new TypeError(`Unknown default dialog action: ${defaultAction}`);
  }
  if (cancelAction && !actionIds.has(cancelAction)) {
    throw new TypeError(`Unknown cancel dialog action: ${cancelAction}`);
  }

  let surface: DialogSurface | undefined;
  if (input.surface !== undefined) {
    const rawSurface = requireRecord(input.surface, "Dialog surface");
    rejectUnknownKeys(rawSurface, new Set(["id", "state"]), "Dialog surface");
    const id = requireString(rawSurface.id, "Dialog surface id", 160, false);
    if (!SURFACE_ID_PATTERN.test(id)) throw new TypeError(`Invalid dialog surface id: ${id}`);
    surface = { id };
    if (Object.prototype.hasOwnProperty.call(rawSurface, "state")) {
      surface.state = copyPortable(rawSurface.state, "Dialog surface state", budget);
    }
  }
  if (kind === "surface" && !surface) {
    throw new TypeError("Surface dialogs require a stable surface.id");
  }
  if (budget.stringBytes > MAX_DIALOG_PAYLOAD_BYTES) {
    throw new TypeError("Dialog request exceeds the payload limit");
  }

  return {
    schemaVersion: 1,
    requestId,
    kind,
    title,
    message,
    detail,
    severity: enumValue(
      input.severity,
      new Set(["info", "warning", "error", "danger"] as const),
      "dialog severity",
    ),
    fields,
    actions,
    initialFocus: requireString(input.initialFocus, "Dialog initialFocus", 160),
    defaultAction,
    cancelAction,
    width: enumValue(
      input.width,
      new Set(["small", "medium", "large"] as const),
      "dialog width",
    ),
    dismissible: requireBoolean(input.dismissible, "Dialog dismissible"),
    ...(surface ? { surface } : {}),
  };
}

export function validateDialogResult(request: DialogRequest, value: unknown): DialogResult {
  const input = requireRecord(value, "Dialog result");
  rejectUnknownKeys(input, new Set(["status", "action", "values"]), "Dialog result");
  const status = enumValue(input.status, RESULT_STATUSES, "dialog result status");
  const action = input.action === null
    ? null
    : requireString(input.action, "Dialog result action", 160, false);
  if (action && !request.actions.some((item) => item.id === action)) {
    throw new TypeError(`Unknown dialog result action: ${action}`);
  }
  const values = copyPortable(input.values, "Dialog result values", newPortableBudget());
  if (!isRecord(values)) throw new TypeError("Dialog result values must be an object");
  return { status, action, values: values as Record<string, PortableValue> };
}

export function closedDialogResult(status: DialogResultStatus = "closed"): DialogResult {
  return { status, action: null, values: {} };
}
