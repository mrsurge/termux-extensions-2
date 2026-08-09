interface ExtensionActivityTransport {
  call(
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export const EXTENSION_ACTIVITY_EVENT = "code-te2:extension-activity";
export const EXTENSION_ACTIVITY_READY_EVENT =
  "code-te2:extension-activity-bridge-ready";

let transport: ExtensionActivityTransport | null = null;

export function bindExtensionActivityTransport(
  nextTransport: ExtensionActivityTransport,
): void {
  transport = nextTransport;
  notifyExtensionActivityBridgeReady();
}

export function notifyExtensionActivityBridgeReady(): void {
  window.dispatchEvent(new CustomEvent(EXTENSION_ACTIVITY_READY_EVENT));
}

export function emitExtensionActivityEvent(
  payload: Record<string, unknown>,
): void {
  window.dispatchEvent(
    new CustomEvent(EXTENSION_ACTIVITY_EVENT, { detail: payload }),
  );
}

export function requestExtensionActivity(
  method: "extensions.activity.snapshot" | "extensions.logs.select",
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  if (!transport) {
    return Promise.reject(new Error("Extension activity bridge unavailable"));
  }
  return transport.call(method, params, {
    timeoutMs: options.timeoutMs ?? 8000,
  });
}
