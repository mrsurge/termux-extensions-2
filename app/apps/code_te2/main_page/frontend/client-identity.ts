import {
  androidNativeRenderer,
  isAndroidNativePage,
  requestCefriumNative,
} from "./native-client-bridge.ts";

const CLIENT_STORAGE_KEYS = Object.freeze({
  primary: "te2.codeTe2.clientInstanceId.v1",
  secondary: "te2.codeTe2.secondaryClientInstanceId.v1",
});
const WINDOW_STORAGE_KEYS = Object.freeze({
  primary: "te2.codeTe2.windowId.v1",
  secondary: "te2.codeTe2.secondaryWindowId.v1",
});
const GECKO_IDENTITY_REQUEST = "te2.clientIdentity.request";
const GECKO_IDENTITY_RESPONSE = "te2.clientIdentity.response";
const ID_PATTERN = /^client_[a-z0-9]{12,64}$/;

interface ElectronIdentityBridge {
  readClientIdentity?: () => Promise<{ clientInstanceId: string }>;
  resetClientIdentity?: () => Promise<{ clientInstanceId: string }>;
}

interface NativeIdentityWindow extends Window {
  te2Electron?: ElectronIdentityBridge;
}

export interface CodeTe2ClientIdentity {
  clientInstanceId: string;
  windowId: string;
  consoleWorkerId: string;
  provider: "browser" | "electron" | "gecko" | "cefrium";
  label: string;
}

export type CodeTe2ClientRole = "primary" | "secondary";

function randomIdentity(prefix: "client" | "window"): string {
  const raw = globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase();
  return `${prefix}_${raw}`;
}

function validatedClientInstanceId(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ID_PATTERN.test(normalized)) {
    throw new Error("Native client identity is invalid");
  }
  return normalized;
}

function browserClientInstanceId(
  reset: boolean,
  role: CodeTe2ClientRole,
): string {
  if (reset) {
    window.localStorage.removeItem(CLIENT_STORAGE_KEYS.primary);
    window.localStorage.removeItem(CLIENT_STORAGE_KEYS.secondary);
  }
  const storageKey = CLIENT_STORAGE_KEYS[role];
  const existing = window.localStorage.getItem(storageKey);
  if (existing && ID_PATTERN.test(existing)) return existing;
  const generated = randomIdentity("client");
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

function windowIdentity(role: CodeTe2ClientRole): string {
  const storageKey = WINDOW_STORAGE_KEYS[role];
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing && /^window_[a-z0-9]{20,64}$/.test(existing)) return existing;
  const generated = randomIdentity("window");
  window.sessionStorage.setItem(storageKey, generated);
  return generated;
}

function requestGeckoClientIdentity(
  reset: boolean,
  role: CodeTe2ClientRole,
): Promise<string> {
  const requestTarget = role === "secondary" && window.parent !== window
    ? window.parent
    : window;
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Gecko native client identity bridge timed out"));
    }, 10_000);
    function onMessage(event: MessageEvent): void {
      if (
        event.source !== requestTarget ||
        event.origin !== window.location.origin
      )
        return;
      const data = event.data;
      if (
        !data ||
        data.channel !== GECKO_IDENTITY_RESPONSE ||
        data.requestId !== requestId
      )
        return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (data.result?.ok !== true) {
        reject(
          new Error(
            String(data.result?.error || "Gecko client identity failed"),
          ),
        );
        return;
      }
      try {
        resolve(validatedClientInstanceId(data.result.clientInstanceId));
      } catch (error) {
        reject(error);
      }
    }
    window.addEventListener("message", onMessage);
    requestTarget.postMessage(
      { channel: GECKO_IDENTITY_REQUEST, requestId, reset, role },
      window.location.origin,
    );
  });
}

async function nativeClientInstanceId(
  reset: boolean,
  role: CodeTe2ClientRole,
): Promise<{
  clientInstanceId: string;
  provider: CodeTe2ClientIdentity["provider"];
  label: string;
}> {
  const electron = (window as NativeIdentityWindow).te2Electron;
  if (typeof electron?.readClientIdentity === "function") {
    const result =
      reset && typeof electron.resetClientIdentity === "function"
        ? await electron.resetClientIdentity()
        : await electron.readClientIdentity();
    return {
      clientInstanceId: validatedClientInstanceId(result.clientInstanceId),
      provider: "electron",
      label: "Electron desktop installation",
    };
  }
  const renderer = androidNativeRenderer();
  if (renderer === "cefrium") {
    const result = await requestCefriumNative(
      reset ? "te2.clientIdentity.reset" : "te2.clientIdentity.read",
      { role },
    );
    return {
      clientInstanceId: validatedClientInstanceId(result.clientInstanceId),
      provider: "cefrium",
      label: "Cefrium Android installation",
    };
  }
  if (renderer === "gecko") {
    return {
      clientInstanceId: await requestGeckoClientIdentity(reset, role),
      provider: "gecko",
      label: "GeckoView Android installation",
    };
  }
  if (isAndroidNativePage()) {
    throw new Error("Android native renderer identity is missing or unsupported");
  }
  return {
    clientInstanceId: browserClientInstanceId(reset, role),
    provider: "browser",
    label: "Browser profile",
  };
}

export async function resolveCodeTe2ClientIdentity(
  options: { reset?: boolean; role?: CodeTe2ClientRole } = {},
): Promise<CodeTe2ClientIdentity> {
  const role = options.role === "secondary" ? "secondary" : "primary";
  const resolved = await nativeClientInstanceId(options.reset === true, role);
  const windowId = windowIdentity(role);
  return Object.freeze({
    ...resolved,
    windowId,
    consoleWorkerId: `main_page:${resolved.clientInstanceId}:${windowId}`,
  });
}

export function codeTe2ClientRoleFromLocation(): CodeTe2ClientRole {
  const params = new URLSearchParams(window.location.search);
  const explicit = (params.get("te2_editor_role") || "").trim().toLowerCase();
  if (explicit && explicit !== "primary" && explicit !== "secondary") {
    throw new Error("Code TE2 editor role is invalid");
  }
  if (explicit === "secondary") return "secondary";
  if (params.get("te2_desktop_editor") === "secondary") return "secondary";
  return "primary";
}
