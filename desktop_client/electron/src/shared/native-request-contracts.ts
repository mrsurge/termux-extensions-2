type UnknownRecord = Record<string, unknown>;

export type NativeRequestFailure = {
  ok: false;
  error: {
    message: string;
    code?: string;
  };
};

export type NativeRequestResult<T = unknown> =
  | { ok: true; value: T }
  | NativeRequestFailure;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestError(error: unknown): NativeRequestFailure["error"] {
  const message = error instanceof Error ? error.message : String(error || "Native request failed");
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
  return code ? { message, code } : { message };
}

export async function settleNativeRequest<T>(
  operation: () => T | Promise<T>,
): Promise<NativeRequestResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: requestError(error) };
  }
}

export function unwrapNativeRequestResult<T>(result: unknown): T {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error("Desktop native request returned an invalid result");
  }
  if (result.ok) return result.value as T;
  if (!isRecord(result.error) || typeof result.error.message !== "string") {
    throw new Error("Desktop native request returned an invalid error");
  }
  const error = new Error(result.error.message) as Error & { code?: string };
  error.name = "DesktopNativeRequestError";
  if (typeof result.error.code === "string") error.code = result.error.code;
  throw error;
}
