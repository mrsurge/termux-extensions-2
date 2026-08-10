function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorToRecord(error: Error): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.cause !== undefined) detail.cause = error.cause;
  return detail;
}

function safeJson(value: unknown): string | null {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return nested.toString();
      if (typeof nested === "function")
        return `[Function ${nested.name || "anonymous"}]`;
      if (nested instanceof Error) return errorToRecord(nested);
      if (nested && typeof nested === "object") {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return null;
  }
}

function trimMessage(message: string): string {
  const maxLength = 4000;
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength)}...`;
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value == null) return null;
  const json = safeJson(value);
  if (json && json !== "{}") return json;
  const text = String(value);
  return text && text !== "[object Object]" ? text : null;
}

// JSON-RPC error boundaries must preserve object-shaped runtime failures as useful text.
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = stringifyValue(
      (error as unknown as Record<string, unknown>).message,
    );
    if (message) {
      return trimMessage(
        error.name && error.name !== "Error"
          ? `${error.name}: ${message}`
          : message,
      );
    }
    const detail = stringifyValue(errorToRecord(error));
    if (detail) return trimMessage(detail);
  }

  if (isRecord(error)) {
    const message = stringifyValue(
      error.message ?? error.error ?? error.reason,
    );
    if (message) return trimMessage(message);
  }

  return trimMessage(stringifyValue(error) ?? "Unknown error");
}
