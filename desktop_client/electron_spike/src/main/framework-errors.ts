type CodedError = Error & { code: string };

export const FRAMEWORK_REQUEST_TIMEOUT_MS = 5_000;
export const FRAMEWORK_UNAVAILABLE_CODE = "FRAMEWORK_UNAVAILABLE";

function nestedErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return "";
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && record.code) return record.code;
    current = record.cause;
  }
  return "";
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name || "")
    : "";
}

export function frameworkConnectionError(error: unknown): CodedError {
  const code = nestedErrorCode(error);
  const name = errorName(error);
  let message = "Framework unavailable";

  if (code === "ECONNREFUSED") {
    message = "Framework unavailable (connection refused)";
  } else if (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    name === "TimeoutError" ||
    name === "AbortError"
  ) {
    message = "Framework unavailable (connection timed out)";
  } else if (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "UND_ERR_SOCKET"
  ) {
    message = "Framework connection was interrupted";
  }

  return Object.assign(new Error(message), { code: FRAMEWORK_UNAVAILABLE_CODE });
}
